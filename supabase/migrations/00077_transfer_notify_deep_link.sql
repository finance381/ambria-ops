-- Every transfer notification (sent, received-confirmation, cancelled) used
-- the bare link 'wallet' — opens the Wallet tab, but at whichever view it
-- last was, pointing at nothing in particular. Clicking a transfer
-- notification should land you on the actual entry, not just the module.
--
-- Carries the transfer's own id (wallet_transfers.id), not a
-- wallet_transactions id, since that's the one identifier stable across the
-- pending -> completed lifecycle: at "transfer sent" time the recipient has
-- no wallet_transactions row yet (confirm_transfer creates it), but the
-- transfer row itself already exists. The frontend opens the viewer's own
-- wallet, switches to the transactions list filtered to transfers, and
-- scrolls to whichever row (sender's debit or recipient's credit) carries
-- this reference_id.
--
-- Bodies are unchanged from 00060/00071/00072 except the link argument on
-- each fn_notify call.

BEGIN;

CREATE OR REPLACE FUNCTION public.initiate_transfer(p_to_user_id uuid, p_amount_paise bigint, p_description text DEFAULT ''::text, p_sender_image text DEFAULT NULL::text, p_transfer_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_from_id uuid := auth.uid();
  v_wallet wallets%rowtype;
  v_transfer_id uuid;
  v_from_name text;
begin
  if v_from_id = p_to_user_id then
    raise exception 'Cannot transfer to yourself';
  end if;
  -- Auto-create recipient wallet if missing
  insert into wallets (user_id, balance_paise) values (p_to_user_id, 0) on conflict (user_id) do nothing;
  select * into v_wallet from wallets where user_id = v_from_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  -- Negative balance allowed by design; no insufficient-balance check.
  update wallets set balance_paise = balance_paise - p_amount_paise where user_id = v_from_id;
  insert into wallet_transfers (from_user_id, to_user_id, amount_paise, description, sender_image_path, transfer_date)
  values (v_from_id, p_to_user_id, p_amount_paise, p_description, p_sender_image, coalesce(p_transfer_date, current_date))
  returning id into v_transfer_id;
  insert into wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  values (v_wallet.id, 'debit', p_amount_paise, v_wallet.balance_paise - p_amount_paise, 'Transfer: ' || p_description, 'transfer', v_transfer_id::text, v_from_id, 'completed');

  select name into v_from_name from profiles where id = v_from_id;
  perform fn_notify(
    p_to_user_id, 'transfer_sent', 'Funds received',
    coalesce(v_from_name, 'Someone') || ' sent you ' || (p_amount_paise / 100.0)::numeric(12,2) || ' pts',
    'wallet:' || v_transfer_id
  );

  return v_transfer_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_transfer(p_transfer_id uuid, p_receiver_image text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer wallet_transfers%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_to_name text;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status <> 'pending' THEN RAISE EXCEPTION 'Transfer is not pending'; END IF;
  IF v_transfer.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Not the receiver'; END IF;

  INSERT INTO wallets (user_id, balance_paise) VALUES (v_transfer.to_user_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE wallets SET balance_paise = balance_paise + v_transfer.amount_paise WHERE user_id = v_transfer.to_user_id;
  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_transfer.to_user_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES (v_wallet.id, 'credit', v_transfer.amount_paise, v_wallet.balance_paise, 'Transfer from: ' || COALESCE(v_transfer.description, ''), 'transfer', p_transfer_id::text, v_transfer.from_user_id, 'completed');

  UPDATE wallet_transfers SET status = 'completed', receiver_image_path = p_receiver_image, completed_at = now() WHERE id = p_transfer_id;

  SELECT name INTO v_to_name FROM profiles WHERE id = v_transfer.to_user_id;
  PERFORM fn_notify(
    v_transfer.from_user_id, 'transfer_received', 'Transfer confirmed',
    coalesce(v_to_name, 'The recipient') || ' confirmed receiving ' || (v_transfer.amount_paise / 100.0)::numeric(12,2) || ' pts',
    'wallet:' || p_transfer_id
  );
END;
$function$;

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
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_notify_body text;
  v_desc_suffix text := CASE WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN ': ' || p_reason ELSE '' END;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status = 'cancelled' THEN RAISE EXCEPTION 'Transfer already cancelled'; END IF;

  IF NOT public.user_can('finance.wallet.cancel_transfer') THEN
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
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  ELSIF v_actor = v_transfer.to_user_id THEN
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  ELSE
    -- The canceller is neither party (an admin or someone granted the
    -- permission without being involved) — tell both sides.
    PERFORM fn_notify(v_transfer.from_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
    PERFORM fn_notify(v_transfer.to_user_id, 'transfer_cancelled', 'Transfer cancelled', v_notify_body, 'wallet:' || p_transfer_id);
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
