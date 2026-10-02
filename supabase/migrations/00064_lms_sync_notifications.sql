-- 4th notification type: "a new contract has been synced in from the LMS."
-- sync-events is a Deno edge function (not a DB trigger), so unlike the
-- other three notification types this one is NOT driven by fn_notify/pg_net
-- — sync-events/index.ts inserts the notifications row and calls send-push
-- itself, inline, the same way wa-webhook/index.ts already does for the
-- WhatsApp-inbox notification. This migration only adds the subscriber list
-- + its admin RPC (same shape as wa_inbox_notification_subscribers /
-- rpc_set_wa_inbox_subscribers from 00060).

BEGIN;

CREATE TABLE IF NOT EXISTS public.lms_sync_notification_subscribers (
  user_id uuid primary key references public.profiles(id)
);

ALTER TABLE public.lms_sync_notification_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_sync_subs_select ON public.lms_sync_notification_subscribers;
CREATE POLICY lms_sync_subs_select ON public.lms_sync_notification_subscribers
  FOR SELECT USING (user_can('broadcast.settings'));
-- No direct INSERT/UPDATE/DELETE policy — written only via
-- rpc_set_lms_sync_subscribers below (SECURITY DEFINER, permission-checked).

CREATE OR REPLACE FUNCTION public.rpc_set_lms_sync_subscribers(p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT user_can('broadcast.settings') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  DELETE FROM public.lms_sync_notification_subscribers WHERE true;
  IF p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 THEN
    INSERT INTO public.lms_sync_notification_subscribers (user_id)
    SELECT DISTINCT unnest(p_user_ids);
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
