-- Three wallets (Kaushal Kumar, Sonu, Chaitanya Arora) each had a stretch of
-- stored balance_after_paise that doesn't match the real running total --
-- not a display-order bug like 00221/00223/00224/00225 (those only ever
-- touched created_at). Checked every RPC that can move a wallet balance
-- (confirm_transfer, cancel_transfer, wallet_self_debit, and every
-- recover_* migration in this repo): all of them compute balance_after_paise
-- atomically from the wallet's own live balance_paise in the same
-- transaction, so a row cannot drift from the running total on its own.
-- Every one of these three gaps sits right where its own balance was
-- presumably hand-edited directly in Studio at some point with no
-- accompanying wallet_transactions row -- the same root cause as Harsh
-- Sharma's "05.09 opening" row (00221), just hitting the balance instead of
-- the timestamp. There's no way to recover what that manual edit actually
-- was; it was never recorded anywhere.
--
-- Traced every single transaction in all three wallets by hand, start to
-- finish, against their current (independently confirmed-correct)
-- wallets.balance_paise. In every case the gap opens at one row and closes
-- again a few rows later at an amount that exactly cancels it back to the
-- original stored values -- so only the rows strictly between the open and
-- close need correcting, and nothing from the close point to today's
-- balance is touched. No amount_paise, description, or current
-- wallets.balance_paise is touched anywhere in this migration -- only the
-- balance_after_paise snapshot on these specific rows.
--
-- Kaushal Kumar: gap opens at 2f7e96d7 (Sept 16, "Transfer: at Go Down ->
-- Vidushi Yadav") understating the balance by 20,000,000 paise, and closes
-- again exactly at 84728747 (Sept 25, "Transfer: At Exotica -> Ompal
-- Sharma"), which already carries the correct value with no change needed.
-- The 7 rows from 2f7e96d7 up to and including 319a8a6f (the last one
-- before 84728747) each need +20,000,000.
UPDATE public.wallet_transactions SET balance_after_paise = 42950000
  WHERE id = '2f7e96d7-388d-487c-99af-d279c8299b45' AND balance_after_paise = 22950000;
UPDATE public.wallet_transactions SET balance_after_paise = 52950000
  WHERE id = 'c01f8fd6-ece1-4e12-be2f-87821c929be9' AND balance_after_paise = 32950000;
UPDATE public.wallet_transactions SET balance_after_paise = 52450000
  WHERE id = '481c8a46-2e83-4565-85f8-3a9c96bf3dc1' AND balance_after_paise = 32450000;
UPDATE public.wallet_transactions SET balance_after_paise = 102450000
  WHERE id = '1e80d99b-103c-4197-a67e-ea7a699b44a3' AND balance_after_paise = 82450000;
UPDATE public.wallet_transactions SET balance_after_paise = 77450000
  WHERE id = '51d462b0-7d9c-4709-8237-635a6e6717ec' AND balance_after_paise = 57450000;
UPDATE public.wallet_transactions SET balance_after_paise = 27450000
  WHERE id = '8f9730ba-2bf7-49bb-a3d7-bc8e57124074' AND balance_after_paise = 7450000;
UPDATE public.wallet_transactions SET balance_after_paise = 47450000
  WHERE id = '319a8a6f-8fdc-4012-b128-c7dcdd6a0bd8' AND balance_after_paise = 27450000;

-- Sonu: gap opens at 11138aff (Sept 17, "Tree cutter machine ki chain
-- blade") overstating the balance by 1,000,000 paise, and closes again
-- exactly at b109aae8 (Sept 24, "Fauntain stone lane gaye the..."), which
-- already carries the correct value with no change needed. The 8 rows from
-- 11138aff up to and including 3d537dfd (the last one before b109aae8) each
-- need -1,000,000.
UPDATE public.wallet_transactions SET balance_after_paise = -25000
  WHERE id = '11138aff-501d-47c0-9d3e-62912665d921' AND balance_after_paise = 975000;
UPDATE public.wallet_transactions SET balance_after_paise = -30000
  WHERE id = '541fa577-e3e3-49cf-9d96-8bae3836743a' AND balance_after_paise = 970000;
UPDATE public.wallet_transactions SET balance_after_paise = -130000
  WHERE id = '669dce13-18fd-419e-ad73-761fafa79240' AND balance_after_paise = 870000;
UPDATE public.wallet_transactions SET balance_after_paise = -460000
  WHERE id = '52ab0d16-d829-4275-a10d-288658655c57' AND balance_after_paise = 540000;
UPDATE public.wallet_transactions SET balance_after_paise = -790000
  WHERE id = '67f8f7d9-7272-4f0e-8cbf-178c24758b4b' AND balance_after_paise = 210000;
UPDATE public.wallet_transactions SET balance_after_paise = -490000
  WHERE id = '0eed3bd3-1bcd-4892-a363-9c5db9b85910' AND balance_after_paise = 510000;
UPDATE public.wallet_transactions SET balance_after_paise = -820000
  WHERE id = '60faeee6-c797-4384-bdf3-7aa00cb8a12f' AND balance_after_paise = 180000;
UPDATE public.wallet_transactions SET balance_after_paise = -490000
  WHERE id = '3d537dfd-a585-4557-965b-3e07706034dc' AND balance_after_paise = 510000;

-- Chaitanya Arora: gap opens at d23874de (Sept 17, "Expense: Venue charge
-- to manager") overstating the balance by 1,600,000 paise, and closes again
-- exactly at d0d623f8 (Sept 27, "Transfer: At ap -> Kaushal Kumar"), which
-- already carries the correct value with no change needed. The 10 rows from
-- d23874de up to and including 1a06f119 (the last one before d0d623f8) each
-- need -1,600,000.
UPDATE public.wallet_transactions SET balance_after_paise = -1600000
  WHERE id = 'd23874de-ecdd-4ef9-ab69-cf8c00df75b2' AND balance_after_paise = 0;
UPDATE public.wallet_transactions SET balance_after_paise = 88400000
  WHERE id = 'e12d0686-1f77-43ec-ab2c-9eed37e72819' AND balance_after_paise = 90000000;
UPDATE public.wallet_transactions SET balance_after_paise = 178400000
  WHERE id = 'f2f99fbd-c7df-4138-9c0c-a1d23143e586' AND balance_after_paise = 180000000;
UPDATE public.wallet_transactions SET balance_after_paise = 88400000
  WHERE id = '68e2d702-5b1b-49bd-9fc1-753b043fa09a' AND balance_after_paise = 90000000;
UPDATE public.wallet_transactions SET balance_after_paise = 88400000
  WHERE id = '38ef8078-29d5-41b8-a42c-5940354f8035' AND balance_after_paise = 90000000;
UPDATE public.wallet_transactions SET balance_after_paise = -1600000
  WHERE id = 'd15b29bf-6668-4a9e-a6a4-7e2f7deb6e9d' AND balance_after_paise = 0;
UPDATE public.wallet_transactions SET balance_after_paise = -2600000
  WHERE id = '3fabfa95-3d4a-41d6-b972-c7d772f3121c' AND balance_after_paise = -1000000;
UPDATE public.wallet_transactions SET balance_after_paise = 27400000
  WHERE id = '21fb850b-85e2-4745-89c2-5f886add1043' AND balance_after_paise = 29000000;
UPDATE public.wallet_transactions SET balance_after_paise = 17400000
  WHERE id = '77b84570-b036-4e13-813e-a4dfa7279bb1' AND balance_after_paise = 19000000;
UPDATE public.wallet_transactions SET balance_after_paise = 17400000
  WHERE id = '1a06f119-042e-42bc-80f1-7d9a3e730c71' AND balance_after_paise = 19000000;

-- Separate, already-confirmed display-order fix (same class as
-- 00223/00224/00225, not part of the balance cascade above): "Adjustment as
-- per tally" is dated Oct 12 07:48 but its own stored balance only makes
-- sense between the Oct 13 10:01 cancelled collection and the Oct 13 14:03
-- transfer that follows it.
UPDATE public.wallet_transactions
SET created_at = '2026-10-13 12:00:00+00'
WHERE id = 'fa8400e0-58fd-4e94-83b6-c4d712582cd0'
  AND created_at = '2026-10-12 07:48:20.603094+00';
