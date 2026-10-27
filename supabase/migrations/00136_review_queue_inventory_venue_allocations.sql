-- v_review_queue has hardcoded venue_id to NULL for every domain since it
-- was first created -- the Inventory tab's "All venues" filter in Reviews.jsx
-- has never actually filtered anything. inventory_items genuinely does have
-- real venue data, just not as a scalar column on the table itself: it's a
-- one-to-many relationship through venue_allocations (one item can be
-- stocked across several venues/sub-venues with different quantities each),
-- the exact same shape AdminItems.jsx's own working Sub-venue filter already
-- reads for this same table.
--
-- CREATE OR REPLACE VIEW can only add columns at the end, not remove/retype
-- existing ones -- venue_id stays (now permanently NULL, unused) and the two
-- new array columns are appended. A single scalar venue_id was never going
-- to be right for a one-to-many relationship anyway; the frontend filters
-- client-side on "does this item have any allocation at the selected venue",
-- same as AdminItems.jsx already does.

CREATE OR REPLACE VIEW v_review_queue AS
 SELECT 'inventory'::review_domain_e AS domain,
    i.id AS source_id,
    i.name AS title,
    NULL::bigint AS amount_paise,
    NULL::text AS vendor_name,
    i.category_id AS primary_tag,
    jsonb_build_object('category_id', i.category_id, 'sub_category_id', i.sub_category_id, 'department', i.department, 'image_path', i.image_path) AS tags,
    i.submitted_by,
    i.created_at AS submitted_at,
    NULL::bigint AS venue_id,
    fn_review_status_from_legacy(i.status, i.dept_approved_at) AS status,
    fn_review_priority(i.created_at, NULL::bigint) AS priority,
    (SELECT array_agg(DISTINCT va.venue_id) FROM venue_allocations va WHERE va.item_id = i.id) AS venue_ids,
    (SELECT array_agg(DISTINCT va.sub_venue_id) FROM venue_allocations va WHERE va.item_id = i.id AND va.sub_venue_id IS NOT NULL) AS sub_venue_ids
   FROM inventory_items i
  WHERE fn_review_status_from_legacy(i.status, i.dept_approved_at) = ANY (ARRAY['pending'::review_status_e, 'changes_requested'::review_status_e])
UNION ALL
 SELECT 'item_receipt'::review_domain_e AS domain,
    c.id AS source_id,
    c.name AS title,
    NULL::bigint AS amount_paise,
    NULL::text AS vendor_name,
    c.category_id AS primary_tag,
    jsonb_build_object('category_id', c.category_id, 'sub_category_id', c.sub_category_id, 'department', c.department, 'image_path', c.image_path) AS tags,
    c.submitted_by,
    c.created_at AS submitted_at,
    NULL::bigint AS venue_id,
    fn_review_status_from_legacy(c.status, c.dept_approved_at) AS status,
    fn_review_priority(c.created_at, NULL::bigint) AS priority,
    NULL::bigint[] AS venue_ids,
    NULL::bigint[] AS sub_venue_ids
   FROM catering_store_items c
  WHERE fn_review_status_from_legacy(c.status, c.dept_approved_at) = ANY (ARRAY['pending'::review_status_e, 'changes_requested'::review_status_e])
UNION ALL
 SELECT 'requisition'::review_domain_e AS domain,
    r.id AS source_id,
    r.purpose AS title,
        CASE
            WHEN r.req_type = 'expense'::text THEN r.expense_amount_paise
            ELSE NULL::integer
        END AS amount_paise,
    NULL::text AS vendor_name,
    r.category_id AS primary_tag,
    jsonb_build_object('category_id', r.category_id, 'sub_category_id', r.sub_category_id, 'department', r.department, 'expense_type_id', r.expense_type_id, 'expense_sub_type_id', r.expense_sub_type_id) AS tags,
    r.requested_by AS submitted_by,
    r.created_at AS submitted_at,
    NULL::bigint AS venue_id,
    fn_review_status_from_legacy(r.status, r.dept_approved_at) AS status,
    fn_review_priority(r.created_at,
        CASE
            WHEN r.req_type = 'expense'::text THEN r.expense_amount_paise
            ELSE NULL::integer
        END::bigint) AS priority,
    NULL::bigint[] AS venue_ids,
    NULL::bigint[] AS sub_venue_ids
   FROM requisitions r
  WHERE fn_review_status_from_legacy(r.status, r.dept_approved_at) = ANY (ARRAY['pending'::review_status_e, 'changes_requested'::review_status_e])
UNION ALL
 SELECT 'category'::review_domain_e AS domain,
    cat.id AS source_id,
    cat.name AS title,
    NULL::bigint AS amount_paise,
    NULL::text AS vendor_name,
    NULL::integer AS primary_tag,
    jsonb_build_object('table', 'categories') AS tags,
    cat.added_by AS submitted_by,
    cat.created_at AS submitted_at,
    NULL::bigint AS venue_id,
    fn_review_status_from_legacy(cat.status, NULL::timestamp with time zone) AS status,
    fn_review_priority(cat.created_at, NULL::bigint) AS priority,
    NULL::bigint[] AS venue_ids,
    NULL::bigint[] AS sub_venue_ids
   FROM categories cat
  WHERE fn_review_status_from_legacy(cat.status, NULL::timestamp with time zone) = 'pending'::review_status_e
UNION ALL
 SELECT 'sub_category'::review_domain_e AS domain,
    sc.id AS source_id,
    sc.name AS title,
    NULL::bigint AS amount_paise,
    NULL::text AS vendor_name,
    sc.category_id AS primary_tag,
    jsonb_build_object('table', 'sub_categories', 'category_id', sc.category_id) AS tags,
    sc.added_by AS submitted_by,
    sc.created_at AS submitted_at,
    NULL::bigint AS venue_id,
    fn_review_status_from_legacy(sc.status, NULL::timestamp with time zone) AS status,
    fn_review_priority(sc.created_at, NULL::bigint) AS priority,
    NULL::bigint[] AS venue_ids,
    NULL::bigint[] AS sub_venue_ids
   FROM sub_categories sc
  WHERE fn_review_status_from_legacy(sc.status, NULL::timestamp with time zone) = 'pending'::review_status_e;

NOTIFY pgrst, 'reload schema';
