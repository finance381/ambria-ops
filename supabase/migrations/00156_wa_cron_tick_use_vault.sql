-- fn_wa_cron_tick (00093) authorized its wa-send call via
-- current_setting('app.settings.service_role_key', true) -- never actually
-- set, since ALTER DATABASE ... SET is blocked for regular project roles on
-- Supabase Cloud (confirmed: "permission denied to set parameter"), the same
-- wall fn_notify hit and fixed in 00062 by switching to Supabase Vault.
-- Reuses the exact same two vault secrets fn_notify already reads
-- (project_url, service_role_key) rather than creating duplicates.
--
-- Until this ran, every scheduled campaign's cron tick correctly queued its
-- messages and flipped status to 'sending', then silently failed to invoke
-- wa-send (Authorization: Bearer <nothing>) -- stuck at 'sending' forever
-- with no error surfaced anywhere.

BEGIN;

CREATE OR REPLACE FUNCTION fn_wa_cron_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  PERFORM fn_wa_queue_due_campaigns();

  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_supabase_url IS NULL OR v_service_role IS NULL THEN RETURN; END IF;

  FOR v_campaign_id IN
    SELECT c.id FROM wa_campaigns c
    WHERE c.status = 'sending'
      AND EXISTS (SELECT 1 FROM wa_messages m WHERE m.campaign_id = c.id AND m.status = 'queued')
  LOOP
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/wa-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role
      ),
      body := jsonb_build_object('campaign_id', v_campaign_id, 'batch_size', 40),
      timeout_milliseconds := 55000
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
