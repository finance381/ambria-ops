-- Fnbapp -> Ops: some functions in Fnbapp exist with no LMS contract behind
-- them at all (a manual "Add Event" or a converted proposal, tagged
-- lms_source IS NULL on their side, with their own FP-.../PROP-... id).
-- Right now fn_fnb_store_requisition_sync's p_event_id is never populated
-- for these, so their requisitions create fine (stock still decrements) but
-- carry no event attribution at all.
--
-- events already has a lightweight "tentative event" mode built for exactly
-- this (fn_create_tentative_event, 00040) -- this adds the missing piece:
-- an external-reference key to upsert against, so a repeated call as the
-- booking gets edited before the function date updates the SAME row instead
-- of creating a new one each time, mirroring store_requisitions.fnb_sync_ref's
-- own idempotency pattern exactly.
--
-- Once a tentative event is merged into a real LMS-synced one
-- (fn_merge_events, admin/auditor action), a repeat sync for the same
-- external_ref stops editing it -- the merge target's fields are LMS's to
-- own from that point on, Fnbapp's own edits to its side of the booking no
-- longer apply. fn_merge_events can't produce more than one hop of
-- merged_into_id (it refuses to merge INTO an event that is itself already
-- a merge target), so following it once is always enough.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS fnb_external_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS events_fnb_external_ref_uniq
  ON public.events(fnb_external_ref) WHERE fnb_external_ref IS NOT NULL;

-- fn_merge_events predates store_requisitions.event_ids (00080, 40
-- migrations later) -- it already repoints every other event_id-shaped FK,
-- but never this bigint[] array column. A tentative event with store
-- requisitions already synced against it, merged today, silently orphans
-- those requisitions' event attribution. Fixed regardless of the new sync
-- above, since any existing tentative-event merge already had this gap.
CREATE OR REPLACE FUNCTION public.fn_merge_events(p_tentative_id bigint, p_target_id bigint)
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
  UPDATE store_requisitions SET event_ids = array_replace(event_ids, p_tentative_id, p_target_id)
    WHERE p_tentative_id = ANY(event_ids);

  UPDATE events SET merged_into_id = p_target_id WHERE id = p_tentative_id;
END;
$$;

-- p_payload: { external_ref, client_name, venue_name, function_date, pax?, function_type }
-- venue_name is resolved against the venues master by exact name match
-- (case/whitespace-insensitive) -- Fnbapp has no visibility into Ops' venue
-- ids, so it sends plain text, same "Other" fallback
-- fn_create_tentative_event's own UI already offers a human for a venue
-- that's not one of the 4 main properties.
--
-- No user_can() gate -- same trust model fn_fnb_store_requisition_sync
-- already uses for this integration: the edge function's shared-secret auth
-- is the real gate, there is no calling Ops user.
CREATE OR REPLACE FUNCTION public.fn_fnb_tentative_event_sync(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_external_ref  text := p_payload->>'external_ref';
  v_client_name   text := trim(coalesce(p_payload->>'client_name', ''));
  v_venue_name_in text := trim(coalesce(p_payload->>'venue_name', ''));
  v_function_date date := (p_payload->>'function_date')::date;
  v_pax           integer := nullif(p_payload->>'pax', '')::integer;
  v_function_type text := trim(coalesce(p_payload->>'function_type', ''));
  v_existing      events%rowtype;
  v_venue_id      integer;
  v_venue_name    text;
  v_id            bigint;
BEGIN
  IF v_external_ref IS NULL OR trim(v_external_ref) = '' THEN
    RAISE EXCEPTION 'external_ref required' USING ERRCODE = 'P0001';
  END IF;
  IF v_client_name = '' THEN
    RAISE EXCEPTION 'client_name required' USING ERRCODE = 'P0001';
  END IF;
  IF v_function_date IS NULL THEN
    RAISE EXCEPTION 'function_date required' USING ERRCODE = 'P0001';
  END IF;
  IF v_function_type = '' THEN
    RAISE EXCEPTION 'function_type required' USING ERRCODE = 'P0001';
  END IF;
  IF v_venue_name_in = '' THEN
    RAISE EXCEPTION 'venue_name required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, name INTO v_venue_id, v_venue_name
  FROM public.venues WHERE lower(trim(name)) = lower(v_venue_name_in) LIMIT 1;
  IF v_venue_id IS NULL THEN
    v_venue_name := v_venue_name_in; -- no match -- stored as free text, same as "Other" venue
  END IF;

  SELECT * INTO v_existing FROM public.events WHERE fnb_external_ref = v_external_ref;

  IF FOUND THEN
    IF v_existing.merged_into_id IS NOT NULL THEN
      -- Already reconciled into a real LMS event -- that event's fields are
      -- LMS's to own from here on, not this sync's. Just report where it
      -- landed (fn_merge_events guarantees this is never itself merged
      -- again, so one hop is always the end of the chain).
      RETURN v_existing.merged_into_id;
    END IF;
    IF v_existing.is_tentative THEN
      UPDATE public.events SET
        client_name   = v_client_name,
        venue_id      = v_venue_id,
        venue_name    = v_venue_name,
        function_date = v_function_date,
        pax           = v_pax,
        function_type = v_function_type,
        event_name    = v_function_type
      WHERE id = v_existing.id;
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.events (
    event_name, client_name, venue_id, venue_name, function_date, pax, function_type,
    is_tentative, tentative_created_at, fnb_external_ref
  ) VALUES (
    v_function_type, v_client_name, v_venue_id, v_venue_name, v_function_date, v_pax, v_function_type,
    true, now(), v_external_ref
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
