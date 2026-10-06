-- Event collections recorded as "Bank" had no way to say which channel the
-- money actually came through (UPI vs NEFT vs a credit card machine vs
-- cheque) — useful for reconciling against statements from different
-- accounts/machines. New optional column, only meaningful for bank mode;
-- left NULL for cash.
--
-- fn_wallet_collect's body is otherwise unchanged from 00053 — only the new
-- param and the one extra column in the wallet_transactions insert.

BEGIN;

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS bank_payment_type text
    CHECK (bank_payment_type IS NULL OR bank_payment_type IN ('UPI', 'NEFT', 'HDFC Credit Card Machine', 'Paytm Credit Card Machine', 'Cheque'));

CREATE OR REPLACE FUNCTION public.fn_wallet_collect(p_event_id bigint, p_payment_mode text, p_amount_paise bigint, p_description text, p_receipt_path text, p_bank_payment_type text DEFAULT NULL)
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
  IF p_payment_mode = 'bank' AND (p_bank_payment_type IS NULL OR length(trim(p_bank_payment_type)) = 0) THEN
    RAISE EXCEPTION 'payment type required for bank collections';
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
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status, payment_mode, bank_payment_type, received_image_path, received_at, receipt_no)
  VALUES
    (v_wallet.id, 'credit', p_amount_paise, v_new_bal, p_description, 'collection', p_event_id::text, auth.uid(), 'completed', p_payment_mode, p_bank_payment_type, p_receipt_path, now(), v_receipt_no)
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

NOTIFY pgrst, 'reload schema';

COMMIT;
