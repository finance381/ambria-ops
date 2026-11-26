-- Venue+Decor/Entertainment consolidation (ContractList.jsx) only ever links
-- automatically, by matching client_name + venue_name with an overlapping
-- function_date -- each department numbers its own LMS contracts
-- independently, so there's no shared contract_no to join on. When that
-- heuristic misses (a name spelled differently between departments' LMS
-- entries, no overlapping date, etc.), the add-on contract just shows as its
-- own separate card with its own separate balance, and there was no way to
-- fix that short of a destructive fn_merge_events-style data migration.
--
-- This is deliberately NOT that: no event_ledger/wallet_transactions/
-- requisition/etc. row ever moves. It's a manual override sitting next to
-- the existing automatic match, read by the exact same consolidation code
-- path (ContractList.jsx's venueGroupsByKey grouping) -- fully reversible,
-- just two nullable columns.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS manual_addon_contract_no text,
  ADD COLUMN IF NOT EXISTS manual_addon_department text;

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
    tax_amount_paise,
    manual_addon_contract_no,
    manual_addon_department
   FROM events
  WHERE lms_cancelled_at IS NULL;

-- p_addon_event_id: any event row belonging to the Decor/Entertainment
-- contract to be folded in. p_venue_event_id: any event row belonging to
-- the target Venue contract. Resolves each to its own contract_no+department
-- and writes the link onto every row of the add-on contract's pool (every
-- function under it), the same way the automatic match already applies to
-- the whole pool, not just one row.
CREATE OR REPLACE FUNCTION public.fn_link_addon_contract(p_addon_event_id bigint, p_venue_event_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_addon public.events%rowtype;
  v_venue public.events%rowtype;
BEGIN
  IF NOT user_can('events.list.merge') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_addon FROM public.events WHERE id = p_addon_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'add-on event not found'; END IF;
  IF v_addon.department NOT IN ('Decor', 'Entertainment') THEN
    RAISE EXCEPTION 'only a Decor or Entertainment contract can be linked as an add-on';
  END IF;
  IF v_addon.contract_no IS NULL THEN
    RAISE EXCEPTION 'add-on contract has no LMS contract number yet';
  END IF;

  SELECT * INTO v_venue FROM public.events WHERE id = p_venue_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue event not found'; END IF;
  IF v_venue.department <> 'Venue' THEN RAISE EXCEPTION 'target must be a Venue contract'; END IF;
  IF v_venue.contract_no IS NULL THEN
    RAISE EXCEPTION 'target contract has no LMS contract number yet';
  END IF;

  UPDATE public.events
  SET manual_addon_contract_no = v_venue.contract_no,
      manual_addon_department = v_venue.department
  WHERE contract_no = v_addon.contract_no AND department = v_addon.department;
END;
$$;

-- p_addon_event_id: any event row belonging to the linked Decor/Entertainment
-- contract. Clears the link off the whole pool, same reach as the link
-- above.
CREATE OR REPLACE FUNCTION public.fn_unlink_addon_contract(p_addon_event_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_addon public.events%rowtype;
BEGIN
  IF NOT user_can('events.list.merge') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_addon FROM public.events WHERE id = p_addon_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'add-on event not found'; END IF;

  UPDATE public.events
  SET manual_addon_contract_no = NULL,
      manual_addon_department = NULL
  WHERE contract_no = v_addon.contract_no AND department = v_addon.department;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_addon_contract(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_link_addon_contract(bigint, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_unlink_addon_contract(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_unlink_addon_contract(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
