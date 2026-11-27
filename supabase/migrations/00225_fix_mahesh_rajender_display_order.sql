-- Same display-order class as 00221/00223/00224. Both verified by hand
-- against the full balance chain (every other row in each wallet checks
-- out exactly; only these two are out of position).
--
-- Mahesh: "Refund (backfill): deleted expense #649" (d9604218, 630000) and
-- "Refund (backfill): deleted expense #536" (1199e06c, 500000) share one
-- timestamp. True order is #649 then #536 -- confirmed: from the real
-- preceding balance (-33200), +630000 lands on #649's own stored balance
-- (596800) exactly, and from there +500000 lands on #536's own stored
-- balance (1096800) exactly; the reverse order does not reproduce either
-- row's stored balance.
UPDATE public.wallet_transactions
SET created_at = created_at + interval '1 second'
WHERE id = '1199e06c-228b-4055-8b48-1b60adc9c3f6';

-- Rajender Singh: "Transfer from Sandeep Patwal: For tender" (6acbc9bd,
-- credit 3000000) and "Opening 8699+60000+30000" (3b785d72, credit
-- 9869900) are swapped. True order is the transfer first, then the
-- opening entry -- confirmed: from the real preceding balance (7000000),
-- +3000000 lands on the transfer's own stored balance (10000000) exactly,
-- and from there +9869900 lands on the opening entry's own stored balance
-- (19869900) exactly, which the existing next real row (a 3000000 debit)
-- already correctly follows.
UPDATE public.wallet_transactions
SET created_at = '2026-10-02 05:58:00+00'
WHERE id = '6acbc9bd-4e6a-4a71-828a-5cc740942ab0';
