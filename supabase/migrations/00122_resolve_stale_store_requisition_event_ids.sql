-- store_requisitions.event_ids is a plain bigint[] snapshot of events.id,
-- not a real FK — so when 00120 collapsed accumulated duplicate live
-- "events" rows (cancelling the losers), any requisition that had linked
-- itself to one of those now-cancelled ids silently lost the link:
-- events_safe filters out cancelled rows, so the join just came back
-- empty ("Linked contract(s) not found", even though the list's own
-- event_ids.length > 0 check still shows it as "LINKED").
--
-- Same resolution as 00120 itself: a cancelled row's live replacement is
-- whichever row shares its contract_no/department/function_date/session.
-- Only touches requisitions that actually point at a cancelled id with a
-- resolvable live sibling — anything else (ids that were never cancelled,
-- or a cancelled id with no live match at all) is left exactly as is.

WITH stale AS (
  SELECT sr.id AS req_id, unnest(sr.event_ids) AS old_event_id
  FROM store_requisitions sr
  WHERE sr.event_ids IS NOT NULL AND array_length(sr.event_ids, 1) > 0
),
resolved AS (
  SELECT s.req_id, s.old_event_id,
    COALESCE(
      (SELECT e.id FROM events e WHERE e.id = s.old_event_id AND e.lms_cancelled_at IS NULL),
      (SELECT live.id
         FROM events stale_e
         JOIN events live
           ON live.contract_no = stale_e.contract_no
          AND live.department = stale_e.department
          AND live.function_date = stale_e.function_date
          AND coalesce(live.session, '') = coalesce(stale_e.session, '')
          AND live.lms_cancelled_at IS NULL
        WHERE stale_e.id = s.old_event_id
        ORDER BY live.synced_at DESC NULLS LAST
        LIMIT 1),
      s.old_event_id
    ) AS new_event_id
  FROM stale s
),
agg AS (
  SELECT req_id, array_agg(DISTINCT new_event_id) AS new_ids
  FROM resolved
  GROUP BY req_id
)
UPDATE store_requisitions sr
SET event_ids = agg.new_ids
FROM agg
WHERE agg.req_id = sr.id
  AND agg.new_ids IS DISTINCT FROM sr.event_ids;
