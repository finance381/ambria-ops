-- sync-events no longer auto-cancels a contract just because it went
-- missing from LMS's list (see that file's updated comment) -- absence
-- alone doesn't distinguish a real cancellation from LMS's own confirmed
-- listing-gap bug, which is exactly how contract #00773 sat hidden for 6
-- days. Genuine cancellation is now read directly from LMS's own
-- cancel_remarks field instead, a real positive signal.
--
-- That means an lms_sync_anomalies row no longer represents something
-- already hidden -- it's a candidate nothing has touched yet. 'restore'
-- stops making sense (there's nothing to undo); replaced with 'dismiss'
-- (this is fine, a known blip — also exempts the contract from future
-- alerts, since a recurring offender like #00773 would otherwise get
-- re-flagged every single cycle it stays missing) and 'confirm_cancelled'
-- (checked in LMS, it's genuinely gone — hide it now).

BEGIN;

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
  IF p_action NOT IN ('dismiss', 'confirm_cancelled') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT event_id INTO v_event_id FROM lms_sync_anomalies WHERE id = p_id AND resolved_at IS NULL;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'anomaly_not_found_or_already_resolved';
  END IF;

  IF p_action = 'confirm_cancelled' THEN
    UPDATE events SET lms_cancelled_at = now() WHERE id = v_event_id;
  ELSIF p_action = 'dismiss' THEN
    UPDATE events SET lms_stale_exempt = true WHERE id = v_event_id;
  END IF;

  UPDATE lms_sync_anomalies
  SET resolved_at = now(), resolved_by = auth.uid(), resolution = p_action
  WHERE id = p_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
