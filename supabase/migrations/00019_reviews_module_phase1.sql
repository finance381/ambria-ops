-- Reviews module — Phase 1: enums, review_events, profiles/role_defaults scopes,
-- helper functions, v_review_queue, state-transition RPCs.
--
-- DESIGN NOTES (read before applying):
--
-- 1. No `review_status` column is added to inventory_items / catering_store_items /
--    requisitions. All three already fully encode the state machine via their
--    existing `status` (text) + `dept_approved_at`/`dept_approved_by` + `rejection_reason`
--    columns. Adding a second, parallel `review_status` enum column would create the
--    exact drift risk the "consolidate, don't duplicate" instruction was meant to avoid,
--    and would require touching every other screen that already filters on `status`
--    (InventoryForm, DeptReview, Requisitions, etc.). Instead, `review_status_e` is
--    DERIVED on read via fn_review_status_from_legacy(status, dept_approved_at).
--
-- 2. `expenses` already has dept_approved_at/dept_approved_by/rejection_reason/
--    reviewed_by/reviewed_at sitting unused (vestigial, from before the table moved to
--    its current flag/acknowledge/deduct model). Per the read-only decision for the
--    expense domain, none of these are touched or reused — expense review is comment-only
--    via review_events, expenses itself is never mutated by this module.
--
-- 3. requisitions already has reviewed_by/reviewed_at (unused today) — reused as-is,
--    same shape as inventory_items/catering_store_items get newly.
--
-- 4. The old two-tier dept-then-admin gate collapses into ONE queue + ONE permission
--    per domain (review.inventory / review.item_receipts / review.requisitions), scoped
--    by review_scopes tags rather than a separate dept-vs-admin permission split.
--    rpc_review_approve inspects the item's CURRENT status and applies whichever
--    transition is next (pending_dept -> pending, or pending -> approved) — the caller
--    just clicks "Approve" once; which transition happens is derived from state, not
--    asked of the user. A reviewer whose review_scopes cover a category can now push an
--    item through both stages if they encounter it at either stage — this is an
--    intentional simplification versus today's DeptReview/AdminReview split, worth
--    knowing about since it changes who effectively can do what versus the old screens
--    (which stay live, unchanged, through the Phase 8 deprecation window).
--
-- 5. rejection_reason (existing column) is reused for BOTH reject and request_changes
--    notes on inventory_items/catering_store_items/requisitions — no new review_notes
--    column added to these 3 tables (same "don't duplicate" reasoning as #1). Full
--    history of every note/comment lives in review_events.notes regardless.
--
-- 6. review_scopes.departments holds department NAME strings, not ids — because
--    requisitions.department is itself a free-text column (no department_id FK exists
--    on requisitions today), unlike the spec's illustrative example which showed ids.
--    review_scopes.categories / expense_types / vendor_ids hold integer ids, matching
--    their real FK columns.
--
-- 7. v_review_queue unions only the 3 stateful domains (inventory, item_receipt,
--    requisition) — it is specifically the ACTION QUEUE (count of items awaiting a
--    decision). expense and vendor_payment have no "pending" concept (per your answer,
--    both are read-only/comment-only), so they don't belong in a queue view and don't
--    contribute to badge counts. Their tabs in the frontend will read directly from
--    `expenses` / `ledger_entries` with a comment-count join (Phase 3) instead.
--
-- 8. fn_review_scope_visible takes only (p_domain, p_source_id) and looks up the
--    relevant tags/venue itself per domain — the spec's literal signature expected the
--    caller to pre-supply p_tags/p_venue_id, which doesn't compose cleanly with an RLS
--    policy on review_events (the policy only has domain+source_id to work with).
--
-- 9. rpc_review_reopen resets status to 'pending_dept' (not 'pending'), mirroring
--    DeptReview.jsx's existing resubmit-after-rejection behavior exactly, and clears
--    rejection_reason. No time-window restriction is enforced in v1 (spec said
--    "config" without specifying a mechanism) — gated on the review.reopen permission
--    only; a time limit can be layered in later once there's a config table to hold it.
--
-- Single transaction, defensive DDL throughout (IF NOT EXISTS) given the local
-- migrations history is known to be stale relative to live schema.

BEGIN;

-- ============================================================================
-- 1.1 Enums
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE review_domain_e AS ENUM ('inventory','item_receipt','expense','requisition','vendor_payment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_status_e AS ENUM ('pending','approved','rejected','changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_event_kind_e AS ENUM ('submit','approve','reject','request_changes','comment','delegate','reopen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_priority_e AS ENUM ('normal','aging','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 1.2 Genuinely-missing columns only (reviewed_by/reviewed_at on the 2 inventory
--     tables). requisitions already has these; expenses' copies are untouched.
-- ============================================================================

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE catering_store_items ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id);
ALTER TABLE catering_store_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Backfill: rows already approved are treated as already-reviewed historical data.
UPDATE inventory_items
   SET reviewed_by = COALESCE(dept_approved_by, submitted_by),
       reviewed_at = COALESCE(dept_approved_at, created_at)
 WHERE status = 'approved' AND reviewed_by IS NULL;

UPDATE catering_store_items
   SET reviewed_by = COALESCE(dept_approved_by, submitted_by),
       reviewed_at = COALESCE(dept_approved_at, created_at)
 WHERE status = 'approved' AND reviewed_by IS NULL;

UPDATE requisitions
   SET reviewed_by = COALESCE(dept_approved_by, requested_by),
       reviewed_at = COALESCE(dept_approved_at, created_at)
 WHERE status = 'approved' AND reviewed_by IS NULL;

-- ============================================================================
-- 1.3 review_events — unified audit log (append-only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_events (
  id bigserial PRIMARY KEY,
  domain review_domain_e NOT NULL,
  source_id bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id) DEFAULT auth.uid(),
  kind review_event_kind_e NOT NULL,
  notes text,
  delegated_to uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_review_events_source ON review_events(domain, source_id, created_at);
CREATE INDEX IF NOT EXISTS ix_review_events_actor ON review_events(actor_id, created_at DESC);

-- ============================================================================
-- 1.4 profiles.review_scopes + role_defaults.review_scopes
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS review_scopes jsonb DEFAULT '{}'::jsonb;
COMMENT ON COLUMN profiles.review_scopes IS
  'Per-domain tag filter arrays: {"expense_types":[3,7], "categories":[1], "departments":["Production"], "vendor_ids":[]}. departments holds NAME strings (requisitions.department is free text, not an FK); the rest hold integer ids. Empty array or missing key = see all in that domain.';

ALTER TABLE role_defaults ADD COLUMN IF NOT EXISTS review_scopes jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 1.6 Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_review_status_from_legacy(p_status text, p_dept_approved_at timestamptz)
RETURNS review_status_e
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN p_status IN ('pending_dept', 'pending') THEN 'pending'::review_status_e
    WHEN p_status = 'rejected' THEN 'rejected'::review_status_e
    WHEN p_status = 'changes_requested' THEN 'changes_requested'::review_status_e
    ELSE 'approved'::review_status_e  -- approved, fulfilled, cancelled, or any other terminal/unknown value
  END
$$;

CREATE OR REPLACE FUNCTION fn_review_priority(p_submitted_at timestamptz, p_amount_paise bigint)
RETURNS review_priority_e
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN now() - p_submitted_at > interval '7 days' OR COALESCE(p_amount_paise, 0) > 10000000 THEN 'urgent'::review_priority_e
    WHEN now() - p_submitted_at > interval '3 days' OR COALESCE(p_amount_paise, 0) > 5000000 THEN 'aging'::review_priority_e
    ELSE 'normal'::review_priority_e
  END
$$;

-- Looks up the item itself (per-domain) and checks the caller's review_scopes tags +
-- data_scopes venue rule against it. SECURITY DEFINER so it can read the source tables
-- regardless of the source tables' own RLS (the caller's *permission* to see the domain
-- at all is checked separately via user_can() at the RLS-policy / RPC call site).
CREATE OR REPLACE FUNCTION fn_review_scope_visible(p_domain review_domain_e, p_source_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scopes jsonb;
  v_role text;
  v_category_id integer;
  v_sub_category_id integer;
  v_department text;
  v_expense_type_id integer;
  v_vendor_id integer;
  v_categories jsonb;
  v_departments jsonb;
  v_expense_types jsonb;
  v_vendor_ids jsonb;
BEGIN
  SELECT review_scopes, role INTO v_scopes, v_role FROM profiles WHERE id = auth.uid();
  IF v_role = 'admin' OR v_role = 'auditor' THEN RETURN true; END IF;
  v_scopes := COALESCE(v_scopes, '{}'::jsonb);
  v_categories := COALESCE(v_scopes->'categories', '[]'::jsonb);
  v_departments := COALESCE(v_scopes->'departments', '[]'::jsonb);
  v_expense_types := COALESCE(v_scopes->'expense_types', '[]'::jsonb);
  v_vendor_ids := COALESCE(v_scopes->'vendor_ids', '[]'::jsonb);

  IF p_domain = 'inventory' THEN
    SELECT category_id, sub_category_id INTO v_category_id, v_sub_category_id FROM inventory_items WHERE id = p_source_id;
  ELSIF p_domain = 'item_receipt' THEN
    SELECT category_id, sub_category_id INTO v_category_id, v_sub_category_id FROM catering_store_items WHERE id = p_source_id;
  ELSIF p_domain = 'requisition' THEN
    SELECT category_id, sub_category_id, department, expense_type_id INTO v_category_id, v_sub_category_id, v_department, v_expense_type_id FROM requisitions WHERE id = p_source_id;
  ELSIF p_domain = 'expense' THEN
    SELECT expense_type_id INTO v_expense_type_id FROM expenses WHERE id = p_source_id;
  ELSIF p_domain = 'vendor_payment' THEN
    SELECT party_id INTO v_vendor_id FROM ledger_entries WHERE id = p_source_id AND ledger_type = 'vendor';
  END IF;

  IF jsonb_array_length(v_categories) > 0 AND v_category_id IS NOT NULL
     AND NOT (v_categories @> to_jsonb(v_category_id)) THEN RETURN false; END IF;

  IF jsonb_array_length(v_departments) > 0 AND v_department IS NOT NULL
     AND NOT (v_departments @> to_jsonb(v_department)) THEN RETURN false; END IF;

  IF jsonb_array_length(v_expense_types) > 0 AND v_expense_type_id IS NOT NULL
     AND NOT (v_expense_types @> to_jsonb(v_expense_type_id)) THEN RETURN false; END IF;

  IF jsonb_array_length(v_vendor_ids) > 0 AND v_vendor_id IS NOT NULL
     AND NOT (v_vendor_ids @> to_jsonb(v_vendor_id)) THEN RETURN false; END IF;

  RETURN true;
END;
$$;

-- ============================================================================
-- 1.5 v_review_queue — the 3 stateful domains only (see design note 7)
-- ============================================================================

CREATE OR REPLACE VIEW v_review_queue AS
SELECT
  'inventory'::review_domain_e AS domain,
  i.id AS source_id,
  i.name AS title,
  NULL::bigint AS amount_paise,
  NULL::text AS vendor_name,
  i.category_id AS primary_tag,
  jsonb_build_object('category_id', i.category_id, 'sub_category_id', i.sub_category_id, 'department', i.department) AS tags,
  i.submitted_by AS submitted_by,
  i.created_at AS submitted_at,
  NULL::bigint AS venue_id,
  fn_review_status_from_legacy(i.status, i.dept_approved_at) AS status,
  fn_review_priority(i.created_at, NULL) AS priority
FROM inventory_items i
WHERE fn_review_status_from_legacy(i.status, i.dept_approved_at) IN ('pending', 'changes_requested')

UNION ALL

SELECT
  'item_receipt'::review_domain_e,
  c.id,
  c.name,
  NULL::bigint,
  NULL::text,
  c.category_id,
  jsonb_build_object('category_id', c.category_id, 'sub_category_id', c.sub_category_id, 'department', c.department),
  c.submitted_by,
  c.created_at,
  NULL::bigint,
  fn_review_status_from_legacy(c.status, c.dept_approved_at),
  fn_review_priority(c.created_at, NULL)
FROM catering_store_items c
WHERE fn_review_status_from_legacy(c.status, c.dept_approved_at) IN ('pending', 'changes_requested')

UNION ALL

SELECT
  'requisition'::review_domain_e,
  r.id,
  r.purpose,
  CASE WHEN r.req_type = 'expense' THEN r.expense_amount_paise ELSE NULL END,
  NULL::text,
  r.category_id,
  jsonb_build_object('category_id', r.category_id, 'sub_category_id', r.sub_category_id, 'department', r.department, 'expense_type_id', r.expense_type_id, 'expense_sub_type_id', r.expense_sub_type_id),
  r.requested_by,
  r.created_at,
  NULL::bigint,
  fn_review_status_from_legacy(r.status, r.dept_approved_at),
  fn_review_priority(r.created_at, CASE WHEN r.req_type = 'expense' THEN r.expense_amount_paise ELSE NULL END)
FROM requisitions r
WHERE fn_review_status_from_legacy(r.status, r.dept_approved_at) IN ('pending', 'changes_requested')
;

-- ============================================================================
-- 1.7 RLS on review_events — append-only, scope-checked
-- ============================================================================

ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_events_select ON review_events;
CREATE POLICY review_events_select ON review_events FOR SELECT
  USING (
    user_can('review.' || (
      CASE domain
        WHEN 'inventory' THEN 'inventory'
        WHEN 'item_receipt' THEN 'item_receipts'
        WHEN 'expense' THEN 'expenses'
        WHEN 'requisition' THEN 'requisitions'
        WHEN 'vendor_payment' THEN 'vendor_payments'
      END
    ))
    AND fn_review_scope_visible(domain, source_id)
  );

DROP POLICY IF EXISTS review_events_insert ON review_events;
CREATE POLICY review_events_insert ON review_events FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND user_can('review.' || (
      CASE domain
        WHEN 'inventory' THEN 'inventory'
        WHEN 'item_receipt' THEN 'item_receipts'
        WHEN 'expense' THEN 'expenses'
        WHEN 'requisition' THEN 'requisitions'
        WHEN 'vendor_payment' THEN 'vendor_payments'
      END
    ))
    AND fn_review_scope_visible(domain, source_id)
  );

-- UPDATE/DELETE: denied for everyone (no policy = no access under RLS). Even admins.

-- ============================================================================
-- 1.8 State-transition RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_review_approve(p_domain review_domain_e, p_source_id bigint, p_notes text DEFAULT NULL)
RETURNS review_status_e
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perm text;
  v_status text;
  v_dept_at timestamptz;
  v_new_status review_status_e;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition') THEN
    RAISE EXCEPTION 'domain % has no approve action', p_domain;
  END IF;

  v_perm := 'review.' || (CASE p_domain WHEN 'inventory' THEN 'inventory' WHEN 'item_receipt' THEN 'item_receipts' ELSE 'requisitions' END);
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT status, dept_approved_at INTO v_status, v_dept_at FROM inventory_items WHERE id = p_source_id FOR UPDATE;
  ELSIF p_domain = 'item_receipt' THEN
    SELECT status, dept_approved_at INTO v_status, v_dept_at FROM catering_store_items WHERE id = p_source_id FOR UPDATE;
  ELSE
    SELECT status, dept_approved_at INTO v_status, v_dept_at FROM requisitions WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
  IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN
    RAISE EXCEPTION 'item is not awaiting review (current status: %)', v_status;
  END IF;

  IF v_status = 'pending_dept' THEN
    -- dept-tier clear: advance to admin tier, stays "pending" in review terms
    IF p_domain = 'inventory' THEN
      UPDATE inventory_items SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    ELSIF p_domain = 'item_receipt' THEN
      UPDATE catering_store_items SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    ELSE
      UPDATE requisitions SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    END IF;
    v_new_status := 'pending';
  ELSE
    -- pending (admin tier) or changes_requested: final approval
    IF p_domain = 'inventory' THEN
      UPDATE inventory_items SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    ELSIF p_domain = 'item_receipt' THEN
      UPDATE catering_store_items SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    ELSE
      UPDATE requisitions SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    END IF;
    v_new_status := 'approved';
  END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'approve', p_notes);
  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_reject(p_domain review_domain_e, p_source_id bigint, p_notes text)
RETURNS review_status_e
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perm text;
  v_status text;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition') THEN
    RAISE EXCEPTION 'domain % has no reject action', p_domain;
  END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to reject'; END IF;

  v_perm := 'review.' || (CASE p_domain WHEN 'inventory' THEN 'inventory' WHEN 'item_receipt' THEN 'item_receipts' ELSE 'requisitions' END);
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT status INTO v_status FROM inventory_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE inventory_items SET status = 'rejected', rejection_reason = p_notes, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
  ELSIF p_domain = 'item_receipt' THEN
    SELECT status INTO v_status FROM catering_store_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE catering_store_items SET status = 'rejected', rejection_reason = p_notes, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
  ELSE
    SELECT status INTO v_status FROM requisitions WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE requisitions SET status = 'rejected', rejection_reason = p_notes, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
  END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'reject', p_notes);
  RETURN 'rejected'::review_status_e;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_request_changes(p_domain review_domain_e, p_source_id bigint, p_notes text)
