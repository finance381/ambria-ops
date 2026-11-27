-- 00223 moved Puspender Driver (CD)'s #573/#574 corrections to 12:07:14/15,
-- but left #572 and #575 (unflagged -- their own naive check happened to
-- pass) both at the original shared 12:07:13.026169 timestamp. 00203's own
-- intended order was 572, 573, 574, 575 -- #575 now needs to sort after
-- #574 too, or it displays before 573/574 despite being the last of the
-- four. #572 stays put: it's correctly first already (earlier than both
-- 00223's new stamps).
UPDATE public.wallet_transactions
SET created_at = '2026-11-25 12:07:16+00'
WHERE wallet_id = (SELECT w.id FROM public.wallets w JOIN public.profiles p ON p.id = w.user_id WHERE p.name = 'Puspender Driver (CD)')
  AND reference_type = 'expense_refund_correction'
  AND description LIKE '%#575 (%';
