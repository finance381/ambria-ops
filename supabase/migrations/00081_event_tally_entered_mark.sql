-- Extends "Mark entered" (Tally bookkeeping) to contracts, same pattern as
-- 00076 (wallet_transactions/ledger_entries/expenses/cost_transfers): same
-- shared permission (finance.wallet.mark_entered), same toggle shape, same
-- same-person-or-admin/auditor un-mark rule.
--
-- events_safe has an explicit column list (00040), not `select *` — the two
-- new columns are appended at the end so every existing column position is
-- unchanged for anything else already selecting from it.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS tally_entered_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tally_entered_at timestamptz;

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
   FROM events;

CREATE OR REPLACE FUNCTION fn_toggle_event_tally_entered(p_event_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entered_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT tally_entered_by INTO v_entered_by
  FROM events WHERE id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;

  IF v_entered_by IS NULL THEN
    UPDATE events SET tally_entered_by = v_uid, tally_entered_at = now()
    WHERE id = p_event_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_entered_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who marked this entered can undo it';
  END IF;

  UPDATE events SET tally_entered_by = NULL, tally_entered_at = NULL
  WHERE id = p_event_id;
  RETURN false;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
