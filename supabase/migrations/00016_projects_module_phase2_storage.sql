-- Projects module — Phase 2: storage bucket for project attachments
-- Apply via Supabase SQL editor (this repo's migrations aren't applied through the CLI).

BEGIN;

INSERT INTO storage.buckets (id, name, public) VALUES ('project-attachments', 'project-attachments', false);

CREATE POLICY project_attachments_select ON storage.objects FOR SELECT
  USING (bucket_id = 'project-attachments' AND user_can('projects.view'));

CREATE POLICY project_attachments_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'project-attachments' AND user_can('projects.create'));

CREATE POLICY project_attachments_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'project-attachments' AND user_role() = 'admin');

COMMIT;

NOTIFY pgrst, 'reload schema';
