-- Confirmed directly against the live LMS API (paginated all 85 pages of
-- get_venue_contract_information_list just now): contract #00674 / Venue_
-- 00674_676 ("Sanjay Kumar", HALDI, 03-Dec-2026) is still live in LMS, not
-- cancelled there — it was wrongly flagged lms_cancelled_at here because
-- LMS's list pagination is unstable under concurrent edits (see the
-- sync-events code comment just added). Restoring this one specific row.
update events
set lms_cancelled_at = null
where id = 269544 and lms_event_id = 'Venue_00674_676';

-- Other rows that MIGHT be the same false-positive pattern: cancelled within
-- an hour of their own last sync — i.e. flagged stale on the very next run
-- after they were last seen, rather than after sitting untouched a while.
-- Each one of these should be checked against the live LMS list before
-- restoring (some may be genuinely cancelled) — this is a candidate list,
-- not an automatic fix.
select id, lms_event_id, contract_no, department, event_name, client_name,
       function_date, synced_at, lms_cancelled_at,
       (lms_cancelled_at - synced_at) as gap
from events
where lms_cancelled_at is not null
  and lms_cancelled_at - synced_at < interval '2 hours'
order by lms_cancelled_at desc;
