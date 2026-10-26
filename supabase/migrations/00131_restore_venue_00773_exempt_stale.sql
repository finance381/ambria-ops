-- Same confirmed LMS-side listing gap already documented in sync-events/
-- index.ts (contract #00674 and others): Venue contract #00773 (Dr. Sikha
-- c/o Mr. Sunder Singh, 24-Jan-2027) is fully live and active in LMS's own
-- UI -- actively forwarded to Decor and Entertainment -- but LMS's own
-- get_venue_contract_information_list endpoint has repeatedly excluded it
-- from its paginated response. Every sync run that misses it re-cancels
-- whatever row currently represents it, and it's been missing from that
-- list on essentially every run for the last 6 days straight (confirmed:
-- synced 2026-10-20 16:15, cancelled again by 19:30 the same day, never
-- recovered since).
--
-- Two resync rows exist for this contract (a signature change somewhere in
-- LMS's data minted a new id rather than updating the old one, same
-- resync-duplicate behavior documented elsewhere in this codebase).
-- Restoring only the more recent one; the older one stays cancelled as a
-- genuine superseded duplicate.

UPDATE events
SET lms_cancelled_at = NULL, lms_stale_exempt = true
WHERE lms_event_id = 'Venue_00773_812';

NOTIFY pgrst, 'reload schema';
