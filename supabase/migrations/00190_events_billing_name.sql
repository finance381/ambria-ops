-- Receipts (generateCollectionReceiptPdf) print events.client_name as
-- "Client Name" -- the guest booking the event. Contracts can carry a
-- separate Billing Name (and address) for who actually gets invoiced,
-- which can differ from the guest (e.g. a company, or a relative footing
-- the bill). sync-events already calls the exact LMS endpoint that returns
-- this (get_venue/catering/decor/entertain_contract_information_list --
-- confirmed directly against GYV_ALL_CONTRACT_API_4_MAY_2026.txt, which
-- documents <dept-prefix>_billing_name/_billing_address on every one of the
-- four) -- it's just never read it out of the response. No new LMS call
-- needed, just two more fields off what sync-events already fetches.
--
-- events_safe is read by Events.jsx and others with an explicit column
-- list (not select *), and carries its own WHERE lms_cancelled_at IS NULL
-- filter not present in the originally-tracked version of this view
-- (00040) -- confirmed live before touching it, so recreating it here
-- doesn't silently drop that filter or any of the columns added to it
-- since.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS billing_name text,
  ADD COLUMN IF NOT EXISTS billing_address text;

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
    billing_name,
    billing_address,
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
    tentative_created_at
   FROM events
  WHERE lms_cancelled_at IS NULL;

NOTIFY pgrst, 'reload schema';
