-- Removes the ₹1,00,000-per-expense hard cap (00007_triggers.sql,
-- trg_expense_validate / validate_expense()). Users should not be gated on
-- expense amount at all, at any size.
DROP TRIGGER IF EXISTS trg_expense_validate ON expenses;
DROP FUNCTION IF EXISTS validate_expense();
