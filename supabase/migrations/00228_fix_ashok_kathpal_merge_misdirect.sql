-- fn_merge_events (the "Merge selected" tentative-into-real-contract flow,
-- ContractList.jsx) was used to merge 3 selected rows at once -- Ashish's
-- real LMS contract (#00874, event id 14265296) as the single target, plus
-- BOTH Ashish's own tentative placeholder (12595888, correct) AND Ashok
-- Kathpal's tentative placeholder (12595890, wrong -- it has its own real
-- LMS contract, #00873, event id 14265295, which nothing was ever merged
-- into). Every tentative selected merges into whichever single real
-- contract is selected, so Ashok Kathpal's tentative data landed on
-- Ashish's contract instead of his own.
--
-- Confirmed live exactly what moved and nothing else did: wallet_transactions
-- and event_ledger both show only two collections under event 14265296 --
-- "Advance payment — Engagement" (Ashish's own tentative event_name, stays)
-- and "Advance payment — Mehendi" (Ashok Kathpal's tentative event_name,
-- misdirected) -- and a count across every other table fn_merge_events
-- touches (event_items, event_manpower, challans, extra_plate_issues/
-- collections, expenses, requisitions, projects, cost_transfers,
-- production_orders, store_requisitions) came back zero for event 14265296,
-- so the one ₹10,000 collection (plus its event_ledger mirror) is the whole
-- correction.
--
-- Only reference_id/event_id/merged_into_id move -- no amount_paise,
-- balance_after_paise, or any other wallet-balance-affecting field is
-- touched, so the collecting wallet's own running balance is unaffected;
-- this only corrects which event the money (and the merge) is attributed to.
UPDATE public.wallet_transactions
SET reference_id = '14265295'
WHERE id = '02dfdd6e-44a6-4025-b714-cb5bab9d0003'
  AND reference_type = 'collection'
  AND reference_id = '14265296';

UPDATE public.event_ledger
SET event_id = 14265295
WHERE id = 9224
  AND reference_id = '02dfdd6e-44a6-4025-b714-cb5bab9d0003'
  AND event_id = 14265296;

UPDATE public.events
SET merged_into_id = 14265295
WHERE id = 12595890
  AND merged_into_id = 14265296;
