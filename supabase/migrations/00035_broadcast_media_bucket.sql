-- API Marketing (Broadcast) module — storage bucket for template header media
-- (image/video/document headers). Must be PUBLIC: template header content is
-- long-lived (a template gets reused for months once approved) and needs a
-- permanent URL Meta/WhatsApp can fetch — a signed URL would expire.
-- Apply via Supabase SQL editor (this repo's migrations aren't applied through the CLI).

BEGIN;

INSERT INTO storage.buckets (id, name, public) VALUES ('broadcast-media', 'broadcast-media', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY broadcast_media_select ON storage.objects FOR SELECT
  USING (bucket_id = 'broadcast-media' AND user_can('broadcast.templates.edit'));

CREATE POLICY broadcast_media_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'broadcast-media' AND user_can('broadcast.templates.edit'));

CREATE POLICY broadcast_media_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'broadcast-media' AND user_can('broadcast.templates.edit'));

COMMIT;

NOTIFY pgrst, 'reload schema';
