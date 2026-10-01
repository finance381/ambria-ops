-- Push notifications, phase 2: notify a department's expense approver(s)
-- whenever an expense is allocated to their department. Depends on
-- fn_notify() and the notifications table from 00060 — run that one first.
--
-- "Department head" here is permission-based, not role-based (confirmed
-- explicitly): a profile counts as a department's notifiable approver when
-- it holds 'finance.expenses.approve' in either permissions array AND the
-- allocation's department_id is in its own department_ids or
-- sub_department_ids. This is exactly user_can()'s own check
-- (mobile_permissions/desktop_permissions array membership), just evaluated
-- per candidate profile instead of per auth.uid() — a trigger fires as
-- whoever submitted the expense, not as each possible recipient, so
-- user_can() itself (which always reads auth.uid()) can't be reused as-is.
-- Admin/auditor's blanket access in user_can() is deliberately NOT mirrored
-- here — they already see every expense elsewhere, and including them would
-- notify every admin on every single expense company-wide.
--
-- Fires on expense_allocations, not expenses: department assignment lives
-- on the child row (an expense can span multiple departments), inserted
-- right after the parent expense (ExpenseForm.jsx — plain client inserts,
-- not an RPC, which is exactly why this has to be a trigger rather than
-- logic added to some RPC body).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notify_expense_dept_head()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_submitter_id uuid;
  v_submitter_name text;
  v_description text;
  r RECORD;
BEGIN
  IF NEW.department_id IS NULL THEN RETURN NEW; END IF;

  SELECT user_id, description INTO v_submitter_id, v_description
    FROM public.expenses WHERE id = NEW.expense_id;
  IF v_submitter_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_submitter_name FROM public.profiles WHERE id = v_submitter_id;

  FOR r IN
    SELECT p.id
    FROM public.profiles p
    WHERE COALESCE(p.active, false)
      AND p.id <> v_submitter_id
      -- Explicit cast rather than trusting the column's own element type —
      -- profiles.expense_type_ids turned out to be integer[] despite being
      -- compared against bigint elsewhere this session (00034's
      -- current_user_dept_ids() casts for the same reason); department_ids/
      -- sub_department_ids might not already be bigint[] either.
      AND (NEW.department_id = ANY (COALESCE(p.department_ids::bigint[], ARRAY[]::bigint[]))
           OR NEW.department_id = ANY (COALESCE(p.sub_department_ids::bigint[], ARRAY[]::bigint[])))
      AND ('finance.expenses.approve' = ANY (COALESCE(p.mobile_permissions, ARRAY[]::text[]))
           OR 'finance.expenses.approve' = ANY (COALESCE(p.desktop_permissions, ARRAY[]::text[])))
  LOOP
    PERFORM fn_notify(
      r.id, 'expense_dept', 'New expense in your department',
      coalesce(v_submitter_name, 'Someone') || ': ' || coalesce(v_description, '(no description)'),
      'expense:' || NEW.expense_id
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_expense_dept_head ON public.expense_allocations;
CREATE TRIGGER trg_notify_expense_dept_head
  AFTER INSERT ON public.expense_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_expense_dept_head();

NOTIFY pgrst, 'reload schema';

COMMIT;
