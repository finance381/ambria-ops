-- Phase 4 cleanup: calculate_quote_v2 (00146/00149) still has the literal
-- `p_date_category = 2`/`2` fallback that 00146's own header flagged as
-- Phase 4 work ("replacing that literal with something named, e.g. a flag
-- on quote_date_categories"). quote_slots already got its `is_lunch` flag
-- in 00144 for the matching `p_slot = 2` literal; this gives
-- quote_date_categories the equivalent flag so the next migration can read
-- both instead of hardcoding 2.
--
-- Exactly one row should ever carry this flag — the partial unique index
-- enforces that the same way a second `is_lunch` slot would need its own
-- guard (not added since there's genuinely only one lunch slot today).

BEGIN;

ALTER TABLE public.quote_date_categories ADD COLUMN IF NOT EXISTS is_lunch_decor_default boolean NOT NULL DEFAULT false;

UPDATE public.quote_date_categories SET is_lunch_decor_default = true WHERE id = 2;

CREATE UNIQUE INDEX IF NOT EXISTS quote_date_categories_one_lunch_default
  ON public.quote_date_categories ((is_lunch_decor_default))
  WHERE is_lunch_decor_default;

COMMIT;
