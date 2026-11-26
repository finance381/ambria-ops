-- Analytics (Lead level + Contract level).
--
-- 1. lms_leads: a local mirror of LMS leads, one row per lead ENTRY
--    (department + entry no), filled by the lms-leads-sync edge function.
--    LMS's lead list is 10 rows a page, so reading it live on every page
--    open would be hundreds of calls; the mirror makes Analytics instant.
--    Lead-header fields (status, priority, follow-up, visit, contract no)
--    are the same on every function row of one lead, so one row per entry
--    is the honest unit -- counting per function would multiply leads.
--
-- 2. lms_leads_sync_state: last sync per department, shown on the page.
--
-- 3. fn_analytics_contracts: contract-level rows built from events, ONE row
--    per contract (department + contract_no). events carries one row per
--    function, and LMS copies the contract's header money (total_amt,
--    advances) onto every function row -- so money is taken once per
--    contract (max), never summed across its functions.

create table if not exists public.lms_leads (
  lead_key            text primary key,          -- '<Department>_<entry_no>'
  department          text not null,
  entry_no            text not null,
  guest_name          text,
  phone               text,
  entry_date          date,                      -- when the lead came in
  first_function_date date,
  last_function_date  date,
  function_count      int not null default 0,
  function_names      text,
  venue_name          text,
  lead_type           text,                      -- I = in-house, O = outdoor
  pax                 int,
  priority            text,
  enquiry_mode        text,                      -- source
  status              text,                      -- lead temperature (mild, ...)
  assigned_lms_id     text,
  assigned_name       text,
  entry_by_lms_id     text,
  entry_by_name       text,
  followed_up         boolean not null default false,
  last_followup_date  date,
  next_followup_date  date,
  followup_status     text,
  followup_remarks    text,
  visited             boolean not null default false,
  visit_date          date,
  contract_no         text,
  converted           boolean not null default false,
  quoted_paise        bigint,                    -- LMS total_amt, real value
  cancelled           boolean not null default false,
  cancel_remarks      text,
  synced_at           timestamptz not null default now()
);

-- Food tasting done (LMS food_taste_no filled in; Venue and Catering only).
alter table public.lms_leads add column if not exists food_tasting boolean not null default false;

create index if not exists lms_leads_entry_date_idx   on public.lms_leads (entry_date);
create index if not exists lms_leads_function_date_idx on public.lms_leads (first_function_date);
create index if not exists lms_leads_department_idx    on public.lms_leads (department);

create table if not exists public.lms_leads_sync_state (
  department  text primary key,
  synced_at   timestamptz,
  fetched     int,
  error       text
);

alter table public.lms_leads enable row level security;
alter table public.lms_leads_sync_state enable row level security;

-- Read-only for Analytics users; writes come only from the edge function
-- (service role, which bypasses RLS).
drop policy if exists lms_leads_read on public.lms_leads;
create policy lms_leads_read on public.lms_leads
  for select to authenticated
  using (
    public.user_can('admin.analytics')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );

drop policy if exists lms_leads_sync_state_read on public.lms_leads_sync_state;
create policy lms_leads_sync_state_read on public.lms_leads_sync_state
  for select to authenticated
  using (
    public.user_can('admin.analytics')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );

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
  advance_paise       bigint
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
      nullif(e.function_date::text, '')::date as f_date
    from events e
    where e.lms_cancelled_at is null
      and e.merged_into_id is null
      and coalesce(e.is_tentative, false) = false
      and coalesce(e.contract_no, '') <> ''
  ),
  g as (
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
      (array_agg(c.created_user_name order by c.id desc))[1] as sales,
      (array_agg(c.priority order by c.id desc))[1] as prio,
      (array_agg(c.enquiry_mode order by c.id desc))[1] as enq,
      (array_agg(c.contract_type order by c.id desc))[1] as ctype,
      max(coalesce(c.total_amount_paise, 0))::bigint as pkg,
      max(coalesce(c.lms_advance_cash_paise, 0) + coalesce(c.lms_advance_bank_paise, 0))::bigint as adv
    from c
    group by c.department, c.contract_no
  )
  select g.dept, g.cno, g.c_date, g.ffd, g.lfd, g.fcount, g.fnames, g.venue, g.client,
         g.sales, g.prio, g.enq, g.ctype, g.pkg, g.adv
  from g
  where (case when p_basis = 'function' then g.ffd else g.c_date end) between p_from and p_to
  order by g.c_date desc nulls last;
end;
$$;

grant execute on function public.fn_analytics_contracts(date, date, text) to authenticated;

NOTIFY pgrst, 'reload schema';

-- Schedule (run once by hand, same as sync-events-15min -- not committed as
-- a migration step). Copy the headers from the existing sync-events-15min
-- job (select command from cron.job where jobname = 'sync-events-15min'),
-- they are the same: the anon key as Bearer + the SYNC_CRON_SECRET header.
--
-- select cron.schedule('lms-leads-sync-hourly', '7 * * * *', $cron$
--   select net.http_post(
--     url := 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/lms-leads-sync',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <ANON_KEY>',
--       'x-cron-secret', '<SYNC_CRON_SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
-- $cron$);
