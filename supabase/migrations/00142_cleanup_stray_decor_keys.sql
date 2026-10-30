-- quote_config.decor carries five stray top-level keys (f, q, t, nw_offset,
-- test) sitting as siblings to the real venue ids instead of nested inside
-- one — confirmed by the quote_config audit to be read by neither
-- calculate_quote (which only ever does decor_all->leaf_id, a real venue
-- id) nor written by any path in RateCardEditor.jsx. Leftover from a manual
-- edit or an old script, not live data. Removing them so the decor config
-- only ever contains real venue entries.

BEGIN;

UPDATE public.quote_config
SET value = value - 'f' - 'q' - 't' - 'nw_offset' - 'test'
WHERE key = 'decor';

COMMIT;
