-- A second, independent stamp alongside "Checked" (00042/43/45/46):
-- "Entered in Tally" — a separate bookkeeping step, so it gets its own
-- column and permission rather than overloading finance.wallet.mark_checked.
-- Same four tables, same toggle shape, same same-person-or-admin/auditor
-- un-mark rule — only the permission string and column names differ.

BEGIN;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS tally_entered_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tally_entered_at timestamptz;

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS tally_entered_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tally_entered_at timestamptz;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS tally_entered_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tally_entered_at timestamptz;

ALTER TABLE cost_transfers
  ADD COLUMN IF NOT EXISTS tally_entered_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tally_entered_at timestamptz;

CREATE OR REPLACE FUNCTION fn_toggle_wallet_tally_entered(p_transaction_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entered_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT tally_entered_by INTO v_entered_by
  FROM wallet_transactions WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;

  IF v_entered_by IS NULL THEN
    UPDATE wallet_transactions SET tally_entered_by = v_uid, tally_entered_at = now()
    WHERE id = p_transaction_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_entered_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who marked this entered can undo it';
  END IF;

  UPDATE wallet_transactions SET tally_entered_by = NULL, tally_entered_at = NULL
  WHERE id = p_transaction_id;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION fn_toggle_ledger_tally_entered(p_entry_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entered_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT tally_entered_by INTO v_entered_by
  FROM ledger_entries WHERE id = p_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry not found';
  END IF;

  IF v_entered_by IS NULL THEN
    UPDATE ledger_entries SET tally_entered_by = v_uid, tally_entered_at = now()
    WHERE id = p_entry_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_entered_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who marked this entered can undo it';
  END IF;

  UPDATE ledger_entries SET tally_entered_by = NULL, tally_entered_at = NULL
  WHERE id = p_entry_id;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION fn_toggle_expense_tally_entered(p_expense_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entered_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT tally_entered_by INTO v_entered_by
  FROM expenses WHERE id = p_expense_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense not found';
  END IF;

  IF v_entered_by IS NULL THEN
    UPDATE expenses SET tally_entered_by = v_uid, tally_entered_at = now()
    WHERE id = p_expense_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_entered_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who marked this entered can undo it';
  END IF;

  UPDATE expenses SET tally_entered_by = NULL, tally_entered_at = NULL
  WHERE id = p_expense_id;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION fn_toggle_cost_transfer_tally_entered(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entered_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT tally_entered_by INTO v_entered_by
  FROM cost_transfers WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;

  IF v_entered_by IS NULL THEN
    UPDATE cost_transfers SET tally_entered_by = v_uid, tally_entered_at = now()
    WHERE id = p_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_entered_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who marked this entered can undo it';
  END IF;

  UPDATE cost_transfers SET tally_entered_by = NULL, tally_entered_at = NULL
  WHERE id = p_id;
  RETURN false;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
