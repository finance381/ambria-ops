-- cancel_transfer used to only let the SENDER cancel a still-PENDING
-- transfer (before the recipient confirms). Two things were missing:
--   1. The recipient had no way to reject an incoming transfer before
--      confirming it — only Confirm existed.
--   2. There was no way to undo an already-COMPLETED transfer at all (the
--      recipient already confirmed, money is sitting in their balance).
--
-- Unified into one function instead of two: a transfer's own `status` tells
-- it which case it's in, and either the sender, the recipient, or an admin
-- may call it either way — same three-way permission shape
-- fn_wallet_collect_cancel already uses (admin OR the person who owns this
-- side of the money).
--
-- Reason now optional (p_reason default null) rather than required, so the
-- existing pendingOutgoing "Cancel" button (no reason prompt) keeps working
-- unchanged; the new reason-collecting UI (WalletManager.jsx's renderCancelModal,
-- kind='transfer') always supplies one. wallet_transfers itself has no
-- reason column, so it's folded into the refund/reversal transaction's own
-- description — same as everywhere else in this file that has no dedicated
-- column for why something was reversed.
--
-- No insufficient-balance guard on the recipient clawback, matching
-- initiate_transfer's own explicit "Negative balance allowed by design" —
-- this is the same wallet, held to the same rule.

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
  v_desc_suffix text := CASE WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN ': ' || p_reason ELSE '' END;
BEGIN
  SELECT * INTO v_transfer FROM wallet_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.status = 'cancelled' THEN RAISE EXCEPTION 'Transfer already cancelled'; END IF;

  v_is_admin := public.is_admin_user();
  IF NOT (v_is_admin OR auth.uid() = v_transfer.from_user_id OR auth.uid() = v_transfer.to_user_id) THEN
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
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
