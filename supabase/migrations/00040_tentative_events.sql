-- Tentative events + merge-into-LMS-event
-- Apply via the Supabase SQL editor (this repo's migrations aren't applied
-- through the CLI — `events`, `event_ledger`, `extra_plate_collections`,
-- `extra_plate_issues`, `production_orders`, and the existing RPCs this
-- migration follows the conventions of are themselves not tracked here,
-- they were created directly in Studio).
--
-- Lets a permitted user (`events.list.create_tentative`) create a lightweight
-- event directly in the app when no LMS contract exists yet for a booking
-- that's already happening — it reuses the `events` table itself (not a new
-- table), so the existing Collect flow (fn_wallet_collect/fn_event_balance)
-- works against it unchanged. Later, once the real LMS event syncs in, a
-- permitted user (`events.list.merge`) merges the tentative event into it —
-- fn_merge_events repoints every table with an event_id foreign key from the
-- tentative event onto the real one, then soft-marks the tentative row via
-- merged_into_id (kept for audit, excluded from future pick-lists).
--
-- Expected/known-safe: fn_event_balance's "agreed" amounts come from
-- events.agreed_cash_paise/agreed_bank_paise, which are null/0 on a
-- tentative event (there's no contract yet to define them) — so a
-- collection against a tentative event will show as "over agreed" until
-- it's merged into a real contracted event. That's accurate, not a bug.

BEGIN;

-- 1) New columns on events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_tentative boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pax integer,
  ADD COLUMN IF NOT EXISTS function_type text,
  ADD COLUMN IF NOT EXISTS merged_into_id bigint REFERENCES events(id),
  ADD COLUMN IF NOT EXISTS tentative_created_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tentative_created_at timestamptz;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_merged_into_id_not_self,
  ADD CONSTRAINT events_merged_into_id_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);

-- 2) events_safe (read by Events.jsx and others) has an explicit column list,
--    not `select *` — it needs the new columns added explicitly too.
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
    merged_into_id
   FROM events;

-- 3) Create a tentative event. SECURITY DEFINER: `events_write` RLS restricts
--    direct writes to admin/auditor, same as fn_wallet_collect/fn_event_balance
--    already bypass RLS this way — the permission check below is what actually
--    gates who may call this, via the same user_can() used elsewhere
--    (see fn_wallet_collect / rpc_project_upsert for the established pattern).
CREATE OR REPLACE FUNCTION fn_create_tentative_event(
  p_client_name text,
  p_venue_id integer,
  p_function_date date,
  p_pax integer,
  p_function_type text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_name text;
  v_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('events.list.create_tentative') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  IF p_client_name IS NULL OR length(trim(p_client_name)) = 0 THEN
    RAISE EXCEPTION 'guest name required';
  END IF;
  IF p_function_date IS NULL THEN
    RAISE EXCEPTION 'function date required';
  END IF;
  IF p_function_type IS NULL OR length(trim(p_function_type)) = 0 THEN
    RAISE EXCEPTION 'function type required';
  END IF;

  SELECT name INTO v_venue_name FROM venues WHERE id = p_venue_id;
  IF v_venue_name IS NULL THEN
    RAISE EXCEPTION 'venue not found';
  END IF;

  INSERT INTO events (
    event_name, client_name, venue_id, venue_name, function_date, pax, function_type,
    is_tentative, tentative_created_by, tentative_created_at
  ) VALUES (
    p_function_type, trim(p_client_name), p_venue_id, v_venue_name, p_function_date, p_pax, p_function_type,
    true, v_uid, now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4) Merge a tentative event into a real (or another) event. Repoints every
--    table that carries an event_id-shaped foreign key, in one transaction,
--    then soft-marks the tentative row via merged_into_id so it disappears
--    from future pick-lists (loadFunctionsForDate/Events.jsx both filter on
--    merged_into_id IS NULL) while staying in place for audit.
CREATE OR REPLACE FUNCTION fn_merge_events(p_tentative_id bigint, p_target_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source events%rowtype;
  v_target events%rowtype;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('events.list.merge') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  IF p_tentative_id = p_target_id THEN
    RAISE EXCEPTION 'cannot merge an event into itself';
  END IF;

  SELECT * INTO v_source FROM events WHERE id = p_tentative_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source event not found'; END IF;
  IF NOT v_source.is_tentative THEN RAISE EXCEPTION 'source event is not a tentative event'; END IF;
  IF v_source.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'source event has already been merged'; END IF;

  SELECT * INTO v_target FROM events WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target event not found'; END IF;
  IF v_target.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'target event has itself been merged elsewhere — pick its merge target instead';
  END IF;

  UPDATE event_items SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE event_manpower SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE challans SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE event_ledger SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE extra_plate_issues SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE extra_plate_collections SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE expenses SET event_id = p_target_id::integer WHERE event_id = p_tentative_id::integer;
  UPDATE requisitions SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE projects SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE cost_transfers SET from_event_id = p_target_id WHERE from_event_id = p_tentative_id;
  UPDATE cost_transfers SET to_event_id = p_target_id WHERE to_event_id = p_tentative_id;
  UPDATE production_orders SET event_id = p_target_id WHERE event_id = p_tentative_id;
  UPDATE wallet_transactions SET reference_id = p_target_id::text
    WHERE reference_type = 'collection' AND reference_id = p_tentative_id::text;

  UPDATE events SET merged_into_id = p_target_id WHERE id = p_tentative_id;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
