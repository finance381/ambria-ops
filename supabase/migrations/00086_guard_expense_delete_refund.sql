-- Real root cause of the Pushpender AND Amar Kumar spurious-refund
-- incidents: it was never the refund_wallet_on_delete trigger (migrations
-- 00056/00059 hardened that one, but it's a BEFORE DELETE trigger, and
-- deleting an expense in this app has never done a hard SQL DELETE --
-- ExpenseDetail.jsx's deleteExp() does a plain `UPDATE expenses SET
-- deleted_at = now()`, so that trigger never actually fires for it).
--
-- The REAL refund-on-delete logic has always lived client-side in
-- ExpenseDetail.jsx: after the soft-delete update, if exp.status ===
-- 'recorded' it unconditionally calls wallet_self_credit / wallet_admin_credit
-- for the full amount -- with no check that a debit ever actually landed.
-- Both incidents were the identical shape: a duplicate expense row created
-- during a connectivity hiccup that was never actually debited (the
-- debit-on-approval step silently failed), then deleted -- manufacturing a
-- refund with nothing behind it.
--
-- wallet_self_credit/wallet_admin_credit stay untouched -- they're generic,
-- shared primitives used elsewhere for legitimate unconditional credits, not
-- the place to bolt an expense-specific guard onto. Instead, one new RPC
-- does the whole soft-delete + guarded-refund atomically server-side,
-- replacing the two unguarded client-orchestrated steps (which also meant a
-- client retry after a flaky response could double-credit the same
-- legitimate refund -- this closes that too, since it's now one transaction).

BEGIN;

CREATE OR REPLACE FUNCTION fn_delete_expense_and_refund(p_expense_id bigint, p_delete_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_wallet wallets%ROWTYPE;
  v_debit_exists boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found'; END IF;
  IF v_exp.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'already_deleted'; END IF;

  -- Mirrors ExpenseDetail.jsx's canDelete exactly: the submitter themselves
  -- (only while recorded/flagged), or an admin/finance-approver, any status.
  v_is_admin := user_role() = 'admin' OR user_can('finance.expenses.approve');
  IF NOT (v_is_admin OR (v_exp.user_id = v_uid AND v_exp.status IN ('recorded', 'flagged'))) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  UPDATE expenses
  SET deleted_at = now(), deleted_by = v_uid, delete_reason = p_delete_reason
  WHERE id = p_expense_id;

  IF v_exp.status = 'recorded' AND COALESCE(v_exp.amount_paise, 0) > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_exp.user_id FOR UPDATE;
    IF FOUND THEN
      -- The guard both 00056 and 00059 already established for the (as it
      -- turns out, unused) trigger path -- only refund if a debit for this
      -- exact expense is actually sitting there to refund against.
      SELECT EXISTS (
        SELECT 1 FROM wallet_transactions
        WHERE wallet_id = v_wallet.id AND type = 'debit'
          AND reference_type = 'expense' AND reference_id = p_expense_id::text
      ) INTO v_debit_exists;

      IF v_debit_exists THEN
        UPDATE wallets SET balance_paise = balance_paise + v_exp.amount_paise, updated_at = now()
        WHERE id = v_wallet.id;

        INSERT INTO wallet_transactions
          (wallet_id, type, amount_paise, balance_after_paise, description,
           reference_type, reference_id, performed_by, status)
        VALUES
          (v_wallet.id, 'credit', v_exp.amount_paise, v_wallet.balance_paise + v_exp.amount_paise,
           'Refund: deleted expense', 'expense_refund', p_expense_id::text, v_uid, 'completed');
      END IF;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
