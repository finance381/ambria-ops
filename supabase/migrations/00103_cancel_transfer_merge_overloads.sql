-- cancel_transfer has had two overloads since before this session touched
-- it: a 1-arg version (sender can cancel their own still-pending transfer,
-- no special permission needed) and a 2-arg version with p_reason
-- DEFAULT NULL (requires finance.wallet.cancel_transfer; handles both
-- pending and already-completed transfers). Because p_reason has a
-- default, Postgres/PostgREST can satisfy a call with just p_transfer_id
-- from either overload — "Could not choose the best candidate function".
--
-- Merged into one function: a still-pending transfer can be cancelled by
-- its own sender OR by someone with the permission (preserves today's
-- actual behavior — the plain "Cancel" button on your own outgoing
-- transfer has no permission gate in the UI); reversing an
-- already-completed transfer (clawing money back out of the recipient's
-- wallet) still requires the explicit permission regardless of who's
-- calling, unchanged from the 2-arg version's existing behavior.

BEGIN;

DROP FUNCTION IF EXISTS public.cancel_transfer(uuid);

CREATE OR REPLACE FUNCTION public.cancel_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer wallet_transfers%ROWTYPE;
  v_sender_wallet wallets%ROWTYPE;
  v_recv_wallet wallets%ROWTYPE;
  v_sender_new_bal bigint;
  v_recv_new_bal bigint;
  v_debit wallet_transactions%ROWTYPE;
  v_credit wallet_transactions%ROWTYPE;
  v_sender_rev_id uuid;
  v_recv_rev_id uuid;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_notify_body text;
  v_desc_suffix text := CASE WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN ': ' || p_reason ELSE '' END;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status = 'cancelled' THEN RAISE EXCEPTION 'Transfer already cancelled'; END IF;

  IF v_transfer.status = 'pending' THEN
    -- Nothing has moved yet (initiate_transfer no longer debits) — the
    -- sender can void their own request; anyone else needs the permission.
    IF v_actor <> v_transfer.from_user_id AND NOT public.user_can('finance.wallet.cancel_transfer') THEN
      RAISE EXCEPTION 'Not permitted';
    END IF;

  ELSIF v_transfer.status = 'completed' THEN
    -- Already landed in the recipient's wallet — reversing it needs the
    -- explicit permission regardless of who's calling.
    IF NOT public.user_can('finance.wallet.cancel_transfer') THEN
      RAISE EXCEPTION 'Not permitted';
    END IF;

    SELECT * INTO v_debit FROM wallet_transactions
     WHERE reference_type = 'transfer' AND reference_id = p_transfer_id::text AND type = 'debit' FOR UPDATE;
    SELECT * INTO v_credit FROM wallet_transactions
     WHERE reference_type = 'transfer' AND reference_id = p_transfer_id::text AND type = 'credit' FOR UPDATE;
    IF v_debit.id IS NULL OR v_credit.id IS NULL THEN RAISE EXCEPTION 'Transfer rows not found'; END IF;
    IF v_debit.status = 'cancelled' OR v_credit.status = 'cancelled' THEN RAISE EXCEPTION 'Already cancelled'; END IF;

    SELECT * INTO v_sender_wallet FROM wallets WHERE id = v_debit.wallet_id FOR UPDATE;
    v_sender_new_bal := v_sender_wallet.balance_paise + v_debit.amount_paise;
    UPDATE wallets SET balance_paise = v_sender_new_bal WHERE id = v_sender_wallet.id;

    INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
    VALUES (v_sender_wallet.id, 'credit', v_debit.amount_paise, v_sender_new_bal,
            'Transfer cancelled' || v_desc_suffix, 'transfer_cancel', p_transfer_id::text, auth.uid(), 'completed')
    RETURNING id INTO v_sender_rev_id;

    UPDATE wallet_transactions
       SET status = 'cancelled', cancel_wallet_tx_id = v_sender_rev_id,
           cancelled_by = auth.uid(), cancelled_at = now(), cancelled_reason = p_reason
     WHERE id = v_debit.id;

    SELECT * INTO v_recv_wallet FROM wallets WHERE id = v_credit.wallet_id FOR UPDATE;
    v_recv_new_bal := v_recv_wallet.balance_paise - v_credit.amount_paise;
    UPDATE wallets SET balance_paise = v_recv_new_bal WHERE id = v_recv_wallet.id;

    INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
    VALUES (v_recv_wallet.id, 'debit', v_credit.amount_paise, v_recv_new_bal,
            'Transfer cancelled' || v_desc_suffix, 'transfer_cancel', p_transfer_id::text, auth.uid(), 'completed')
    RETURNING id INTO v_recv_rev_id;

    UPDATE wallet_transactions
       SET status = 'cancelled', cancel_wallet_tx_id = v_recv_rev_id,
           cancelled_by = auth.uid(), cancelled_at = now(), cancelled_reason = p_reason
     WHERE id = v_credit.id;
  ELSE
    RAISE EXCEPTION 'Unexpected transfer status: %', v_transfer.status;
  END IF;

  UPDATE wallet_transfers SET status = 'cancelled' WHERE id = p_transfer_id;

  SELECT name INTO v_actor_name FROM profiles WHERE id = v_actor;
  v_notify_body := coalesce(v_actor_name, 'Someone') || ' cancelled a transfer of ' ||
    (v_transfer.amount_paise / 100.0)::numeric(12,2) || ' pts' || v_desc_suffix;

  IF v_actor = v_transfer.from_user_id THEN
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  ELSIF v_actor = v_transfer.to_user_id THEN
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  ELSE
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify only one overload remains
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'cancel_transfer';
