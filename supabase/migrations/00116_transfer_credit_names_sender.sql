-- The recipient's own credit row for a wallet transfer has never actually
-- said who sent it — confirm_transfer wrote its description as literally
-- "Transfer from: " + the sender's free-text note (itself usually ending in
-- "-> <recipient name>", baked in client-side before the RPC call), with no
-- substitution of the sender's own name anywhere in the stored text. The
-- only place the sender's name ever showed up was a client-side join
-- (transferParties/walletProfiles) rendered conditionally on top of it,
-- which is why it silently went missing in some views/rows (reported: a
-- transfer card with no way to tell who sent it). Baking the resolved name
-- into the persisted description — the same pattern already used for the
-- sender's own debit-side "-> <recipient>" — makes this a DB-level fact
-- instead of something that depends on the right data happening to be
-- loaded client-side.
--
-- Signature unchanged from 00101_wallet_transfer_debit_on_accept.sql — only
-- the credit-side description text changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_transfer(p_transfer_id uuid, p_receiver_image text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer wallet_transfers%ROWTYPE;
  v_sender_wallet wallets%ROWTYPE;
  v_recv_wallet wallets%ROWTYPE;
  v_to_name text;
  v_from_name text;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status <> 'pending' THEN RAISE EXCEPTION 'Transfer is not pending'; END IF;
  IF v_transfer.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'Not the receiver'; END IF;

  SELECT name INTO v_from_name FROM profiles WHERE id = v_transfer.from_user_id;

  -- The sender's debit now happens here, together with the recipient's
  -- credit, instead of back when the transfer was only initiated.
  -- Negative balance allowed by design; no insufficient-balance check.
  SELECT * INTO v_sender_wallet FROM wallets WHERE user_id = v_transfer.from_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sender wallet not found'; END IF;
  UPDATE wallets SET balance_paise = balance_paise - v_transfer.amount_paise WHERE user_id = v_transfer.from_user_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES (v_sender_wallet.id, 'debit', v_transfer.amount_paise, v_sender_wallet.balance_paise - v_transfer.amount_paise,
          'Transfer: ' || COALESCE(v_transfer.description, ''), 'transfer', p_transfer_id::text, v_transfer.from_user_id, 'completed');

  INSERT INTO wallets (user_id, balance_paise) VALUES (v_transfer.to_user_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE wallets SET balance_paise = balance_paise + v_transfer.amount_paise WHERE user_id = v_transfer.to_user_id;
  SELECT * INTO v_recv_wallet FROM wallets WHERE user_id = v_transfer.to_user_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES (v_recv_wallet.id, 'credit', v_transfer.amount_paise, v_recv_wallet.balance_paise,
          'Transfer from ' || COALESCE(v_from_name, 'Unknown') || ': ' || COALESCE(v_transfer.description, ''),
          'transfer', p_transfer_id::text, v_transfer.from_user_id, 'completed');

  UPDATE wallet_transfers SET status = 'completed', receiver_image_path = p_receiver_image, completed_at = now() WHERE id = p_transfer_id;

  SELECT name INTO v_to_name FROM profiles WHERE id = v_transfer.to_user_id;
  PERFORM fn_notify(
    v_transfer.from_user_id, 'transfer_received', 'Transfer confirmed',
    coalesce(v_to_name, 'The recipient') || ' confirmed receiving ' || (v_transfer.amount_paise / 100.0)::numeric(12,2) || ' pts',
    'wallet:' || p_transfer_id
  );
END;
$function$;

-- Backfill: every already-completed transfer's credit row, so existing
-- history gets the sender's name too, not just transfers confirmed from now on.
UPDATE wallet_transactions wtx
SET description = 'Transfer from ' || p.name || ': ' || regexp_replace(wtx.description, '^Transfer from:\s*', '')
FROM wallet_transfers wt
JOIN profiles p ON p.id = wt.from_user_id
WHERE wtx.reference_type = 'transfer'
  AND wtx.type = 'credit'
  AND wtx.reference_id = wt.id::text
  AND p.name IS NOT NULL
  AND wtx.description NOT LIKE 'Transfer from ' || p.name || ':%';

NOTIFY pgrst, 'reload schema';

COMMIT;
