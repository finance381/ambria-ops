-- fn_merge_vendors (00048) never checked whether the TARGET it's merging
-- into is itself active and not already merged away. The UI only ever
-- offers active vendors as merge candidates, but that list is loaded once
-- per page visit (Vendors.jsx's allVendorsRaw, VendorLedger.jsx's own
-- vendors state) -- if someone else deactivates or merges that same vendor
-- in between, picking it as the target here would silently move every
-- ledger entry, FK reference and expense reference onto a now-retired
-- vendor, dropping them out of every list that filters on active=true.
-- Source vendors already skip past a missing row (FOR UPDATE + NOT FOUND);
-- this adds the same skip for a source that's already inactive or already
-- merged elsewhere, so re-running a merge that partly failed can't double
-- up the union/opening-balance step on an already-retired source.

CREATE OR REPLACE FUNCTION public.fn_merge_vendors(p_source_ids integer[], p_target_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_target vendors%ROWTYPE;
  v_source vendors%ROWTYPE;
  v_source_id integer;
  v_sub record;
  v_field jsonb;
  v_key text;
  v_n integer;
  v_ledger_moved integer := 0;
  v_expenses_moved integer := 0;
  v_fk_moved integer := 0;
BEGIN
  IF NOT user_can('procurement.vendors') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT * INTO v_target FROM vendors WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target vendor not found'; END IF;
  IF NOT v_target.active OR v_target.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'target vendor is inactive or already merged into another vendor';
  END IF;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    IF v_source_id = p_target_id THEN CONTINUE; END IF;
    SELECT * INTO v_source FROM vendors WHERE id = v_source_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT v_source.active OR v_source.merged_into_id IS NOT NULL THEN CONTINUE; END IF;

    UPDATE manpower_assignments SET vendor_id = p_target_id WHERE vendor_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_fk_moved := v_fk_moved + v_n;
    UPDATE cost_transfers SET from_vendor_id = p_target_id WHERE from_vendor_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_fk_moved := v_fk_moved + v_n;
    UPDATE cost_transfers SET to_vendor_id = p_target_id WHERE to_vendor_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_fk_moved := v_fk_moved + v_n;
    UPDATE project_vendors SET vendor_id = p_target_id WHERE vendor_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_fk_moved := v_fk_moved + v_n;
    UPDATE project_ledger SET vendor_id = p_target_id WHERE vendor_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_fk_moved := v_fk_moved + v_n;

    -- Vendor ledger: party_id is polymorphic (also holds profiles.id for
    -- ledger_type='user_salary'), so there's no real FK to lean on here.
    UPDATE ledger_entries SET party_id = p_target_id WHERE ledger_type = 'vendor' AND party_id = v_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_ledger_moved := v_ledger_moved + v_n;

    -- Expenses: every sub-type with a vendor-lookup extra field stores the
    -- chosen vendor's id under that field's own key inside metadata jsonb.
    FOR v_sub IN SELECT id, extra_fields FROM expense_sub_types WHERE extra_fields IS NOT NULL LOOP
      FOR v_field IN SELECT * FROM jsonb_array_elements(v_sub.extra_fields) LOOP
        IF v_field->>'type' = 'lookup' AND v_field->>'source' = 'vendors' THEN
          v_key := v_field->>'key';
          UPDATE expenses
             SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), ARRAY[v_key], to_jsonb(p_target_id::text)),
                 vendor_name = v_target.name
           WHERE expense_sub_type_id = v_sub.id
             AND metadata->>v_key = v_source_id::text;
          GET DIAGNOSTICS v_n = ROW_COUNT; v_expenses_moved := v_expenses_moved + v_n;
        END IF;
      END LOOP;
    END LOOP;

    -- Union tag arrays onto the target so future expense-type-gated vendor
    -- pickers still surface it, and fold the source's opening balance in so
    -- the merge doesn't silently drop it from the outstanding total.
    UPDATE vendors SET
      expense_type_ids = (SELECT array_agg(DISTINCT x) FROM unnest(
          coalesce((SELECT expense_type_ids FROM vendors WHERE id = p_target_id), '{}'::bigint[]) ||
          coalesce((SELECT expense_type_ids FROM vendors WHERE id = v_source_id), '{}'::bigint[])
        ) x),
      expense_sub_type_ids = (SELECT array_agg(DISTINCT x) FROM unnest(
          coalesce((SELECT expense_sub_type_ids FROM vendors WHERE id = p_target_id), '{}'::bigint[]) ||
          coalesce((SELECT expense_sub_type_ids FROM vendors WHERE id = v_source_id), '{}'::bigint[])
        ) x),
      opening_balance_paise = coalesce((SELECT opening_balance_paise FROM vendors WHERE id = p_target_id), 0)
                             + coalesce((SELECT opening_balance_paise FROM vendors WHERE id = v_source_id), 0)
    WHERE id = p_target_id;

    UPDATE vendors SET active = false, merged_into_id = p_target_id, opening_balance_paise = 0 WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object('ledger_entries_moved', v_ledger_moved, 'expenses_updated', v_expenses_moved, 'other_refs_moved', v_fk_moved);
END;
$$;

NOTIFY pgrst, 'reload schema';
