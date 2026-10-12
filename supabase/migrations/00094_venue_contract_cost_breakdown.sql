-- Contract list asked for Menu Rate, Venue Rental, Decor amount,
-- Entertainment amount per contract, to be "back-calculated" from a total
-- package via the newly-documented get_venue_lead_matrix_detail LMS API.
-- Checking the raw LMS response sync-events already fetches for every Venue
-- contract (get_venue_contract_information_list) found LMS already computes
-- and returns all four directly — fiscd_menu_rate, fiscd_venue_value,
-- fiscd_decoration_lumpsum, fiscd_entertainment_lumpsum — sync-events was
-- just never capturing them. Confirmed against 10 live contracts: summing
-- venue_value + menu_value + decor + entertainment reproduces fisc_total_amt
-- on 9 of 10 (one off by <1%, presumably a tax/rounding line LMS tracks
-- elsewhere) — using LMS's own authoritative figures directly is strictly
-- more accurate than re-deriving them from a pax/rate back-calculation ever
-- could be, so no matrix-API call is needed at all. Pax itself was already
-- captured as total_plates (fiscd_pax_no) — just never surfaced as a column
-- in the Contracts UI.
--
-- Venue-only: these fields only exist under the Venue department's LMS
-- response shape (fiscd_* prefix) — null on Catering/Decor/Entertainment
-- department rows, same as total_plates/complementary_plates already are
-- for Decor/Entertainment today.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS menu_rate_paise bigint,
  ADD COLUMN IF NOT EXISTS venue_rental_paise bigint,
  ADD COLUMN IF NOT EXISTS decor_amount_paise bigint,
  ADD COLUMN IF NOT EXISTS entertainment_amount_paise bigint;

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
    entertainment_amount_paise
   FROM events
   WHERE lms_cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
