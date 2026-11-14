-- fn_event_collections (00155) was built as a narrowly-scoped RLS bypass:
-- event_ledger_select only shows a row to its own creator (plus dept-
-- hierarchy reach), which meant a function with two collectors each only
-- saw their own collections. This RPC fixed that for entry_type =
-- 'collection' specifically.
--
-- It never covered entry_type = 'adjustment' -- the reversal row a
-- collection cancel writes (fn_wallet_collect_cancel, 00051; the Extra
-- Plates equivalent, 00088). That row is almost always created by WHOEVER
-- cancelled the collection (often an admin), not by the original collector
-- -- so under the same creator-only RLS, the person who actually collected
-- the money, viewing their own event's "Show financials" / Event Ledger
-- Transactions tab, never sees that their collection was cancelled, while
-- an admin (who bypasses this RLS on permission) does. Reported directly:
-- a normal user's event financials silently dropped a cancelled
-- collection's reversal line.
--
-- 'adjustment' in event_ledger is used for exactly this one thing -- a
-- collection (regular or Extra Plates) being cancelled -- never anything
-- else (grep confirms only 00051 and 00088 ever insert it), so widening
-- this RPC's filter to include it carries the same narrow risk profile
-- the original design called for: still nothing about expenses, cost
-- transfers, salary or profile visibility changes.
--
-- Adds entry_type and direction as new output columns (the client needs
-- both — direction drives the existing +/- colour, entry_type distinguishes
-- a collection row from the adjustment reversing it) since CREATE OR
-- REPLACE can't change a RETURNS TABLE column list in place.

DROP FUNCTION IF EXISTS public.fn_event_collections(bigint[]);

CREATE FUNCTION public.fn_event_collections(p_event_ids bigint[])
RETURNS TABLE (
  id bigint,
  event_id bigint,
  entry_type text,
  direction text,
  amount_paise bigint,
  payment_mode text,
  reference_type text,
  reference_id text,
  description text,
  created_at timestamptz,
  created_by uuid,
  creator_name text,
  wt_amount_paise bigint,
  wt_status text,
  wt_payment_mode text,
  wt_bank_payment_type text,
  wt_receipt_no text,
  wt_received_image_path text,
  wt_checked_by uuid,
  wt_checked_at timestamptz,
  wt_tally_entered_by uuid,
  wt_tally_entered_at timestamptz,
  performed_by uuid,
  collector_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    el.id, el.event_id, el.entry_type, el.direction, el.amount_paise, el.payment_mode, el.reference_type, el.reference_id, el.description, el.created_at, el.created_by,
    creator.name,
    wt.amount_paise, wt.status, wt.payment_mode, wt.bank_payment_type, wt.receipt_no, wt.received_image_path,
    wt.checked_by, wt.checked_at, wt.tally_entered_by, wt.tally_entered_at,
    wt.performed_by, performer.name
  FROM public.event_ledger el
  LEFT JOIN public.wallet_transactions wt ON wt.id::text = el.reference_id
  LEFT JOIN public.profiles creator ON creator.id = el.created_by
  LEFT JOIN public.profiles performer ON performer.id = wt.performed_by
  WHERE el.entry_type IN ('collection', 'adjustment')
    AND el.event_id = ANY(p_event_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_event_collections(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_event_collections(bigint[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
