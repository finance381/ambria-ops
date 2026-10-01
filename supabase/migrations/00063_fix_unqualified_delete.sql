-- rpc_set_wa_inbox_subscribers's "clear everyone, reinsert the new set"
-- DELETE had no WHERE clause — this database has a safety guard against
-- exactly that (blocks accidental full-table wipes), so every save failed
-- with "DELETE requires a WHERE clause" (SQLSTATE 21000). WHERE true keeps
-- the same "delete every row" behavior while satisfying the guard.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_set_wa_inbox_subscribers(p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT user_can('broadcast.settings') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  DELETE FROM public.wa_inbox_notification_subscribers WHERE true;
  IF p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 THEN
    INSERT INTO public.wa_inbox_notification_subscribers (user_id)
    SELECT DISTINCT unnest(p_user_ids);
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
