-- cancel_transfer (00069) never notified anyone when a transfer got
-- cancelled/rejected — Pratik sent Kanishk funds, Kanishk rejected it, and
-- Pratik had no way to find out short of checking his wallet. Whoever did
-- NOT call cancel_transfer gets told; if an admin cancelled it (neither
-- party), both sides are told.

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
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
  v_is_admin boolean;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_notify_body text;
  v_desc_suffix text := CASE WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN ': ' || p_reason ELSE '' END;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status = 'cancelled' THEN RAISE EXCEPTION 'Transfer already cancelled'; END IF;

  v_is_admin := public.is_admin_user();
  IF NOT (v_is_admin OR v_actor = v_transfer.from_user_id OR v_actor = v_transfer.to_user_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF v_transfer.status = 'pending' THEN
    -- Nothing has reached the recipient yet (confirm_transfer is what
    -- creates their wallet_transactions row, at confirmation time) — only
    -- the sender's own debit needs undoing.
    UPDATE wallets SET balance_paise = balance_paise + v_transfer.amount_paise WHERE user_id = v_transfer.from_user_id;
    SELECT * INTO v_sender_wallet FROM wallets WHERE user_id = v_transfer.from_user_id;

    INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
    VALUES (v_sender_wallet.id, 'credit', v_transfer.amount_paise, v_sender_wallet.balance_paise,
            'Transfer cancelled (refund)' || v_desc_suffix, 'transfer', p_transfer_id::text, auth.uid(), 'completed');

  ELSIF v_transfer.status = 'completed' THEN
    -- Already landed in the recipient's wallet — reverse both sides.
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
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet');
  ELSIF v_actor = v_transfer.to_user_id THEN
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet');
  ELSE
    -- Admin cancelled on behalf of neither party — tell both.
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet');
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet');
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
