-- Collapses inventory's two-stage approval (pending_dept -> pending -> approved)
-- into one stage: the category dept head's approval is now final. There is no
-- admin tier for inventory any more — admins keep full visibility (they already
-- see every row via the existing admin/auditor RLS bypass) but the review
-- ACTION is gated to dept heads only, both in the RPC and via a new trigger
-- that blocks the legacy raw-client admin approve/reject paths from bypassing
-- that gate. item_receipt, requisition, category and sub_category are
-- completely untouched — this migration only ever branches on p_domain =
-- 'inventory' / only ever touches inventory_items.
--
-- "Dept head" is defined as: profiles.role = 'dept. head' (the literal role
-- value used in this app) AND the profile holds 'review.dept.approve' AND the
-- item's category_id is in the profile's category_ids. All three conditions
-- are required — confirmed against live data: every current admin account
-- also holds 'review.dept.approve' with broad category_ids (a holdover from
-- when admins were also fallback approvers), so gating on permission +
-- category alone would NOT have excluded admins. The role check is what
-- actually makes "only dept heads approve, admins only see" hold.
--
-- Categories with no dept head assigned: auto-approve (explicit decision —
-- there is no fallback approver). Confirmed via introspection that 0 rows
-- currently fall in this case, so this only matters for future submissions.

BEGIN;

-- ═══════════════════════════════════════
-- 1. The single dept-head definition, used everywhere below
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_is_inventory_dept_head(p_category_id integer, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = p_user
      AND active = true
      AND role = 'dept. head'
      AND p_category_id = ANY(COALESCE(category_ids, ARRAY[]::integer[]))
      AND (
        'review.dept.approve' = ANY(COALESCE(mobile_permissions,  ARRAY[]::text[]))
        OR
        'review.dept.approve' = ANY(COALESCE(desktop_permissions, ARRAY[]::text[]))
      )
  );
$function$;

-- Rewritten to add the same role='dept. head' condition, so submission
-- routing (InventoryForm) and approval (rpc_review_approve) can never
-- disagree about who counts as a dept head. Signature unchanged.
CREATE OR REPLACE FUNCTION public.has_category_dept_approver(p_category_id integer, p_exclude_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE active = true
      AND id <> p_exclude_id
      AND role = 'dept. head'
      AND p_category_id = ANY(COALESCE(category_ids, ARRAY[]::integer[]))
      AND (
        'review.dept.approve' = ANY(COALESCE(mobile_permissions,  ARRAY[]::text[]))
        OR
        'review.dept.approve' = ANY(COALESCE(desktop_permissions, ARRAY[]::text[]))
      )
  );
$function$;

