-- v_item_purchase_history's expense-receipt branch only read matched_item_id
-- — set by the SUBMITTER at request time when they match to an item that
-- already exists. When they instead pick "new item" (matched_source: 'new',
-- matched_item_id: null), the RECEIVER's side of the flow later writes a
-- different field, resulting_item_id (via receive_expense_item or
-- link_expense_to_new_item) — which this view never looked at. Net effect:
-- any item resolved through the Receive Item queue without an existing
-- submitter match never showed up in the Inventory Ledger's purchase
-- history, regardless of whether it went through Match Existing or Create
-- New at receive time.
--
-- Also prefers qty_received (what the receiver actually confirmed) over the
-- original requested qty where the line has been received — the two can
-- differ (partial receipt) and the ledger should reflect what came in.
--
-- The purchase_order_items branch is untouched.

CREATE OR REPLACE VIEW public.v_item_purchase_history AS
 SELECT
        CASE
            WHEN poi._source = 'new'::text THEN COALESCE(poi.inventory_item_id, poi.cs_item_id)
            ELSE poi.item_id
        END AS item_id,
        CASE
            WHEN poi._source = 'catering_store'::text THEN 'catering_store'::text
            WHEN poi._source = 'inventory'::text THEN 'inventory'::text
            WHEN poi._source = 'new'::text AND poi.cs_item_id IS NOT NULL THEN 'catering_store'::text
            WHEN poi._source = 'new'::text AND poi.inventory_item_id IS NOT NULL THEN 'inventory'::text
            ELSE NULL::text
        END AS item_source,
    poi.vendor_name,
    poi.actual_qty AS qty,
    poi.unit,
    poi.vendor_rate_paise AS rate_paise,
    COALESCE(poi.actual_cost_paise, (poi.actual_qty * poi.vendor_rate_paise::numeric)::bigint) AS amount_paise,
    COALESCE(poi.purchased_at::date, poi.received_at::date) AS txn_date,
    'po'::text AS source_type,
    poi.id::text AS source_id,
    'PO #'::text || "substring"(poi.po_id::text, 1, 8) AS source_ref
   FROM purchase_order_items poi
  WHERE (poi.status = ANY (ARRAY['purchased'::text, 'received'::text])) AND ((poi._source = ANY (ARRAY['inventory'::text, 'catering_store'::text])) AND poi.item_id IS NOT NULL OR poi._source = 'new'::text AND (poi.inventory_item_id IS NOT NULL OR poi.cs_item_id IS NOT NULL))
UNION ALL
 SELECT COALESCE((ir.value ->> 'matched_item_id'::text)::bigint, (ir.value ->> 'resulting_item_id'::text)::bigint) AS item_id,
    ir.value ->> 'matched_source'::text AS item_source,
    e.vendor_name,
    COALESCE((ir.value ->> 'qty_received'::text)::numeric, (ir.value ->> 'qty'::text)::numeric) AS qty,
    ir.value ->> 'unit'::text AS unit,
    (ir.value ->> 'rate_paise'::text)::bigint AS rate_paise,
    CASE
        WHEN (ir.value ->> 'rate_paise'::text) IS NOT NULL
          THEN ROUND(COALESCE((ir.value ->> 'qty_received'::text)::numeric, (ir.value ->> 'qty'::text)::numeric) * (ir.value ->> 'rate_paise'::text)::numeric)::bigint
        ELSE (ir.value ->> 'line_total_paise'::text)::bigint
    END AS amount_paise,
    COALESCE(e.expense_date, e.created_at::date) AS txn_date,
    'expense'::text AS source_type,
    e.id::text AS source_id,
    'Exp #'::text || e.id::text AS source_ref
   FROM expenses e
     CROSS JOIN LATERAL jsonb_array_elements(e.metadata -> 'item_receipts'::text) ir(value)
  WHERE e.deleted_at IS NULL AND e.metadata ? 'item_receipts'::text AND jsonb_typeof(e.metadata -> 'item_receipts'::text) = 'array'::text
    AND COALESCE(ir.value ->> 'matched_item_id'::text, ir.value ->> 'resulting_item_id'::text) IS NOT NULL
    AND ((ir.value ->> 'matched_source'::text) = ANY (ARRAY['inventory'::text, 'catering_store'::text]));

NOTIFY pgrst, 'reload schema';
