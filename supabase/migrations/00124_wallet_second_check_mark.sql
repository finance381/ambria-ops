-- A second, independent "checked" mark for Transfer and Vendor Payment
-- wallet_transactions rows — a separate reviewer from whoever does the
-- existing finance.wallet.mark_checked pass, gated by its own permission
-- (finance.wallet.mark_checked2) so the two can be assigned to different
-- people. Mirrors fn_toggle_wallet_check's exact structure (same
-- un-check rule: only the checker themself, or admin/auditor).

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS checked2_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS checked2_at timestamptz;

CREATE OR REPLACE FUNCTION public.fn_toggle_wallet_check2(p_transaction_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_checked_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_checked2') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT checked2_by INTO v_checked_by
  FROM wallet_transactions WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;

  IF v_checked_by IS NULL THEN
    UPDATE wallet_transactions SET checked2_by = v_uid, checked2_at = now()
    WHERE id = p_transaction_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_checked_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who checked this entry can un-check it';
  END IF;

  UPDATE wallet_transactions SET checked2_by = NULL, checked2_at = NULL
  WHERE id = p_transaction_id;
  RETURN false;
END;
$function$;

NOTIFY pgrst, 'reload schema';
