-- season-export and lms-push (edge functions, outside this app's own
-- src/) both still read quote_config directly for data Phase 3 moved to
-- quote_date_categories/quote_season_dates/quote_venues/quote_decor_rate_cards/
-- quote_dj_options — fixed in those functions' own files. season-export
-- additionally reports an updated_at freshness timestamp, which the old
-- quote_config rows carried but these new tables don't; adding it here
-- rather than approximating freshness another way.

BEGIN;

ALTER TABLE public.quote_date_categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.quote_season_dates ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
