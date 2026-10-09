-- "Schedule for later" (CampaignBuilder.jsx) only ever stored scheduled_at
-- and left status at its default 'draft' — nothing anywhere checked whether
-- that time had arrived and actually queued/sent the campaign. The only
-- thing that ever triggered a real send was a logged-in user clicking Send
-- Campaign / Resume Sending in the browser. This closes that gap the same
-- way sync-events-15min already does (pg_cron + pg_net, both already
-- enabled in this project): a cron job that fires due campaigns and keeps
-- any in-flight send going, with nobody needing the app open at all.
--
-- batch_claimed_at is a plain optimistic lock on wa_campaigns, needed now
-- that wa-send is reachable two ways that can genuinely overlap — a
-- browser tab's own send loop, and this cron tick — without it, both could
-- pull the same 'queued' rows in the gap between SELECT and each row's own
-- UPDATE and send a few messages twice. See wa-send/index.ts's own claim
-- logic (the actual lock/unlock lives there, not here — this migration only
-- adds the column it reads and writes).

BEGIN;

ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS batch_claimed_at timestamptz;

-- Queues every due campaign's messages (same logic rpc_wa_campaign_send
-- uses to queue an interactive send) with no permission check and no
-- confirmation-threshold token — there's nobody present to hold either of
-- those gates against; scheduling the send in advance already was the
-- confirmation. FOR UPDATE SKIP LOCKED so a campaign a human is mid-editing
-- (rpc_wa_campaign_send already holds its own FOR UPDATE briefly) is simply
-- left for the next tick rather than blocking this one. One campaign's
-- failure (template no longer approved, a bad filter) can't take the whole
-- batch down — each is its own sub-transaction via the EXCEPTION block.
CREATE OR REPLACE FUNCTION fn_wa_queue_due_campaigns()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign record;
  v_template record;
  v_recipient_count integer;
  v_blocked_count integer;
BEGIN
  FOR v_campaign IN
    SELECT * FROM wa_campaigns
    WHERE status IN ('draft', 'scheduled')
      AND scheduled_at IS NOT NULL AND scheduled_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_template FROM wa_templates WHERE id = v_campaign.template_id;
      IF v_template IS NULL OR v_template.meta_status != 'approved' THEN
        UPDATE wa_campaigns SET status = 'failed' WHERE id = v_campaign.id;
        CONTINUE;
      END IF;

      SELECT count(*) FILTER (WHERE reachable), count(*) FILTER (WHERE NOT reachable)
        INTO v_recipient_count, v_blocked_count
        FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category);

      INSERT INTO wa_messages (campaign_id, contact_id, direction, template_id, rendered_body, status)
      SELECT
        v_campaign.id, a.contact_id, 'out', v_campaign.template_id,
        fn_wa_render_body(v_template.body_text, fn_wa_resolve_mapping(v_campaign.variable_mapping_json, a.contact_id)),
        'queued'
      FROM fn_wa_resolve_audience(v_campaign.list_id, v_campaign.audience_filter_json, v_template.category) a
      WHERE a.reachable;

      UPDATE wa_campaigns SET status = 'sending', sent_at = now(), blocked_count = v_blocked_count
      WHERE id = v_campaign.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE wa_campaigns SET status = 'failed' WHERE id = v_campaign.id;
    END;
  END LOOP;
END;
$$;

-- Called every minute by a cron job (registered separately, not here — see
-- this project's own convention of hand-running cron.schedule once rather
-- than committing it; sync-events-15min was set up the same way). Queues
-- anything newly due, then nudges wa-send for every campaign still
-- 'sending' with messages left — covering both a fresh scheduled send and
-- any interrupted one, unattended either way.
CREATE OR REPLACE FUNCTION fn_wa_cron_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign_id bigint;
BEGIN
  PERFORM fn_wa_queue_due_campaigns();

  FOR v_campaign_id IN
    SELECT c.id FROM wa_campaigns c
    WHERE c.status = 'sending'
      AND EXISTS (SELECT 1 FROM wa_messages m WHERE m.campaign_id = c.id AND m.status = 'queued')
  LOOP
    PERFORM net.http_post(
      url := 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/wa-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('campaign_id', v_campaign_id, 'batch_size', 40),
      timeout_milliseconds := 55000
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
