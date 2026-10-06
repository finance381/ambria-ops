-- Migration 00033 (template_params for outbound WhatsApp template variable
-- substitution) was written but, per a live information_schema check, never
-- actually applied -- wa_messages.template_params doesn't exist on the live
-- DB at all. Meanwhile wa-send (the edge function) has been deployed
-- expecting it: any template send where the template has variables and
-- template_params doesn't match variable_count gets hard-failed with
-- `template_params_missing` before it ever reaches Meta (see wa-send/index.ts
-- ~line 121). With the column missing, that's every variable template, via
-- every path -- quick-send, campaigns, and inbox replies alike. Confirmed
-- nothing's hit it yet (zero wa_messages rows exist for any variable_count>0
-- template), but it's a live landmine for the first one that does.
--
-- This re-applies 00033 in full (idempotent either way), and additionally
-- closes the gap 00033's own header flagged as deliberately unresolved:
-- rpc_wa_conversation_reply (the Inbox's "send template" reply/reopen path)
-- never accepted variable values at all, so Inbox.jsx defensively only ever
-- listed templates with variable_count = 0 in its picker -- a template with
-- real variables simply couldn't be sent from the Inbox. Extended here to
-- accept p_variable_values and render/pack template_params exactly like
-- quick-send and campaign-send already do; Inbox.jsx's template picker and
-- send flow updated in the same commit to collect those values and no longer
-- filter the list down to zero-variable templates only.

BEGIN;

ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS template_params jsonb;

CREATE OR REPLACE FUNCTION fn_wa_values_to_ordered_array(p_values jsonb, p_count integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  i integer;
BEGIN
  FOR i IN 1..COALESCE(p_count, 0) LOOP
    v_result := v_result || to_jsonb(COALESCE(p_values->>(i::text), ''));
  END LOOP;
  RETURN v_result;
END;
$$;

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

  INSERT INTO wa_messages (contact_id, direction, template_id, rendered_body, template_params, status, sent_by)
  VALUES (
    p_contact_id, 'out', p_template_id,
    fn_wa_render_body(v_template.body_text, p_variable_values),
    fn_wa_values_to_ordered_array(p_variable_values, v_template.variable_count),
    'queued', auth.uid()
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
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

  INSERT INTO wa_messages (campaign_id, contact_id, direction, template_id, rendered_body, template_params, status)
  SELECT
    p_campaign_id,
    a.contact_id,
    'out',
    v_campaign.template_id,
    fn_wa_render_body(v_template.body_text, fn_wa_resolve_mapping(v_campaign.variable_mapping_json, a.contact_id)),
    fn_wa_values_to_ordered_array(fn_wa_resolve_mapping(v_campaign.variable_mapping_json, a.contact_id), v_template.variable_count),
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

-- Adding a parameter makes Postgres treat this as a new overload rather than
-- a replacement of the 3-arg version — drop it explicitly first, same note
-- 00033's header already left for whoever did this.
DROP FUNCTION IF EXISTS rpc_wa_conversation_reply(bigint, text, bigint);

CREATE OR REPLACE FUNCTION rpc_wa_conversation_reply(p_contact_id bigint, p_body text, p_template_id bigint, p_variable_values jsonb DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_id bigint;
  v_template record;
  v_rendered text;
  v_params jsonb;
BEGIN
  IF NOT user_can('broadcast.inbox.reply') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_template_id IS NULL AND NOT fn_wa_session_open(p_contact_id) THEN
    RAISE EXCEPTION 'session_closed_need_template';
  END IF;

  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_template FROM wa_templates WHERE id = p_template_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
    v_rendered := fn_wa_render_body(v_template.body_text, p_variable_values);
    v_params := fn_wa_values_to_ordered_array(p_variable_values, v_template.variable_count);
  ELSE
    v_rendered := p_body;
    v_params := NULL;
  END IF;

  INSERT INTO wa_messages (contact_id, direction, template_id, rendered_body, template_params, status, sent_by)
  VALUES (p_contact_id, 'out', p_template_id, v_rendered, v_params, 'queued', auth.uid())
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
