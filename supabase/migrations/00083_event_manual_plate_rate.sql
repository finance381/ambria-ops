-- Extra Plate Collect hides its whole Collect section when a contract has no
-- extra_plates_charge synced from LMS (see ExtraPlateCollect.jsx:564,
-- `ratePaise > 0` gate) — correct, since there's nothing to charge against,
-- but some contracts genuinely never get a rate entered in LMS at all. Adds
-- a manual override staff can set in Ambria Ops when that happens.
--
-- A separate column, not a write to extra_plates_charge itself: that field
-- is LMS-owned and sync-events overwrites it on every sync (mapRow always
-- sets it from the LMS row) -- a manual value written there would just get
-- clobbered on the next sync. This column is never touched by sync-events,
-- so it survives.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS manual_plate_rate_paise bigint,
  ADD COLUMN IF NOT EXISTS manual_plate_rate_set_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS manual_plate_rate_set_at timestamptz;

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
    manual_plate_rate_set_at
   FROM events
   WHERE lms_cancelled_at IS NULL;

-- Same permission ExtraPlateCollect.jsx already gates Issue/Collect/cancel
-- actions on (`isAdmin = hasPerm(profile?.permsNew, 'events.extra_plate_collect')`).
-- Passing NULL clears the override and falls back to the LMS rate again
-- (e.g. once someone enters it properly in LMS and it syncs in).
CREATE OR REPLACE FUNCTION fn_set_event_manual_plate_rate(p_event_id bigint, p_rate_paise bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('events.extra_plate_collect') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  IF p_rate_paise IS NOT NULL AND p_rate_paise < 0 THEN
    RAISE EXCEPTION 'rate cannot be negative';
  END IF;

  UPDATE events
  SET manual_plate_rate_paise = p_rate_paise,
      manual_plate_rate_set_by = CASE WHEN p_rate_paise IS NULL THEN NULL ELSE v_uid END,
      manual_plate_rate_set_at = CASE WHEN p_rate_paise IS NULL THEN NULL ELSE now() END
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
