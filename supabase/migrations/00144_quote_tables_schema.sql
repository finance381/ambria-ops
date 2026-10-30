-- Phase 1 of the quote_config JSONB -> tables migration: the new tables,
-- built alongside the existing quote_config rows. Nothing reads from these
-- yet — calculate_quote and RateCardEditor.jsx are untouched by this
-- migration. Next up: a backfill from the live quote_config data, then a
-- calculate_quote_v2 built on these tables, verified side by side with the
-- original before anything in the app points at it.
--
-- quote_date_categories.id and quote_slots.id are real primary keys, not
-- serials, and are backfilled to exactly match the OLD array positions
-- (0, 1, 2, ...) that quotes.date_category / quotes.slot / quote_config's
-- own arrays already reference everywhere. This is deliberate: it means
-- every already-saved quote's stored integers keep meaning exactly what
-- they mean today, with no remapping step, for as long as both systems
-- exist side by side.
--
-- decor_idx / dj_idx / menu_idx / ttd_idx stay meaningful the same way, but
-- scoped per venue (or variant, for menu) rather than globally — sort_order
-- on each table below plays that role; calculate_quote_v2 will look up "the
-- row at this venue's own sort_order N", exactly replicating what a
-- position in that venue's old labels array meant.

BEGIN;

CREATE TABLE public.quote_date_categories (
  id int PRIMARY KEY,
  label text NOT NULL,
  color text,
  sort_order int NOT NULL
);

CREATE TABLE public.quote_slots (
  id int PRIMARY KEY,
  label text NOT NULL,
  is_lunch boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL
);

CREATE TABLE public.quote_venues (
  id text PRIMARY KEY,
  parent_id text REFERENCES public.quote_venues(id),
  name text NOT NULL,
  location text,
  status text NOT NULL DEFAULT 'live',
  sort_order int NOT NULL DEFAULT 0
);

-- One row per decor package tier a venue offers, for its regular pricing
-- AND separately for its Lunch override (is_lunch_override=true) — flagged,
-- not nested, so "how many tiers" and "flat vs tiered" is just "how many
-- rows exist", never an ambiguous array shape. A 1-row card set replaces
-- decor_mode='f'; a 2-row set replaces 'eg'; a 3-row set replaces 'p'; no
-- rows at all replaces decor_mode=''.
CREATE TABLE public.quote_decor_rate_cards (
  id serial PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.quote_venues(id),
  tier_label text NOT NULL,
  is_lunch_override boolean NOT NULL DEFAULT false,
  nw_offset numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (venue_id, is_lunch_override, sort_order)
);

CREATE TABLE public.quote_decor_rate_cells (
  id serial PRIMARY KEY,
  rate_card_id int NOT NULL REFERENCES public.quote_decor_rate_cards(id) ON DELETE CASCADE,
  date_category_id int NOT NULL REFERENCES public.quote_date_categories(id),
  quote_amt numeric, target_amt numeric, floor_amt numeric,
  UNIQUE (rate_card_id, date_category_id)
);

-- Always one row per (venue, date_category, slot) — rentals never had a
-- flat/tiered split in the old config, so there's no card-set indirection
-- needed here the way decor needs one.
CREATE TABLE public.quote_rental_rate_cells (
  id serial PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.quote_venues(id),
  date_category_id int NOT NULL REFERENCES public.quote_date_categories(id),
  slot_id int NOT NULL REFERENCES public.quote_slots(id),
  quote_amt numeric, target_amt numeric, floor_amt numeric,
  UNIQUE (venue_id, date_category_id, slot_id)
);

-- DJ is keyed by the PARENT venue (shared across its sub-venues), same as
-- quote_config.dj today.
CREATE TABLE public.quote_dj_options (
  id serial PRIMARY KEY,
  parent_venue_id text NOT NULL REFERENCES public.quote_venues(id),
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.quote_dj_rate_cells (
  id serial PRIMARY KEY,
  dj_option_id int NOT NULL REFERENCES public.quote_dj_options(id) ON DELETE CASCADE,
  date_category_id int NOT NULL REFERENCES public.quote_date_categories(id),
  quote_amt numeric, target_amt numeric, floor_amt numeric,
  UNIQUE (dj_option_id, date_category_id)
);

-- 'quote_calc' and 'lms_push' stay two independent variants, same as today
-- (menu vs menu_lms) — the old editor's one-way "Copy from QC" button is
-- just "duplicate these rows into the other variant", not a live link.
-- is_sliding is dropped: confirmed dead, no editor control, never read by
-- calculate_quote.
CREATE TABLE public.quote_menu_items (
  id serial PRIMARY KEY,
  variant text NOT NULL CHECK (variant IN ('quote_calc', 'lms_push')),
  label text NOT NULL,
  base_rate numeric NOT NULL DEFAULT 0,
  flat_add numeric NOT NULL DEFAULT 0,
  max_pax int,
  restro_only boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.quote_menu_item_also_available (
  menu_item_id int NOT NULL REFERENCES public.quote_menu_items(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.quote_venues(id),
  PRIMARY KEY (menu_item_id, venue_id)
);

CREATE TABLE public.quote_menu_settings (
  variant text PRIMARY KEY CHECK (variant IN ('quote_calc', 'lms_push')),
  nv_upgrade numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.quote_ttd_discounts (
  id serial PRIMARY KEY,
  is_restro boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  discount_pct numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.quote_event_types (
  id serial PRIMARY KEY,
  label text NOT NULL,
  icon text,
  is_wedding boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.quote_inquiry_modes (
  id serial PRIMARY KEY,
  label text NOT NULL,
  lms_code text,
  sort_order int NOT NULL DEFAULT 0
);

-- year NULL = the legacy "MM-DD, applies every year with no explicit entry
-- of its own" fallback season_dates already supports; a non-null year is a
-- specific-date override, same precedence rule as today (exact year wins).
CREATE TABLE public.quote_season_dates (
  id serial PRIMARY KEY,
  year int,
  month int NOT NULL,
  day int NOT NULL,
  date_category_id int NOT NULL REFERENCES public.quote_date_categories(id),
  UNIQUE (year, month, day)
);

COMMIT;
