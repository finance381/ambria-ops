-- LMS users (get_user_list, see LMS_USER_LIST_API.md) mirrored into
-- lms_users by lms-leads-sync on every run, and used two ways:
--
-- 1. fn_map_profiles_to_lms: fills profiles.lms_user_id by phone number
--    (last 10 digits, unique on both sides). Preview by default; pass true
--    to apply. Only fills EMPTY lms_user_id -- an existing mapping is never
--    changed, only reported when the phone points at a different LMS id.
-- 2. Analytics names: a contract / lead creator with no mapped profile now
--    shows its LMS name instead of 'LMS user #<id>'.

create table if not exists public.lms_users (
  id          int primary key,             -- LMS user id (= *_entryby on contracts/leads)
  username    text,
  full_name   text,
  phone       text,
  email       text,
  active      boolean not null default true,
  departments text,
  synced_at   timestamptz not null default now()
);

alter table public.lms_users enable row level security;

drop policy if exists lms_users_read on public.lms_users;
create policy lms_users_read on public.lms_users
  for select to authenticated
  using (
    public.user_can('admin.analytics') or public.user_can('admin.users')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );

create or replace function public.fn_map_profiles_to_lms(p_apply boolean default false)
returns table (
  profile_id     uuid,
  profile_name   text,
  profile_phone  text,
  current_lms_id text,
  lms_user_id    int,
  lms_name       text,
  action         text   -- 'will map' / 'mapped' / 'already mapped' / 'differs'
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Run straight from the SQL editor (a direct DB session, not the API's
  -- 'authenticator' login): allowed. From the app: admins only.
  if session_user = 'authenticator' and not (
    public.user_can('admin.users')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) then
    raise exception 'Not allowed';
  end if;

  return query
  with lu as (
    select u.id, u.full_name, right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) as ph
    from lms_users u
  ),
  lu_unique as (   -- a phone shared by two LMS users can't decide anything
    select ph from lu where length(ph) = 10 group by ph having count(*) = 1
  ),
  pr as (
    select p.id, p.name, p.phone, p.lms_user_id::text as cur,
      right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) as ph
    from profiles p
  ),
  pr_unique as (
    select ph from pr where length(ph) = 10 group by ph having count(*) = 1
  ),
  m as (
    select pr.id as pid, pr.name as pname, pr.phone as pphone, pr.cur, lu.id as lid, lu.full_name as lname
    from pr
    join lu on lu.ph = pr.ph
    where pr.ph in (select ph from lu_unique) and pr.ph in (select ph from pr_unique)
  ),
  applied as (
    update profiles p set lms_user_id = m.lid
    from m
    where p_apply and p.id = m.pid and p.lms_user_id is null
    returning p.id
  )
  select m.pid, m.pname, m.pphone, m.cur, m.lid, m.lname,
    case
      when m.cur is null and p_apply then 'mapped'
      when m.cur is null then 'will map'
      when m.cur = m.lid::text then 'already mapped'
      else 'differs'
    end
  from m
  order by 7, 2;
end;
$$;

revoke execute on function public.fn_map_profiles_to_lms(boolean) from public, anon;
grant execute on function public.fn_map_profiles_to_lms(boolean) to authenticated;

-- Names for Analytics: the mapped profile's name first, else the LMS name.
create or replace function public.fn_analytics_lms_user_names()
returns table (lms_user_id text, name text)
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
  with prof as (
    select distinct on (pr.lms_user_id::text) pr.lms_user_id::text as k, pr.name
    from profiles pr where pr.lms_user_id is not null
    order by pr.lms_user_id::text, pr.name
  )
  select prof.k, prof.name from prof
  union all
  select u.id::text, coalesce(nullif(u.full_name, ''), u.username)
  from lms_users u
  where u.id::text not in (select k from prof);
end;
$$;

grant execute on function public.fn_analytics_lms_user_names() to authenticated;

NOTIFY pgrst, 'reload schema';

-- ── one-off, after the first sync has filled lms_users ──
-- preview:  select * from fn_map_profiles_to_lms(false);
-- apply:    select * from fn_map_profiles_to_lms(true);
