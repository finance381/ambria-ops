-- The expense deduction (penalty) action used to post a debit to the
-- salary ledger via this trigger, on top of docking the wallet. Now that
-- ExpenseDetail.jsx's deduct() credits the wallet back for the deducted
-- amount (the same wallet_admin_credit RPC the full "flag" refund already
-- uses), the salary-ledger side is no longer wanted at all — a deduction
-- should only ever move money in the wallet.
--
-- Looked up by trigger name rather than a hardcoded table, since its exact
-- table was never tracked in a migration — this drops it wherever it
-- actually lives.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'trg_expense_deduction_to_salary_ledger'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.trigger_name, r.table_name);
  END LOOP;
END $$;
