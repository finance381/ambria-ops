-- Bug: reverse_ledger_entry only ever corrected the OTHER party's ledger
-- (vendor/employee) — it never undid the wallet debit pay_vendor/pay_employee
-- made against the person who actually paid. Confirmed live: ledger entry
-- #684 (vendor_payment, 30,000 pts cash, paid by 111c20c6-...) was reversed
-- as #776 on the vendor's ledger, but 111c20c6-...'s wallet was never
-- credited back — the money is just gone from their wallet with no trace.
--
-- Wallet-debit rules differ by ref_type (confirmed from the live function
-- bodies, not assumed):
--   - vendor_payment (pay_vendor): wallet_self_debit called unconditionally,
--     cash or bank.
--   - salary_payment (pay_employee): wallet debited only when
--     metadata->>'mode' = 'cash' — bank salary payouts never touch a wallet,
--     so reversing one must NOT manufacture a credit for it.
--   - vendor_deduction / salary_adjustment: never touch a wallet at all
--     (they adjust what's owed, not cash paid) — excluded entirely.
--
-- wallet_admin_credit already exists for crediting a wallet other than the
-- caller's own (caller here is the admin doing the reversal, not the
-- original payer) — reused as-is rather than duplicating its logic.

BEGIN;

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
     jsonb_build_object('kind','correction','reverses',v_orig.id))
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

-- One-time backfill for the single case this already happened to (confirmed
-- by querying every past 'correction' entry reversing a vendor_payment/
-- salary_payment — #684/#776 was the only one). Idempotent: skips if a
-- ledger_reversal wallet credit referencing correction #776 already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference_type = 'ledger_reversal' AND reference_id = '776'
  ) THEN
    PERFORM public.wallet_admin_credit(
      p_user_id      := '111c20c6-0a89-4503-84b1-98952031a5ec'::uuid,
      p_amount_paise := 3000000,
      p_description  := 'Reversal of #684: Wrong Entered (backfilled — reverse_ledger_entry did not credit wallets before this fix)',
      p_ref_type     := 'ledger_reversal',
      p_ref_id       := '776'
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
