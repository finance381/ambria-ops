-- Verification found a mismatch on 'restro': v1 returns
-- venue_decor_mode=null, decor_relevance=[] (no dollar difference here,
-- since restro's decor table happens to be all zeros, but a real
-- discrepancy in general). decor_mode turns out not to be fully derivable
-- from a venue's decor_rate_cards row count after all — it's its own
-- independent on/off switch (missing/empty = "decor doesn't apply to this
-- venue, full stop", regardless of whatever stale rows sit in its decor
-- table). Restro has 3 leftover tier rows (all zero) but no decor_mode, so
-- the original system ignores them entirely; v2 was deriving "how many
-- tiers" purely from row count and found those 3 stale rows.
--
-- Storing decor_mode explicitly, as the gate it actually is: tier count
-- still comes from real rows (that part of the design holds), but only
-- gets consulted when decor_mode is one of 'p'/'eg'/'f' — exactly
-- mirroring the original IF/ELSIF/ELSE chain's structure.

BEGIN;

ALTER TABLE public.quote_venues ADD COLUMN IF NOT EXISTS decor_mode text;

UPDATE public.quote_venues v
SET decor_mode = src.decor_mode
FROM (
  SELECT parent->>'id' AS id, parent->>'decor_mode' AS decor_mode
  FROM public.quote_config, jsonb_array_elements(value) AS parent
  WHERE key = 'venues'
  UNION ALL
  SELECT sub->>'id', sub->>'decor_mode'
  FROM public.quote_config,
       jsonb_array_elements(value) AS parent,
       jsonb_array_elements(parent->'sub_venues') AS sub
  WHERE key = 'venues'
) src
WHERE v.id = src.id;

COMMIT;
