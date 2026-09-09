-- API Marketing module — Phase 1g: fixes a real gap found while writing the
-- wa-send Edge Function (Phase 3), not caught during the original Phase 1
-- schema review.
--
-- Meta's WhatsApp template-send API doesn't take a single merged string — it
-- takes a structured `components: [{type:'body', parameters:[{type:'text',
-- text:'Riya'},{type:'text',text:'PA Venue'}]}]` array of the INDIVIDUAL
-- variable values in {{1}},{{2}},... order. wa_messages.rendered_body only
-- stores the final merged text (for display in the Inbox thread), which
-- can't be inverted back into positional values in general (values can
-- overlap with template text). Adding wa_messages.template_params to carry
-- the ordered value array alongside rendered_body, populated at the same
-- time by the two RPCs that actually send templates (quick-send, campaign
-- send).
--
-- Known gap, not resolved here: rpc_wa_conversation_reply's template-reply
-- path (reopening a closed session from the Inbox) still only accepts a
-- pre-rendered p_body with no per-variable values, so it can't populate
-- template_params for a multi-variable template. wa-send below fails that
-- specific combination loudly (`template_params_missing`) rather than
-- sending something wrong. Revisit when Phase 7 (Inbox UI) is built —
-- extending rpc_wa_conversation_reply to take p_variable_values would need
-- its signature changed (a DROP + re-CREATE, since adding a parameter makes
-- Postgres treat it as an overload, not a replacement).

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

NOTIFY pgrst, 'reload schema';

COMMIT;
