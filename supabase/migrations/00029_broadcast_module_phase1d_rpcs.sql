-- API Marketing module — Phase 1d: client-callable RPCs.
--
-- IMPORTANT correction vs. the original spec: mutating RPCs here are
-- VOLATILE (the default — no STABLE keyword), not STABLE. A STABLE function
-- may be evaluated once and its result reused/skipped by the planner within
-- a single statement, which is wrong for anything that writes rows. Only
-- truly read-only helpers (phase1c) are STABLE. This is the same class of
-- bug already caught and corrected in the Projects and Reviews module builds
-- this session — flagging again here since the spec repeated the same
-- "STABLE on all RPCs" instruction.
--
-- Two RPCs (rpc_wa_template_submit, rpc_wa_template_sync) only do DB
-- bookkeeping — the actual outbound HTTP call to Meta has no precedent
-- anywhere in this codebase (no pg_net/http extension in use), so it must
-- happen in a Phase 3 Edge Function that the client invokes after calling
-- these. Commented inline at each; flagged in the phase-1 report too.

BEGIN;

-- ============================================================================
-- Small pure-text helpers used by preview/send/quick-send rendering
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_render_body(p_body text, p_values jsonb)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result text := p_body;
  v_key text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_values, '{}'::jsonb)) LOOP
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_values->>v_key, ''));
  END LOOP;
  RETURN v_result;
END;
$$;

