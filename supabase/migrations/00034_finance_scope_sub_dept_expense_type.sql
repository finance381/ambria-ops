-- Adds two new finance data-scope values ('own_sub_dept', 'own_expense_type') that read
-- profiles.sub_department_ids / profiles.expense_type_ids — both already exist and are
-- edited today via Users.jsx (Edit User > Expense tab), but were never wired into any
-- fn_*_scope_visible() check. These replace 'own_dept'/'own_venue' as options in the
-- PermMatrix "Data scope" chip for Finance rows only (src/lib/permissions.js
-- FINANCE_SCOPE_OPTIONS); other modules (Projects, HR, Inventory, ...) keep using
-- own_dept/own_venue via the same fn_*_scope_visible functions untouched here.
--
-- Note: 'finance.payments' / 'finance.salary_payouts' / 'finance.cost_transfers' have no
-- dedicated fn_*_scope_visible function (only finance.expenses and finance.ledgers.* do,
-- via fn_expense_scope_visible / fn_ledger_entries_scope_visible below) — scope selection
-- on those three rows is already inert today and stays that way; not a regression here.

-- ---- New helper functions, mirroring current_user_dept_ids()/current_user_venue_ids() ----

CREATE OR REPLACE FUNCTION public.current_user_sub_dept_ids()
 RETURNS bigint[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sub_department_ids::bigint[], ARRAY[]::bigint[]) FROM profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_user_expense_type_ids()
 RETURNS bigint[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(expense_type_ids::bigint[], ARRAY[]::bigint[]) FROM profiles WHERE id = auth.uid()
$function$;

-- ---- fn_expense_scope_visible: add own_sub_dept / own_expense_type branches ----

CREATE OR REPLACE FUNCTION public.fn_expense_scope_visible(_expense_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s text;
BEGIN
  s := user_scope('finance.expenses');
  IF s = 'all' THEN
    RETURN TRUE;
  END IF;
  IF s = 'own' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expenses e
       WHERE e.id = _expense_id AND e.user_id = auth.uid()
    );
  END IF;
  IF s = 'own_dept' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expense_allocations ea
       WHERE ea.expense_id = _expense_id
         AND ea.department_id = ANY (current_user_dept_ids())
    );
  END IF;
  IF s = 'own_venue' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expense_allocations ea
       WHERE ea.expense_id = _expense_id
         AND ea.venue_id = ANY (current_user_venue_ids())
    );
  END IF;
  IF s = 'own_sub_dept' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expense_allocations ea
       WHERE ea.expense_id = _expense_id
         AND ea.department_id = ANY (current_user_sub_dept_ids())
    );
  END IF;
  IF s = 'own_expense_type' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expenses e
       WHERE e.id = _expense_id
         AND e.expense_type_id = ANY (current_user_expense_type_ids())
    );
  END IF;
  -- Unknown scope value: log-and-allow
  RETURN TRUE;
END;
$function$;

-- ---- fn_ledger_entries_scope_visible: add own_sub_dept (all ledger types, same
-- department_ids column own_dept already uses) / own_expense_type (expense-derived
-- ledger rows only, mirroring the existing own_venue-via-ref_id check) ----

CREATE OR REPLACE FUNCTION public.fn_ledger_entries_scope_visible(_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  lt text; cb uuid; dept_ids bigint[]; ref_t text; ref_i text;
  scope_key text; s text;
BEGIN
  SELECT ledger_type, created_by, department_ids, ref_type, ref_id
    INTO lt, cb, dept_ids, ref_t, ref_i
    FROM public.ledger_entries WHERE id = _id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  scope_key := CASE lt
    WHEN 'vendor'        THEN 'finance.ledgers.vendor'
    WHEN 'user_salary'   THEN 'finance.ledgers.salary'
    WHEN 'cost_transfer' THEN 'finance.ledgers.cost_transfer'
    WHEN 'inventory'     THEN 'finance.ledgers.inventory'
    ELSE                      'finance.ledgers.expense'
  END;

  s := user_scope(scope_key);
  IF s = 'all'  THEN RETURN TRUE; END IF;
  IF s = 'own'  THEN RETURN cb = auth.uid(); END IF;
  IF s = 'own_dept' THEN
    RETURN dept_ids && current_user_dept_ids();
  END IF;
  IF s = 'own_venue' AND ref_t = 'expense' AND ref_i ~ '^\d+$' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expense_allocations ea
       WHERE ea.expense_id = ref_i::bigint
         AND ea.venue_id = ANY (current_user_venue_ids())
    );
  END IF;
  IF s = 'own_sub_dept' THEN
    RETURN dept_ids && current_user_sub_dept_ids();
  END IF;
  IF s = 'own_expense_type' AND ref_t = 'expense' AND ref_i ~ '^\d+$' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expenses e
       WHERE e.id = ref_i::bigint
         AND e.expense_type_id = ANY (current_user_expense_type_ids())
    );
  END IF;
  RETURN TRUE;
END;
$function$;

NOTIFY pgrst, 'reload schema';
