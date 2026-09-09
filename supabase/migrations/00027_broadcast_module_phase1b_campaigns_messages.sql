-- API Marketing module — Phase 1b: wa_campaigns, wa_messages, wa_conversations,
-- wa_opt_outs, wa_send_events, wa_automation_rules (scaffold only, no consumer yet).
-- Run after 00026 (references wa_templates, wa_contact_lists, wa_contacts).

BEGIN;

-- ============================================================================
-- 1.6 wa_campaigns
-- ============================================================================

CREATE TABLE wa_campaigns (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  template_id bigint NOT NULL REFERENCES wa_templates(id),
  list_id bigint REFERENCES wa_contact_lists(id),
  audience_filter_json jsonb,            -- if list_id null, filter used to resolve at send-time
  variable_mapping_json jsonb NOT NULL,  -- {"1": "contact.first_name", "2": "contact.venue_affinity_name"}
  scheduled_at timestamptz,
  status wa_campaign_status_e NOT NULL DEFAULT 'draft',
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,       -- opt-out + freq-cap + window blocks
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_campaigns_status ON wa_campaigns(status);
CREATE INDEX ix_wa_campaigns_scheduled ON wa_campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- ============================================================================
-- 1.7 wa_messages
-- ============================================================================

CREATE TABLE wa_messages (
  id bigserial PRIMARY KEY,
  campaign_id bigint REFERENCES wa_campaigns(id),        -- null for inbox/quick-send
  contact_id bigint NOT NULL REFERENCES wa_contacts(id),
  direction wa_message_direction_e NOT NULL,
  wa_message_id text UNIQUE,                             -- Meta's id, null on failure
  template_id bigint REFERENCES wa_templates(id),        -- null for free-form
  rendered_body text,                                    -- final text after variable substitution
  status wa_message_status_e NOT NULL DEFAULT 'queued',
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  sent_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_messages_contact ON wa_messages(contact_id, created_at DESC);
CREATE INDEX ix_wa_messages_campaign ON wa_messages(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX ix_wa_messages_wa_id ON wa_messages(wa_message_id);

-- ============================================================================
-- 1.8 wa_conversations — auto-managed via trigger on wa_messages (see phase1e)
-- ============================================================================

CREATE TABLE wa_conversations (
  id bigserial PRIMARY KEY,
  contact_id bigint NOT NULL UNIQUE REFERENCES wa_contacts(id),
  last_message_id bigint REFERENCES wa_messages(id),
  last_message_at timestamptz,
  last_direction wa_message_direction_e,
  session_started_at timestamptz,        -- most recent inbound
  session_expires_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  assigned_to uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 1.9 wa_opt_outs — global source-of-truth, every send checks this first
-- ============================================================================

CREATE TABLE wa_opt_outs (
  phone_e164 text PRIMARY KEY CHECK (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  contact_id bigint REFERENCES wa_contacts(id),
  campaign_id bigint REFERENCES wa_campaigns(id),
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  source text                            -- 'stop_keyword'|'manual'|'inbound_report'
);

-- ============================================================================
-- 1.10 wa_send_events — debug audit trail, retained 90 days (cleanup job later)
-- ============================================================================

CREATE TABLE wa_send_events (
  id bigserial PRIMARY KEY,
  message_id bigint REFERENCES wa_messages(id),
  event_type text NOT NULL,              -- 'request'|'response'|'webhook'|'error'
  request_payload jsonb,
  response_payload jsonb,
  http_status integer,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_send_events_message ON wa_send_events(message_id, created_at);

-- ============================================================================
-- 1.11 wa_automation_rules — scaffold only, no consumer yet (v2)
-- ============================================================================

CREATE TABLE wa_automation_rules (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  trigger_type wa_automation_trigger_e NOT NULL,
  delay_hours integer NOT NULL DEFAULT 0,
  template_id bigint NOT NULL REFERENCES wa_templates(id),
  variable_mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_json jsonb,                     -- e.g. venue_id, min amount
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

NOTIFY pgrst, 'reload schema';

COMMIT;