-- Resolves a campaign's variable_mapping_json (e.g. {"1":"contact.first_name"})
-- into concrete per-contact values (e.g. {"1":"Riya"}) for preview/send.
-- Only a small known set of contact fields is supported; anything else
-- renders blank rather than erroring, since campaign variable mappings are
-- user-authored and shouldn't be able to crash a send.
CREATE OR REPLACE FUNCTION fn_wa_resolve_mapping(p_mapping jsonb, p_contact_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contact record;
  v_key text;
  v_path text;
  v_field text;
  v_value text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT c.*, v.name AS venue_affinity_name
    INTO v_contact
    FROM wa_contacts c
    LEFT JOIN venues v ON v.id = c.venue_affinity
    WHERE c.id = p_contact_id;

  FOR v_key, v_path IN SELECT key, value FROM jsonb_each_text(COALESCE(p_mapping, '{}'::jsonb)) LOOP
    v_field := split_part(v_path, '.', 2);
    v_value := CASE v_field
      WHEN 'first_name' THEN v_contact.first_name
      WHEN 'name' THEN v_contact.name
      WHEN 'phone_e164' THEN v_contact.phone_e164
      WHEN 'venue_affinity_name' THEN v_contact.venue_affinity_name
      ELSE ''
    END;
    v_result := v_result || jsonb_build_object(v_key, coalesce(v_value, ''));
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Templates
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_wa_template_upsert(p_template jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT user_can('broadcast.templates.edit') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  v_id := NULLIF(p_template->>'id', '')::bigint;

  IF v_id IS NULL THEN
    INSERT INTO wa_templates (
      name, language, category, header_type, header_content, body_text, footer_text,
      buttons_json, variable_labels, sales_approved, created_by
    ) VALUES (
      p_template->>'name',
      COALESCE(p_template->>'language', 'en'),
      (p_template->>'category')::wa_template_category_e,
      p_template->>'header_type',
      p_template->>'header_content',
      p_template->>'body_text',
      p_template->>'footer_text',
      COALESCE(p_template->'buttons_json', '[]'::jsonb),
      COALESCE(p_template->'variable_labels', '[]'::jsonb),
      COALESCE((p_template->>'sales_approved')::boolean, false),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    -- Meta templates are immutable once submitted — editing content only
    -- makes sense while still draft, or after Meta rejected it (resubmit as
    -- a fresh draft-equivalent edit). Pending/approved rows are locked here.
    UPDATE wa_templates SET
      name = p_template->>'name',
      language = COALESCE(p_template->>'language', language),
      category = (p_template->>'category')::wa_template_category_e,
      header_type = p_template->>'header_type',
      header_content = p_template->>'header_content',
      body_text = p_template->>'body_text',
      footer_text = p_template->>'footer_text',
      buttons_json = COALESCE(p_template->'buttons_json', buttons_json),
      variable_labels = COALESCE(p_template->'variable_labels', variable_labels),
      sales_approved = COALESCE((p_template->>'sales_approved')::boolean, sales_approved),
      updated_at = now()
    WHERE id = v_id
      AND meta_status IN ('draft', 'rejected');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'template_not_editable';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_template_submit(p_template_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT user_can('broadcast.templates.submit') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Bookkeeping only. The client must call the Phase-3 Edge Function to
  -- actually POST this template to Meta's Create Message Template API
  -- immediately after this RPC succeeds.
  UPDATE wa_templates
  SET meta_status = 'pending', submitted_at = now(), meta_rejection_reason = NULL
  WHERE id = p_template_id AND meta_status IN ('draft', 'rejected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_submittable';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_template_sync(p_template_id bigint, p_meta_status text DEFAULT NULL, p_meta_id text DEFAULT NULL, p_rejection_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT user_can('broadcast.templates.view') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Called two ways: (1) bare p_template_id from the client as a "please
  -- refresh" signal — currently a no-op, since the actual Meta fetch has to
  -- happen in the Phase-3 Edge Function; (2) with the fetched values, which
  -- that Edge Function should pass once it exists.
  IF p_meta_status IS NULL THEN
    RETURN;
  END IF;

  UPDATE wa_templates SET
    meta_status = p_meta_status::wa_template_status_e,
    meta_id = COALESCE(p_meta_id, meta_id),
    meta_rejection_reason = p_rejection_reason,
    approved_at = CASE WHEN p_meta_status = 'approved' THEN now() ELSE approved_at END,
    updated_at = now()
  WHERE id = p_template_id;
END;
$$;

-- ============================================================================
-- Contacts
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_wa_contact_upsert_bulk(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row jsonb;
  v_phone text;
  v_id bigint;
  v_was_insert boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped_invalid integer := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT (user_can('broadcast.contacts.import') OR user_can('broadcast.contacts.edit')) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_phone := v_row->>'phone';

    IF v_phone IS NULL OR v_phone !~ '^\+[1-9]\d{7,14}$' THEN
      v_skipped_invalid := v_skipped_invalid + 1;
      v_results := v_results || jsonb_build_object('phone', v_phone, 'status', 'skipped_invalid_phone');
      CONTINUE;
    END IF;

    INSERT INTO wa_contacts (phone_e164, name, source, external_ids, tags, opt_status, created_by)
    VALUES (
      v_phone,
      v_row->>'name',
      COALESCE((v_row->>'source')::wa_contact_source_e, 'manual'),
      COALESCE(v_row->'external_ids', '{}'::jsonb),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row->'tags', '[]'::jsonb))), '{}'),
      COALESCE((v_row->>'opt_status')::wa_contact_opt_status_e, 'unknown'),
      auth.uid()
    )
    ON CONFLICT (phone_e164) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, wa_contacts.name),
      tags = ARRAY(SELECT DISTINCT unnest(wa_contacts.tags || EXCLUDED.tags)),
      external_ids = wa_contacts.external_ids || EXCLUDED.external_ids,
      opt_status = CASE WHEN v_row ? 'opt_status' THEN EXCLUDED.opt_status ELSE wa_contacts.opt_status END,
      updated_at = now()
    RETURNING id, (xmax = 0) INTO v_id, v_was_insert;

    IF v_was_insert THEN
      v_inserted := v_inserted + 1;
      v_results := v_results || jsonb_build_object('phone', v_phone, 'status', 'inserted', 'contact_id', v_id);
    ELSE
      v_updated := v_updated + 1;
      v_results := v_results || jsonb_build_object('phone', v_phone, 'status', 'updated', 'contact_id', v_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped_invalid_phone', v_skipped_invalid,
    'results', v_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_contact_opt_out(p_phone text, p_reason text, p_source text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Permission check only applies to genuine client-driven calls. When this
  -- is invoked internally (the stop-keyword trigger in phase1e), auth.uid()
  -- is null since there's no end-user JWT in that context — same as how
  -- service-role calls already bypass RLS on the base tables.
  IF auth.uid() IS NOT NULL AND NOT user_can('broadcast.contacts.opt_out') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  INSERT INTO wa_opt_outs (phone_e164, contact_id, reason, source)
  SELECT p_phone, id, p_reason, p_source FROM wa_contacts WHERE phone_e164 = p_phone
  ON CONFLICT (phone_e164) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source, opted_out_at = now();

  UPDATE wa_contacts SET opt_status = 'opted_out', opt_out_at = now(), opt_out_reason = p_reason
  WHERE phone_e164 = p_phone;
END;
$$;

-- ============================================================================
-- Campaigns
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_wa_campaign_preview(p_campaign_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign record;
  v_template record;
  v_breakdown jsonb;
  v_recipient_count integer;
  v_samples jsonb := '[]'::jsonb;
  v_sample record;
BEGIN
  IF NOT user_can('broadcast.campaigns.view') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT * INTO v_campaign FROM wa_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;

  SELECT * INTO v_template FROM wa_templates WHERE id = v_campaign.template_id;

  SELECT jsonb_object_agg(reason, cnt) INTO v_breakdown
  FROM (
    SELECT reason, count(*) AS cnt
    FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category)
    GROUP BY reason
  ) b;

  SELECT count(*) INTO v_recipient_count
  FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category)
  WHERE reachable;

  FOR v_sample IN
    SELECT a.contact_id
    FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category) a
    WHERE a.reachable
    LIMIT 3
  LOOP
    v_samples := v_samples || jsonb_build_object(
      'contact_id', v_sample.contact_id,
      'rendered_body', fn_wa_render_body(v_template.body_text, fn_wa_resolve_mapping(v_campaign.variable_mapping_json, v_sample.contact_id))
    );
  END LOOP;

  RETURN jsonb_build_object(
    'recipient_count', v_recipient_count,
    'breakdown_by_reason', COALESCE(v_breakdown, '{}'::jsonb),
    'sample_renders', v_samples
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_campaign_send(p_campaign_id bigint, p_confirm_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign record;
  v_template record;
  v_threshold integer;
  v_recipient_count integer;
  v_blocked_count integer;
BEGIN
  IF NOT user_can('broadcast.campaigns.send') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT * INTO v_campaign FROM wa_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_campaign.status NOT IN ('draft', 'scheduled') THEN
    RAISE EXCEPTION 'campaign_already_sent';
  END IF;

  SELECT * INTO v_template FROM wa_templates WHERE id = v_campaign.template_id;
  IF v_template.meta_status != 'approved' THEN
    RAISE EXCEPTION 'template_not_approved';
  END IF;

  SELECT confirmation_threshold_recipients INTO v_threshold FROM wa_settings WHERE id = 1;

  SELECT count(*) FILTER (WHERE reachable), count(*) FILTER (WHERE NOT reachable)
    INTO v_recipient_count, v_blocked_count
    FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category);

  IF v_recipient_count > v_threshold AND p_confirm_token IS DISTINCT FROM ('SEND-' || p_campaign_id::text) THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;

  INSERT INTO wa_messages (campaign_id, contact_id, direction, template_id, rendered_body, status)
  SELECT
    p_campaign_id,
    a.contact_id,
    'out',
    v_campaign.template_id,
    fn_wa_render_body(v_template.body_text, fn_wa_resolve_mapping(v_campaign.variable_mapping_json, a.contact_id)),
    'queued'
  FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category) a
  WHERE a.reachable;

  UPDATE wa_campaigns SET
    status = 'sending',
    sent_at = now(),
    blocked_count = v_blocked_count
  WHERE id = p_campaign_id;

  -- The actual Meta API calls happen in the wa-send Edge Function (Phase 3),
  -- which the client must invoke with {campaign_id: p_campaign_id} right
  -- after this RPC returns — this RPC only queues the message rows.
END;
$$;

-- ============================================================================
-- Quick send + inbox
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_wa_quick_send(p_contact_id bigint, p_template_id bigint, p_variable_values jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template record;
  v_check record;
  v_message_id bigint;
BEGIN
  IF NOT user_can('broadcast.quicksend') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT * INTO v_template FROM wa_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
  IF NOT v_template.sales_approved OR v_template.meta_status != 'approved' THEN
    RAISE EXCEPTION 'template_not_sales_approved';
  END IF;

  SELECT * INTO v_check FROM fn_wa_can_send(p_contact_id, v_template.category);
  IF NOT v_check.ok THEN
    RAISE EXCEPTION '%', v_check.reason;
  END IF;

  INSERT INTO wa_messages (contact_id, direction, template_id, rendered_body, status, sent_by)
  VALUES (
    p_contact_id, 'out', p_template_id,
    fn_wa_render_body(v_template.body_text, p_variable_values),
    'queued', auth.uid()
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_conversation_reply(p_contact_id bigint, p_body text, p_template_id bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_id bigint;
BEGIN
  IF NOT user_can('broadcast.inbox.reply') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_template_id IS NULL AND NOT fn_wa_session_open(p_contact_id) THEN
    RAISE EXCEPTION 'session_closed_need_template';
  END IF;

  INSERT INTO wa_messages (contact_id, direction, template_id, rendered_body, status, sent_by)
  VALUES (p_contact_id, 'out', p_template_id, p_body, 'queued', auth.uid())
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_wa_mark_read(p_conversation_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT user_can('broadcast.inbox.view') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  UPDATE wa_conversations SET unread_count = 0 WHERE id = p_conversation_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
