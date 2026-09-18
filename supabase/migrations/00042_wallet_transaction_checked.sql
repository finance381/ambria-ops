-- "Checked" flow for the wallet ledger — a finance controller opens any
-- wallet_transactions row (expense, transfer, issue, collection, vendor/
-- salary payment — every reference_type already unified in this one table)
-- and marks it checked, separate from the expense-specific acknowledge/
-- resubmit/deduct review. It's a same-person-reversible stamp, not a
-- permission-gated approval: `user_can` only gates who may toggle it at
-- all, and un-checking is further restricted to the person who checked it
-- (or an admin/auditor override) inside the function itself.
--
-- wallet_transactions is created directly in Studio (like the RPCs this
-- migration mirrors — pay_vendor, fn_wallet_collect), not tracked in this
-- repo's earlier migrations.

BEGIN;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE OR REPLACE FUNCTION fn_toggle_wallet_check(p_transaction_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_checked_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_checked') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT checked_by INTO v_checked_by
  FROM wallet_transactions WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;

  IF v_checked_by IS NULL THEN
    UPDATE wallet_transactions SET checked_by = v_uid, checked_at = now()
    WHERE id = p_transaction_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_checked_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who checked this entry can un-check it';
  END IF;

  UPDATE wallet_transactions SET checked_by = NULL, checked_at = NULL
  WHERE id = p_transaction_id;
  RETURN false;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
