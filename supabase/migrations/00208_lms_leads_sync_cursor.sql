-- lms-leads-sync now works through LMS's lead list in time-boxed runs
-- (10 leads a page; a full Venue pass is far longer than one edge-function
-- run). `cursor` is the next page to fetch, `cycle_done_at` when a full
-- pass last reached the end of the list.
alter table public.lms_leads_sync_state add column if not exists cursor int not null default 1;
alter table public.lms_leads_sync_state add column if not exists cycle_done_at timestamptz;

NOTIFY pgrst, 'reload schema';