-- ═══════════════════════════════════════
-- 2. Close the legacy raw-update gap. rpc_review_approve/reject are the only
-- intended path to move inventory_items.status into approved/rejected, but
-- inventory_update RLS also allows admin/auditor and dept-approve holders to
-- update the row directly — which is exactly what AdminMobile.jsx and
-- PendingReview.jsx do today. This trigger makes any direct status flip into
-- approved/rejected fail unless it's flagged as coming from inside the RPC,
-- regardless of which RLS branch let the UPDATE through. Every other column
-- (qty, name, image_path, etc.) is unaffected — normal edits keep working.
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_inventory_items_guard_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND COALESCE(current_setting('app.review_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'inventory item status can only be set to approved/rejected via the review action (Reviews > Inventory), not a direct update';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventory_items_guard_status_update ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_guard_status_update
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_items_guard_status_update();

-- ═══════════════════════════════════════
-- 3. rpc_review_approve — inventory gets its own early-return branch, gated
-- on fn_is_inventory_dept_head instead of user_can('review.inventory') (which
-- is unconditionally true for admin/auditor by design — see user_can — so it
-- could never be used to exclude them). item_receipt/requisition/category/
-- sub_category logic below is byte-for-byte what's live today.
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_review_approve(p_domain review_domain_e, p_source_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS review_status_e
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_perm text;
  v_status text;
  v_dept_at timestamptz;
  v_new_status review_status_e;
  v_found boolean;
  v_category_id integer;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition', 'category', 'sub_category') THEN
    RAISE EXCEPTION 'domain % has no approve action', p_domain;
  END IF;

  IF p_domain = 'inventory' THEN
    SELECT status, category_id INTO v_status, v_category_id FROM inventory_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF NOT fn_is_inventory_dept_head(v_category_id) THEN
      RAISE EXCEPTION 'only the category dept head can approve inventory items';
    END IF;
    IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN
      RAISE EXCEPTION 'item is not awaiting review (current status: %)', v_status;
    END IF;
    PERFORM set_config('app.review_rpc', '1', true);
    UPDATE inventory_items
       SET status = 'approved',
           dept_approved_by = auth.uid(), dept_approved_at = COALESCE(dept_approved_at, now()),
           reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = p_source_id;
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'approve', p_notes);
    RETURN 'approved'::review_status_e;
  END IF;

  v_perm := CASE p_domain
    WHEN 'item_receipt' THEN 'review.item_receipts'
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

  IF p_domain = 'item_receipt' THEN
    SELECT status, dept_approved_at INTO v_status, v_dept_at FROM catering_store_items WHERE id = p_source_id FOR UPDATE;
  ELSE
    SELECT status, dept_approved_at INTO v_status, v_dept_at FROM requisitions WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
  IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN
    RAISE EXCEPTION 'item is not awaiting review (current status: %)', v_status;
  END IF;

  IF v_status = 'pending_dept' THEN
    IF p_domain = 'item_receipt' THEN
      UPDATE catering_store_items SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    ELSE
      UPDATE requisitions SET status = 'pending', dept_approved_by = auth.uid(), dept_approved_at = now() WHERE id = p_source_id;
    END IF;
    v_new_status := 'pending';
  ELSE
    IF p_domain = 'item_receipt' THEN
      UPDATE catering_store_items SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    ELSE
      UPDATE requisitions SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    END IF;
    v_new_status := 'approved';
  END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'approve', p_notes);
  RETURN v_new_status;
END;
$function$;

-- ═══════════════════════════════════════
-- 4. rpc_review_reject — same shape: inventory gets its own gate, everything
-- else is unchanged from what's live today.
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_review_reject(p_domain review_domain_e, p_source_id bigint, p_notes text)
 RETURNS review_status_e
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_perm text;
  v_status text;
  v_found boolean;
  v_category_id integer;
BEGIN
  IF p_domain NOT IN ('inventory', 'item_receipt', 'requisition', 'category', 'sub_category') THEN
    RAISE EXCEPTION 'domain % has no reject action', p_domain;
  END IF;
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to reject'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT status, category_id INTO v_status, v_category_id FROM inventory_items WHERE id = p_source_id FOR UPDATE;
    IF v_status IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF NOT fn_is_inventory_dept_head(v_category_id) THEN
      RAISE EXCEPTION 'only the category dept head can reject inventory items';
    END IF;
    IF v_status NOT IN ('pending_dept', 'pending', 'changes_requested') THEN RAISE EXCEPTION 'item is not awaiting review'; END IF;
    PERFORM set_config('app.review_rpc', '1', true);
    UPDATE inventory_items SET status = 'rejected', rejection_reason = p_notes, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_source_id;
    INSERT INTO review_events (domain, source_id, actor_id, kind, notes) VALUES (p_domain, p_source_id, auth.uid(), 'reject', p_notes);
    RETURN 'rejected'::review_status_e;
  END IF;

  v_perm := CASE p_domain
    WHEN 'item_receipt' THEN 'review.item_receipts'
    WHEN 'requisition' THEN 'review.requisitions' ELSE 'review.masters' END;
  IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  IF p_domain = 'category' THEN
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

  IF p_domain = 'item_receipt' THEN
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
$function$;

-- ═══════════════════════════════════════
-- 5. rpc_review_comment — inventory now requires being the category's dept
-- head (matches "admins will just see the list and nothing else" — no
-- comment access either). Every other domain unchanged.
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_review_comment(p_domain review_domain_e, p_source_id bigint, p_notes text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_perm text;
  v_event_id bigint;
  v_category_id integer;
BEGIN
  IF p_notes IS NULL OR trim(p_notes) = '' THEN RAISE EXCEPTION 'notes are required to comment'; END IF;

  IF p_domain = 'inventory' THEN
    SELECT category_id INTO v_category_id FROM inventory_items WHERE id = p_source_id;
    IF v_category_id IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
    IF NOT fn_is_inventory_dept_head(v_category_id) THEN RAISE EXCEPTION 'not permitted'; END IF;
  ELSE
    v_perm := CASE p_domain
      WHEN 'item_receipt' THEN 'review.item_receipts' WHEN 'expense' THEN 'review.expenses'
      WHEN 'requisition' THEN 'review.requisitions' WHEN 'vendor_payment' THEN 'review.vendor_payments'
      WHEN 'category' THEN 'review.masters' WHEN 'sub_category' THEN 'review.masters'
    END;
    IF p_domain = 'expense' THEN
      IF NOT (user_can(v_perm) OR user_can('finance.expenses')) THEN RAISE EXCEPTION 'not permitted'; END IF;
    ELSIF p_domain = 'vendor_payment' THEN
      IF NOT (user_can(v_perm) OR user_can('finance.payments')) THEN RAISE EXCEPTION 'not permitted'; END IF;
    ELSE
      IF NOT user_can(v_perm) THEN RAISE EXCEPTION 'not permitted'; END IF;
    END IF;
  END IF;
  IF NOT fn_review_scope_visible(p_domain, p_source_id) THEN RAISE EXCEPTION 'not visible in your review scope'; END IF;

  INSERT INTO review_events (domain, source_id, actor_id, kind, notes)
  VALUES (p_domain, p_source_id, auth.uid(), 'comment', p_notes)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

-- ═══════════════════════════════════════
-- 6. review_events RLS — widen the inventory case to also admit dept heads,
-- so they can read/write their own item's comment/history timeline
-- regardless of whether they separately hold 'review.inventory'. Every other
-- domain's condition is unchanged.
-- ═══════════════════════════════════════
DROP POLICY IF EXISTS review_events_select ON review_events;
CREATE POLICY review_events_select ON review_events FOR SELECT USING (
  (
    CASE domain
      WHEN 'inventory'::review_domain_e THEN
        user_can('review.inventory'::text)
        OR EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = review_events.source_id AND fn_is_inventory_dept_head(i.category_id))
      WHEN 'item_receipt'::review_domain_e THEN user_can('review.item_receipts'::text)
      WHEN 'expense'::review_domain_e THEN user_can('review.expenses'::text)
      WHEN 'requisition'::review_domain_e THEN user_can('review.requisitions'::text)
      WHEN 'vendor_payment'::review_domain_e THEN user_can('review.vendor_payments'::text)
      WHEN 'category'::review_domain_e THEN user_can('review.masters'::text)
      WHEN 'sub_category'::review_domain_e THEN user_can('review.masters'::text)
      ELSE NULL::boolean
    END
  )
  AND fn_review_scope_visible(domain, source_id)
);

DROP POLICY IF EXISTS review_events_insert ON review_events;
CREATE POLICY review_events_insert ON review_events FOR INSERT WITH CHECK (
  actor_id = auth.uid()
  AND (
    CASE domain
      WHEN 'inventory'::review_domain_e THEN
        user_can('review.inventory'::text)
        OR EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = review_events.source_id AND fn_is_inventory_dept_head(i.category_id))
      WHEN 'item_receipt'::review_domain_e THEN user_can('review.item_receipts'::text)
      WHEN 'expense'::review_domain_e THEN user_can('review.expenses'::text)
      WHEN 'requisition'::review_domain_e THEN user_can('review.requisitions'::text)
      WHEN 'vendor_payment'::review_domain_e THEN user_can('review.vendor_payments'::text)
      WHEN 'category'::review_domain_e THEN user_can('review.masters'::text)
      WHEN 'sub_category'::review_domain_e THEN user_can('review.masters'::text)
      ELSE NULL::boolean
    END
  )
  AND fn_review_scope_visible(domain, source_id)
);

