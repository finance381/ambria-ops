-- Extends the "checked" stamp to cost_transfers, same pattern and
-- permission (finance.wallet.mark_checked) as wallet_transactions (00042)
-- and ledger_entries (00043).

ALTER TABLE cost_transfers
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE OR REPLACE FUNCTION fn_toggle_cost_transfer_check(p_id bigint)
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
  FROM cost_transfers WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;

  IF v_checked_by IS NULL THEN
    UPDATE cost_transfers SET checked_by = v_uid, checked_at = now()
    WHERE id = p_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_checked_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who checked this entry can un-check it';
  END IF;

  UPDATE cost_transfers SET checked_by = NULL, checked_at = NULL
  WHERE id = p_id;
  RETURN false;
END;
$$;

NOTIFY pgrst, 'reload schema';
