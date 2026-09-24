-- wa_templates had no DELETE RLS policy at all (00031_broadcast_module_
-- phase1f_rls.sql only granted select/insert/update), so there was never a
-- way to remove an old template — not a missing UI button, RLS itself
-- blocked it. Same permission the existing insert/update policies already
-- use. wa_campaigns.template_id and wa_messages.template_id both reference
-- wa_templates(id) with the default FK action (RESTRICT) — a template that
-- was ever actually used by a campaign or message can't be deleted, the
-- database enforces that on its own; this only unblocks deleting unused
-- drafts/rejected templates.

BEGIN;

CREATE POLICY wa_templates_delete ON wa_templates FOR DELETE USING (user_can('broadcast.templates.edit'));

NOTIFY pgrst, 'reload schema';

COMMIT;
