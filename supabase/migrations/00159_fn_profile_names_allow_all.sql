-- fn_profile_names (00158) covered a specific list of ids. Several pickers
-- (expense form's "staff" lookup field, the submitted-by/entered-by filters
-- on Expenses/Requisitions/etc.) need every active-or-not profile's id+name
-- as a directory, not a specific list -- same RLS gap (profiles_select only
-- lets a user read their own row), just with no ids known up front.
-- p_ids defaulting to null and meaning "everyone" keeps this one function
-- for both shapes.
create or replace function public.fn_profile_names(p_ids uuid[] default null)
returns table(id uuid, name text, signature_path text)
language sql
security definer
set search_path to 'public'
as $$
  select id, name, signature_path from public.profiles
  where p_ids is null or id = any(p_ids);
$$;

revoke all on function public.fn_profile_names(uuid[]) from public;
grant execute on function public.fn_profile_names(uuid[]) to authenticated;
