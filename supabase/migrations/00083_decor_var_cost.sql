-- Decor Var Cost: the decor team's per-function cost sheets (the "CD DATE-
-- VENUE NAME-SALES PERSON NAME" workbook — one sheet per department: Flower,
-- Tenting, Fabric, Structure, Furniture, Light, Transport, Mics., Commission)
-- moved off Excel and into the app.
--
-- One record = one sheet: its department (sheet_code), optionally the
-- function it is for (date, venue, sub venue, and the booking if one was
-- picked), and any number of dated entries under it. A function on the 5th
-- whose decor work starts on the 3rd gets three entries — 3rd, 4th, 5th —
-- each saved on its own; the sheet's date columns (D..G) become these rows.
--
--   decor_var_costs           the record: header, status, grand total
--   decor_var_cost_entries    one per date: the quantity typed on each row
--   decor_var_cost_counters   the running serial per prefix (F-001, T-002…)
--
-- The rows, their rates and formulas live in the app (src/lib/decorVarCost.js,
-- generated from the workbook). An entry stores only what was typed, keyed by
-- the sheet's row number; the record's `sheet` jsonb holds the per-row values
-- that span dates — the Rate column where it is editable, Remarks, and the
-- particulars of the free-text Mics./Commission rows.
--
-- Draft → submitted. Save writes one date's entry and keeps the record a
-- draft; Final Submit locks it. Writes go through the SECURITY DEFINER
-- functions below (no insert/update/delete policies), the same pattern as
-- store_requisitions: the gate is finance.expenses, and only the record's
-- creator — or someone who can approve expenses — may change it.
--
-- Idempotent: safe to run again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.decor_var_cost_counters (
  prefix   text PRIMARY KEY,
  next_num integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.decor_var_costs (
  id                bigserial PRIMARY KEY,
  serial_no         text UNIQUE NOT NULL,
  sheet_code        text NOT NULL CHECK (sheet_code IN ('FLR','TNT','FBR','STR','FRN','LGT','TRN','MICS','COMMISSION')),
  sub_department_id integer REFERENCES public.sub_departments(id) ON DELETE SET NULL,
  is_function       boolean NOT NULL DEFAULT false,
  function_date     date,
  event_id          integer REFERENCES public.events(id) ON DELETE SET NULL,
  venue_id          integer REFERENCES public.venues(id) ON DELETE SET NULL,
  sub_venue_id      integer REFERENCES public.sub_venues(id) ON DELETE SET NULL,
  sheet             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  total_paise       bigint NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  submitted_by      uuid REFERENCES public.profiles(id),
  submitted_at      timestamptz
);

CREATE TABLE IF NOT EXISTS public.decor_var_cost_entries (
  id           bigserial PRIMARY KEY,
  cost_id      bigint NOT NULL REFERENCES public.decor_var_costs(id) ON DELETE CASCADE,
  entry_date   date NOT NULL,
  lines        jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_paise bigint NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cost_id, entry_date)
);

CREATE INDEX IF NOT EXISTS decor_var_costs_created_by_idx ON public.decor_var_costs (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS decor_var_costs_function_date_idx ON public.decor_var_costs (function_date);
CREATE INDEX IF NOT EXISTS decor_var_cost_entries_cost_idx ON public.decor_var_cost_entries (cost_id, entry_date);

ALTER TABLE public.decor_var_cost_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decor_var_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decor_var_cost_entries ENABLE ROW LEVEL SECURITY;

-- Read: your own records; everyone's if you can approve expenses (user_can
-- is true for admin/auditor by design).
DROP POLICY IF EXISTS dvc_select ON public.decor_var_costs;
CREATE POLICY dvc_select ON public.decor_var_costs FOR SELECT USING (
  created_by = auth.uid() OR user_can('finance.expenses.approve')
);
DROP POLICY IF EXISTS dvc_entries_select ON public.decor_var_cost_entries;
CREATE POLICY dvc_entries_select ON public.decor_var_cost_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.decor_var_costs c
           WHERE c.id = cost_id
             AND (c.created_by = auth.uid() OR user_can('finance.expenses.approve')))
);

-- ── helpers ─────────────────────────────────────────────────────────────

