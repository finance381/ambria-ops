-- Auto-replies for inbound WhatsApp messages (the number listed on the
-- website). wa-webhook checks these after storing an inbound message and
-- fires the first active match by sending a plain-text reply — always
-- allowed since a reply to a message the guest just sent is within their
-- 24h session window. Rules are per-account, gated the same way wa_settings
-- already is (admin-only, matching how sensitive/compliance-adjacent
-- messaging config is treated elsewhere in this module).

BEGIN;

CREATE TYPE wa_auto_reply_trigger_e AS ENUM ('keyword', 'always');

CREATE TABLE wa_auto_replies (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  trigger_type wa_auto_reply_trigger_e NOT NULL DEFAULT 'keyword',
  keywords text[],                        -- trigger_type='keyword': any one matching (case-insensitive substring) fires it
  reply_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,    -- lower checked first; first active match wins
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_auto_replies_active_priority ON wa_auto_replies(active, priority);

ALTER TABLE wa_auto_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_auto_replies_select ON wa_auto_replies FOR SELECT USING (fn_is_admin_only());
CREATE POLICY wa_auto_replies_insert ON wa_auto_replies FOR INSERT WITH CHECK (fn_is_admin_only());
CREATE POLICY wa_auto_replies_update ON wa_auto_replies FOR UPDATE USING (fn_is_admin_only());
CREATE POLICY wa_auto_replies_delete ON wa_auto_replies FOR DELETE USING (fn_is_admin_only());

NOTIFY pgrst, 'reload schema';

COMMIT;
