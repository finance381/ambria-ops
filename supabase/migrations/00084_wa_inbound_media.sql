-- wa-webhook only ever extracted text for msg.type 'text' | 'button' |
-- 'interactive' -- anything else a customer sends (photo, voice note,
-- video, document, sticker, location) got stored with rendered_body = null
-- and the Inbox showed the generic "(template message)" placeholder for it
-- -- wrong label (that term only means anything for a message *we* send)
-- and, worse, the content itself was never captured anywhere at all.
--
-- New columns carry whatever the inbound message actually was; the
-- accompanying wa-webhook change downloads media from Meta's Media API
-- (a signed, short-lived URL per message) and re-uploads it to our own
-- storage so it has a permanent home, same shape the existing
-- broadcast-media bucket already established for outbound template media.

BEGIN;

ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS message_type text,
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_mime_type text,
  ADD COLUMN IF NOT EXISTS media_caption text,
  ADD COLUMN IF NOT EXISTS media_filename text,
  ADD COLUMN IF NOT EXISTS location_lat double precision,
  ADD COLUMN IF NOT EXISTS location_lng double precision,
  ADD COLUMN IF NOT EXISTS location_name text;

-- Public, same reasoning as broadcast-media (00035): a signed URL would
-- expire and this needs to keep rendering in the Inbox indefinitely. Only
-- Inbox viewers can see it via the authenticated path (the public path is
-- gated by path obscurity, not RLS, same tradeoff this app already made for
-- the receipts bucket).
INSERT INTO storage.buckets (id, name, public) VALUES ('wa-inbound-media', 'wa-inbound-media', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY wa_inbound_media_select ON storage.objects FOR SELECT
  USING (bucket_id = 'wa-inbound-media' AND user_can('broadcast.inbox.view'));

NOTIFY pgrst, 'reload schema';

COMMIT;
