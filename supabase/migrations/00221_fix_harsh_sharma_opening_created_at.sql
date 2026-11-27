-- One wallet_transactions row (Harsh Sharma, "05.09 opening", credit
-- 140,000) was entered directly via SQL at some point with created_at
-- backdated to 2026-10-02 -- not through issue_money/deduct_money, neither
-- of which take a date parameter at all (always now()), confirming this was
-- a one-off manual insert, not an app bug.
--
-- Its stored balance_after_paise (14,240,000) is NOT corrupted -- verified
-- by hand (and independently re-verified) against the real chain: it
-- follows correctly from bb4f6558-7447-48f1-a975-ddf7d1dcceee's balance
-- (14,100,000, at 2026-10-19 08:04:08) + this row's own 140,000, and the
-- very next row by amount, 8d408a47-8d78-4488-8e23-e7bbe8ba6a19 (debit
-- 10,100,000 at 2026-10-19 08:09:16), computes correctly FROM this row's
-- balance (14,240,000 - 10,100,000 = 4,140,000, exactly what's stored).
-- So this row was actually inserted between those two, around 2026-10-19
-- 08:04-08:09 -- its created_at just says the wrong date.
--
-- Every screen that lists wallet history sorts by created_at, so the wrong
-- date displayed this row next to transactions from three weeks later that
-- it has no real relationship to -- a balance jumping to 1,42,400 for a
-- 1,400 credit, then appearing to drop back down right after -- which is
-- exactly the "out of sync, makes no sense" symptom reported. No amount or
-- balance_after_paise is touched here, only the timestamp that controls
-- display order.
UPDATE public.wallet_transactions
SET created_at = '2026-10-19 08:05:00+00'
WHERE id = '46bd4a63-9bb0-440f-a621-7e3b6c8cca6f'
  AND created_at = '2026-10-02 11:38:40.795627+00';
