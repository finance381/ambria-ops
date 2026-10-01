-- 00064 gated lms_sync_notification_subscribers on the WhatsApp module's
-- broadcast.settings permission purely because that's where the picker UI
-- first got built (code reuse convenience). It has nothing to do with
-- WhatsApp — the picker has since moved to the Events screen, next to the
-- "Sync LMS" button it's actually about. Re-gate on the same admin/auditor
-- role check sync-events itself already enforces for who can trigger a sync
-- in the first place (supabase/functions/sync-events/index.ts), so "who can
-- sync" and "who controls notifications about syncing" are the same people.

BEGIN;

DROP POLICY IF EXISTS lms_sync_subs_select ON public.lms_sync_notification_subscribers;
CREATE POLICY lms_sync_subs_select ON public.lms_sync_notification_subscribers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'auditor'))
  );

CREATE OR REPLACE FUNCTION public.rpc_set_lms_sync_subscribers(p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'auditor')) THEN
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