-- The sheet's own serial prefix (F-001 to F-1000, …). Tenting and Transport
-- both print T- on the workbook, so they share one counter rather than
-- handing out the same number twice. Mics. and Commission had none: M, CM.
CREATE OR REPLACE FUNCTION public.fn_dvc_prefix(p_sheet text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_sheet
    WHEN 'FLR' THEN 'F'  WHEN 'TNT' THEN 'T'  WHEN 'FBR' THEN 'C'
    WHEN 'STR' THEN 'S'  WHEN 'FRN' THEN 'FR' WHEN 'LGT' THEN 'L'
    WHEN 'TRN' THEN 'T'  WHEN 'MICS' THEN 'M' WHEN 'COMMISSION' THEN 'CM'
  END
$$;

-- May the caller change this record? Locks the row; raises if not.
CREATE OR REPLACE FUNCTION public.fn_dvc_lock_draft(p_cost_id bigint)
RETURNS public.decor_var_costs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v public.decor_var_costs%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.expenses') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v FROM public.decor_var_costs WHERE id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decor Var Cost % not found', p_cost_id; END IF;
  IF v.created_by IS DISTINCT FROM auth.uid() AND NOT user_can('finance.expenses.approve') THEN
    RAISE EXCEPTION 'Only the person who made this sheet can change it';
  END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'This sheet has been submitted and can no longer be changed'; END IF;
  RETURN v;
END;
$$;

-- Applies a header (jsonb from the app) to a draft, checking it as it goes.
-- p_header: { sheet_code, sub_department_id, is_function, function_date,
--             event_id, venue_id, sub_venue_id, sheet }
CREATE OR REPLACE FUNCTION public.fn_dvc_apply_header(p_cost_id bigint, p_header jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_is_fn  boolean := coalesce((p_header->>'is_function')::boolean, false);
  v_date   date    := nullif(p_header->>'function_date', '')::date;
  v_venue  integer := nullif(p_header->>'venue_id', '')::integer;
  v_sub    integer := nullif(p_header->>'sub_venue_id', '')::integer;
  v_event  integer := nullif(p_header->>'event_id', '')::integer;
BEGIN
  IF v_is_fn THEN
    IF v_date IS NULL THEN RAISE EXCEPTION 'Pick the function date'; END IF;
    IF v_venue IS NULL THEN RAISE EXCEPTION 'Pick the venue'; END IF;
    IF v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_venues WHERE id = v_sub AND venue_id = v_venue) THEN
      RAISE EXCEPTION 'That sub venue is not at this venue';
    END IF;
    IF v_sub IS NULL AND EXISTS (SELECT 1 FROM public.sub_venues WHERE venue_id = v_venue AND active) THEN
      RAISE EXCEPTION 'Pick the sub venue';
    END IF;
  ELSE
    v_date := NULL; v_venue := NULL; v_sub := NULL; v_event := NULL;
  END IF;

  UPDATE public.decor_var_costs SET
    sub_department_id = nullif(p_header->>'sub_department_id', '')::integer,
    is_function       = v_is_fn,
    function_date     = v_date,
    event_id          = v_event,
    venue_id          = v_venue,
    sub_venue_id      = v_sub,
    sheet             = CASE WHEN jsonb_typeof(p_header->'sheet') = 'object' THEN p_header->'sheet' ELSE sheet END,
    updated_at        = now()
  WHERE id = p_cost_id;
END;
$$;

-- ── Save: one date's entry ──────────────────────────────────────────────
-- p_cost_id null → a new draft record is made from p_header first (and
-- given its serial). p_entry_id null → a new date; else that entry is
-- rewritten. Returns { cost_id, serial_no, entry_id }.
CREATE OR REPLACE FUNCTION public.fn_dvc_save_entry(
  p_cost_id      bigint,
  p_header       jsonb,
  p_entry_id     bigint,
  p_entry_date   date,
  p_lines        jsonb,
  p_amount_paise bigint
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
      INSERT INTO public.decor_var_cost_entries (cost_id, entry_date, lines, amount_paise, created_by)
      VALUES (v_id, p_entry_date, p_lines, coalesce(p_amount_paise, 0), auth.uid())
      RETURNING id INTO v_entry;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'There is already an entry for %', to_char(p_entry_date, 'DD Mon YYYY');
    END;
  ELSE
    BEGIN
      UPDATE public.decor_var_cost_entries
         SET entry_date = p_entry_date, lines = p_lines, amount_paise = coalesce(p_amount_paise, 0), updated_at = now()
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

-- ── Header only (details changed, no entry touched) ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_dvc_update_header(p_cost_id bigint, p_header jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cost public.decor_var_costs%rowtype;
BEGIN
  v_cost := public.fn_dvc_lock_draft(p_cost_id);
  IF (p_header->>'sheet_code') IS NOT NULL AND p_header->>'sheet_code' <> v_cost.sheet_code THEN
    RAISE EXCEPTION 'The department of a saved sheet cannot be changed';
  END IF;
  PERFORM public.fn_dvc_apply_header(p_cost_id, p_header);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_dvc_delete_entry(p_entry_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cost_id bigint;
  v_cost    public.decor_var_costs%rowtype;
BEGIN
  SELECT cost_id INTO v_cost_id FROM public.decor_var_cost_entries WHERE id = p_entry_id;
  IF v_cost_id IS NULL THEN RAISE EXCEPTION 'Entry % not found', p_entry_id; END IF;
  v_cost := public.fn_dvc_lock_draft(v_cost_id);
  DELETE FROM public.decor_var_cost_entries WHERE id = p_entry_id;
  UPDATE public.decor_var_costs SET updated_at = now() WHERE id = v_cost_id;
END;
$$;

-- A whole sheet, entries and all. A draft: its creator, or someone who can
-- approve expenses. A submitted sheet: only someone who can approve expenses
-- (admin/auditor included) — once submitted it is no longer the creator's
-- to take back.
--
-- The serials close up behind it: delete F-001 and F-002 becomes F-001,
-- F-003 becomes F-002, and the next new sheet is F-003 — the numbers always
-- run 1, 2, 3 in the order the sheets were made. Done in two passes through
-- a temporary value because serial_no is UNIQUE and a single UPDATE would
-- briefly hold two F-001s. The counter row is locked first so a sheet being
-- made at the same moment waits for the renumbering instead of racing it.
CREATE OR REPLACE FUNCTION public.fn_dvc_delete(p_cost_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v        public.decor_var_costs%rowtype;
  v_prefix text;
  v_count  integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.expenses') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v FROM public.decor_var_costs WHERE id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decor Var Cost % not found', p_cost_id; END IF;
  IF v.status = 'submitted' THEN
    IF NOT user_can('finance.expenses.approve') THEN
      RAISE EXCEPTION 'A submitted sheet can only be deleted by someone who approves expenses';
    END IF;
  ELSIF v.created_by IS DISTINCT FROM auth.uid() AND NOT user_can('finance.expenses.approve') THEN
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

-- ── Final Submit ────────────────────────────────────────────────────────
-- Locks the sheet with its grand total. The app checks every entry against
-- the sheet's rules before calling; here the record must be a complete
-- draft with at least one entry.
CREATE OR REPLACE FUNCTION public.fn_dvc_submit(p_cost_id bigint, p_total_paise bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cost public.decor_var_costs%rowtype;
BEGIN
  v_cost := public.fn_dvc_lock_draft(p_cost_id);
  IF NOT EXISTS (SELECT 1 FROM public.decor_var_cost_entries WHERE cost_id = p_cost_id) THEN
    RAISE EXCEPTION 'Save at least one dated entry before submitting';
  END IF;
  IF v_cost.is_function AND (v_cost.function_date IS NULL OR v_cost.venue_id IS NULL) THEN
    RAISE EXCEPTION 'The function date and venue are missing';
  END IF;
  IF coalesce(p_total_paise, 0) < 0 THEN RAISE EXCEPTION 'Total cannot be negative'; END IF;
  UPDATE public.decor_var_costs
     SET status = 'submitted', total_paise = coalesce(p_total_paise, 0),
         submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
   WHERE id = p_cost_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dvc_lock_draft(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_dvc_apply_header(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dvc_save_entry(bigint, jsonb, bigint, date, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dvc_update_header(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dvc_delete_entry(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dvc_delete(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dvc_submit(bigint, bigint) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
