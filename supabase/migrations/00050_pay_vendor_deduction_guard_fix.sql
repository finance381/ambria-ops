-- pay_vendor's deduction-cap check ran even when there was no deduction at
-- all (p_deduction_paise = 0). Once a vendor carries an advance, the mode
-- balance goes negative (e.g. -1,000,000 paise), and 0 > -1,000,000 is true —
-- so every advance payment to that vendor failed with "deduction (0) exceeds
-- cash outstanding (-1000000)" even though nothing was being deducted.
-- Only cap the check when an actual deduction was requested.

BEGIN;

CREATE OR REPLACE FUNCTION public.pay_vendor(p_vendor_id bigint, p_amount_paise bigint, p_description text DEFAULT NULL::text, p_entry_date date DEFAULT CURRENT_DATE, p_mode text DEFAULT NULL::text, p_deduction_paise bigint DEFAULT 0, p_deduction_reason text DEFAULT NULL::text, p_image_paths text[] DEFAULT NULL::text[], p_deduction_image_path text DEFAULT NULL::text, p_source_expense_id bigint DEFAULT NULL::bigint, p_payment_type text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor         uuid   := auth.uid();
  v_ref_id        text   := gen_random_uuid()::text;
  v_ledger_id     bigint;
  v_dedn_id       bigint;
  v_vendor_name   text;
  v_mode_balance  bigint;
  v_path          text;
  v_prefix        text;
  v_dedn_meta     jsonb;
  v_pay_meta      jsonb;
  v_alloc         record;
  v_alloc_total   bigint;
  v_alloc_count   integer;
  v_alloc_seen    integer := 0;
  v_share_paise   bigint;
  v_share_sum     bigint := 0;
  v_fallback_type bigint;
  v_fallback_sub  bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'pay_vendor: not authenticated';
  END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'pay_vendor: amount must be positive';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('cash','bank') THEN
    RAISE EXCEPTION 'pay_vendor: mode must be cash or bank';
  END IF;
  IF p_payment_type IS NOT NULL AND p_payment_type NOT IN ('fnf','advance') THEN
    RAISE EXCEPTION 'pay_vendor: payment_type must be fnf or advance';
  END IF;
  IF COALESCE(p_deduction_paise, 0) < 0 THEN
    RAISE EXCEPTION 'pay_vendor: deduction cannot be negative';
  END IF;
  IF COALESCE(p_deduction_paise, 0) > 0
     AND (p_deduction_reason IS NULL OR btrim(p_deduction_reason) = '') THEN
    RAISE EXCEPTION 'pay_vendor: deduction requires a reason';
  END IF;

  v_prefix := v_actor::text || '/';

  IF p_image_paths IS NULL OR array_length(p_image_paths, 1) IS NULL THEN
    RAISE EXCEPTION 'pay_vendor: at least one payment proof image is required';
  END IF;
  FOREACH v_path IN ARRAY p_image_paths LOOP
    IF v_path IS NULL OR btrim(v_path) = '' THEN
      RAISE EXCEPTION 'pay_vendor: image path cannot be empty';
    END IF;
    IF position(v_prefix in v_path) <> 1 THEN
      RAISE EXCEPTION 'pay_vendor: image path % must start with %', v_path, v_prefix;
    END IF;
  END LOOP;

  IF p_deduction_image_path IS NOT NULL THEN
    IF btrim(p_deduction_image_path) = '' THEN
      RAISE EXCEPTION 'pay_vendor: deduction image path cannot be empty';
    END IF;
    IF COALESCE(p_deduction_paise, 0) = 0 THEN
      RAISE EXCEPTION 'pay_vendor: deduction image supplied without a deduction';
    END IF;
    IF position(v_prefix in p_deduction_image_path) <> 1 THEN
      RAISE EXCEPTION 'pay_vendor: deduction image path % must start with %',
        p_deduction_image_path, v_prefix;
    END IF;
  END IF;

  SELECT name INTO v_vendor_name
  FROM public.vendors WHERE id = p_vendor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_vendor: vendor % not found', p_vendor_id;
  END IF;

  SELECT CASE p_mode
           WHEN 'cash' THEN cash_balance_paise
           WHEN 'bank' THEN bank_balance_paise
         END
    INTO v_mode_balance
  FROM public.v_vendor_ledger
  WHERE vendor_id = p_vendor_id;

  -- Only the deduction (a credit against an actual bill) is capped by what's
  -- billed and outstanding. The payment itself may exceed it — that's an
  -- advance, and it's expected to leave the mode balance negative until
  -- future bills consume it. Skip the cap entirely when there's no
  -- deduction, so an advance against an already-negative balance doesn't
  -- trip a check that only makes sense once something is actually deducted.
  IF COALESCE(p_deduction_paise, 0) > 0
     AND p_deduction_paise > COALESCE(v_mode_balance, 0) THEN
    RAISE EXCEPTION 'pay_vendor: deduction (%) exceeds % outstanding (%)',
      p_deduction_paise,
      p_mode,
      COALESCE(v_mode_balance, 0);
  END IF;

  PERFORM public.wallet_self_debit(
    p_amount_paise := p_amount_paise,
    p_description  := COALESCE(p_description, 'Payment to ' || v_vendor_name),
    p_ref_type     := 'vendor_payment',
    p_ref_id       := v_ref_id
  );

  v_pay_meta := jsonb_build_object(
    'kind','payment',
    'mode',p_mode,
    'payment_images', to_jsonb(p_image_paths)
  );
  IF p_payment_type IS NOT NULL THEN
    v_pay_meta := v_pay_meta || jsonb_build_object('payment_type', p_payment_type);
  END IF;

  INSERT INTO public.ledger_entries
    (ledger_type, party_id, entry_date, ref_type, ref_id, description,
     debit_paise, credit_paise, created_by, metadata)
  VALUES
    ('vendor', p_vendor_id, p_entry_date, 'vendor_payment', v_ref_id,
     COALESCE(p_description, 'Payment to vendor'),
     p_amount_paise, 0, v_actor,
     v_pay_meta)
  RETURNING id INTO v_ledger_id;

  IF COALESCE(p_deduction_paise, 0) > 0 THEN
    v_dedn_meta := jsonb_build_object(
      'kind','deduction',
      'mode',p_mode,
      'reason',btrim(p_deduction_reason),
      'linked_payment_id',v_ledger_id
    );
    IF p_deduction_image_path IS NOT NULL THEN
      v_dedn_meta := v_dedn_meta || jsonb_build_object('deduction_image', p_deduction_image_path);
    END IF;

    INSERT INTO public.ledger_entries
      (ledger_type, party_id, entry_date, ref_type, ref_id, description,
       debit_paise, credit_paise, created_by, metadata)
    VALUES
      ('vendor', p_vendor_id, p_entry_date, 'vendor_deduction', v_ref_id,
       'Deduction: ' || btrim(p_deduction_reason),
       p_deduction_paise, 0, v_actor,
       v_dedn_meta)
    RETURNING id INTO v_dedn_id;

    IF p_source_expense_id IS NOT NULL THEN
      SELECT COALESCE(SUM(ea.amount_paise), 0), COUNT(*)
        INTO v_alloc_total, v_alloc_count
      FROM public.expense_allocations ea
      WHERE ea.expense_id = p_source_expense_id;

      IF v_alloc_count = 0 OR v_alloc_total <= 0 THEN
        SELECT e.expense_type_id, e.expense_sub_type_id
          INTO v_fallback_type, v_fallback_sub
        FROM public.expenses e WHERE e.id = p_source_expense_id;

        INSERT INTO public.cost_transfers (
          amount_paise, from_party_type, from_expense_type_id, from_expense_sub_type_id,
          to_party_type, to_vendor_id, description, reason_note, effective_date, created_by, metadata
        ) VALUES (
          p_deduction_paise, 'expense', v_fallback_type, v_fallback_sub,
          'vendor', p_vendor_id,
          'Vendor deduction credit: ' || btrim(p_deduction_reason),
          p_deduction_reason, p_entry_date, v_actor,
          jsonb_build_object('source', 'vendor_deduction', 'vendor_deduction_ledger_id', v_dedn_id, 'source_expense_id', p_source_expense_id)
        );
      ELSE
        FOR v_alloc IN
          SELECT COALESCE(ea.expense_type_id, e.expense_type_id) AS expense_type_id,
                 COALESCE(ea.expense_sub_type_id, e.expense_sub_type_id) AS expense_sub_type_id,
                 ea.amount_paise
          FROM public.expense_allocations ea
          JOIN public.expenses e ON e.id = ea.expense_id
          WHERE ea.expense_id = p_source_expense_id
          ORDER BY ea.id
        LOOP
          v_alloc_seen := v_alloc_seen + 1;
          IF v_alloc_seen = v_alloc_count THEN
            v_share_paise := p_deduction_paise - v_share_sum;
          ELSE
            v_share_paise := ROUND(p_deduction_paise::numeric * v_alloc.amount_paise / v_alloc_total);
            v_share_sum := v_share_sum + v_share_paise;
          END IF;
          IF v_share_paise <> 0 THEN
            INSERT INTO public.cost_transfers (
              amount_paise, from_party_type, from_expense_type_id, from_expense_sub_type_id,
              to_party_type, to_vendor_id, description, reason_note, effective_date, created_by, metadata
            ) VALUES (
              v_share_paise, 'expense', v_alloc.expense_type_id, v_alloc.expense_sub_type_id,
              'vendor', p_vendor_id,
              'Vendor deduction credit: ' || btrim(p_deduction_reason),
              p_deduction_reason, p_entry_date, v_actor,
              jsonb_build_object('source', 'vendor_deduction', 'vendor_deduction_ledger_id', v_dedn_id, 'source_expense_id', p_source_expense_id)
            );
          END IF;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN v_ledger_id;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
