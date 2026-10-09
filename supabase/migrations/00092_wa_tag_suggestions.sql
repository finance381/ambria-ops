-- Campaign Builder's Tags/Exclude tags and the Lists dynamic-filter form are
-- free-text, comma-separated fields with no link to what tags actually exist
-- on wa_contacts — a typo or a different casing (e.g. "Team" vs "team")
-- silently matches nothing, with no error, which is exactly how an exclude
-- filter can look applied in the UI while doing nothing in fn_wa_resolve_audience.
-- rpc_wa_list_tags gives the frontend a real suggestion list to autocomplete
-- against instead. SECURITY DEFINER because wa_contacts' own RLS
-- (00031_broadcast_module_phase1f_rls.sql) only grants SELECT to
-- broadcast.contacts.view, but anyone who can build a campaign
-- (broadcast.campaigns.view) needs this list too.

BEGIN;

CREATE OR REPLACE FUNCTION rpc_wa_list_tags()
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tags text[];
BEGIN
  IF NOT (user_can('broadcast.campaigns.view') OR user_can('broadcast.contacts.view')) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
  INTO v_tags
  FROM wa_contacts, unnest(tags) AS t;

  RETURN v_tags;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
