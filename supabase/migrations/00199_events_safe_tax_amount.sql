-- tax_amount_paise already exists on events (sync-events has written it
-- since before this migration, and fn_event_group_balance already reads it
-- for the Financials/Ledger tax reconciliation) but was never exposed
-- through events_safe, the view ContractList.jsx reads with an explicit
-- column list -- needed now for the Contracts tab's Balance box, which
-- shows each package figure as "package + tax = total". CREATE OR REPLACE
-- VIEW only allows appending new columns at the END of the existing list
-- (see 00198's own note on this), so this goes after net_amount_paise, the
-- view's current last column, confirmed against 00198 -- the latest
-- migration to touch this view.
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
    net_amount_paise,
    tax_amount_paise
   FROM events
  WHERE lms_cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';
