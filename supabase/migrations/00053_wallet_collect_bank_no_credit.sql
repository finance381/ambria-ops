-- fn_wallet_collect credited the collector's wallet balance for BOTH cash
-- and bank collections. Bank collections never physically pass through the
-- collector's hands (the guest pays into the company account directly) —
-- crediting the wallet for bank made it look like the collector was
-- carrying money they never held. Bank collections should still be
-- recorded (wallet_transactions row + event_ledger entry, so they show up
-- in history and event balance calculations), just without moving the
-- wallet's balance_paise.
--
-- fn_wallet_collect_cancel is fixed to match: only debit the wallet back
-- when reversing a CASH collection; a bank collection's cancel leaves the
-- wallet balance untouched too (mirrors the credit side).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_wallet_collect(p_event_id bigint, p_payment_mode text, p_amount_paise bigint, p_description text, p_receipt_path text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet public.wallets%rowtype;
  v_new_bal bigint;
  v_tx_id uuid;
  v_ledger_id bigint;
  v_ledger_amount_paise bigint;
  v_agreed bigint;
  v_collected bigint;
  v_pending_after bigint;
  v_over boolean := false;
  v_event_exists boolean;
  v_receipt_no text;
  v_mode_letter char;
BEGIN
  IF p_payment_mode NOT IN ('cash','bank') THEN RAISE EXCEPTION 'invalid payment_mode'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF p_payment_mode = 'bank' AND (p_receipt_path IS NULL OR length(trim(p_receipt_path)) = 0) THEN
    RAISE EXCEPTION 'receipt required for bank collections';
  END IF;
  SELECT true INTO v_event_exists FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;

  IF p_payment_mode = 'cash' THEN
    v_ledger_amount_paise := p_amount_paise / 10;
  ELSE
    v_ledger_amount_paise := p_amount_paise;
  END IF;

  -- Only cash physically sits with the collector — only cash moves the wallet.
  IF p_payment_mode = 'cash' THEN
    v_new_bal := v_wallet.balance_paise + p_amount_paise;
  ELSE
    v_new_bal := v_wallet.balance_paise;
  END IF;
  UPDATE public.wallets SET balance_paise = v_new_bal WHERE id = v_wallet.id;

  v_mode_letter := CASE p_payment_mode WHEN 'cash' THEN 'C' ELSE 'B' END;
  v_receipt_no := fn_next_receipt_no(fn_indian_fy_code(current_date), v_mode_letter);

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status, payment_mode, received_image_path, received_at, receipt_no)
  VALUES
    (v_wallet.id, 'credit', p_amount_paise, v_new_bal, p_description, 'collection', p_event_id::text, auth.uid(), 'completed', p_payment_mode, p_receipt_path, now(), v_receipt_no)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.event_ledger
    (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by)
  VALUES
    (p_event_id, 'collection', 'in', p_payment_mode, v_ledger_amount_paise, 'wallet_transaction', v_tx_id::text, p_description, auth.uid())
  RETURNING id INTO v_ledger_id;

  SELECT
    CASE WHEN p_payment_mode='cash' THEN COALESCE(agreed_cash_paise, 0) ELSE COALESCE(agreed_bank_paise, 0) END,
    CASE WHEN p_payment_mode='cash'
      THEN (SELECT COALESCE(SUM(amount_paise),0) FROM public.event_ledger WHERE event_id = p_event_id AND direction='in' AND payment_mode='cash')
      ELSE (SELECT COALESCE(SUM(amount_paise),0) FROM public.event_ledger WHERE event_id = p_event_id AND direction='in' AND payment_mode='bank')
    END
  INTO v_agreed, v_collected
  FROM public.events WHERE id = p_event_id;
  v_pending_after := v_agreed - v_collected;
  IF v_agreed > 0 AND v_pending_after < 0 THEN v_over := true; END IF;

  RETURN json_build_object(
    'wallet_tx_id', v_tx_id,
    'receipt_no', v_receipt_no,
    'ledger_id', v_ledger_id,
    'new_balance_paise', v_new_bal,
    'over_agreed', v_over,
    'pending_after_paise', v_pending_after,
    'ledger_amount_paise', v_ledger_amount_paise
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_wallet_collect_cancel(p_txn_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orig      public.wallet_transactions%rowtype;
  v_wallet    public.wallets%rowtype;
  v_new_bal   bigint;
  v_rev_tx_id uuid;
  v_rev_led_id bigint;
  v_ledger_amount_paise bigint;
  v_event_id  bigint;
  v_is_admin  boolean;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason required (min 3 chars)'; END IF;

  SELECT * INTO v_orig FROM public.wallet_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_orig.reference_type <> 'collection' THEN RAISE EXCEPTION 'only collection txns can be cancelled here'; END IF;
  IF v_orig.status = 'cancelled' THEN RAISE EXCEPTION 'already cancelled'; END IF;
  IF v_orig.cancel_wallet_tx_id IS NOT NULL THEN RAISE EXCEPTION 'already cancelled'; END IF;

  -- Permission: admin OR original collector (any time)
  v_is_admin := public.is_admin_user();
  IF NOT (v_is_admin OR v_orig.performed_by = auth.uid()) THEN
    RAISE EXCEPTION 'only admin or the original collector can cancel';
  END IF;

  v_event_id := v_orig.reference_id::bigint;

  -- Lock collector wallet
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_orig.wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;

  -- Only cash was ever credited to the wallet — only cash reverses it back out.
  IF v_orig.payment_mode = 'cash' THEN
    IF v_wallet.balance_paise < v_orig.amount_paise THEN
      RAISE EXCEPTION 'insufficient wallet balance to reverse (need %, have %)', v_orig.amount_paise, v_wallet.balance_paise;
    END IF;
    v_new_bal := v_wallet.balance_paise - v_orig.amount_paise;
  ELSE
    v_new_bal := v_wallet.balance_paise;
  END IF;
  UPDATE public.wallets SET balance_paise = v_new_bal WHERE id = v_wallet.id;

  -- Reversing wallet_transaction (debit)
  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'debit', v_orig.amount_paise, v_new_bal,
     'Cancel: ' || COALESCE(v_orig.description, 'collection') || ' — ' || p_reason,
     'collection_cancel', v_orig.id::text, auth.uid(), 'completed')
  RETURNING id INTO v_rev_tx_id;

  -- Reversing event_ledger (direction='out', mirror cash-halving rule from fn_wallet_collect)
  IF v_orig.payment_mode = 'cash' THEN
    v_ledger_amount_paise := v_orig.amount_paise / 10;
  ELSE
    v_ledger_amount_paise := v_orig.amount_paise;
  END IF;

  INSERT INTO public.event_ledger
    (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by)
  VALUES
    (v_event_id, 'adjustment', 'out', v_orig.payment_mode, v_ledger_amount_paise,
     'wallet_transaction', v_rev_tx_id::text,
     'Cancel #' || COALESCE(v_orig.receipt_no, v_orig.id::text) || ': ' || p_reason,
     auth.uid())
  RETURNING id INTO v_rev_led_id;

  -- Mark original cancelled
  UPDATE public.wallet_transactions
  SET status              = 'cancelled',
      cancel_wallet_tx_id = v_rev_tx_id,
      cancel_ledger_id    = v_rev_led_id,
      cancelled_by        = auth.uid(),
      cancelled_at        = now(),
      cancelled_reason    = p_reason
  WHERE id = p_txn_id;

  RETURN json_build_object(
    'cancel_wallet_tx_id', v_rev_tx_id,
    'cancel_ledger_id',    v_rev_led_id,
    'new_balance_paise',   v_new_bal
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
