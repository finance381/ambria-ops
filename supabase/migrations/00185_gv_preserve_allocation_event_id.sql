-- fn_create_gv's allocation-replace INSERT never mentioned event_id --
-- confirmed identical to the live function (pg_get_functiondef), so this
-- wasn't drift, just a gap that predates period mode. Every GV ever filed
-- against a period-mode expense (expense_allocations.event_id set per row,
-- 00183) would silently null out every row's function attribution. Since
-- the expense itself also carries no event_id in period mode (the whole
-- point is each row names its own), that expense's entire amount would
-- vanish from every contract's "spent" total with no error and no warning,
-- until fn_rebuild_expense_event_ledger (00184) rebuilt its event_ledger
-- rows off nothing.
--
-- Only change from the live version: event_id now carried through
-- unchanged on each allocation row. GVForm.jsx has no UI to edit it (no
-- period-mode support there), so this is a pass-through, not a new
-- capability -- a GV's own "change this expense's function" field still
-- only ever affects expenses.event_id, same as before, which is why a
-- period-mode expense's ledger still won't follow a GV's event change
-- (its allocations' own event_ids still win) -- flagged in GVForm.jsx,
-- not fixed here; it would need real period-mode UI in the GV form to fix
-- properly, which is a separate piece of work.

CREATE OR REPLACE FUNCTION public.fn_create_gv(
  p_expense_id integer,
  p_reason text,
  p_allocations jsonb,
  p_new_expense_type_id bigint DEFAULT NULL::bigint,
  p_new_expense_sub_type_id bigint DEFAULT NULL::bigint,
  p_update_event boolean DEFAULT false,
  p_event_id bigint DEFAULT NULL::bigint
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid              uuid := auth.uid();
  v_expense          public.expenses%rowtype;
  v_alloc_sum        bigint;
  v_alloc_count      integer;
  v_before           jsonb;
  v_after            jsonb;
  v_before_fields    jsonb;
  v_after_fields     jsonb;
  v_fiscal_year      integer;
  v_next_num         integer;
  v_gv_number        text;
  v_gv_id            uuid;
  v_alloc            jsonb;
  v_fields_changed   boolean := false;
  v_new_type_id      bigint;
  v_new_sub_type_id  bigint;
  v_event_changed    boolean := false;
begin
  if v_uid is null then raise exception 'GV: not authenticated'; end if;

  if not public.user_can('finance.gv') then
    raise exception 'GV: insufficient permission';
  end if;

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'GV: expense % not found', p_expense_id; end if;
  if v_expense.deleted_at is not null then raise exception 'GV: expense % is deleted', p_expense_id; end if;
  if v_expense.status not in ('recorded','flagged','deducted','acknowledged') then
    raise exception 'GV: expense % status % not eligible', p_expense_id, v_expense.status;
  end if;

  -- ═══ Optional: attribute (or clear) this expense's function/event ═══
  if p_update_event and p_event_id is not distinct from v_expense.event_id then
    p_update_event := false; -- no-op, nothing actually changed
  end if;
  if p_update_event then
    if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id) then
      raise exception 'GV: event % does not exist', p_event_id;
    end if;
    v_event_changed := true;
  end if;

  -- ═══ Optional field-update validation ═══
  if p_new_expense_type_id is not null or p_new_expense_sub_type_id is not null then
    v_new_type_id     := coalesce(p_new_expense_type_id, v_expense.expense_type_id);
    v_new_sub_type_id := p_new_expense_sub_type_id;

    if v_new_type_id is distinct from v_expense.expense_type_id
       or v_new_sub_type_id is distinct from v_expense.expense_sub_type_id then
      v_fields_changed := true;
    end if;

    if v_new_type_id is not null and not exists (
      select 1 from public.expense_types where id = v_new_type_id
    ) then
      raise exception 'GV: expense_type_id % does not exist', v_new_type_id;
    end if;

    if v_new_sub_type_id is not null then
      if not exists (
        select 1 from public.expense_sub_types
         where id = v_new_sub_type_id and expense_type_id = v_new_type_id
      ) then
        raise exception 'GV: sub-type % does not belong to type %', v_new_sub_type_id, v_new_type_id;
      end if;
    end if;
  end if;

  -- ═══ Allocation validation ═══
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'GV: p_allocations must be a jsonb array';
  end if;
  v_alloc_count := jsonb_array_length(p_allocations);
  if v_alloc_count = 0 then raise exception 'GV: at least one allocation required'; end if;

  select coalesce(sum((elem->>'amount_paise')::bigint), 0)
    into v_alloc_sum
    from jsonb_array_elements(p_allocations) elem;
  if v_alloc_sum <> v_expense.amount_paise then
    raise exception 'GV: allocation sum % ≠ expense amount %', v_alloc_sum, v_expense.amount_paise;
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    if (v_alloc->>'department_id') is null and (v_alloc->>'department') is null then
      raise exception 'GV: each allocation needs department_id or department';
    end if;
    if (v_alloc->>'amount_paise') is null or (v_alloc->>'amount_paise')::bigint <= 0 then
      raise exception 'GV: each allocation needs positive amount_paise';
    end if;
  end loop;

  -- ═══ Snapshot BEFORE ═══
  select coalesce(jsonb_agg(row_to_json(a.*) order by a.id), '[]'::jsonb)
    into v_before
    from public.expense_allocations a
   where a.expense_id = p_expense_id;

  if v_fields_changed or v_event_changed then
    select jsonb_build_object(
      'expense_type_id',       v_expense.expense_type_id,
      'expense_type_name',     (select name from public.expense_types      where id = v_expense.expense_type_id),
      'expense_sub_type_id',   v_expense.expense_sub_type_id,
      'expense_sub_type_name', (select name from public.expense_sub_types  where id = v_expense.expense_sub_type_id),
      'event_id',               v_expense.event_id,
      'event_name',             (select event_name from public.events where id = v_expense.event_id)
    ) into v_before_fields;
  end if;

  -- ═══ Replace allocations ═══
  delete from public.expense_allocations where expense_id = p_expense_id;

  insert into public.expense_allocations
    (expense_id, department, department_id, expense_type_id, expense_sub_type_id,
     venue_id, sub_venue_id, amount_paise, remarks, event_id)
  select
    p_expense_id,
    coalesce(elem->>'department', ''),
    nullif(elem->>'department_id','')::bigint,
    nullif(elem->>'expense_type_id','')::bigint,
    nullif(elem->>'expense_sub_type_id','')::bigint,
    nullif(elem->>'venue_id','')::integer,
    nullif(elem->>'sub_venue_id','')::integer,
    (elem->>'amount_paise')::bigint,
    nullif(elem->>'remarks',''),
    nullif(elem->>'event_id','')::bigint
  from jsonb_array_elements(p_allocations) elem;

  -- ═══ Apply field / event updates if requested ═══
  -- A single UPDATE so it fires trg_expense_to_ledger (AFTER UPDATE on
  -- expenses) exactly once, which rebuilds the event_ledger row off the
  -- resulting event_id.
  if v_fields_changed or v_event_changed then
    update public.expenses
       set expense_type_id     = case when v_fields_changed then v_new_type_id else expense_type_id end,
           expense_sub_type_id = case when v_fields_changed then v_new_sub_type_id else expense_sub_type_id end,
           event_id             = case when v_event_changed then p_event_id else event_id end
     where id = p_expense_id;

    select jsonb_build_object(
      'expense_type_id',       case when v_fields_changed then v_new_type_id else v_expense.expense_type_id end,
      'expense_type_name',     (select name from public.expense_types where id = case when v_fields_changed then v_new_type_id else v_expense.expense_type_id end),
      'expense_sub_type_id',   case when v_fields_changed then v_new_sub_type_id else v_expense.expense_sub_type_id end,
      'expense_sub_type_name', (select name from public.expense_sub_types where id = case when v_fields_changed then v_new_sub_type_id else v_expense.expense_sub_type_id end),
      'event_id',               case when v_event_changed then p_event_id else v_expense.event_id end,
      'event_name',             (select event_name from public.events where id = case when v_event_changed then p_event_id else v_expense.event_id end)
    ) into v_after_fields;
  end if;

  -- ═══ Snapshot AFTER ═══
  select coalesce(jsonb_agg(row_to_json(a.*) order by a.id), '[]'::jsonb)
    into v_after
    from public.expense_allocations a
   where a.expense_id = p_expense_id;

  -- ═══ Fiscal year + counter ═══
  select case when extract(month from now())::int < 4
              then extract(year from now())::int - 1
              else extract(year from now())::int end
    into v_fiscal_year;

  insert into public.general_voucher_counters (fiscal_year, next_num)
       values (v_fiscal_year, 2)
  on conflict (fiscal_year)
  do update set next_num = general_voucher_counters.next_num + 1
  returning next_num - 1 into v_next_num;

  v_gv_number := 'GV-' || v_fiscal_year::text || '-' || lpad(v_next_num::text, 4, '0');

  insert into public.general_vouchers
    (gv_number, expense_id, fiscal_year, created_by, reason,
     before_allocations, after_allocations, before_fields, after_fields, is_reversal,
     snapshot_amount_paise, snapshot_expense_date, snapshot_vendor_name)
  values
    (v_gv_number, p_expense_id, v_fiscal_year, v_uid, p_reason,
     v_before, v_after, v_before_fields, v_after_fields, false,
     v_expense.amount_paise, v_expense.expense_date, v_expense.vendor_name)
  returning id into v_gv_id;

  return jsonb_build_object(
    'gv_id', v_gv_id,
    'gv_number', v_gv_number,
    'fields_changed', v_fields_changed or v_event_changed
  );
end;
$function$;

NOTIFY pgrst, 'reload schema';
