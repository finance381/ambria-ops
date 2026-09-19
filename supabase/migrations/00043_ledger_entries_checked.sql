-- Extends the "checked" stamp (00042, wallet_transactions) to ledger_entries
-- — vendor and salary ledger rows (purchases, payments, deductions,
-- adjustments) live there instead, so a vendor_payment entry in
-- VendorLedger.jsx needs its own checked_by/checked_at + toggle function.
-- Reuses the same finance.wallet.mark_checked permission — one permission
-- covers both surfaces, since it's the same "finance controller reviewed
-- this" action either way.

BEGIN;

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE OR REPLACE FUNCTION fn_toggle_ledger_check(p_entry_id bigint)
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
  FROM ledger_entries WHERE id = p_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry not found';
  END IF;

  IF v_checked_by IS NULL THEN
    UPDATE ledger_entries SET checked_by = v_uid, checked_at = now()
    WHERE id = p_entry_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_checked_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who checked this entry can un-check it';
  END IF;

  UPDATE ledger_entries SET checked_by = NULL, checked_at = NULL
  WHERE id = p_entry_id;
  RETURN false;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
