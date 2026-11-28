-- v_vendor_ledger's per-mode columns (cash_balance_paise/bank_balance_paise)
-- only ever counted kind IN ('purchase','payment','deduction') -- a
-- kind='correction' entry (a manual reversal/adjustment of an earlier
-- mistaken entry, e.g. "Reversal of #2652: extra amt paid") fell through to
-- the ELSE 0 branch unconditionally, regardless of whether it had a mode
-- tag. The mode-agnostic balance_paise (a plain sum(credit-debit), no kind
-- filter) counted it fine, so the two columns silently drifted apart by
-- exactly the corrected amount.
--
-- Found via vendor #28 (Shivnath Bangali Vendor): balance_paise correctly
-- showed +938,600 (one real unpaid bill) but cash_balance_paise showed
-- -1,696,900, because correction #2876 (+2,635,500, reversing a mistaken
-- cash payment #2652) was invisible to the per-mode math. pay_vendor's own
-- deduction guard reads this same view, so the phantom negative balance
-- also wrongly blocked a legitimate deduction there.
--
-- Tagging #2876 mode='cash' alone (migration 00229) didn't fix it -- the
-- CASE didn't recognize kind='correction' as countable at all. This
-- migration does the other half: adds a correction-aware branch to each
-- per-mode CASE, keyed on the entry's own mode tag, same as purchase/
-- payment/deduction already are, using credit_paise - debit_paise directly
-- (corrections carry the real amount at full value, same as a payment --
-- no credit_portion_paise sub-split like a multi-mode bill has).
--
-- Every other correction-kind entry in the ledger (9 total, across 7
-- vendors) was missing the same mode tag -- backfilled here from whichever
-- entry each one's own metadata.reverses points at (confirmed unambiguous
-- for all 9: each reverses exactly one real entry with its own clean mode).
-- ledger_type/party_id are matched to the correction's own row as a belt-
-- and-braces guard (reverse_ledger_entry always copies both from the
-- original onto the correction it creates, so this should never actually
-- exclude a real match -- it only protects against a ledger_entries id ever
-- being reused across vendors/parties).
--
-- This is not a one-off data slip -- reverse_ledger_entry (00099) is the
-- ONLY place a 'correction' entry is ever created, and it writes metadata as
-- just {kind:'correction', reverses:<id>}, no mode, every time. Without
-- fixing the function itself, the next reversal anyone makes reopens this
-- exact gap. Redefined below with the same signature (no DROP needed --
-- same single overload) to carry the original entry's own mode forward,
-- the same way this backfill derives it. jsonb_strip_nulls so a reversal of
-- an entry that itself has no mode (if that's ever possible) still omits
-- the key entirely rather than writing an explicit JSON null that would
-- read differently from "key absent" everywhere else metadata->>'mode' is
-- checked.
BEGIN;

UPDATE public.ledger_entries c
SET metadata = c.metadata || jsonb_build_object('mode', orig.metadata->>'mode')
FROM public.ledger_entries orig
WHERE c.ledger_type = 'vendor'
  AND c.metadata->>'kind' = 'correction'
  AND c.metadata->>'mode' IS NULL
  AND c.deleted_at IS NULL
  AND orig.id = (c.metadata->>'reverses')::bigint
  AND orig.ledger_type = c.ledger_type
  AND orig.party_id = c.party_id
  AND orig.metadata->>'mode' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reverse_ledger_entry(p_entry_id bigint, p_reason text DEFAULT NULL::text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor  uuid := auth.uid();
  v_orig   public.ledger_entries%ROWTYPE;
  v_new_id bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'reverse_ledger_entry: not authenticated';
  END IF;

  IF NOT public.user_can('admin.dashboard') THEN
    RAISE EXCEPTION 'reverse_ledger_entry: admin permission required';
  END IF;

  SELECT * INTO v_orig FROM public.ledger_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_ledger_entry: entry % not found', p_entry_id;
  END IF;
  IF v_orig.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reverse_ledger_entry: entry % is soft-deleted', p_entry_id;
  END IF;

  INSERT INTO public.ledger_entries
    (ledger_type, party_id, entry_date, ref_type, ref_id, description,
     debit_paise, credit_paise, created_by, metadata)
  VALUES
    (v_orig.ledger_type, v_orig.party_id, CURRENT_DATE,
     'correction', gen_random_uuid()::text,
     'Reversal of #' || v_orig.id || COALESCE(': ' || p_reason, ''),
     v_orig.credit_paise, v_orig.debit_paise, v_actor,
     jsonb_build_object('kind','correction','reverses',v_orig.id)
       || jsonb_strip_nulls(jsonb_build_object('mode', v_orig.metadata->>'mode')))
  RETURNING id INTO v_new_id;

  IF v_orig.debit_paise > 0 AND v_orig.created_by IS NOT NULL AND (
       v_orig.ref_type = 'vendor_payment'
       OR (v_orig.ref_type = 'salary_payment' AND v_orig.metadata->>'mode' = 'cash')
     ) THEN
    PERFORM public.wallet_admin_credit(
      p_user_id      := v_orig.created_by,
      p_amount_paise := v_orig.debit_paise,
      p_description  := 'Reversal of #' || v_orig.id || COALESCE(': ' || p_reason, ''),
      p_ref_type     := 'ledger_reversal',
      p_ref_id       := v_new_id::text
    );
  END IF;

  RETURN v_new_id;
END;
$function$;

CREATE OR REPLACE VIEW public.v_vendor_ledger AS
 SELECT v.id AS vendor_id,
    v.name AS vendor_name,
    v.status AS vendor_status,
    v.active AS vendor_active,
    COALESCE(sum(le.credit_paise - le.debit_paise), 0::numeric)::bigint AS balance_paise,
    COALESCE(sum(
        CASE
            WHEN (le.metadata ->> 'kind'::text) = 'purchase'::text AND (le.metadata ->> 'mode'::text) = 'cash'::text THEN COALESCE((le.metadata ->> 'credit_portion_paise'::text)::bigint, 0::bigint)
            WHEN ((le.metadata ->> 'kind'::text) = ANY (ARRAY['payment'::text, 'deduction'::text])) AND (le.metadata ->> 'mode'::text) = 'cash'::text THEN - le.debit_paise
            WHEN (le.metadata ->> 'kind'::text) = 'correction'::text AND (le.metadata ->> 'mode'::text) = 'cash'::text THEN (le.credit_paise - le.debit_paise)
            ELSE 0::bigint
        END), 0::numeric)::bigint AS cash_balance_paise,
    COALESCE(sum(
        CASE
            WHEN (le.metadata ->> 'kind'::text) = 'purchase'::text AND (le.metadata ->> 'mode'::text) = 'bank'::text THEN COALESCE((le.metadata ->> 'credit_portion_paise'::text)::bigint, 0::bigint)
            WHEN ((le.metadata ->> 'kind'::text) = ANY (ARRAY['payment'::text, 'deduction'::text])) AND (le.metadata ->> 'mode'::text) = 'bank'::text THEN - le.debit_paise
            WHEN (le.metadata ->> 'kind'::text) = 'correction'::text AND (le.metadata ->> 'mode'::text) = 'bank'::text THEN (le.credit_paise - le.debit_paise)
            ELSE 0::bigint
        END), 0::numeric)::bigint AS bank_balance_paise,
    min(
        CASE
            WHEN (le.metadata ->> 'kind'::text) = 'purchase'::text AND (le.metadata ->> 'due_date'::text) IS NOT NULL AND (le.metadata ->> 'due_date'::text) <> ''::text THEN (le.metadata ->> 'due_date'::text)::date
            ELSE NULL::date
        END) AS earliest_due_date,
    count(*) FILTER (WHERE (le.metadata ->> 'kind'::text) = 'purchase'::text AND (le.metadata ->> 'due_date'::text) IS NOT NULL AND (le.metadata ->> 'due_date'::text) <> ''::text AND ((le.metadata ->> 'due_date'::text)::date) < CURRENT_DATE)::integer AS overdue_count,
    count(le.id) FILTER (WHERE le.deleted_at IS NULL) AS entry_count,
    max(le.entry_date) FILTER (WHERE le.deleted_at IS NULL) AS last_entry_date
   FROM vendors v
     LEFT JOIN ledger_entries le ON le.ledger_type = 'vendor'::text AND le.party_id = v.id AND le.deleted_at IS NULL
  GROUP BY v.id, v.name, v.status, v.active;

COMMIT;

NOTIFY pgrst, 'reload schema';
