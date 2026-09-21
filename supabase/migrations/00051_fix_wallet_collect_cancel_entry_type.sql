-- fn_wallet_collect_cancel inserted its event_ledger reversal row with
-- entry_type = 'collection_cancel', which was never in
-- event_ledger_entry_type_check's allowed list ('collection', 'lms_advance',
-- 'expense', 'requisition', 'po', 'refund', 'adjustment') — so every
-- collection cancel failed with a constraint violation before it could
-- complete. Changed to 'adjustment' (an internal correction, not a
-- customer refund — the direction='out' column already carries the
-- "this reverses money" meaning). Everything else is unchanged from the
-- live function.

BEGIN;

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
  IF v_wallet.balance_paise < v_orig.amount_paise THEN
    RAISE EXCEPTION 'insufficient wallet balance to reverse (need %, have %)', v_orig.amount_paise, v_wallet.balance_paise;
  END IF;

  v_new_bal := v_wallet.balance_paise - v_orig.amount_paise;
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