RETURNS review_status_e
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perm text;
  v_status text;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition') THEN
    RAISE EXCEPTION 'domain % has no request_changes action', p_domain;
  END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to request changes'; END IF;

  v_perm := 'review.' || (CASE p_domain WHEN 'inventory' THEN 'inventory' WHEN 'item_receipt' THEN 'item_receipts' ELSE 'requisitions' END);
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT status INTO v_status FROM inventory_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE inventory_items SET status = 'changes_requested', rejection_reason = p_notes WHERE id = p_source_id;
  ELSIF p_domain = 'item_receipt' THEN
    SELECT status INTO v_status FROM catering_store_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE catering_store_items SET status = 'changes_requested', rejection_reason = p_notes WHERE id = p_source_id;
  ELSE
    SELECT status INTO v_status FROM requisitions WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('pending_dept', 'pending') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    UPDATE requisitions SET status = 'changes_requested', rejection_reason = p_notes WHERE id = p_source_id;
  END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'request_changes', p_notes);
  RETURN 'changes_requested'::review_status_e;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_comment(p_domain review_domain_e, p_source_id bigint, p_notes text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perm text;
  v_event_id bigint;
BEGIN
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to comment'; END IF;

  v_perm := 'review.' || (
    CASE p_domain
      WHEN 'inventory' THEN 'inventory' WHEN 'item_receipt' THEN 'item_receipts'
      WHEN 'expense' THEN 'expenses' WHEN 'requisition' THEN 'requisitions'
      WHEN 'vendor_payment' THEN 'vendor_payments'
    END
  );
  -- expense / vendor_payment are read-only audit domains — anyone who can already see the
  -- item via the ordinary Finance module (finance.expenses / finance.payments) can raise a
  -- concern on it, not only people holding the dedicated review.* browse permission.
  IF p_domain = 'expense' THEN
    IF NOT (user_can(v_perm) OR user_can('finance.expenses')) THEN RAISE EXCEPTION 'not permitted'; END IF;
  ELSIF p_domain = 'vendor_payment' THEN
    IF NOT (user_can(v_perm) OR user_can('finance.payments')) THEN RAISE EXCEPTION 'not permitted'; END IF;
  ELSE
    IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes)
  VALUES (p_domain, p_source_id, auth.uid(), 'comment', p_notes)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_reopen(p_domain review_domain_e, p_source_id bigint, p_notes text DEFAULT NULL)
