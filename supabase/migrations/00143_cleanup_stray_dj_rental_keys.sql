-- Same pattern as 00142 (stray decor keys), found while pulling the full
-- quote_config dump for the Phase 1 table migration: dj carries a 'test'
-- parent-venue entry that matches no real venue id, and rentals carries
-- 'test' plus two purely numeric keys ('3', '4') that match no venue id
-- either. None of these are read by calculate_quote (which only ever looks
-- up a real venue/parent id) or written by RateCardEditor.jsx.

BEGIN;

UPDATE public.quote_config SET value = value - 'test' WHERE key = 'dj';
UPDATE public.quote_config SET value = value - '3' - '4' - 'test' WHERE key = 'rentals';

COMMIT;
