-- Rule 6 of LMS_SYNC_SAFETY_PATTERNS.md: "make the sync observable, not just
-- functional." sync-events.ts currently only console.log's its per-run
-- counts and errors -- that rolls off and nobody sees it unless they happen
-- to be watching function logs at the exact moment, which is exactly how a
-- truncation/error condition could run unnoticed for a long time (the same
-- shape of problem that let contract #00773 sit broken for 6 days before
-- this repo's own lms_sync_anomalies table existed). This is the same fix
-- applied one level up: a queryable row per run instead of only ad-hoc
-- per-contract anomaly rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lms_sync_runs (
  id bigserial primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  trigger_source text not null,  -- 'cron' | 'manual'
  triggered_by uuid references public.profiles(id),
  status text not null,  -- 'ok' | 'errors' (some dept had an error) | 'error' (whole run threw)
  total_fetched int,
  total_synced int,
  total_stale int,
  dept_summary jsonb,  -- [{department, fetched, synced, stale, errors:[...]}]
  errors jsonb         -- flat list of every error string this run hit, or null
);
CREATE INDEX IF NOT EXISTS idx_lms_sync_runs_started_at ON public.lms_sync_runs (started_at DESC);

ALTER TABLE public.lms_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_sync_runs_select ON public.lms_sync_runs;
CREATE POLICY lms_sync_runs_select ON public.lms_sync_runs
  FOR SELECT USING (public.user_can('events.sync_issues'));
-- No INSERT/UPDATE policy -- written only by sync-events (service role,
-- bypasses RLS), same convention as lms_sync_anomalies.

NOTIFY pgrst, 'reload schema';

COMMIT;
