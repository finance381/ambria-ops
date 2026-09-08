-- Reviews module — fix: list-row thumbnails were never wired up.
-- v_review_queue never selected image_path, so the Reviews inbox list only ever
-- showed a generic domain-icon placeholder instead of the item's real photo
-- (PendingReview.jsx's list showed the actual thumbnail via getImageUrl(image_path)).
-- Adding image_path into the existing 'tags' jsonb column is a same-shape change
-- (same output columns/types), so CREATE OR REPLACE VIEW is safe here.

BEGIN;

CREATE OR REPLACE VIEW v_review_queue AS
SELECT
  'inventory'::review_domain_e AS domain,
  i.id AS source_id,
  i.name AS title,
  NULL::bigint AS amount_paise,
  NULL::text AS vendor_name,
  i.category_id AS primary_tag,
  jsonb_build_object('category_id', i.category_id, 'sub_category_id', i.sub_category_id, 'department', i.department, 'image_path', i.image_path) AS tags,
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
  jsonb_build_object('category_id', c.category_id, 'sub_category_id', c.sub_category_id, 'department', c.department, 'image_path', c.image_path),
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

NOTIFY pgrst, 'reload schema';

COMMIT;
