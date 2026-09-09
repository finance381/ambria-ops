# Ambria Ops — API Marketing (WhatsApp Broadcast) module — new feature (2026-09-09)

Built in-house WhatsApp marketing + sales-follow-up tool using Meta's WhatsApp Cloud API direct (no third-party broadcast SaaS). Two surfaces: a full admin/marketing console (Templates, Contacts, Campaigns, Inbox, Settings) and a lightweight "Sales Quick Send" widget mounted inline in QuoteCalculator and Events.

## Status: DB + code complete, NOT live-tested

The Meta/WhatsApp secrets (`WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`, `WA_API_VERSION`) were never added to the `ambria-ops` Supabase project during this build — confirmed absent via `supabase secrets list` at Phase 0, and the user deferred adding them ("I will tell when I can add the secrets"). Everything below was built and syntax-verified (esbuild per-file + a full `npm run build`) but **none of the 5 Edge Functions have been deployed or invoked against real Meta infrastructure.** Do not assume this works end-to-end until that happens.

## Manual steps still required before this is live

1. Add the 6 secrets to the `ambria-ops` Supabase project (`supabase secrets set --project-ref ptksdithbytzrznplfiq KEY=value`).
2. Run migrations `00026` through `00033` **in that exact numeric order** (00022–00025 are from the earlier Reviews-module session, unrelated). `00032` (permissions) can run any time after `00026`; `00033` must run after `00029`.
3. Deploy the 5 Edge Functions: `supabase functions deploy wa-send wa-webhook lms-contacts-pull wa-template-meta wa-account-info --project-ref ptksdithbytzrznplfiq`.
4. Register the webhook with Meta: URL `https://ptksdithbytzrznplfiq.supabase.co/functions/v1/wa-webhook`, verify token = whatever `WA_WEBHOOK_VERIFY_TOKEN` was set to.
5. Subscribe the webhook to the `messages` and `message_template_status_update` fields in the Meta App dashboard.
6. Re-run Phase 0's connectivity checks (phone number info + templates list) now that secrets exist, to confirm the WABA is actually reachable before onboarding real templates.

## New DB objects (migrations `00026`–`00033`)

**12 tables** (the original spec said "11" but its own Phase 1.17 adds a 12th, `wa_settings`, uncounted): `wa_accounts`, `wa_settings`, `wa_templates`, `wa_contacts`, `wa_contact_lists`, `wa_list_members`, `wa_campaigns`, `wa_messages`, `wa_conversations`, `wa_opt_outs`, `wa_send_events`, `wa_automation_rules` (scaffold, no consumer).

**9 enums**, **~9 functions** (`fn_wa_can_send`, `fn_wa_session_open`, `fn_wa_resolve_audience` — STABLE; `fn_wa_render_body`, `fn_wa_resolve_mapping`, `fn_wa_values_to_ordered_array`, `fn_wa_count_template_vars`, `fn_wa_messages_after_insert`, `fn_wa_set_updated_at`, `fn_wa_stop_keyword_handler` — the last three are trigger functions), **10 RPCs** (`rpc_wa_template_upsert`, `rpc_wa_template_submit`, `rpc_wa_template_sync`, `rpc_wa_contact_upsert_bulk`, `rpc_wa_contact_opt_out`, `rpc_wa_campaign_preview`, `rpc_wa_campaign_send`, `rpc_wa_quick_send`, `rpc_wa_conversation_reply`, `rpc_wa_mark_read`), **3 triggers** on `wa_messages` + 2 `updated_at` triggers, RLS on all 12 tables.

### Corrections made vs. the original spec (flagged during the build, not silent)

