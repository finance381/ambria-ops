-- Manual link between two SEPARATE Venue contracts for the same deal (e.g.
-- a Sagan at one venue + a Wedding at another, booked by the same family
-- the same weekend, each its own real LMS contract_no) -- same pattern as
-- 00201's manual Decor/Entertainment-to-Venue add-on link, generalized to
-- Venue+Venue. Deliberately NOT that: no event_ledger/wallet_transactions/
-- requisition/etc. row ever moves, fully reversible, just one nullable
-- column. ContractList.jsx folds the secondary into the primary's Balance/
-- plates/collections/print the exact same way it already folds a linked
-- add-on contract in -- those consolidation functions
-- (fetchConsolidatedContractBalance, computePlateSummary, the poolIds-based
-- collections query, the print statement's addon-contracts page) already
-- take a plain list of contracts/ids, so a second Venue contract folds into
-- the same lists without any new balance math.
--
-- No department column needed here (unlike manual_addon_department) --
-- both sides of this link are always 'Venue'.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS manual_venue_link_contract_no text;

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
    manual_addon_department,
    manual_venue_link_contract_no
   FROM events
  WHERE lms_cancelled_at IS NULL;

-- p_event_id_a / p_event_id_b: any event row belonging to either Venue
-- contract to be linked (resolved to its own contract_no+'Venue' pool, same
-- as fn_link_addon_contract). The contract with the EARLIER function_date
-- becomes primary -- picked here, not left to the caller, per how this is
-- meant to be used (two real bookings for the same deal; whichever happens
-- first is "the" contract everything else folds into). Compared as the
-- EARLIEST function_date across each contract's own pool (a multi-function
-- contract's rows aren't all the same date), not just whichever single row
-- the caller happened to pass -- the app's own contract list sorts a
-- multi-function group's rows newest-first, so "the row the caller passed"
-- is routinely that group's LATEST date, not its first. Rejects if either
-- side's (pool-wide) function_date is missing or they tie, rather than
-- guessing.
--
-- Only one level of linking is supported (a straight pair, not a chain) --
-- rejects if the primary is already linked to something, already has a
-- different secondary, or the secondary is already linked to something.
-- Without this, re-running the merge UI against an already-linked contract
-- could silently overwrite or orphan an existing link (confirmed in review:
-- unguarded, a third contract selected alongside an already-linked pair
-- could make one of the three vanish from every balance/plates/collections
-- view with no error).
CREATE OR REPLACE FUNCTION public.fn_link_venue_contracts(p_event_id_a bigint, p_event_id_b bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_a public.events%rowtype;
  v_b public.events%rowtype;
  v_primary public.events%rowtype;
  v_secondary public.events%rowtype;
  v_a_date date;
  v_b_date date;
BEGIN
  IF NOT user_can('events.list.merge') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_a FROM public.events WHERE id = p_event_id_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'first event not found'; END IF;
  SELECT * INTO v_b FROM public.events WHERE id = p_event_id_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'second event not found'; END IF;

  IF v_a.department <> 'Venue' OR v_b.department <> 'Venue' THEN
    RAISE EXCEPTION 'both contracts must be Venue contracts';
  END IF;
  IF v_a.contract_no IS NULL OR v_b.contract_no IS NULL THEN
    RAISE EXCEPTION 'both contracts must already have an LMS contract number';
  END IF;
  IF v_a.contract_no = v_b.contract_no THEN
    RAISE EXCEPTION 'these are already the same contract';
  END IF;

  -- Cancelled/resync-duplicate rows excluded from the date comparison
  -- (not from the final UPDATE's reach below, same scope 00201's own
  -- add-on link UPDATE uses) -- a stale duplicate can carry an earlier
  -- date than the function actually being linked, which would otherwise
  -- pick the wrong contract as primary.
  SELECT min(function_date) INTO v_a_date FROM public.events WHERE contract_no = v_a.contract_no AND department = 'Venue' AND lms_cancelled_at IS NULL AND merged_into_id IS NULL;
  SELECT min(function_date) INTO v_b_date FROM public.events WHERE contract_no = v_b.contract_no AND department = 'Venue' AND lms_cancelled_at IS NULL AND merged_into_id IS NULL;
  IF v_a_date IS NULL OR v_b_date IS NULL THEN
    RAISE EXCEPTION 'both contracts need a function date to decide which one is primary';
  END IF;
  IF v_a_date = v_b_date THEN
    RAISE EXCEPTION 'both contracts have the same function date -- pick which one is primary manually';
  END IF;

  IF v_a_date < v_b_date THEN
    v_primary := v_a; v_secondary := v_b;
  ELSE
    v_primary := v_b; v_secondary := v_a;
  END IF;

  IF EXISTS (SELECT 1 FROM public.events WHERE contract_no = v_primary.contract_no AND department = 'Venue' AND manual_venue_link_contract_no IS NOT NULL) THEN
    RAISE EXCEPTION 'contract #% is already linked to another Venue contract -- unlink it first', v_primary.contract_no;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE department = 'Venue' AND manual_venue_link_contract_no = v_primary.contract_no) THEN
    RAISE EXCEPTION 'contract #% already has a different Venue contract linked to it -- unlink that one first', v_primary.contract_no;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE contract_no = v_secondary.contract_no AND department = 'Venue' AND manual_venue_link_contract_no IS NOT NULL) THEN
    RAISE EXCEPTION 'contract #% is already linked to another Venue contract -- unlink it first', v_secondary.contract_no;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE department = 'Venue' AND manual_venue_link_contract_no = v_secondary.contract_no) THEN
    RAISE EXCEPTION 'contract #% already has a different Venue contract linked to it -- only one level of linking is supported', v_secondary.contract_no;
  END IF;

  UPDATE public.events
  SET manual_venue_link_contract_no = v_primary.contract_no
  WHERE contract_no = v_secondary.contract_no AND department = 'Venue';
END;
$$;

-- p_event_id: any event row belonging to the linked (secondary) Venue
-- contract. Clears the link off its whole pool, same reach as
-- fn_unlink_addon_contract.
CREATE OR REPLACE FUNCTION public.fn_unlink_venue_contract(p_event_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event public.events%rowtype;
BEGIN
  IF NOT user_can('events.list.merge') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;

  UPDATE public.events
  SET manual_venue_link_contract_no = NULL
  WHERE contract_no = v_event.contract_no AND department = 'Venue';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_venue_contracts(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_link_venue_contracts(bigint, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_unlink_venue_contract(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_unlink_venue_contract(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
