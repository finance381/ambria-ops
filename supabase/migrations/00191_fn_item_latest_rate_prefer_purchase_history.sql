-- fn_item_latest_rate (00073) fed Store Requisition's rate auto-fill from
-- whichever of v_item_purchase_history (actual PO/expense receipts -- the
-- same data Inventory Ledger's "Last purchase rate" is built from) OR
-- stock_batches (every stock lot ever recorded, including opening/audit
-- batches that carry a cost-basis rate but were never an actual purchase)
-- had the more recent date. Since stock_batches isn't in
-- v_item_purchase_history at all, any stock_batches row dated after the
-- item's real last purchase silently won that race -- Store Requisition's
-- pre-filled rate then matched neither Inventory's item record nor
-- Inventory Ledger's own "Last purchase rate" for that item.
--
-- Now: an actual purchase, if one exists at all, always wins -- same answer
-- as Inventory Ledger's "Last purchase rate". stock_batches is only
-- consulted as a fallback for an item that has never actually been
-- purchased (e.g. freshly entered into Inventory with just an opening
-- batch), same case this fallback was originally meant for.

CREATE OR REPLACE FUNCTION public.fn_item_latest_rate(p_item_id bigint, p_item_source text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT rate_paise
     FROM public.v_item_purchase_history
     WHERE item_id = p_item_id AND item_source = p_item_source AND rate_paise IS NOT NULL
     ORDER BY txn_date DESC NULLS LAST, source_id DESC
     LIMIT 1),
    (SELECT rate_paise
     FROM public.stock_batches
     WHERE item_id = p_item_id AND item_source = p_item_source AND rate_paise IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1)
  )
$$;

NOTIFY pgrst, 'reload schema';