RETURNS review_status_e
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition') THEN
    RAISE EXCEPTION 'domain % has no reopen action', p_domain;
  END IF;
  IF NOT user_can('review.reopen') THEN RAISE EXCEPTION 'not permitted'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT status INTO v_status FROM inventory_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('rejected', 'approved') THEN RAISE EXCEPTION 'only rejected or approved items can be reopened'; END IF;
    UPDATE inventory_items SET status = 'pending_dept', rejection_reason = NULL WHERE id = p_source_id;
  ELSIF p_domain = 'item_receipt' THEN
    SELECT status INTO v_status FROM catering_store_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('rejected', 'approved') THEN RAISE EXCEPTION 'only rejected or approved items can be reopened'; END IF;
    UPDATE catering_store_items SET status = 'pending_dept', rejection_reason = NULL WHERE id = p_source_id;
  ELSE
    SELECT status INTO v_status FROM requisitions WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF v_status NOT IN ('rejected', 'approved') THEN RAISE EXCEPTION 'only rejected or approved items can be reopened'; END IF;
    UPDATE requisitions SET status = 'pending_dept', rejection_reason = NULL WHERE id = p_source_id;
  END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'reopen', p_notes);
  RETURN 'pending'::review_status_e;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_bulk_approve(p_domain review_domain_e, p_source_ids bigint[], p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_new_status review_status_e;
BEGIN
  IF NOT user_can('review.bulk') THEN RAISE EXCEPTION 'not permitted'; END IF;
  FOREACH v_id IN ARRAY p_source_ids LOOP
    BEGIN
      v_new_status := rpc_review_approve(p_domain, v_id, p_notes);
      v_result := v_result || jsonb_build_object('source_id', v_id, 'ok', true, 'status', v_new_status);
    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('source_id', v_id, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_bulk_reject(p_domain review_domain_e, p_source_ids bigint[], p_notes text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF NOT user_can('review.bulk') THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to reject'; END IF;
  FOREACH v_id IN ARRAY p_source_ids LOOP
    BEGIN
      PERFORM rpc_review_reject(p_domain, v_id, p_notes);
      v_result := v_result || jsonb_build_object('source_id', v_id, 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('source_id', v_id, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 1.7b Extend SELECT visibility on the 2 source tables that need it
--
-- v_review_queue is a plain view — it runs under the QUERYING USER's RLS on the
-- underlying tables, not under fn_review_scope_visible (that only governs
-- review_events). Without this, a reviewer granted ONLY the new review.inventory /
-- review.requisitions permission (with a review_scopes tag but no matching
-- profiles.category_ids, which is the OLD, separate scoping array DeptReview.jsx
-- uses) would be unable to see anyone else's pending item at all — making the new
-- permission a no-op for anyone but admin/auditor. Adding an OR-branch, not
-- replacing the existing logic, so nothing already relying on these policies changes.
--
-- catering_store_items_select is already `USING (true)` (wide open) — no change needed.
-- ============================================================================

ALTER POLICY inventory_select ON inventory_items USING (
  (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
  OR (submitted_by = auth.uid())
  OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND inventory_items.category_id = ANY (p.category_ids)))
  OR (user_can('review.inventory'::text) AND fn_review_scope_visible('inventory'::review_domain_e, id))
);

ALTER POLICY req_select ON requisitions USING (
  (requested_by = auth.uid())
  OR fn_is_admin_only()
  OR ((fn_can_view_user(requested_by) OR user_can('review.dept.approve'::text)) AND fn_requisitions_scope_visible(id))
  OR (user_can('review.requisitions'::text) AND fn_review_scope_visible('requisition'::review_domain_e, id))
);

COMMIT;

NOTIFY pgrst, 'reload schema';
