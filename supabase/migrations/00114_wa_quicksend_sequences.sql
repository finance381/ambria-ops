-- Sales Quick Send — the real build, after a mocked-up design pass earlier.
--
-- Two sequences (which messages a salesperson sees, in what order, for a
-- client who's only quoted vs one who's booked) plus the ability to schedule
-- a one-shot step for later instead of sending it immediately. Repeat-sends
-- (a Quote-sequence follow-up sent more than once) are always immediate —
-- "Send again" is a direct tap, not something to schedule — so scheduling
-- only applies to wa_quicksend_scheduled rows, never to the repeat count
-- itself (that's read straight off wa_messages at request time).
--
-- Reuses the exact insert shape rpc_wa_quick_send already uses (see
-- 00085) rather than calling that RPC from the cron path — it gates on
-- user_can('broadcast.quicksend'), which reads auth.uid(), and there is no
-- session/JWT in a pg_cron context (auth.uid() is null there — the same
-- trap this project hit earlier this session with a manual SQL fix for
-- link_expense_to_new_item). The permission was already checked once, at
-- the moment the human who scheduled it called rpc_wa_quicksend_schedule.

BEGIN;

-- ── Sequence membership + order + (for 'quote') repeat rule ────────────────
CREATE TABLE IF NOT EXISTS public.wa_quicksend_steps (
  id bigserial PRIMARY KEY,
  sequence text NOT NULL CHECK (sequence IN ('quote', 'booked')),
  template_id bigint NOT NULL REFERENCES public.wa_templates(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  repeatable boolean NOT NULL DEFAULT false,
  repeat_interval_days integer,
  repeat_max_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence, template_id)
);

ALTER TABLE public.wa_quicksend_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_quicksend_steps_select ON public.wa_quicksend_steps;
CREATE POLICY wa_quicksend_steps_select ON public.wa_quicksend_steps FOR SELECT
  USING (user_can('broadcast.quicksend') OR user_can('broadcast.settings'));

DROP POLICY IF EXISTS wa_quicksend_steps_write ON public.wa_quicksend_steps;
CREATE POLICY wa_quicksend_steps_write ON public.wa_quicksend_steps FOR ALL
  USING (user_can('broadcast.settings')) WITH CHECK (user_can('broadcast.settings'));

-- ── A one-shot step scheduled for later instead of sent right away ────────
CREATE TABLE IF NOT EXISTS public.wa_quicksend_scheduled (
  id bigserial PRIMARY KEY,
  contact_id bigint NOT NULL REFERENCES public.wa_contacts(id),
  template_id bigint NOT NULL REFERENCES public.wa_templates(id),
  variable_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  message_id bigint REFERENCES public.wa_messages(id),
  error_message text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_wa_quicksend_scheduled_due
  ON public.wa_quicksend_scheduled (send_at) WHERE status = 'pending';

ALTER TABLE public.wa_quicksend_scheduled ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_quicksend_scheduled_select ON public.wa_quicksend_scheduled;
CREATE POLICY wa_quicksend_scheduled_select ON public.wa_quicksend_scheduled FOR SELECT
  USING (created_by = auth.uid() OR user_can('broadcast.settings'));

-- ── Admin: manage a sequence's steps ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_wa_quicksend_upsert_step(
  p_sequence text, p_template_id bigint,
  p_repeatable boolean DEFAULT false, p_repeat_interval_days integer DEFAULT NULL, p_repeat_max_count integer DEFAULT NULL
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_order integer;
  v_id bigint;
BEGIN
  IF NOT user_can('broadcast.settings') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_sequence NOT IN ('quote', 'booked') THEN RAISE EXCEPTION 'invalid_sequence'; END IF;

  SELECT id INTO v_id FROM public.wa_quicksend_steps WHERE sequence = p_sequence AND template_id = p_template_id;
  IF v_id IS NOT NULL THEN
    UPDATE public.wa_quicksend_steps
      SET repeatable = p_repeatable, repeat_interval_days = p_repeat_interval_days, repeat_max_count = p_repeat_max_count
      WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT COALESCE(MAX(order_index), 0) + 1 INTO v_next_order FROM public.wa_quicksend_steps WHERE sequence = p_sequence;
  INSERT INTO public.wa_quicksend_steps (sequence, template_id, order_index, repeatable, repeat_interval_days, repeat_max_count)
  VALUES (p_sequence, p_template_id, v_next_order, p_repeatable, p_repeat_interval_days, p_repeat_max_count)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_wa_quicksend_remove_step(p_step_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT user_can('broadcast.settings') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  DELETE FROM public.wa_quicksend_steps WHERE id = p_step_id;
END;
$function$;

-- Re-numbers order_index 1..n to match the order the caller sends, for one
-- sequence at a time — the admin screen's up/down arrows send the whole
-- reordered id list after each move rather than one delta, which keeps this
-- side simple and race-free regardless of how many moves happened client-side.
CREATE OR REPLACE FUNCTION public.rpc_wa_quicksend_reorder(p_sequence text, p_ordered_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
  v_pos integer := 0;
BEGIN
  IF NOT user_can('broadcast.settings') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    v_pos := v_pos + 1;
    UPDATE public.wa_quicksend_steps SET order_index = v_pos WHERE id = v_id AND sequence = p_sequence;
  END LOOP;
END;
$function$;

-- ── Sales: schedule a one-shot step for later ──────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_wa_quicksend_schedule(
  p_contact_id bigint, p_template_id bigint, p_variable_values jsonb, p_send_at timestamptz
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template record;
  v_id bigint;
BEGIN
  IF NOT user_can('broadcast.quicksend') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_send_at <= now() THEN RAISE EXCEPTION 'send_at_must_be_future'; END IF;

  SELECT * INTO v_template FROM public.wa_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
  IF NOT v_template.sales_approved OR v_template.meta_status != 'approved' THEN
    RAISE EXCEPTION 'template_not_sales_approved';
  END IF;

  INSERT INTO public.wa_quicksend_scheduled (contact_id, template_id, variable_values, send_at, created_by)
  VALUES (p_contact_id, p_template_id, COALESCE(p_variable_values, '{}'::jsonb), p_send_at, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_wa_quicksend_cancel_scheduled(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.wa_quicksend_scheduled WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status != 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;
  IF v_row.created_by != auth.uid() AND NOT user_can('broadcast.settings') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  UPDATE public.wa_quicksend_scheduled SET status = 'cancelled' WHERE id = p_id;
END;
$function$;

-- ── Cron: fire anything due, same pattern as fn_wa_queue_due_campaigns ─────

CREATE OR REPLACE FUNCTION public.fn_wa_process_due_quicksends()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_template record;
  v_check record;
  v_message_id bigint;
BEGIN
  FOR v_row IN
    SELECT * FROM public.wa_quicksend_scheduled
    WHERE status = 'pending' AND send_at <= now()
    FOR UPDATE SKIP LOCKED
    LIMIT 50
  LOOP
    BEGIN
      SELECT * INTO v_template FROM public.wa_templates WHERE id = v_row.template_id;
      IF v_template IS NULL OR NOT v_template.sales_approved OR v_template.meta_status != 'approved' THEN
        UPDATE public.wa_quicksend_scheduled SET status = 'failed', error_message = 'template_no_longer_sales_approved' WHERE id = v_row.id;
        CONTINUE;
      END IF;

      SELECT * INTO v_check FROM public.fn_wa_can_send(v_row.contact_id, v_template.category);
      IF NOT v_check.ok THEN
        UPDATE public.wa_quicksend_scheduled SET status = 'failed', error_message = v_check.reason WHERE id = v_row.id;
        CONTINUE;
      END IF;

      INSERT INTO public.wa_messages (contact_id, direction, template_id, rendered_body, template_params, status, sent_by)
      VALUES (
        v_row.contact_id, 'out', v_row.template_id,
        public.fn_wa_render_body(v_template.body_text, v_row.variable_values),
        public.fn_wa_values_to_ordered_array(v_row.variable_values, v_template.variable_count),
        'queued', v_row.created_by
      )
      RETURNING id INTO v_message_id;

      UPDATE public.wa_quicksend_scheduled SET status = 'sent', message_id = v_message_id WHERE id = v_row.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.wa_quicksend_scheduled SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
    END;
  END LOOP;
END;
$function$;

-- fn_wa_cron_tick's own signature (no args) is unchanged, so this replaces
-- it in place rather than creating a second overload. Appended, not
-- rewritten — the existing campaign-queueing body (00093) is untouched.
CREATE OR REPLACE FUNCTION public.fn_wa_cron_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id bigint;
  v_message_id bigint;
BEGIN
  PERFORM fn_wa_queue_due_campaigns();
  PERFORM fn_wa_process_due_quicksends();

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

  -- One wa-send call per due quicksend message — there's no batch concept
  -- here the way a campaign has one, each row is its own independent send.
  FOR v_message_id IN
    SELECT message_id FROM wa_quicksend_scheduled WHERE status = 'sent' AND message_id IN (SELECT id FROM wa_messages WHERE status = 'queued')
  LOOP
    PERFORM net.http_post(
      url := 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/wa-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('message_id', v_message_id),
      timeout_milliseconds := 55000
    );
  END LOOP;
END;
$function$;

-- wa_messages' own SELECT policy (00031) only admits broadcast.inbox.view /
-- broadcast.campaigns.view — broadcast.quicksend was never one of them, so
-- a rep holding only that permission (exactly who this feature is for; its
-- own note says "no other API Marketing access implied") got nothing back
-- from the checklist's history query and every step read "Pending" forever,
-- even right after sending it. Widened just enough for that: an individual
-- outbound template send (direction='out', no campaign, a template set —
-- the exact shape rpc_wa_quick_send and the scheduled-quicksend path both
-- insert), not inbound conversation content or a campaign's full recipient
-- list, which stay gated behind their own, narrower permissions.
DROP POLICY IF EXISTS wa_messages_select ON wa_messages;
CREATE POLICY wa_messages_select ON wa_messages FOR SELECT
  USING (
    user_can('broadcast.inbox.view') OR user_can('broadcast.campaigns.view')
    OR (user_can('broadcast.quicksend') AND direction = 'out' AND campaign_id IS NULL AND template_id IS NOT NULL)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
