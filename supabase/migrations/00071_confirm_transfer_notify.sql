-- confirm_transfer is the RPC WalletManager.jsx's "Confirm Received" button
-- actually calls — the transfer_received notification from migration 00060
-- was wired into confirm_wallet_receive instead, a different generic RPC
-- that isn't the one used for transfers, so it never fired in practice.

BEGIN;

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
    'wallet'
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
