-- System-wide audit (triggered by checking Raj Singh's wallet after #4401,
-- 00202) found 9 users carrying wallet_transactions credits that overstate
-- their real balance -- found by summing, per expense_id, every completed
-- 'expense' debit against every completed 'expense_refund' credit: any
-- expense_id where refunds exceed debits is a credit with nothing real
-- behind it. Two distinct bugs produced these, both already closed by later
-- fixes (fn_refund_expense_debit now nets debited-credited as of 00194;
-- nothing here can recur going forward) -- this migration only corrects the
-- stale balances they left behind:
--
-- (A) Real cash expense, original wallet_self_debit silently failed (the
--     same orphaned-expense failure mode as #4401/#2785/etc), then the
--     duplicate/failed entry was deleted as a cleanup -- and the
--     delete-refund fired anyway, crediting cash that was never actually
--     taken out. Confirmed by each one's own delete_reason ("double entry",
--     "submit nahi ho paya", "internet ki vajah se", "Galat"):
--       Amar Kumar   #13 #14 #184 #803 #1022 #1027
--       Puspender Driver (CD) #572 #573 #574 #575 (same expense, 4 retries
--         in under 2 minutes)
--       Guddu Light (Add) #23
--     Jai Singh's #3597/#3599/#3600 are the same pattern but via the EDIT
--     path, not delete: ExpenseForm.jsx's edit-branch walletDiff computes
--     purely from the row's own payment_cash_paise, with no check that a
--     debit ever actually posted -- flagged as an open gap earlier, now
--     confirmed causing real loss. That client-side gap is NOT fixed by
--     this migration (data-only) and still needs a code fix.
--
-- (B) Credit-only expense (payment_cash_paise = 0, no wallet debit was ever
--     supposed to happen) where the old delete/flag refund logic credited
--     the wallet anyway instead of recognizing there was nothing to refund:
--       Guddu Light (Add) #25 #26 #27 #28 #30 #32
--       Tarun #24
--       David #401 #421 (expenses are still 'flagged', unresolved -- if
--         David resubmits, that produces a fresh, real, independent debit;
--         it is not a second instance of this bug)
--       Mohan Sharma #850 #1079 #1082 (also still 'flagged')
--       Umakant #1284 -- partial: of the two credits on this expense, the
--         "Expense edited: -1,368 pts" (136800) correctly nets an earlier
--         real debit and is left alone; only the later "Refund: deleted
--         expense" (896800) is erroneous and reversed here.
--
-- Raj Singh's #643 (found while investigating #4401) is its own case: an
-- edit-down correctly credited back a real debit, then the delete fired a
-- second, redundant refund on top -- reversed here too.
--
-- Each reversal is its own 'debit' row tagged reference_type =
-- 'expense_refund_correction' (reference_id = the original expense id) so
-- it reads distinctly from a real expense debit or a real refund credit in
-- every wallet's history.
DO $$
DECLARE
  v_row record;
  v_wallet public.wallets%ROWTYPE;
  v_targets jsonb := '[
    {"user_id": "39c1c329-d9e6-4105-88b4-9799e489e2da", "expense_id": 643,  "amount_paise": 500000,  "description": "Correction: reverse duplicate refund on #643 (already refunded once by its own edit)"},

    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 13,   "amount_paise": 24000,   "description": "Correction: reverse refund on #13 (original debit never posted)"},
    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 14,   "amount_paise": 24000,   "description": "Correction: reverse refund on #14 (original debit never posted)"},
    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 184,  "amount_paise": 100000,  "description": "Correction: reverse refund on #184 (original debit never posted)"},
    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 803,  "amount_paise": 120000,  "description": "Correction: reverse refund on #803 (original debit never posted)"},
    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 1022, "amount_paise": 29000,   "description": "Correction: reverse refund on #1022 (original debit never posted)"},
    {"user_id": "7fafae19-f7e1-4ab8-8db3-9d47e50f859b", "expense_id": 1027, "amount_paise": 275000,  "description": "Correction: reverse refund on #1027 (original debit never posted)"},

    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 23,   "amount_paise": 280000,  "description": "Correction: reverse refund on #23 (original debit never posted)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 25,   "amount_paise": 280000,  "description": "Correction: reverse refund on #25 (credit-only expense, never debited)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 26,   "amount_paise": 560000,  "description": "Correction: reverse refund on #26 (credit-only expense, never debited)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 27,   "amount_paise": 560000,  "description": "Correction: reverse refund on #27 (credit-only expense, never debited)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 28,   "amount_paise": 24600,   "description": "Correction: reverse refund on #28 (credit-only expense, never debited)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 30,   "amount_paise": 35000,   "description": "Correction: reverse refund on #30 (credit-only expense, never debited)"},
    {"user_id": "c740a689-afb2-48a9-a9cc-9afffb5fe6ad", "expense_id": 32,   "amount_paise": 51700,   "description": "Correction: reverse refund on #32 (credit-only expense, never debited)"},

    {"user_id": "67d78386-5e4c-4959-b738-0d8b7b41d460", "expense_id": 3597, "amount_paise": 599900,  "description": "Correction: reverse edit-down credit on #3597 (original debit never posted)"},
    {"user_id": "67d78386-5e4c-4959-b738-0d8b7b41d460", "expense_id": 3599, "amount_paise": 599900,  "description": "Correction: reverse edit-down credit on #3599 (original debit never posted)"},
    {"user_id": "67d78386-5e4c-4959-b738-0d8b7b41d460", "expense_id": 3600, "amount_paise": 599900,  "description": "Correction: reverse edit-down credit on #3600 (original debit never posted)"},

    {"user_id": "ce50135b-48e8-4a61-b5af-988a8e0fe290", "expense_id": 850,  "amount_paise": 251500,  "description": "Correction: reverse refund on #850 (credit-only expense, never debited)"},
    {"user_id": "ce50135b-48e8-4a61-b5af-988a8e0fe290", "expense_id": 1079, "amount_paise": 84400,   "description": "Correction: reverse refund on #1079 (credit-only expense, never debited)"},
    {"user_id": "ce50135b-48e8-4a61-b5af-988a8e0fe290", "expense_id": 1082, "amount_paise": 340250,  "description": "Correction: reverse refund on #1082 (credit-only expense, never debited)"},

    {"user_id": "09b90067-f06c-4dd3-aaff-323b45e0e230", "expense_id": 572,  "amount_paise": 250000,  "description": "Correction: reverse refund on #572 (original debit never posted)"},
    {"user_id": "09b90067-f06c-4dd3-aaff-323b45e0e230", "expense_id": 573,  "amount_paise": 250000,  "description": "Correction: reverse refund on #573 (original debit never posted)"},
    {"user_id": "09b90067-f06c-4dd3-aaff-323b45e0e230", "expense_id": 574,  "amount_paise": 250000,  "description": "Correction: reverse refund on #574 (original debit never posted)"},
    {"user_id": "09b90067-f06c-4dd3-aaff-323b45e0e230", "expense_id": 575,  "amount_paise": 250000,  "description": "Correction: reverse refund on #575 (original debit never posted)"},

    {"user_id": "f607c0d5-d237-4ca5-8abd-7a298ef0047a", "expense_id": 24,   "amount_paise": 840000,  "description": "Correction: reverse refund on #24 (credit-only expense, never debited)"},

    {"user_id": "e96dffda-0899-41af-99c9-b65c7e9b6f3a", "expense_id": 1284, "amount_paise": 896800,  "description": "Correction: reverse delete-refund on #1284 (credit-only remainder, never debited -- its earlier edit-credit of 136800 was legitimate and is untouched)"},

    {"user_id": "3c331a39-5ffd-4553-af7a-fc07e4e3070e", "expense_id": 401,  "amount_paise": 1506700, "description": "Correction: reverse refund on #401 (credit-only expense, never debited)"},
    {"user_id": "3c331a39-5ffd-4553-af7a-fc07e4e3070e", "expense_id": 421,  "amount_paise": 37000,   "description": "Correction: reverse refund on #421 (credit-only expense, never debited)"}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_targets) AS x(user_id uuid, expense_id bigint, amount_paise bigint, description text)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE reference_type = 'expense_refund_correction' AND reference_id = v_row.expense_id::text
    ) THEN
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
       v_row.description, 'expense_refund_correction', v_row.expense_id::text, v_row.user_id, 'completed');
  END LOOP;
END $$;
