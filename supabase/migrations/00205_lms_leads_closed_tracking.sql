-- LMS's lead-list API returns only OPEN leads (blank / mild / warm / hot).
-- Confirmed, Dead and Waste leads drop out of it entirely -- checked against
-- the LMS Lead View for Venue, Nov 2026: 199 leads in the API vs 338 on
-- screen, the 139 missing being exactly Confirmed 25 + Dead 107 + Waste 6.
--
-- So a lead that was in the list and is gone after a full pass has been
-- closed in LMS. lms-leads-sync marks it closed; Analytics shows it as
-- Confirmed when a contract exists for its phone, otherwise Dead / Waste.
alter table public.lms_leads add column if not exists last_seen_at timestamptz;
alter table public.lms_leads add column if not exists closed boolean not null default false;
alter table public.lms_leads add column if not exists closed_at timestamptz;

-- when the current full pass of each department started
alter table public.lms_leads_sync_state add column if not exists cycle_started_at timestamptz;

update public.lms_leads set last_seen_at = synced_at where last_seen_at is null;

NOTIFY pgrst, 'reload schema';
