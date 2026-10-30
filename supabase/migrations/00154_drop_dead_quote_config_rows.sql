-- Phase 4 cleanup: drop the quote_config rows that Phase 1-3 (00144-00153)
-- moved into the quote_* tables, plus the manual backup/snapshot keys
-- (_v0_backup_*, *_pre_restro_leaf, *_backup_2026*) and menu_formula (dead
-- since the sliding-curve pricing was killed in 00117) that turned up in a
-- full key-list introspection but were never read by any live code.
--
-- Confirmed still needed and left alone: the 5 rental cascade-offset
-- scalars (rental_filler_offset, rental_perfect_offset,
-- rental_pushpanjali_exotica_offset, rental_pushpanjali_manaktala_offset,
-- rental_tier_pct — see rateCardData.js's EDITOR_ONLY_KEYS) and
-- lms_locations (QuoteCalculator.jsx, sync-events — genuinely separate from
-- this migration).
--
-- Explicit delete-list rather than a NOT IN keep-list, so a key added
-- between this review and running this migration isn't swept up by
-- accident.

BEGIN;

DELETE FROM public.quote_config WHERE key IN (
  '_v0_backup_decor',
  '_v0_backup_decor_bnw',
  '_v0_backup_decor_eg',
  '_v0_backup_decor_valencia',
  '_v0_backup_dj',
  '_v0_backup_dj_eg',
  '_v0_backup_dj_valencia',
  '_v0_backup_lms_locations',
  '_v0_backup_lunch_decor',
  '_v0_backup_menu',
  '_v0_backup_rentals',
  '_v0_backup_ttd',
  '_v0_backup_venues',
  'categories',
  'categories_backup_20261014',
  'decor',
  'decor_backup_20260922',
  'decor_pre_restro_leaf',
  'dj',
  'event_types',
  'inquiry_modes',
  'lms_locations_pre_restro_leaf',
  'menu',
  'menu_formula',
  'menu_lms',
  'rentals',
  'rentals_backup_20260922',
  'rentals_backup_20261014',
  'rentals_pre_restro_leaf',
  'season_dates',
  'slots',
  'slots_backup_20261014',
  'ttd',
  'ttd_restro',
  'venues',
  'venues_pre_restro_leaf'
);

COMMIT;
