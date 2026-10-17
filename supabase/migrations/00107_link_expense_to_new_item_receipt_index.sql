-- ItemReceipts.jsx's "Create New" flow calls link_expense_to_new_item with
-- p_expense_id, p_receipt_index, p_new_item_id, p_source — but the live
-- function only ever had (p_expense_id, p_new_item_id, p_source): no
-- p_receipt_index. PostgREST matches an RPC call by its exact set of named
-- arguments, so a call naming a 4th argument the function doesn't declare
-- finds no match at all ("Could not find the function ... in the schema
-- cache") — the same family of bug as 00079/00102/00103, just missing a
-- param instead of carrying an extra one.
--
-- receive_expense_item (the sibling the "Match Existing" flow calls, and
-- which does work) was extended the same way at some point — it has two
-- live overloads: an old 4-arg one with no p_receipt_index that still
-- assumes a single, non-array item_receipt, and the current 5-arg one that
-- is receipt_index/array-aware (expenses.metadata->'item_receipts' as a
-- jsonb array, one element per requisition line; a lone legacy expense
-- still keyed under metadata->'item_receipt' singular). This rebuilds
-- link_expense_to_new_item on that same array-aware shape, since that's
-- the one actually in use.
--
-- It does NOT touch inventory_items.qty / catering_store_items.qty: unlike
-- receive_expense_item, which is receiving against an item that already
-- existed, this path's item was *just created* by InventoryForm with its
-- own opening qty and venue allocations already saved — adding p_qty again
-- here would double-count stock that was never passed in anyway (the
-- client's call carries no p_qty at all).

BEGIN;

DROP FUNCTION IF EXISTS public.link_expense_to_new_item(bigint, bigint, text);

CREATE OR REPLACE FUNCTION public.link_expense_to_new_item(
  p_expense_id bigint,
  p_receipt_index integer,
  p_new_item_id bigint,
  p_source text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta      jsonb;
  v_has_array boolean;
  v_item      jsonb;
  v_patch     jsonb;
  v_all_done  boolean;
BEGIN
  IF NOT public.is_receiver() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_source NOT IN ('inventory', 'catering_store') THEN
    RAISE EXCEPTION 'Invalid source: %', p_source;
  END IF;

  IF p_source = 'catering_store' THEN
    PERFORM 1 FROM public.catering_store_items WHERE id = p_new_item_id;
  ELSE
    PERFORM 1 FROM public.inventory_items WHERE id = p_new_item_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION '% % not found', p_source, p_new_item_id; END IF;

  SELECT metadata INTO v_meta FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense % not found', p_expense_id; END IF;

  v_has_array := jsonb_typeof(v_meta->'item_receipts') = 'array';

  IF v_has_array THEN
    v_item := v_meta->'item_receipts'->p_receipt_index;
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'No item at index % in item_receipts', p_receipt_index;
    END IF;
    IF (v_item->>'resulting_item_id') IS NOT NULL OR (v_item->>'cancel_reason') IS NOT NULL THEN
      RAISE EXCEPTION 'Item at index % already resolved', p_receipt_index;
    END IF;

    v_patch := jsonb_build_object(
      'resulting_item_id', p_new_item_id::text,
      'matched_source',    p_source,
      'qty_received',      v_item->'qty',
      'created_new_item',  true,
      'received_by',       auth.uid()::text,
      'received_at',       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

    v_meta := jsonb_set(
      v_meta,
      ARRAY['item_receipts', p_receipt_index::text],
      v_item || v_patch
    );

    SELECT bool_and(
      (el->>'resulting_item_id') IS NOT NULL OR (el->>'cancel_reason') IS NOT NULL
    ) INTO v_all_done
    FROM jsonb_array_elements(v_meta->'item_receipts') AS el;

    UPDATE public.expenses SET
      metadata            = v_meta,
      item_receipt_status = CASE WHEN v_all_done THEN 'received' ELSE 'pending' END
    WHERE id = p_expense_id;
  ELSE
    IF p_receipt_index <> 0 THEN
      RAISE EXCEPTION 'Legacy singular receipt only accepts index 0 (got %)', p_receipt_index;
    END IF;
    v_item := v_meta->'item_receipt';
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'No item_receipt on expense %', p_expense_id;
    END IF;

    v_patch := jsonb_build_object(
      'resulting_item_id', p_new_item_id::text,
      'matched_source',    p_source,
      'qty_received',      v_item->'qty',
      'created_new_item',  true,
      'received_by',       auth.uid()::text,
      'received_at',       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

    UPDATE public.expenses SET
      metadata            = jsonb_set(v_meta, ARRAY['item_receipt'], v_item || v_patch),
      item_receipt_status = 'received'
    WHERE id = p_expense_id;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify only one overload remains, with the 4-arg signature the client calls
SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'link_expense_to_new_item';
