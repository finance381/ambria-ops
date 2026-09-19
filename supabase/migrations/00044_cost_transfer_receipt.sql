-- Cost Transfers had no proof/receipt attachment at all. Adds one optional
-- slot (image, PDF, or voice note — same three input methods as the expense
-- form: capture, upload, or record) to both the create and edit RPCs.

ALTER TABLE public.cost_transfers
  ADD COLUMN IF NOT EXISTS receipt_path text;

CREATE OR REPLACE FUNCTION public.fn_create_cost_transfer(p_amount_paise bigint, p_from_party_type text, p_from_expense_type_id integer DEFAULT NULL::integer, p_from_expense_sub_type_id integer DEFAULT NULL::integer, p_from_event_id bigint DEFAULT NULL::bigint, p_from_vendor_id integer DEFAULT NULL::integer, p_from_employee_id uuid DEFAULT NULL::uuid, p_to_party_type text DEFAULT NULL::text, p_to_expense_type_id integer DEFAULT NULL::integer, p_to_expense_sub_type_id integer DEFAULT NULL::integer, p_to_event_id bigint DEFAULT NULL::bigint, p_to_vendor_id integer DEFAULT NULL::integer, p_to_employee_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_reason_note text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date, p_from_meta jsonb DEFAULT '{}'::jsonb, p_to_meta jsonb DEFAULT '{}'::jsonb, p_batch_id uuid DEFAULT NULL::uuid, p_receipt_path text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;

  IF NOT public.user_can('finance.cost_transfers') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'amount must be positive' USING errcode = '22000'; END IF;
  IF p_description IS NULL OR trim(p_description) = '' THEN RAISE EXCEPTION 'description required' USING errcode = '22000'; END IF;
  IF p_from_party_type IS NULL OR p_to_party_type IS NULL THEN RAISE EXCEPTION 'from/to party type required' USING errcode = '22000'; END IF;

  INSERT INTO public.cost_transfers (
    amount_paise,
    from_party_type, from_expense_type_id, from_expense_sub_type_id, from_event_id, from_vendor_id, from_employee_id,
    to_party_type,   to_expense_type_id,   to_expense_sub_type_id,   to_event_id,   to_vendor_id,   to_employee_id,
    description, reason_note, effective_date, created_by,
    metadata, batch_id, receipt_path
  ) VALUES (
    p_amount_paise,
    p_from_party_type, p_from_expense_type_id, p_from_expense_sub_type_id, p_from_event_id, p_from_vendor_id, p_from_employee_id,
    p_to_party_type,   p_to_expense_type_id,   p_to_expense_sub_type_id,   p_to_event_id,   p_to_vendor_id,   p_to_employee_id,
    p_description, p_reason_note, COALESCE(p_effective_date, CURRENT_DATE), v_uid,
    jsonb_build_object('from_meta', COALESCE(p_from_meta, '{}'::jsonb), 'to_meta', COALESCE(p_to_meta, '{}'::jsonb)),
    COALESCE(p_batch_id, gen_random_uuid()), p_receipt_path
  ) RETURNING id INTO v_id;

  PERFORM public._post_cost_transfer_ledgers(v_id);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_edit_cost_transfer(
  p_id bigint,
  p_amount_paise bigint,
  p_from_expense_type_id integer,
  p_from_expense_sub_type_id integer,
  p_to_expense_type_id integer,
  p_to_expense_sub_type_id integer,
  p_description text,
  p_reason_note text DEFAULT NULL::text,
  p_effective_date date DEFAULT NULL::date,
  p_receipt_path text DEFAULT NULL::text,
  p_remove_receipt boolean DEFAULT false
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.cost_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;

  IF NOT public.user_can('finance.cost_transfers') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_row FROM public.cost_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found' USING errcode = 'P0002'; END IF;
  IF v_row.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'cannot edit a reversal entry' USING errcode = '22000'; END IF;
  IF v_row.reversed_by_id IS NOT NULL THEN RAISE EXCEPTION 'cannot edit a reversed transfer' USING errcode = '22000'; END IF;
  IF v_row.from_party_type <> 'expense' OR v_row.to_party_type <> 'expense' THEN
    RAISE EXCEPTION 'only expense-to-expense transfers can be edited' USING errcode = '22000';
  END IF;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'amount must be positive' USING errcode = '22000'; END IF;
  IF p_description IS NULL OR trim(p_description) = '' THEN RAISE EXCEPTION 'description required' USING errcode = '22000'; END IF;
  IF p_from_expense_type_id IS NULL OR p_to_expense_type_id IS NULL THEN RAISE EXCEPTION 'from/to expense type required' USING errcode = '22000'; END IF;
  IF p_from_expense_type_id = p_to_expense_type_id AND COALESCE(p_from_expense_sub_type_id, -1) = COALESCE(p_to_expense_sub_type_id, -1) THEN
    RAISE EXCEPTION 'to cannot be the same as from' USING errcode = '22000';
  END IF;

  INSERT INTO public.cost_transfer_edits (cost_transfer_id, edited_by, before, after, reason)
  VALUES (
    p_id, v_uid,
    jsonb_build_object(
      'amount_paise', v_row.amount_paise,
      'from_expense_type_id', v_row.from_expense_type_id, 'from_expense_sub_type_id', v_row.from_expense_sub_type_id,
      'to_expense_type_id', v_row.to_expense_type_id, 'to_expense_sub_type_id', v_row.to_expense_sub_type_id,
      'description', v_row.description, 'reason_note', v_row.reason_note, 'effective_date', v_row.effective_date,
      'receipt_path', v_row.receipt_path
    ),
    jsonb_build_object(
      'amount_paise', p_amount_paise,
      'from_expense_type_id', p_from_expense_type_id, 'from_expense_sub_type_id', p_from_expense_sub_type_id,
      'to_expense_type_id', p_to_expense_type_id, 'to_expense_sub_type_id', p_to_expense_sub_type_id,
      'description', p_description, 'reason_note', p_reason_note, 'effective_date', COALESCE(p_effective_date, v_row.effective_date),
      'receipt_path', CASE WHEN p_remove_receipt THEN NULL WHEN p_receipt_path IS NOT NULL THEN p_receipt_path ELSE v_row.receipt_path END
    ),
    p_reason_note
  );

  UPDATE public.cost_transfers SET
    amount_paise = p_amount_paise,
    from_expense_type_id = p_from_expense_type_id,
    from_expense_sub_type_id = p_from_expense_sub_type_id,
    to_expense_type_id = p_to_expense_type_id,
    to_expense_sub_type_id = p_to_expense_sub_type_id,
    description = p_description,
    reason_note = COALESCE(p_reason_note, v_row.reason_note),
    effective_date = COALESCE(p_effective_date, v_row.effective_date),
    receipt_path = CASE WHEN p_remove_receipt THEN NULL WHEN p_receipt_path IS NOT NULL THEN p_receipt_path ELSE v_row.receipt_path END,
    edited_at = now(),
    edited_by = v_uid
  WHERE id = p_id;

  RETURN p_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
