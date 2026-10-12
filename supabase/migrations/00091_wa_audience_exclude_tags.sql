-- Audience filters (campaign audience_filter_json / dynamic list filter_json)
-- only ever had one tags behavior: "contact matching ANY of these is
-- included" (c.tags && filter_tags). No way to say the opposite — exclude
-- anyone carrying a given tag. Adds a second, independent field,
-- exclude_tags, rather than repurposing tags itself (which would silently
-- invert every campaign/list already relying on the include behavior).

BEGIN;

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
    AND (v_filter->'exclude_tags' IS NULL OR NOT (c.tags && ARRAY(SELECT jsonb_array_elements_text(v_filter->'exclude_tags'))))
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
