-- Prompted by LMS_SYNC_SAFETY_PATTERNS.md (a write-up of a real incident in
-- a sibling app, Fnbapp, on 2026-11-14: a sync bug hard-deleted events,
-- which CASCADEd into deleting their menu selections and at least one
-- already-finalized, sent-to-kitchen Function Plan -- unrecoverable,
-- required a full backup restore). That app's own lms-sync does its own
-- periodic full-list reconciliation; this app's analogous sync-events.ts
-- already never hard-deletes on absence (confirmed: the "missing from this
-- run" path only inserts into lms_sync_anomalies for a human to review, via
-- migrations 00100/00131/00132/00133). But Rule 2 of that write-up is
-- "assume application code will have bugs" and harden the schema itself,
-- independent of whether today's code is already careful -- so this closes
-- the two places in THIS schema where a parent-row delete (today's code,
-- or a bug introduced tomorrow) would silently cascade away data that
-- can't be reconstructed afterward, matching that exact failure shape:
--
-- 1. events -> event_briefs / event_items / event_manpower / event_tasks.
--    Confirmed live (pg_constraint query): all four were ON DELETE CASCADE.
--    Confirmed via grep across src/ and supabase/migrations/: nothing in
--    this app ever deletes a row from `events` today, so this is a pure
--    safety net with zero behavior change -- it only stops a future bug
--    (or a manual psql DELETE) from doing exactly what happened to Fnbapp.
--
-- 2. profiles -> wallets -> wallet_transactions. This one isn't
--    hypothetical: src/modules/users/Users.jsx's own deleteUser() already
--    tries `DELETE FROM profiles` and its catch block explicitly expects
--    (and depends on) a foreign-key violation for any user with "historical
--    records (quotes, expenses, POs, etc.)", telling the admin to
--    deactivate instead -- that's this app's own stated design intent, and
--    it already holds for every other table referencing profiles. wallets
--    was the one exception still set to CASCADE, so deleting a profile
--    whose only history is wallet activity (e.g. a never-invoiced employee
--    who only ever received salary/reimbursement credits) would silently
--    wipe their entire points ledger instead of being blocked like the
--    error message already promises. wallet_transactions cascading from
--    wallets compounds the same gap one level down. Confirmed via grep: no
--    code anywhere deletes a wallet or wallet_transactions row directly, so
--    nothing legitimate relies on either cascading.
--
-- Deliberately NOT touched here (checked and found a live dependency, so
-- each needs its own follow-up rather than a blind schema change):
-- store_requisitions -> store_requisition_dept_rows -> items/casuals/
-- expense_adjustments. rpc_delete_store_requisition (migration 00075) is a
-- real, currently-used delete path that relies on this exact cascade to
-- clean up a deleted requisition's rows; flipping it here would break that
-- RPC until it's rewritten to delete children explicitly first.
-- salary_payout_batches -> salary_payout_entries has no such dependency
-- (confirmed via grep) and is the same class of risk as wallets, but was
-- left out of this pass to keep it scoped to the two confirmed-safe,
-- confirmed-zero-regression changes; worth a near-term follow-up.

ALTER TABLE public.event_briefs
  DROP CONSTRAINT event_briefs_event_id_fkey,
  ADD CONSTRAINT event_briefs_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.event_items
  DROP CONSTRAINT event_items_event_id_fkey,
  ADD CONSTRAINT event_items_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.event_manpower
  DROP CONSTRAINT event_manpower_event_id_fkey,
  ADD CONSTRAINT event_manpower_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.event_tasks
  DROP CONSTRAINT event_tasks_event_id_fkey,
  ADD CONSTRAINT event_tasks_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.wallets
  DROP CONSTRAINT wallets_user_id_fkey,
  ADD CONSTRAINT wallets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT wallet_transactions_wallet_id_fkey,
  ADD CONSTRAINT wallet_transactions_wallet_id_fkey
    FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE RESTRICT;
