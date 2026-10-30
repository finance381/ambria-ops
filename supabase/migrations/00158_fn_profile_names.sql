-- profiles_select only lets a user read their own row (or an admin/auditor/
-- dept-approver read everyone's) -- so a regular employee's client-side
-- `.from('profiles').select(...)` for a transfer counterparty, a collection's
-- collector, or a payment's recipient silently came back empty for anyone
-- who wasn't themselves. Reported live: a wallet transfer showed "— →
-- Abhishek Meena" / "Abhishek Meena → —" for the sender/receiver who wasn't
-- viewing their own transaction.
--
-- A person's name (and receipt-signature image) isn't sensitive the way the
-- rest of profiles is -- it's shown across the app today wherever an admin
-- views it, and the whole point here is that the OTHER party to a transfer,
-- collection or payment should see it too. SECURITY DEFINER, same pattern as
-- fn_event_collections (migration 00155), scoped to exactly these two
-- columns so nothing else on profiles is exposed by it.
create or replace function public.fn_profile_names(p_ids uuid[])
returns table(id uuid, name text, signature_path text)
language sql
security definer
set search_path to 'public'
as $$
  select id, name, signature_path from public.profiles where id = any(p_ids);
$$;

revoke all on function public.fn_profile_names(uuid[]) from public;
grant execute on function public.fn_profile_names(uuid[]) to authenticated;
