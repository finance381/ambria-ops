-- fn_event_group_balance computes a contract's "spent" total by summing
-- event_ledger rows (direction='out') grouped by event_id -- it never reads
-- expenses directly. event_ledger itself was populated by exactly one
-- trigger (trg_expense_ledger_post / trg_expense_to_ledger on `expenses`):
-- one row per expense, for its whole gross amount, against its single
-- expenses.event_id.
--
-- ExpenseForm.jsx's new "Period" mode lets one expense's split-allocation
-- rows each name a DIFFERENT function (expense_allocations.event_id, added
-- in 00183) instead of the whole expense anchoring to one. That needs
-- event_ledger to carry one row PER allocation in that case -- summing to
-- the same gross total, but spread across each row's own event_id.
--
-- Two problems with doing this in the existing expenses-table trigger alone:
--   1. expense_allocations rows are inserted in a SEPARATE statement, after
--      the expenses row -- the trigger fires too early to see them.
--   2. Editing an expense replaces its allocations (fn_replace_expense_
--      allocations) without ever re-touching the expenses row itself, so
--      nothing would re-run the rebuild when only the allocations change.
--
-- Fixed by pulling the actual rebuild into its own function, called from
-- BOTH the existing expenses-table trigger AND a new expense_allocations-
-- table trigger -- whichever table changes last, the ledger ends up
-- correct. Every pre-existing expense (no allocation ever carries its own
-- event_id) keeps computing exactly as before: one row, off the expense's
-- own event_id.

CREATE OR REPLACE FUNCTION public.fn_rebuild_expense_event_ledger(p_expense_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp public.expenses%rowtype;
  v_alloc record;
  v_any_alloc_event boolean;
BEGIN
  DELETE FROM public.event_ledger
   WHERE reference_type = 'expense' AND reference_id = p_expense_id::text;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.expense_allocations
     WHERE expense_id = p_expense_id AND event_id IS NOT NULL
  ) INTO v_any_alloc_event;

  IF v_any_alloc_event THEN
    -- Period mode: one row per function this expense's rows actually hit,
    -- each for just that row's own amount.
    FOR v_alloc IN
      SELECT event_id, amount_paise FROM public.expense_allocations
       WHERE expense_id = p_expense_id AND event_id IS NOT NULL AND amount_paise > 0
    LOOP
      INSERT INTO public.event_ledger
        (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by, created_at)
      VALUES
        (v_alloc.event_id, 'expense', 'out', null, v_alloc.amount_paise, 'expense', p_expense_id::text,
         v_exp.description, v_exp.user_id, v_exp.created_at);
    END LOOP;
  ELSIF v_exp.event_id IS NOT NULL AND v_exp.amount_paise > 0 THEN
    -- Unchanged from the original trigger: single-date/no-function mode,
    -- one row for the whole gross amount against the expense's own event_id.
    INSERT INTO public.event_ledger
      (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by, created_at)
    VALUES
      (v_exp.event_id, 'expense', 'out', null, v_exp.amount_paise, 'expense', p_expense_id::text,
       v_exp.description, v_exp.user_id, v_exp.created_at);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_expense_to_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF tg_op = 'DELETE' THEN
    DELETE FROM public.event_ledger WHERE reference_type = 'expense' AND reference_id = old.id::text;
    RETURN old;
  END IF;
  PERFORM public.fn_rebuild_expense_event_ledger(new.id);
  RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_expense_allocations_to_event_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF tg_op = 'DELETE' THEN
    PERFORM public.fn_rebuild_expense_event_ledger(old.expense_id);
    RETURN old;
  END IF;
  PERFORM public.fn_rebuild_expense_event_ledger(new.expense_id);
  RETURN new;
END $function$;

DROP TRIGGER IF EXISTS trg_expense_allocations_event_ledger_post ON public.expense_allocations;
CREATE TRIGGER trg_expense_allocations_event_ledger_post
AFTER INSERT OR UPDATE OR DELETE ON public.expense_allocations
FOR EACH ROW EXECUTE FUNCTION public.trg_expense_allocations_to_event_ledger();

NOTIFY pgrst, 'reload schema';
