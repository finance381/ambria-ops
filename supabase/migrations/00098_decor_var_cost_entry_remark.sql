-- A remark for the whole day's entry (distinct from the existing per-row
-- "+Remark" on a particular line, which lives in decor_var_costs.sheet.remarks
-- and is shared across every day on the sheet). Requested right after the
-- Entry date field on the entry editor.
--
-- Adding p_remark as a new trailing parameter with a default is the one
-- case CREATE OR REPLACE FUNCTION can do without a DROP first — Postgres
-- allows appending defaulted parameters to an existing function's list.

BEGIN;

ALTER TABLE public.decor_var_cost_entries ADD COLUMN IF NOT EXISTS remark text;

CREATE OR REPLACE FUNCTION public.fn_dvc_save_entry(
  p_cost_id      bigint,
  p_header       jsonb,
  p_entry_id     bigint,
  p_entry_date   date,
  p_lines        jsonb,
  p_amount_paise bigint,
  p_remark       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cost    public.decor_var_costs%rowtype;
  v_sheet   text := p_header->>'sheet_code';
  v_prefix  text;
  v_num     integer;
  v_id      bigint := p_cost_id;
  v_entry   bigint := p_entry_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.expenses') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF p_entry_date IS NULL THEN RAISE EXCEPTION 'Pick the date for this entry'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'object' THEN RAISE EXCEPTION 'Entry lines must be an object'; END IF;
  IF coalesce(p_amount_paise, 0) < 0 THEN RAISE EXCEPTION 'Amount cannot be negative'; END IF;

  IF v_id IS NULL THEN
    v_prefix := public.fn_dvc_prefix(v_sheet);
    IF v_prefix IS NULL THEN RAISE EXCEPTION 'Pick the department'; END IF;
    INSERT INTO public.decor_var_cost_counters (prefix, next_num) VALUES (v_prefix, 2)
    ON CONFLICT (prefix) DO UPDATE SET next_num = decor_var_cost_counters.next_num + 1
    RETURNING next_num - 1 INTO v_num;
    INSERT INTO public.decor_var_costs (serial_no, sheet_code, created_by)
    VALUES (v_prefix || '-' || lpad(v_num::text, greatest(3, length(v_num::text)), '0'), v_sheet, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    v_cost := public.fn_dvc_lock_draft(v_id);
    IF v_sheet IS NOT NULL AND v_sheet <> v_cost.sheet_code THEN
      RAISE EXCEPTION 'The department of a saved sheet cannot be changed';
    END IF;
  END IF;

  PERFORM public.fn_dvc_apply_header(v_id, p_header);

  IF v_entry IS NULL THEN
    BEGIN
      INSERT INTO public.decor_var_cost_entries (cost_id, entry_date, lines, amount_paise, remark, created_by)
      VALUES (v_id, p_entry_date, p_lines, coalesce(p_amount_paise, 0), nullif(trim(p_remark), ''), auth.uid())
      RETURNING id INTO v_entry;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'There is already an entry for %', to_char(p_entry_date, 'DD Mon YYYY');
    END;
  ELSE
    BEGIN
      UPDATE public.decor_var_cost_entries
         SET entry_date = p_entry_date, lines = p_lines, amount_paise = coalesce(p_amount_paise, 0),
             remark = nullif(trim(p_remark), ''), updated_at = now()
       WHERE id = v_entry AND cost_id = v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'There is already an entry for %', to_char(p_entry_date, 'DD Mon YYYY');
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry % not found on this sheet', v_entry; END IF;
  END IF;

  RETURN jsonb_build_object(
    'cost_id', v_id,
    'serial_no', (SELECT serial_no FROM public.decor_var_costs WHERE id = v_id),
    'entry_id', v_entry
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_dvc_save_entry(bigint, jsonb, bigint, date, jsonb, bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
