-- Decor Var Cost gets its own permission instead of riding on Expenses:
--   finance.decor_var_cost           open the screen, make and fill sheets
--   finance.decor_var_cost.approve   see everyone's sheets, change any draft,
--                                    delete submitted ones
-- (src/lib/permissions.js PERM_GROUPS; Shell.jsx and AdminShell.jsx gate the
-- tile on it, DecorVarCost.jsx's canApprove reads the approve key.)
--
-- Backfilled onto whoever already has the Expenses keys, on profiles and
-- role_defaults, both surfaces — the same conditional UPDATE as 00095 — so
-- nobody who can use Decor Var Cost today loses it. The RLS policies and every
-- fn_dvc_* function that checked finance.expenses / .approve now check the
-- new keys; bodies are otherwise those of 00087 / 00096 / 00098 / 00104.
-- Run after 00104_decor_var_cost_function_detail.sql.

BEGIN;

-- ── backfill ────────────────────────────────────────────────────────────
UPDATE profiles
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.decor_var_cost']))
WHERE 'finance.expenses' = ANY(COALESCE(desktop_permissions, '{}'));
UPDATE profiles
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.decor_var_cost']))
WHERE 'finance.expenses' = ANY(COALESCE(mobile_permissions, '{}'));
UPDATE role_defaults
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.decor_var_cost']))
WHERE 'finance.expenses' = ANY(COALESCE(desktop_permissions, '{}'));
UPDATE role_defaults
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.decor_var_cost']))
WHERE 'finance.expenses' = ANY(COALESCE(mobile_permissions, '{}'));

UPDATE profiles
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.decor_var_cost.approve']))
WHERE 'finance.expenses.approve' = ANY(COALESCE(desktop_permissions, '{}'));
UPDATE profiles
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.decor_var_cost.approve']))
WHERE 'finance.expenses.approve' = ANY(COALESCE(mobile_permissions, '{}'));
UPDATE role_defaults
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.decor_var_cost.approve']))
WHERE 'finance.expenses.approve' = ANY(COALESCE(desktop_permissions, '{}'));
UPDATE role_defaults
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.decor_var_cost.approve']))
WHERE 'finance.expenses.approve' = ANY(COALESCE(mobile_permissions, '{}'));

-- ── read access ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS dvc_select ON public.decor_var_costs;
CREATE POLICY dvc_select ON public.decor_var_costs FOR SELECT USING (
  created_by = auth.uid() OR user_can('finance.decor_var_cost.approve')
);
DROP POLICY IF EXISTS dvc_entries_select ON public.decor_var_cost_entries;
CREATE POLICY dvc_entries_select ON public.decor_var_cost_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.decor_var_costs c
           WHERE c.id = cost_id
             AND (c.created_by = auth.uid() OR user_can('finance.decor_var_cost.approve')))
);

-- ── who may change a draft ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dvc_lock_draft(p_cost_id bigint)
RETURNS public.decor_var_costs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v public.decor_var_costs%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.decor_var_cost') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v FROM public.decor_var_costs WHERE id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decor Var Cost % not found', p_cost_id; END IF;
  IF v.created_by IS DISTINCT FROM auth.uid() AND NOT user_can('finance.decor_var_cost.approve') THEN
    RAISE EXCEPTION 'Only the person who made this sheet can change it';
  END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'This sheet has been submitted and can no longer be changed'; END IF;
  RETURN v;
END;
$$;

-- ── save a dated entry (00098's body) ───────────────────────────────────
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
  IF NOT user_can('finance.decor_var_cost') THEN RAISE EXCEPTION 'Not permitted'; END IF;
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

-- ── delete a sheet (00087's body) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dvc_delete(p_cost_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v        public.decor_var_costs%rowtype;
  v_prefix text;
  v_count  integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.decor_var_cost') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v FROM public.decor_var_costs WHERE id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decor Var Cost % not found', p_cost_id; END IF;
  IF v.status = 'submitted' THEN
    IF NOT user_can('finance.decor_var_cost.approve') THEN
      RAISE EXCEPTION 'A submitted sheet can only be deleted by a Decor Var Cost approver';
    END IF;
  ELSIF v.created_by IS DISTINCT FROM auth.uid() AND NOT user_can('finance.decor_var_cost.approve') THEN
    RAISE EXCEPTION 'Only the person who made this sheet can delete it';
  END IF;

  v_prefix := public.fn_dvc_prefix(v.sheet_code);
  PERFORM 1 FROM public.decor_var_cost_counters WHERE prefix = v_prefix FOR UPDATE;

  DELETE FROM public.decor_var_costs WHERE id = p_cost_id;

  UPDATE public.decor_var_costs SET serial_no = 'renumber-' || id
   WHERE public.fn_dvc_prefix(sheet_code) = v_prefix;
  WITH ord AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
      FROM public.decor_var_costs
     WHERE public.fn_dvc_prefix(sheet_code) = v_prefix
  )
  UPDATE public.decor_var_costs c
     SET serial_no = v_prefix || '-' || lpad(ord.rn::text, greatest(3, length(ord.rn::text)), '0')
    FROM ord
   WHERE c.id = ord.id;

  SELECT count(*) INTO v_count FROM public.decor_var_costs WHERE public.fn_dvc_prefix(sheet_code) = v_prefix;
  UPDATE public.decor_var_cost_counters SET next_num = v_count + 1 WHERE prefix = v_prefix;
END;
$$;

-- ── a group's written detail (00104's body) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dvc_set_event_detail(p_cost_ids bigint[], p_detail text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_detail text := left(nullif(btrim(p_detail), ''), 200);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.decor_var_cost') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF v_detail IS NULL THEN RAISE EXCEPTION 'Write the detail'; END IF;
  IF NOT user_can('finance.decor_var_cost.approve') AND EXISTS (
    SELECT 1 FROM public.decor_var_costs
    WHERE id = ANY (p_cost_ids) AND created_by IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the person who made these sheets can change them';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.decor_var_costs
    WHERE id = ANY (p_cost_ids) AND is_function AND event_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A sheet linked to a booking takes its name from the booking';
  END IF;

  UPDATE public.decor_var_costs
  SET event_detail = v_detail, updated_at = now()
  WHERE id = ANY (p_cost_ids);
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
