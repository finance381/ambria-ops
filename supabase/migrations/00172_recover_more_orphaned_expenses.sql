-- More victims of the same bigint-vs-int4 department_id lookup bug
-- (ExpenseForm.jsx, fixed this session) found via a system-wide scan for
-- expenses with zero expense_allocations rows. Five distinct real expenses
-- get their allocation (and wallet debit, where one didn't already land)
-- recovered below. #8 already has a wallet_transactions row (status is
-- already 'acknowledged'), so only its allocation is added.
--
-- #2356-2361 are a separate case: 6 IDENTICAL entries (same description,
-- amount, type/sub-type) submitted by the same user within 3 minutes of
-- each other -- almost certainly the same bug causing repeated
-- failed-submit retries, not 6 real expenses. Per decision: keep only the
-- first (2356) as real, soft-delete the other 5 (kept in the DB for audit,
-- excluded everywhere deleted_at is filtered).

-- #8 -- ARC Expenses (Restro Cafe Palam) -> Venue, already acknowledged + already debited
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 8, 'Venue', 22, NULL, 52, 311, 306000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 8);

-- #413 -- LGT-Light (ADD) -> Decor
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 413, 'Decor', 16, NULL, 40, 31, 28800, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 413);

-- #463 -- FRN-Furniture (ADD) -> Decor
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 463, 'Decor', 16, NULL, 44, 172, 16000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 463);

-- #1159 -- KTM Expenses -> Venue
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 1159, 'Venue', 22, NULL, 48, 242, 200000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 1159);

-- #2158 -- CRO Expenses (Crockery) -> Catering
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 2158, 'Catering', 19, NULL, 63, 489, 500000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 2158);

-- #2356 -- PA Expenses -> Venue (the one kept of the 6 duplicates)
INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 2356, 'Venue', 22, NULL, 49, 261, 120000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 2356);

-- Wallet debits for everything above that didn't already get one.
-- wallet_self_debit() can't be called here (keys off auth.uid()), so this
-- replicates its body per row, targeting each row's real owner explicitly.
DO $$
DECLARE
  v_row record;
  v_wallet public.wallets%ROWTYPE;
  v_targets jsonb := '[
    {"expense_id": 413,  "user_id": "efde00a1-b006-45cd-ad77-344bbd9933f8", "amount_paise": 28800,  "description": "Expense: Basant Kunj Rama form to godam ola kiraya"},
    {"expense_id": 463,  "user_id": "efde00a1-b006-45cd-ad77-344bbd9933f8", "amount_paise": 16000,  "description": "Expense: 8log"},
    {"expense_id": 1159, "user_id": "ee61fad9-6cbb-4093-90dd-69a65f59db07", "amount_paise": 200000, "description": "Expense: Pantry exp. Ajay gaurd"},
    {"expense_id": 2158, "user_id": "97995012-eae2-458d-9243-721259694f97", "amount_paise": 500000, "description": "Expense: Khan studio khurja cartage"},
    {"expense_id": 2356, "user_id": "24d16c76-61af-494e-abae-cf1bb121bbc7", "amount_paise": 120000, "description": "Expense: 1 troli malwa parking se hataya"}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_targets) AS x(expense_id bigint, user_id uuid, amount_paise bigint, description text)
  LOOP
    IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_type = 'expense' AND reference_id = v_row.expense_id::text) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_row.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet not found for user % (expense #%)', v_row.user_id, v_row.expense_id;
    END IF;

    UPDATE public.wallets SET balance_paise = balance_paise - v_row.amount_paise WHERE id = v_wallet.id;

    INSERT INTO public.wallet_transactions
      (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
    VALUES
      (v_wallet.id, 'debit', v_row.amount_paise, v_wallet.balance_paise - v_row.amount_paise,
       v_row.description, 'expense', v_row.expense_id::text, v_row.user_id, 'completed');
  END LOOP;
END $$;

-- Soft-delete Sonu's 5 duplicate retries of the same troli-parking expense.
UPDATE public.expenses
SET deleted_at = now(),
    deleted_by = '24d16c76-61af-494e-abae-cf1bb121bbc7',
    delete_reason = 'Duplicate retry of #2356 -- same bug caused the submit to fail and re-create the row on each retry'
WHERE id IN (2357, 2358, 2359, 2360, 2361)
  AND deleted_at IS NULL;