- **`wa_contacts.venue_affinity` is `integer`, not `bigint`** — `venues.id` is a `SERIAL` in this schema.
- **`variable_count`'s generated-column expression as spec'd was invalid SQL** — `regexp_matches(..., 'g')` is set-returning and Postgres generated columns can't use one even in a subquery. Wrapped in `fn_wa_count_template_vars` (IMMUTABLE).
- **All mutating `rpc_wa_*` functions are `VOLATILE`**, not `STABLE` as the spec's convention list said — same correctness class already caught twice earlier this session (Projects, Reviews modules). Only the 3 genuinely read-only helpers are STABLE.
- **Stop-keyword regex tightened to match the whole message**, not just a leading word — the spec's literal `^(stop|unsubscribe|...)` would also auto-opt-out a contact who replied "Cancel the extra dessert please."
- **`rpc_wa_template_submit`/`rpc_wa_template_sync` are DB bookkeeping only** — no `pg_net` precedent anywhere in this codebase, so the actual Meta HTTP calls live in a 4th Edge Function (`wa-template-meta`) not in the original spec's named 3.
- **Gap, not resolved**: `broadcast.campaigns.cancel` is a real grantable permission key, but RLS only gates campaign INSERT/UPDATE on `broadcast.campaigns.create`, and no RPC implements a distinct cancel path. Someone with only `.cancel` can't act via RLS today.
- **Migration `00033`** (added after `wa-send` was written, not part of the original Phase 1 file set): `wa_messages.template_params` — Meta's template-send API needs the *individual* variable values as an ordered array, not the merged `rendered_body` string; there's no way to invert a string substitution back into positional values. `rpc_wa_quick_send` and `rpc_wa_campaign_send` populate it; **`rpc_wa_conversation_reply`'s template-reply path does not** (see Known Gaps below).

## Permissions (`src/lib/permissions.js`)

