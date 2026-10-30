-- Durable tracking for the known LMS-side listing gap documented in
-- sync-events/index.ts (confirmed on contracts #00674 and #00773): LMS's
-- own list endpoints sometimes stop returning a contract that's still fully
-- live in LMS's own UI, so the stale sweep auto-cancels it here. Previously
-- the only trace of this was a console.log inside the edge function and
-- whoever happened to notice the contract had vanished -- #00773 sat broken
-- for 6 days before anyone caught it. Every stale-cancellation now logs a
-- row here (see sync-events/index.ts's notifyStaleAnomalies) and notifies
-- the same lms_sync_notification_subscribers list used for new-contract
-- syncs, and this table is what Events -> Sync Issues reads to let an admin
-- restore-and-exempt (if it's this known gap) or dismiss (if the contract
-- really was cancelled in LMS) in one click instead of someone writing a
-- one-off migration each time.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lms_sync_anomalies (
  id bigserial primary key,
  event_id bigint references public.events(id),
  lms_event_id text not null,
  contract_no text,
  department text,
  client_name text,
  venue_name text,
  function_date date,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text  -- 'restored' | 'dismissed'
);
CREATE INDEX IF NOT EXISTS idx_lms_sync_anomalies_unresolved ON public.lms_sync_anomalies (detected_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.lms_sync_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_sync_anomalies_select ON public.lms_sync_anomalies;
CREATE POLICY lms_sync_anomalies_select ON public.lms_sync_anomalies
  FOR SELECT USING (public.user_can('events.sync_issues'));
-- No direct INSERT/UPDATE policy -- rows are written by sync-events (service
-- role, bypasses RLS) and resolved only via fn_resolve_lms_sync_anomaly below.

CREATE OR REPLACE FUNCTION public.fn_resolve_lms_sync_anomaly(p_id bigint, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  IF NOT public.user_can('events.sync_issues') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  IF p_action NOT IN ('restore', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT event_id INTO v_event_id FROM lms_sync_anomalies WHERE id = p_id AND resolved_at IS NULL;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'anomaly_not_found_or_already_resolved';
  END IF;

  IF p_action = 'restore' THEN
    UPDATE events SET lms_cancelled_at = NULL, lms_stale_exempt = true WHERE id = v_event_id;
  END IF;

  UPDATE lms_sync_anomalies
  SET resolved_at = now(), resolved_by = auth.uid(), resolution = p_action
  WHERE id = p_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
