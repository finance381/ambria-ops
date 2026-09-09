-- API Marketing module — Phase 1f: RLS on all 12 tables (the spec's "11
-- tables" list omits wa_settings from its own count, but its own 1.17 note
-- says "admin-only edit" — giving it RLS too rather than leaving it open).
--
-- Reuses fn_is_admin_only() — already defined live (used by the Reviews and
-- Requisitions RLS, e.g. 00019_reviews_module_phase1.sql:611) — for the
-- tables the spec marks flatly "admin-only", instead of a new ad-hoc check.
--
-- Open item to flag, not silently resolved here: the permissions catalog
-- (phase 2) defines `broadcast.campaigns.cancel` as its own grantable key,
-- but the spec's own RLS section only ever gates campaign INSERT/UPDATE on
-- `broadcast.campaigns.create` — so someone granted ONLY .cancel (without
-- .create) can view but not act on a campaign via RLS. No RPC in phase 1d
-- implements a distinct cancel path either. Leaving as specified for now;
-- flagged in the phase-1 report for a decision before Phase 6 (Campaigns UI).

BEGIN;

-- wa_accounts — admin only
ALTER TABLE wa_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_accounts_select ON wa_accounts FOR SELECT USING (fn_is_admin_only());
CREATE POLICY wa_accounts_insert ON wa_accounts FOR INSERT WITH CHECK (fn_is_admin_only());
CREATE POLICY wa_accounts_update ON wa_accounts FOR UPDATE USING (fn_is_admin_only());

-- wa_settings — admin only (singleton row, seeded already; no insert/delete policy needed)
ALTER TABLE wa_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_settings_select ON wa_settings FOR SELECT USING (fn_is_admin_only());
CREATE POLICY wa_settings_update ON wa_settings FOR UPDATE USING (fn_is_admin_only());

-- wa_templates
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_templates_select ON wa_templates FOR SELECT USING (user_can('broadcast.templates.view'));
CREATE POLICY wa_templates_insert ON wa_templates FOR INSERT WITH CHECK (user_can('broadcast.templates.edit'));
CREATE POLICY wa_templates_update ON wa_templates FOR UPDATE USING (user_can('broadcast.templates.edit'));

-- wa_contacts
ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_contacts_select ON wa_contacts FOR SELECT USING (user_can('broadcast.contacts.view'));
CREATE POLICY wa_contacts_insert ON wa_contacts FOR INSERT WITH CHECK (user_can('broadcast.contacts.edit'));
CREATE POLICY wa_contacts_update ON wa_contacts FOR UPDATE USING (user_can('broadcast.contacts.edit'));

-- wa_contact_lists, wa_list_members — same gating as contacts
ALTER TABLE wa_contact_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_contact_lists_select ON wa_contact_lists FOR SELECT USING (user_can('broadcast.contacts.view'));
CREATE POLICY wa_contact_lists_insert ON wa_contact_lists FOR INSERT WITH CHECK (user_can('broadcast.contacts.edit'));
CREATE POLICY wa_contact_lists_update ON wa_contact_lists FOR UPDATE USING (user_can('broadcast.contacts.edit'));
CREATE POLICY wa_contact_lists_delete ON wa_contact_lists FOR DELETE USING (user_can('broadcast.contacts.edit'));

ALTER TABLE wa_list_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_list_members_select ON wa_list_members FOR SELECT USING (user_can('broadcast.contacts.view'));
CREATE POLICY wa_list_members_insert ON wa_list_members FOR INSERT WITH CHECK (user_can('broadcast.contacts.edit'));
CREATE POLICY wa_list_members_delete ON wa_list_members FOR DELETE USING (user_can('broadcast.contacts.edit'));

-- wa_campaigns — send itself is additionally gated inside rpc_wa_campaign_send
ALTER TABLE wa_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_campaigns_select ON wa_campaigns FOR SELECT USING (user_can('broadcast.campaigns.view'));
CREATE POLICY wa_campaigns_insert ON wa_campaigns FOR INSERT WITH CHECK (user_can('broadcast.campaigns.create'));
CREATE POLICY wa_campaigns_update ON wa_campaigns FOR UPDATE USING (user_can('broadcast.campaigns.create'));

-- wa_messages — no INSERT/UPDATE/DELETE policy anywhere: every write goes
-- through a SECURITY DEFINER RPC or the service-role Edge Function, both of
-- which bypass RLS via table ownership. This is deliberate audit integrity,
-- not an oversight.
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_messages_select ON wa_messages FOR SELECT
  USING (user_can('broadcast.inbox.view') OR user_can('broadcast.campaigns.view'));

-- wa_conversations — UPDATE via rpc_wa_mark_read / the messages trigger only
ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_conversations_select ON wa_conversations FOR SELECT USING (user_can('broadcast.inbox.view'));

-- wa_opt_outs — readable by anyone holding any broadcast permission (so every
-- surface can show "this contact is opted out"); INSERT via RPC only.
ALTER TABLE wa_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_opt_outs_select ON wa_opt_outs FOR SELECT USING (
  user_can('broadcast.templates.view') OR user_can('broadcast.contacts.view')
  OR user_can('broadcast.campaigns.view') OR user_can('broadcast.inbox.view')
  OR user_can('broadcast.analytics.view') OR user_can('broadcast.quicksend')
);

-- wa_send_events, wa_automation_rules — admin-only per spec
ALTER TABLE wa_send_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_send_events_select ON wa_send_events FOR SELECT USING (fn_is_admin_only());

ALTER TABLE wa_automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_automation_rules_select ON wa_automation_rules FOR SELECT USING (fn_is_admin_only());
CREATE POLICY wa_automation_rules_insert ON wa_automation_rules FOR INSERT WITH CHECK (fn_is_admin_only());
CREATE POLICY wa_automation_rules_update ON wa_automation_rules FOR UPDATE USING (fn_is_admin_only());
CREATE POLICY wa_automation_rules_delete ON wa_automation_rules FOR DELETE USING (fn_is_admin_only());

NOTIFY pgrst, 'reload schema';

COMMIT;