New "API Marketing" group, 18 `broadcast.*` keys nested under 7 top-level toggles (mirrors how `finance.expenses`/`procurement.requisitions` nest sub-actions via `optional`). Backfill (`00032`): **admin** gets all 18 (both surfaces); **auditor** gets the 5 `.view` keys only; **sales** gets `broadcast.quicksend` only (role name confirmed live against `profiles.role`'s CHECK constraint history).

## Edge Functions (`supabase/functions/`)

- **`wa-send`** — sends queued `wa_messages` rows to Meta. `{message_id}` (single) or `{campaign_id}` (batch, 100ms apart). Re-checks `fn_wa_can_send` at send time (conditions can shift after queueing). Meta error 131047 → auto opt-out.
- **`wa-webhook`** — public, HMAC-SHA256 signature-verified. Handles inbound messages, delivery/read/failed statuses, template approval/rejection events. Not live-tested (no real webhook deliveries possible without secrets) — the `message_template_status_update` field shape is Meta's documented format, verify against a real payload once wired up.
- **`lms-contacts-pull`** — **design deviation, user-approved**: no "list leads" LMS endpoint has any precedent in this codebase (only "create one lead" and "list confirmed contracts" do). Per the user's choice, this reads the already-synced local `events` table instead of re-hitting LMS a second time — same data, one fewer external integration surface. This also means the spec's separately-planned "Pull from LMS" and "Pull from contracts" Contacts.jsx buttons were collapsed into one ("Pull from Contracts").
- **`wa-template-meta`** — **not in the original spec's named 3 functions**, added to close a gap: actually POSTs a template to Meta's Create Message Template API (`submit`) and re-fetches its status (`sync`). Without this, Templates.jsx's Submit/Sync buttons would be non-functional stubs.
- **`wa-account-info`** — also not originally named. Admin-only; fetches WABA display name/quality rating/tier from Meta for the Settings page's read-only info card. `quota_used_today` is NOT fetched here (no simple Meta field for it) — stays whatever the DB already has, which nothing currently writes (deferred).

## UI (`src/modules/broadcast/`, `src/components/broadcast/`)

- **`Templates.jsx`** — 3-column library/editor/preview layout. Buttons are edited as raw JSON (not a drag-and-drop builder) — a deliberate MVP simplification.
- **`Contacts.jsx`** — table + filters + CSV import (client-side parse) + "Pull from Contracts" + manual add + detail drawer (tags/notes/message history/opt-out, masked phone with logged reveal).
- **`Campaigns.jsx`** + **`CampaignBuilder.jsx`** — list view + 5-step builder (name/template/audience/variable-mapping/schedule) with a live preview panel and the ≤20-vs-typed-token confirm dialog.
- **`Inbox.jsx`** — conversation list + thread + composer, Supabase Realtime subscription on `wa_messages`.
- **`Settings.jsx`** — admin-only, edits `wa_settings` + on-demand WABA info refresh.
- **`QuickSendDrawer.jsx`** (shared, `src/components/broadcast/`) — mounted inline in `QuoteCalculator.jsx` (next to the Phone field) and `Events.jsx` (Group Detail Modal). Gated on `broadcast.quicksend`, only ever shows `sales_approved` + `meta_status='approved'` templates.
- **`BroadcastHub.jsx`** — sub-nav wrapper for Shell.jsx (mobile), mirrors AdminShell's `SUB_TAB_CONFIG` pattern since Shell has no equivalent mechanism. **Must stay `lazy()`** — Shell.jsx is statically imported at the app root, so a plain static import here would have shipped all 5 sub-pages in the main bundle for every user regardless of permission (this actually happened once during the build and was caught via a `npm run build` chunk-size check, then fixed).
- Shell integration: new "API Marketing" tile between HR and Admin (Shell.jsx) / after Users (AdminShell.jsx), `ti-brand-whatsapp` icon, gated on any of the 4 `.view` perms — `broadcast.quicksend`-only (sales) users don't see the tile.

## Known gaps / deferred (supersedes the original spec's own deferred list)

- **Contact merge** — no `rpc_wa_contact_merge` exists; "Merge duplicates" was not built (would need to touch `wa_messages`/`wa_conversations`/`wa_list_members` with no client RLS write access — needs its own RPC first).
- **Saved Lists (static/dynamic) CRUD** — not built. Campaigns still work without them (`rpc_wa_campaign_preview`/`send` accept a raw `audience_filter_json` with no `list_id`).
- **Image/media attachments in Inbox** — NOT built, despite being spec'd as v1 scope. Needs Meta's Media Upload API + a `wa-send` `'image'` message type, neither of which exist. (The original spec's deferred list only mentioned "media attachments >images" as deferred — correcting that here: images are deferred too.)
- **`rpc_wa_conversation_reply`'s template-reply path never populates `template_params`** — `wa-send` fails loudly (`template_params_missing`) rather than sending wrong values, so the Inbox's template picker only offers variable-count-0 templates. Fixing this needs the RPC's signature changed (a DROP + re-CREATE, not a plain replace).
- **"Message all booked guests" bulk campaign trigger from Events.jsx** — not built (spec's Phase 8.3, admin-only bulk send to an event's guest list); depends on the deferred saved-Lists feature.
- **Contracts.jsx integration (Phase 8.4)** — moot; confirmed at Phase 0 that no dedicated Contracts module exists anywhere in this repo.
- **`wa_campaigns.replied_count`** — never incremented anywhere. There's no specified rule for attributing a later inbound message back to a specific campaign; guessing one risked misleading analytics, so it was left at 0 rather than faked.
- **Automations** (`wa_automation_rules`) — schema scaffolded per spec, genuinely zero consumer, as intended for v1.
- **Mobile (Shell.jsx) rendering of the full console** — wired in (permission-consistent with `permissions.js` marking these keys `scope: 'both'`), but the pages themselves (tables, multi-column forms) are desktop-first and not verified at narrow phone widths.

## Test checklist (from the original spec — none of these have been run; secrets/deploy are prerequisites)

- [ ] Admin lists templates from Meta via Phase 0 fetch → matches DB after Templates page load
- [ ] Create draft template → save → submit → status pending; sync after a few minutes → approved/rejected with reason
- [ ] CSV upload with mixed valid/invalid phones → valid inserted, invalid returned per-row
- [ ] Pull from Contracts → returns N contacts; dedup on second run
- [ ] Contact opt-out (manual) → `wa_opt_outs` row + contact status flipped
- [ ] Inbound "STOP" via webhook → auto-opt-out fires, future sends blocked
- [ ] Send campaign to 5 recipients → all rows in `wa_messages`, counters increment, webhook updates delivery status
- [ ] Send campaign to 30 recipients → confirmation modal requires typed token
- [ ] Campaign with opted-out contacts in audience → preview shows correct reachable count + breakdown
- [ ] Marketing send at 22:30 IST → blocked by window; utility send at same time → allowed
- [ ] Frequency cap: 2 marketing sends in a week → 3rd blocked, shows in preview breakdown
- [ ] Inbound reply → conversation upserted, unread badge increments, session extends
- [ ] Reply within session → free-form composer enabled; after session closes → template-only
- [ ] Sales user (only `broadcast.quicksend`): no tile visible, QuickSend from QuoteCalc/Events works, only `sales_approved` templates shown
- [ ] Sales user hitting the broadcast tab route directly → blocked (no tile means no route trigger, but verify AdminShell's `anyPerm` gate also holds if navigated some other way)
- [ ] Webhook with invalid signature → 403, no data written
- [ ] Phone display in Contacts masked; click reveals + logs to `activity_logs` (verify no phone number lands in `details`)
