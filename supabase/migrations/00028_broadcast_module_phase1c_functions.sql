-- API Marketing module — Phase 1c: read-only compliance/audience helper functions.
-- These are the only wa_* functions marked STABLE — they never write. Every
-- rpc_wa_* mutating function in phase1d is intentionally left VOLATILE (the
-- default): a STABLE function is allowed to be skipped/cached by the planner
-- within a single statement, which is wrong for anything that writes rows —
-- the same correctness class of bug caught earlier in the Projects and
-- Reviews module builds. Don't mark mutating RPCs STABLE.

BEGIN;

-- ============================================================================
-- 1.13 fn_wa_can_send — the single compliance gate every send path calls first
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_can_send(p_contact_id bigint, p_template_category wa_template_category_e)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
  v_freq_cap integer;
  v_window_start time;
  v_window_end time;
  v_now_ist time;
  v_marketing_count integer;
BEGIN
  SELECT phone_e164 INTO v_phone FROM wa_contacts WHERE id = p_contact_id;

  IF v_phone IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_phone'; RETURN;
  END IF;

  IF v_phone !~ '^\+[1-9]\d{7,14}$' THEN
    RETURN QUERY SELECT false, 'invalid_phone'; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM wa_opt_outs WHERE phone_e164 = v_phone) THEN
    RETURN QUERY SELECT false, 'opted_out'; RETURN;
  END IF;

  IF p_template_category = 'marketing' THEN
    SELECT marketing_freq_cap_per_week, send_window_start, send_window_end
      INTO v_freq_cap, v_window_start, v_window_end
      FROM wa_settings WHERE id = 1;

    SELECT count(*) INTO v_marketing_count
      FROM wa_messages m
      JOIN wa_templates t ON t.id = m.template_id
      WHERE m.contact_id = p_contact_id
        AND m.direction = 'out'
        AND t.category = 'marketing'
        AND m.status IN ('sent', 'delivered', 'read')
        AND m.created_at >= now() - interval '7 days';

    IF v_marketing_count >= v_freq_cap THEN
      RETURN QUERY SELECT false, 'freq_cap'; RETURN;
    END IF;

    v_now_ist := (now() AT TIME ZONE 'Asia/Kolkata')::time;
    IF NOT (v_now_ist BETWEEN v_window_start AND v_window_end) THEN
      RETURN QUERY SELECT false, 'window_blocked'; RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'ok';
END;
$$;

-- ============================================================================
-- fn_wa_session_open — 24h (configurable) inbound-message window check
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_session_open(p_contact_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT session_expires_at IS NOT NULL AND session_expires_at > now()
  FROM wa_contacts WHERE id = p_contact_id
$$;

-- ============================================================================
-- 1.12 fn_wa_resolve_audience — table-valued, used by campaign preview/send
-- and the campaign-builder's live reachable-count. Input is dynamic (either
-- a saved list or an ad-hoc filter), so this is a function, not a view.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_resolve_audience(p_list_id bigint, p_filter jsonb, p_template_category wa_template_category_e)
RETURNS TABLE (contact_id bigint, reason text, reachable boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_list_type wa_list_type_e;
  v_list_filter jsonb;
  v_filter jsonb;
BEGIN
  IF p_list_id IS NOT NULL THEN
    SELECT type, filter_json INTO v_list_type, v_list_filter FROM wa_contact_lists WHERE id = p_list_id;
  END IF;

  -- Static list: membership is the audience, no filter applied on top.
  IF p_list_id IS NOT NULL AND v_list_type = 'static' THEN
    RETURN QUERY
    SELECT c.id, r.reason, r.ok
    FROM wa_list_members lm
    JOIN wa_contacts c ON c.id = lm.contact_id
    CROSS JOIN LATERAL fn_wa_can_send(c.id, p_template_category) r
    WHERE lm.list_id = p_list_id;
    RETURN;
  END IF;

  -- Dynamic list: its own filter_json drives the query. Ad-hoc (no list_id):
  -- the campaign's own audience_filter_json (p_filter) drives it instead.
  v_filter := COALESCE(v_list_filter, p_filter, '{}'::jsonb);

  RETURN QUERY
  SELECT c.id, r.reason, r.ok
  FROM wa_contacts c
  CROSS JOIN LATERAL fn_wa_can_send(c.id, p_template_category) r
  WHERE (v_filter->'tags' IS NULL OR c.tags && ARRAY(SELECT jsonb_array_elements_text(v_filter->'tags')))
    AND (v_filter->'venue_ids' IS NULL OR c.venue_affinity = ANY (ARRAY(SELECT jsonb_array_elements_text(v_filter->'venue_ids')::integer)))
    AND (v_filter->>'source' IS NULL OR c.source::text = v_filter->>'source')
    AND (
      v_filter->>'min_last_sent_days' IS NULL
      OR c.last_sent_at IS NULL
      OR c.last_sent_at <= now() - ((v_filter->>'min_last_sent_days')::integer * interval '1 day')
    );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
