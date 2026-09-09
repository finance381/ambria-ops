-- API Marketing (WhatsApp broadcast) module — Phase 1a: enums, wa_settings,
-- wa_accounts, wa_templates, wa_contacts, wa_contact_lists, wa_list_members.
--
-- Deviations from the original spec, and why:
--  - wa_contacts.venue_affinity is INTEGER, not BIGINT. venues.id is a SERIAL
--    (integer) PK in this schema (confirmed via migration 00010) — a bigint FK
--    column against an integer PK is a type mismatch Postgres will reject.
--  - wa_templates.variable_count can't inline `(SELECT count(*) FROM
--    regexp_matches(...))` as a generated-column expression: regexp_matches
--    with the 'g' flag is a set-returning function, and Postgres generated
--    columns don't allow set-returning functions even inside a scalar
--    subquery in that position. Wrapped it in a small IMMUTABLE SQL function
--    instead (fn_wa_count_template_vars) — same result, valid generated column.

BEGIN;

-- ============================================================================
-- 1.1 Enums
-- ============================================================================

CREATE TYPE wa_template_category_e AS ENUM ('marketing','utility','authentication');
CREATE TYPE wa_template_status_e AS ENUM ('draft','pending','approved','rejected','disabled','paused');
CREATE TYPE wa_message_direction_e AS ENUM ('in','out');
CREATE TYPE wa_message_status_e AS ENUM ('queued','sent','delivered','read','failed','opted_out_blocked','freq_cap_blocked','window_blocked');
CREATE TYPE wa_contact_opt_status_e AS ENUM ('opted_in','implied','opted_out','unknown');
CREATE TYPE wa_contact_source_e AS ENUM ('lms','contract','csv','manual','inbound');
CREATE TYPE wa_campaign_status_e AS ENUM ('draft','scheduled','sending','sent','partial','failed','cancelled');
CREATE TYPE wa_list_type_e AS ENUM ('static','dynamic');
CREATE TYPE wa_automation_trigger_e AS ENUM ('quote_sent','event_completed','payment_due','contract_signed','manual');

-- ============================================================================
-- 1.17 wa_settings — single-row config, admin-only edit
-- ============================================================================

CREATE TABLE wa_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  marketing_freq_cap_per_week integer NOT NULL DEFAULT 2,
  send_window_start time NOT NULL DEFAULT '09:00',
  send_window_end time NOT NULL DEFAULT '22:00',
  confirmation_threshold_recipients integer NOT NULL DEFAULT 20,
  session_length_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO wa_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 1.2 wa_accounts — single-row-per-WABA config + rolling counters (non-secret facts only)
-- ============================================================================

CREATE TABLE wa_accounts (
  id bigserial PRIMARY KEY,
  waba_id text NOT NULL UNIQUE,
  phone_number_id text NOT NULL,
  display_phone text NOT NULL,
  tier text,                             -- '250'|'1k'|'10k'|'100k'|'unlimited'
  quality_rating text,                   -- 'green'|'yellow'|'red'
  quota_used_today integer NOT NULL DEFAULT 0,
  quota_reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 1.3 wa_templates
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_count_template_vars(p_body text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT count(*)::integer FROM regexp_matches(p_body, '\{\{\d+\}\}', 'g')
$$;

CREATE TABLE wa_templates (
  id bigserial PRIMARY KEY,
  name text NOT NULL,                    -- lowercase snake_case, Meta rules
  language text NOT NULL DEFAULT 'en',
  category wa_template_category_e NOT NULL,
  header_type text,                      -- null|'text'|'image'|'video'|'document'
  header_content text,
  body_text text NOT NULL,               -- with {{1}}, {{2}} placeholders
  footer_text text,
  buttons_json jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{type:'quick_reply',text:'..'} | {type:'url',text:'..',url:'..'}]
  variable_count integer GENERATED ALWAYS AS (fn_wa_count_template_vars(body_text)) STORED,
  variable_labels jsonb NOT NULL DEFAULT '[]'::jsonb, -- ["name","venue"] — user-facing labels for {{1}},{{2}}
  sales_approved boolean NOT NULL DEFAULT false,  -- if true, appears in Sales Quick Send picker
  meta_id text UNIQUE,
  meta_status wa_template_status_e NOT NULL DEFAULT 'draft',
  meta_rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, language)
);

-- ============================================================================
-- 1.4 wa_contacts
-- ============================================================================

CREATE TABLE wa_contacts (
  id bigserial PRIMARY KEY,
  phone_e164 text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  name text,
  first_name text GENERATED ALWAYS AS (split_part(coalesce(name,''), ' ', 1)) STORED,
  tags text[] NOT NULL DEFAULT '{}',
  opt_status wa_contact_opt_status_e NOT NULL DEFAULT 'unknown',
  opt_in_source text,
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  opt_out_reason text,
  source wa_contact_source_e NOT NULL,
  venue_affinity integer REFERENCES venues(id),
  last_sent_at timestamptz,
  last_received_at timestamptz,
  session_expires_at timestamptz,        -- last_received_at + session window, or null
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb, -- {lms_lead_id: 'x', contract_id: 42}
  notes text,
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_contacts_tags ON wa_contacts USING GIN (tags);
CREATE INDEX ix_wa_contacts_venue ON wa_contacts(venue_affinity);
CREATE INDEX ix_wa_contacts_session ON wa_contacts(session_expires_at) WHERE session_expires_at IS NOT NULL;
CREATE INDEX ix_wa_contacts_last_received ON wa_contacts(last_received_at DESC NULLS LAST);

-- ============================================================================
-- 1.5 wa_contact_lists + wa_list_members
-- ============================================================================

CREATE TABLE wa_contact_lists (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  description text,
  type wa_list_type_e NOT NULL DEFAULT 'static',
  filter_json jsonb,                     -- for dynamic: {tags: [...], venue_ids: [...], source: 'lms', min_last_sent_days: 7}
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_list_members (
  list_id bigint NOT NULL REFERENCES wa_contact_lists(id) ON DELETE CASCADE,
  contact_id bigint NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);

NOTIFY pgrst, 'reload schema';

COMMIT;
