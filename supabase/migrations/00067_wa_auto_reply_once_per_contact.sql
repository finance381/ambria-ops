-- wa-webhook's maybeAutoReply fired its matched rule on every single inbound
-- message, with nothing recording that a contact had already received it —
-- an 'always' rule (e.g. the welcome message) would resend itself on every
-- reply the contact sent. This column is what lets wa-webhook check "has
-- this contact already gotten this rule" before queuing another send.

BEGIN;

ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS auto_reply_id bigint REFERENCES public.wa_auto_replies(id);

CREATE INDEX IF NOT EXISTS ix_wa_messages_contact_auto_reply
  ON public.wa_messages (contact_id, auto_reply_id) WHERE auto_reply_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
