-- Reviews module — Phase 10b: wire 'category'/'sub_category' into the queue, RPCs, RLS.
-- Run AFTER 00022 has been applied and committed (new enum values must exist first).
--
-- Categories/sub_categories don't have a dept tier, a rejection_reason column, or a
-- changes_requested concept — matching PendingReview.jsx's actual behavior exactly:
-- approve is a plain status flip, reject HARD-DELETES the row (there is no persistent
-- "rejected taxonomy entry" state, unlike items). The review_events row for the reject
-- still gets written with the notes, so the audit trail survives even though its
-- subject doesn't — that's expected for a deletion, not a bug.
-- request_changes / reopen remain unsupported for these 2 domains (no edit flow for
-- masters, same as today).

BEGIN;

-- ============================================================================
-- v_review_queue — add the 2 new domains
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

UNION ALL

SELECT
  'category'::review_domain_e,
  cat.id,
  cat.name,
  NULL::bigint,
  NULL::text,
  NULL::integer,
  jsonb_build_object('table', 'categories'),
  cat.added_by,
  cat.created_at,
  NULL::bigint,
  fn_review_status_from_legacy(cat.status, NULL),
  fn_review_priority(cat.created_at, NULL)
FROM categories cat
WHERE fn_review_status_from_legacy(cat.status, NULL) = 'pending'

UNION ALL

SELECT
  'sub_category'::review_domain_e,
  sc.id,
  sc.name,
  NULL::bigint,
  NULL::text,
  sc.category_id,
  jsonb_build_object('table', 'sub_categories', 'category_id', sc.category_id),
  sc.added_by,
  sc.created_at,
  NULL::bigint,
  fn_review_status_from_legacy(sc.status, NULL),
  fn_review_priority(sc.created_at, NULL)
FROM sub_categories sc
WHERE fn_review_status_from_legacy(sc.status, NULL) = 'pending'
;

-- ============================================================================
-- fn_review_scope_visible — no tag semantics for master data, always visible
-- to whoever holds review.masters (checked separately at the RPC/RLS layer)
-- ============================================================================

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
  IF p_domain IN ('category', 'sub_category') THEN RETURN true; END IF;

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
-- review_events RLS — add category/sub_category to the domain->permission map
-- ============================================================================

DROP POLICY IF EXISTS review_events_select ON review_events;
CREATE POLICY review_events_select ON review_events FOR SELECT
  USING (
    user_can((
      CASE domain
        WHEN 'inventory' THEN 'review.inventory'
        WHEN 'item_receipt' THEN 'review.item_receipts'
        WHEN 'expense' THEN 'review.expenses'
        WHEN 'requisition' THEN 'review.requisitions'
        WHEN 'vendor_payment' THEN 'review.vendor_payments'
        WHEN 'category' THEN 'review.masters'
        WHEN 'sub_category' THEN 'review.masters'
      END
    ))
    AND fn_review_scope_visible(domain, source_id)
  );

DROP POLICY IF EXISTS review_events_insert ON review_events;
CREATE POLICY review_events_insert ON review_events FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND user_can((
      CASE domain
        WHEN 'inventory' THEN 'review.inventory'
        WHEN 'item_receipt' THEN 'review.item_receipts'
        WHEN 'expense' THEN 'review.expenses'
        WHEN 'requisition' THEN 'review.requisitions'
        WHEN 'vendor_payment' THEN 'review.vendor_payments'
        WHEN 'category' THEN 'review.masters'
        WHEN 'sub_category' THEN 'review.masters'
      END
    ))
    AND fn_review_scope_visible(domain, source_id)
  );

-- ============================================================================
-- rpc_review_approve — add category/sub_category branches
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
  v_found boolean;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition', 'category', 'sub_category') THEN
    RAISE EXCEPTION 'domain % has no approve action', p_domain;
  END IF;

  v_perm := CASE p_domain
    WHEN 'inventory' THEN 'review.inventory' WHEN 'item_receipt' THEN 'review.item_receipts'
    WHEN 'requisition' THEN 'review.requisitions' ELSE 'review.masters' END;
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'category' THEN
    UPDATE categories SET status = 'approved' WHERE id = p_source_id AND status = 'pending';
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'approve', p_notes);
    RETURN 'approved'::review_status_e;
  ELSIF p_domain = 'sub_category' THEN
    UPDATE sub_categories SET status = 'approved' WHERE id = p_source_id AND status = 'pending';
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'approve', p_notes);
    RETURN 'approved'::review_status_e;
  END IF;

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
    IF p_domain = 'inventory' THEN
      UPDATE inventory_items SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    ELSIF p_domain = 'item_receipt' THEN
      UPDATE catering_store_items SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    ELSE
      UPDATE requisitions SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    END IF;
    v_new_status := 'pending';
  ELSE
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

-- ============================================================================
-- rpc_review_reject — category/sub_category hard-delete (matches PendingReview.jsx)
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_review_reject(p_domain review_domain_e, p_source_id bigint, p_notes text)
RETURNS review_status_e
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_perm text;
  v_status text;
  v_found boolean;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition', 'category', 'sub_category') THEN
    RAISE EXCEPTION 'domain % has no reject action', p_domain;
  END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to reject'; END IF;

  v_perm := CASE p_domain
    WHEN 'inventory' THEN 'review.inventory' WHEN 'item_receipt' THEN 'review.item_receipts'
    WHEN 'requisition' THEN 'review.requisitions' ELSE 'review.masters' END;
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'category' THEN
    -- Log BEFORE deleting — review_events has no FK to the source row, but the
    -- delete must succeed for the log to be meaningful either way.
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'reject', p_notes);
    DELETE FROM categories WHERE id = p_source_id AND status = 'pending';
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    RETURN 'rejected'::review_status_e;
  ELSIF p_domain = 'sub_category' THEN
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'reject', p_notes);
    DELETE FROM sub_categories WHERE id = p_source_id AND status = 'pending';
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    RETURN 'rejected'::review_status_e;
  END IF;

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

-- ============================================================================
-- rpc_review_comment — extend permission map to category/sub_category
-- ============================================================================

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

  v_perm := CASE p_domain
    WHEN 'inventory' THEN 'review.inventory' WHEN 'item_receipt' THEN 'review.item_receipts'
    WHEN 'expense' THEN 'review.expenses' WHEN 'requisition' THEN 'review.requisitions'
    WHEN 'vendor_payment' THEN 'review.vendor_payments'
    WHEN 'category' THEN 'review.masters' WHEN 'sub_category' THEN 'review.masters'
  END;

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

COMMIT;

NOTIFY pgrst, 'reload schema';
