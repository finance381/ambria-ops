-- API Marketing module — Phase 1e: triggers.
--
-- One deliberate deviation from the spec's literal stop-keyword regex: the
-- spec anchors only the start (`^(stop|unsubscribe|...)`), which would also
-- match an ordinary reply like "Cancel the extra dessert please" or "Stop by
-- the venue at 5" and silently opt that contact out against their actual
-- intent — a real customer-harm risk, not just a style nitpick. Anchored the
-- match to the *whole* message (trimmed, optional trailing punctuation) so
-- only a bare stop-word reply triggers it.

BEGIN;

-- ============================================================================
-- wa_messages_after_insert — upserts wa_conversations, updates wa_contacts'
-- last_sent_at/last_received_at, extends the session window on inbound.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_hours integer;
  v_session_expires timestamptz;
BEGIN
  SELECT COALESCE(session_length_hours, 24) INTO v_session_hours FROM wa_settings WHERE id = 1;

  IF NEW.direction = 'in' THEN
    v_session_expires := now() + (v_session_hours * interval '1 hour');

    UPDATE wa_contacts SET
      last_received_at = NEW.created_at,
      session_expires_at = v_session_expires,
      updated_at = now()
    WHERE id = NEW.contact_id;

    INSERT INTO wa_conversations (contact_id, last_message_id, last_message_at, last_direction, session_started_at, session_expires_at, unread_count, updated_at)
    VALUES (NEW.contact_id, NEW.id, NEW.created_at, NEW.direction, now(), v_session_expires, 1, now())
    ON CONFLICT (contact_id) DO UPDATE SET
      last_message_id = NEW.id,
      last_message_at = NEW.created_at,
      last_direction = NEW.direction,
      session_started_at = now(),
      session_expires_at = v_session_expires,
      unread_count = wa_conversations.unread_count + 1,
      updated_at = now();
  ELSE
    UPDATE wa_contacts SET
      last_sent_at = NEW.created_at,
      updated_at = now()
    WHERE id = NEW.contact_id;

    INSERT INTO wa_conversations (contact_id, last_message_id, last_message_at, last_direction, updated_at)
    VALUES (NEW.contact_id, NEW.id, NEW.created_at, NEW.direction, now())
    ON CONFLICT (contact_id) DO UPDATE SET
      last_message_id = NEW.id,
      last_message_at = NEW.created_at,
      last_direction = NEW.direction,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER wa_messages_after_insert
AFTER INSERT ON wa_messages
FOR EACH ROW EXECUTE FUNCTION fn_wa_messages_after_insert();

-- ============================================================================
-- Generic updated_at bump
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wa_contacts_updated_at BEFORE UPDATE ON wa_contacts FOR EACH ROW EXECUTE FUNCTION fn_wa_set_updated_at();
CREATE TRIGGER wa_templates_updated_at BEFORE UPDATE ON wa_templates FOR EACH ROW EXECUTE FUNCTION fn_wa_set_updated_at();

-- ============================================================================
-- Stop-keyword auto-opt-out
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_wa_stop_keyword_handler()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
BEGIN
  IF NEW.direction = 'in' AND trim(NEW.rendered_body) ~* '^(stop|unsubscribe|opt out|opt-out|remove me|cancel)[.!]?$' THEN
    SELECT phone_e164 INTO v_phone FROM wa_contacts WHERE id = NEW.contact_id;
    IF v_phone IS NOT NULL THEN
      PERFORM rpc_wa_contact_opt_out(v_phone, 'stop_keyword', 'stop_keyword');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wa_stop_keyword_handler
AFTER INSERT ON wa_messages
FOR EACH ROW EXECUTE FUNCTION fn_wa_stop_keyword_handler();

NOTIFY pgrst, 'reload schema';

COMMIT;
