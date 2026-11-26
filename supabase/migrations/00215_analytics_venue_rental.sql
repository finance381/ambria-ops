-- Salesperson revenue the way LMS counts it: for Venue contracts that is the
-- venue rental (fiscd_venue_value, stored per function as venue_rental_paise),
-- summed over the contract's functions -- not the whole package. Other
-- departments have no rental; Analytics uses their package value.
-- New output column -> drop and recreate.

drop function if exists public.fn_analytics_contracts(date, date, text);

create or replace function public.fn_analytics_contracts(p_from date, p_to date, p_basis text default 'contract')
returns table (
  department          text,
  contract_no         text,
  contract_date       date,
  first_function_date date,
  last_function_date  date,
  function_count      int,
  function_names      text,
  venue_name          text,
  client_name         text,
  salesperson         text,
  priority            text,
  enquiry_mode        text,
  contract_type       text,
  package_paise       bigint,
  advance_paise       bigint,
  lead_entry_date     date,
  venue_rental_paise  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.user_can('admin.analytics')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  ) then
    raise exception 'Not allowed';
  end if;

  return query
  with c as (
    select e.*,
      nullif(e.contract_date::text, '')::date as c_date,
      nullif(e.function_date::text, '')::date as f_date,
      -- name looked up now, so mapping an LMS id on the Users page fixes
      -- old contracts at once; an unmapped id shows as 'LMS user #<id>'
      coalesce(p.name, e.created_user_name,
               case when e.created_by_lms_id is not null then 'LMS user #' || e.created_by_lms_id::text end) as sales_name
    from events e
    left join lateral (
      select pr.name from profiles pr
      where pr.lms_user_id is not null and pr.lms_user_id::text = e.created_by_lms_id::text
      limit 1
    ) p on true
    where e.lms_cancelled_at is null
      and e.merged_into_id is null
      and coalesce(e.is_tentative, false) = false
      and coalesce(e.contract_no, '') <> ''
  ),
  g0 as (
    select
      c.department as dept,
      c.contract_no as cno,
      max(c.c_date) as c_date,
      min(c.f_date) as ffd,
      max(c.f_date) as lfd,
      count(distinct coalesce(c.event_name, '') || '|' || coalesce(c.f_date::text, '') || '|' || coalesce(c.session, ''))::int as fcount,
      string_agg(distinct nullif(c.event_name, ''), ', ') as fnames,
      (array_agg(c.venue_name order by c.id desc))[1] as venue,
      (array_agg(c.client_name order by c.id desc))[1] as client,
      (array_agg(c.sales_name order by c.id desc))[1] as sales,
      (array_agg(c.priority order by c.id desc))[1] as prio,
      (array_agg(c.enquiry_mode order by c.id desc))[1] as enq,
      (array_agg(c.contract_type order by c.id desc))[1] as ctype,
      max(coalesce(c.total_amount_paise, 0))::bigint as pkg,
      max(coalesce(c.lms_advance_cash_paise, 0) + coalesce(c.lms_advance_bank_paise, 0))::bigint as adv,
      min(c.lead_entry_date) as lead_dt,
      (array_agg(right(regexp_replace(coalesce(c.contact_number, ''), '\D', '', 'g'), 10) order by c.id desc))[1] as ph,
      sum(coalesce(c.venue_rental_paise, 0))::bigint as rental
    from c
    group by c.department, c.contract_no
  ),
  -- the lead's date: LMS's own (Venue/Catering/Entertainment), else the
  -- date of a lead we synced for the same phone + department (on or before
  -- the contract), else the contract date itself -- so 'lead' basis never
  -- comes up empty, and sharpens as lead dates fill in
  g as (
    select g0.*,
      coalesce(
        g0.lead_dt,
        (select min(l.entry_date) from lms_leads l
          where l.department = g0.dept and length(g0.ph) = 10
            and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = g0.ph
            and (g0.c_date is null or l.entry_date <= g0.c_date)),
        g0.c_date
      ) as ldate
    from g0
  )
  select g.dept, g.cno, g.c_date, g.ffd, g.lfd, g.fcount, g.fnames, g.venue, g.client,
         g.sales, g.prio, g.enq, g.ctype, g.pkg, g.adv, g.ldate, g.rental
  from g
  where (case when p_basis = 'function' then g.ffd when p_basis = 'lead' then g.ldate else g.c_date end) between p_from and p_to
  order by g.c_date desc nulls last;
end;
$$;

grant execute on function public.fn_analytics_contracts(date, date, text) to authenticated;

NOTIFY pgrst, 'reload schema';
