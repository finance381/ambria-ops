-- A contract cancelled in LMS was never actually removed from our events
-- table: sync-events already skips a *brand-new* cancelled contract (it
-- checks cancel_remarks before inserting), but a contract that was synced
-- in BEFORE it got cancelled just stops getting touched by later syncs --
-- the "stale rows (possibly cancelled in LMS)" count was only ever logged
-- to the console, never acted on. So it stayed in `events` forever, still
-- visible everywhere: Contracts list, Events, Extra Plate Collect, every
-- date-based event picker, etc.
--
-- Fix: a flag the sync function now sets on exactly those stale rows (see
-- the accompanying sync-events change), and a filter on the one view nearly
-- every "list/browse/pick a contract" screen already reads through.
--
-- Deliberately NOT filtered out of the raw `events` table itself -- several
-- screens resolve an already-known event_id to show the context of a
-- transaction that happened *before* the contract was cancelled (an old
-- requisition, expense, wallet collection). Hiding the row there would
-- blank out legitimate history. Only events_safe (used by list/picker
-- screens) excludes it; the handful of raw `events` picker queries get
-- their own explicit filter in the same commit.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS lms_cancelled_at timestamptz;

CREATE OR REPLACE VIEW events_safe AS
 SELECT id,
    lms_event_id,
    contract_no,
    contract_date,
    department,
    contract_type,
    venue_name,
    location,
    contact_person,
    contact_number,
    event_name,
    client_name,
    session,
    catering,
    total_plates,
    complementary_plates,
    extra_plates_charge,
    balance_received,
    balance_bank,
    balance_amount,
    status,
    synced_at,
    created_user_name,
    ppt_link,
    pdf_link,
    secondary_contact,
    enquiry_mode,
    priority,
    address,
    function_date,
    lms_head_id,
    is_tentative,
    pax,
    function_type,
    merged_into_id,
    tally_entered_by,
    tally_entered_at
   FROM events
   WHERE lms_cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
