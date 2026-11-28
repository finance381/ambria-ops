-- Vendor #28 (Shivnath Bangali Vendor) showed cash_balance_paise = -16,969 pts
-- in v_vendor_ledger even though balance_paise (the overall total) correctly
-- showed +9,386 pts owed, matching the one real unpaid bill (ledger_entries
-- id 3293, 2026-11-28, "FBR-Casual Labour Expenses: bangali labor").
--
-- Root cause: ledger_entries id 2876 (entry_date 2026-11-21, kind=correction,
-- credit_paise 2,635,500, "Reversal of #2652: extra amt paid") is a manual
-- correction reversing an earlier mistaken CASH payment (id 2652, mode=cash).
-- The reversal itself was never tagged metadata.mode='cash', so
-- v_vendor_ledger's per-mode CASE (which only counts kind IN
-- ('purchase','payment','deduction') against a matching mode) silently
-- excludes it from cash_balance_paise, while the mode-agnostic balance_paise
-- counts it fine. Net effect: cash_balance_paise sat permanently short by
-- exactly the 2,635,500 paise this correction was supposed to restore,
-- making the vendor look like a -16,969 pt cash overpayment when there is
-- none -- this was discovered when a user tried to "write off" that
-- apparent overpayment via pay_vendor's deduction, which correctly refused
-- it (a deduction can only reduce an already-positive outstanding, never
-- manufacture one out of a negative balance).
--
-- Fix is metadata-only -- no credit_paise/debit_paise/wallet balance is
-- touched, same as id 2652/2653's own original amounts. Tagging this
-- correction mode='cash' (matching what it reverses) brings
-- cash_balance_paise up to 938,600, matching balance_paise exactly (this
-- vendor has no bank-mode activity at all), which is just the one real
-- unpaid bill -- payable normally, no deduction involved.
UPDATE public.ledger_entries
SET metadata = metadata || jsonb_build_object('mode', 'cash')
WHERE id = 2876
  AND ledger_type = 'vendor'
  AND party_id = 28
  AND metadata->>'kind' = 'correction'
  AND metadata->>'mode' IS NULL;