-- ═══════════════════════════════════════
-- 7. Backfill in-flight rows.
--
-- 538 rows: already dept-cleared, sitting in 'pending' waiting on the
-- (removed) admin stage — auto-approve now, dept head recorded as final
-- approver too (confirmed decision).
--
-- 55 rows: sitting in 'pending' but NEVER dept-cleared (dept_approved_at is
-- null) despite their category currently having a dept head — these reached
-- 'pending' via the old skip-to-admin route before a dept head existed for
-- their category, or a direct-create path. Under the new rule nobody has
-- actually reviewed these, so they go back to pending_dept for the now-
-- assigned dept head to look at, rather than being silently auto-approved.
--
-- 0 rows today fall in "pending_dept, category has no dept head" (confirmed
-- via introspection) — so the Decision A auto-approve path has nothing to
-- backfill; it only affects future submissions via InventoryForm.jsx.
--
-- These are direct updates, not calls through rpc_review_approve, so they'd
-- trip the guard trigger from step 2 — set its bypass flag first (SELECT, not
-- PERFORM: this is plain SQL here, not inside a function body).
-- ═══════════════════════════════════════
SELECT set_config('app.review_rpc', '1', true);

WITH backfilled AS (
  UPDATE inventory_items
     SET status = 'approved', reviewed_by = dept_approved_by, reviewed_at = now()
   WHERE status = 'pending' AND dept_approved_at IS NOT NULL
   RETURNING id, dept_approved_by
)
INSERT INTO review_events (domain, source_id, actor_id, kind, notes)
SELECT 'inventory'::review_domain_e, id, dept_approved_by, 'approve', 'auto: single-stage migration — was dept-cleared, admin stage removed'
FROM backfilled;

UPDATE inventory_items
   SET status = 'pending_dept'
 WHERE status = 'pending' AND dept_approved_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
