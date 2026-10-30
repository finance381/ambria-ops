-- Collections (event_ledger.entry_type = 'collection') are currently
-- restricted by event_ledger_select's RLS policy to the row's own creator
-- (plus finance_hr / fn_can_view_user's dept-hierarchy reach) -- so for a
-- function where Sales X and Sales Y both collected twice, Sales X only
-- ever sees their own 2 entries, not all 4, in both WalletManager's
-- collection-history panel and the Event Ledger embedded in the Events tab's
-- "Show financials" block (ContractList.jsx). The ask: any logged-in user
-- should be able to see every collection against a function -- who collected
-- what, when -- read-only.
--
-- Deliberately NOT done by widening event_ledger_select / wt_select /
-- profiles_select directly: those three policies gate every other ledger
-- entry type (expenses, cost transfers, salary, etc.) and most of the app's
-- profile-visibility model. Loosening them to fix collections would also
-- expose all those other entry types and every user's profile row to
-- everyone, which isn't what was asked. Instead, this is a single narrowly
-- scoped SECURITY DEFINER function -- same pattern as calculate_quote_v2 /
-- fn_create_tentative_event -- that only ever returns entry_type =
-- 'collection' rows, pre-joined to the wallet_transactions and profiles
-- detail the UI already shows (collector name, receipt, mode, checked
-- status). It changes nothing about who can see expenses, cost transfers,
-- or any other profile data; it has no write path at all.

CREATE OR REPLACE FUNCTION public.fn_event_collections(p_event_ids bigint[])
RETURNS TABLE (
  id bigint,
  event_id bigint,
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
    el.id, el.event_id, el.amount_paise, el.payment_mode, el.reference_type, el.reference_id, el.description, el.created_at, el.created_by,
    creator.name,
    wt.amount_paise, wt.status, wt.payment_mode, wt.bank_payment_type, wt.receipt_no, wt.received_image_path,
    wt.checked_by, wt.checked_at, wt.tally_entered_by, wt.tally_entered_at,
    wt.performed_by, performer.name
  FROM public.event_ledger el
  LEFT JOIN public.wallet_transactions wt ON wt.id::text = el.reference_id
  LEFT JOIN public.profiles creator ON creator.id = el.created_by
  LEFT JOIN public.profiles performer ON performer.id = wt.performed_by
  WHERE el.entry_type = 'collection'
    AND el.event_id = ANY(p_event_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_event_collections(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_event_collections(bigint[]) TO authenticated;
