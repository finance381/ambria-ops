-- Cost Transfers never showed the function tag, Vehicle No., Vendor Name, or
-- any other dynamic expense-type field anywhere -- not in the list, not in
-- the desktop table, not in Edit -- despite fn_create_cost_transfer already
-- capturing and storing all of it. Root cause: the table only ever had a
-- single `metadata` jsonb column holding {from_meta, to_meta}, but
-- CostTransfers.jsx's partyMeta() read row.from_meta / row.to_meta as if
-- they were their own top-level columns, which select('*') never returns --
-- those fields were always undefined, so the lookup silently fell back to
-- an empty object every time, for every transfer, since the column existed.
--
-- fn_edit_cost_transfer compounds the same gap on the write side: it has no
-- p_from_meta/p_to_meta parameters at all, so even once the frontend reads
-- metadata correctly, an edit has nothing to carry a meta change back with
-- -- changing Vehicle No. or Vendor Name in Edit would be silently dropped
-- on save, and the event tag would be wiped the moment any edit touched the
-- row (nothing in the UPDATE preserves it either way).
--
-- Both are nullable: NULL means "leave this side's meta as it was",
-- matching p_reason_note/p_effective_date's own COALESCE-to-existing
-- pattern just above them, so a caller that only means to change the amount
-- or description (the only caller today) keeps behaving exactly as before.

-- CREATE OR REPLACE only replaces a function with the exact same argument
-- list -- a different one (this adds two trailing params) creates a second,
-- separate overload instead. 00044's 11-arg version never dropped 00036's
-- 9-arg one either, so without these the live database would end up with
-- three overloads of the same name: any caller that still sends the old 11
-- (or 9) positional arguments would match more than one and fail with
-- "function is not unique", and those stale copies would never persist
-- metadata since they don't know the parameter exists.
DROP FUNCTION IF EXISTS public.fn_edit_cost_transfer(bigint, bigint, integer, integer, integer, integer, text, text, date, text, boolean);
DROP FUNCTION IF EXISTS public.fn_edit_cost_transfer(bigint, bigint, integer, integer, integer, integer, text, text, date);

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
  p_remove_receipt boolean DEFAULT false,
  p_from_meta jsonb DEFAULT NULL::jsonb,
  p_to_meta jsonb DEFAULT NULL::jsonb
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.cost_transfers%ROWTYPE;
  v_new_metadata jsonb;
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

  v_new_metadata := jsonb_build_object(
    'from_meta', COALESCE(p_from_meta, v_row.metadata->'from_meta', '{}'::jsonb),
    'to_meta',   COALESCE(p_to_meta,   v_row.metadata->'to_meta',   '{}'::jsonb)
  );

  INSERT INTO public.cost_transfer_edits (cost_transfer_id, edited_by, before, after, reason)
  VALUES (
    p_id, v_uid,
    jsonb_build_object(
      'amount_paise', v_row.amount_paise,
      'from_expense_type_id', v_row.from_expense_type_id, 'from_expense_sub_type_id', v_row.from_expense_sub_type_id,
      'to_expense_type_id', v_row.to_expense_type_id, 'to_expense_sub_type_id', v_row.to_expense_sub_type_id,
      'description', v_row.description, 'reason_note', v_row.reason_note, 'effective_date', v_row.effective_date,
      'receipt_path', v_row.receipt_path, 'metadata', v_row.metadata
    ),
    jsonb_build_object(
      'amount_paise', p_amount_paise,
      'from_expense_type_id', p_from_expense_type_id, 'from_expense_sub_type_id', p_from_expense_sub_type_id,
      'to_expense_type_id', p_to_expense_type_id, 'to_expense_sub_type_id', p_to_expense_sub_type_id,
      'description', p_description, 'reason_note', p_reason_note, 'effective_date', COALESCE(p_effective_date, v_row.effective_date),
      'receipt_path', CASE WHEN p_remove_receipt THEN NULL WHEN p_receipt_path IS NOT NULL THEN p_receipt_path ELSE v_row.receipt_path END,
      'metadata', v_new_metadata
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
    metadata = v_new_metadata,
    edited_at = now(),
    edited_by = v_uid
  WHERE id = p_id;

  RETURN p_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
