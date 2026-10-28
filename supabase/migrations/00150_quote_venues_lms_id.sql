-- RateCardEditor.jsx's Venues tab has a dedicated "LMS venue ID" field on
-- every parent venue that Phase 1's schema (00144) missed — not read by
-- calculate_quote/calculate_quote_v2 (admin metadata only, presumably used
-- by some other LMS-sync integration), but needs to round-trip through the
-- editor faithfully.
--
-- The venues JSON also carries a stray "offset" field (e.g. Valencia: -1)
-- that neither calculate_quote nor the editor UI ever read or write —
-- dead data, same pattern as the stray decor/dj/rentals keys already
-- cleaned up in 00142/00143. Not carried forward.

BEGIN;

ALTER TABLE public.quote_venues ADD COLUMN IF NOT EXISTS lms_venue_id text;

UPDATE public.quote_venues v
SET lms_venue_id = src.lms_venue_id
FROM (
  SELECT parent->>'id' AS id, parent->>'lms_venue_id' AS lms_venue_id
  FROM public.quote_config, jsonb_array_elements(value) AS parent
  WHERE key = 'venues'
) src
WHERE v.id = src.id;

COMMIT;
