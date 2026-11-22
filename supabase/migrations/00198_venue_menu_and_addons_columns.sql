-- Two columns for fields LMS's own Venue contract listing carries that
-- this app has never synced: a combined "Venue + Menu" package value
-- (LMS's own Catering Type "Venue + Menu" / Value pair) and an itemized
-- "Addons" list (seen live as "L.L. (25000.0)" in LMS's own UI), distinct
-- from the existing decor_amount_paise/entertainment_amount_paise lumpsums.
--
-- venue_menu_paise is wired up in this same change (sync-events' mapRow --
-- confirmed directly against the live API: fiscd_menu_value = 1132500 on
-- contract #00568, exactly matching LMS's own UI). addons_json stays NULL:
-- the raw field (fisc_addon) exists but was empty on that same contract
-- despite its UI showing a real addon, and a scan of ~190 other live
-- contracts found zero non-empty values either -- the real data isn't in
-- this list endpoint's response at all, so there's nothing to map yet. No
-- backfill needed either way: this is new data, not a correction to
-- anything already stored.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS venue_menu_paise bigint,
  ADD COLUMN IF NOT EXISTS addons_json jsonb;

-- events_safe is read by ContractList.jsx (and others) with an explicit
-- column list, not select * -- these have to be added to the view too or
-- they're invisible to every reader regardless of the table having them.
-- total_amount_paise/net_amount_paise already exist on the table (sync-events
-- has written them since before this migration) but were never exposed
-- through this view either -- now needed for the Contracts tab's Add-on
-- Decor/Ent cards, which show that contract's own total as its "Package"
-- figure. CREATE OR REPLACE VIEW only allows appending new columns at the
-- END of the existing list (see 00190's own note on this), so these go
-- after billing_address, the view's current last column, confirmed against
-- 00190 -- the latest migration to touch this view.
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
    tally_entered_at,
    manual_plate_rate_paise,
    manual_plate_rate_set_by,
    manual_plate_rate_set_at,
    menu_rate_paise,
    venue_rental_paise,
    decor_amount_paise,
    entertainment_amount_paise,
    tentative_created_by,
    tentative_created_at,
    billing_name,
    billing_address,
    venue_menu_paise,
    addons_json,
    total_amount_paise,
    net_amount_paise
   FROM events
  WHERE lms_cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';
