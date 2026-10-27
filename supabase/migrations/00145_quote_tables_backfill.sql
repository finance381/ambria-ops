-- One-time backfill of the Phase 1 tables (00144) from the live
-- quote_config JSONB. Read-only against quote_config — nothing in the old
-- system is touched, so this can be re-run from a clean slate if the
-- verification pass (comparing calculate_quote against calculate_quote_v2,
-- built next) turns up anything that needs correcting here first.
--
-- Everything joins against quote_venues (inserted first, below) rather than
-- trusting raw object keys from decor/rentals/dj directly — that join is
-- what keeps any leftover stray key (same pattern as the ones already
-- cleaned out in 00142/00143) from ever reaching the new tables, present or
-- future, without needing its own exclusion list.
--
-- date_categories.id and slots.id are inserted as the literal 0-based
-- position from quote_config's categories/slots arrays (see 00144's
-- comment) — every ->id below is intentionally an integer array index, not
-- an arbitrary foreign key.

BEGIN;

TRUNCATE
  public.quote_decor_rate_cells, public.quote_decor_rate_cards,
  public.quote_rental_rate_cells,
  public.quote_dj_rate_cells, public.quote_dj_options,
  public.quote_menu_item_also_available, public.quote_menu_items, public.quote_menu_settings,
  public.quote_ttd_discounts, public.quote_event_types, public.quote_inquiry_modes,
  public.quote_season_dates,
  public.quote_venues, public.quote_slots, public.quote_date_categories
  RESTART IDENTITY;

-- ── date_categories, slots ──────────────────────────────────────────────
INSERT INTO public.quote_date_categories (id, label, color, sort_order)
SELECT (ord - 1)::int, elem->>'label', elem->>'color', (ord - 1)::int
FROM public.quote_config, jsonb_array_elements(value) WITH ORDINALITY AS t(elem, ord)
WHERE key = 'categories';

INSERT INTO public.quote_slots (id, label, is_lunch, sort_order)
SELECT (ord - 1)::int, elem, lower(elem) = 'lunch', (ord - 1)::int
FROM public.quote_config, jsonb_array_elements_text(value) WITH ORDINALITY AS t(elem, ord)
WHERE key = 'slots';

-- ── venues (parents first, then subs referencing them) ──────────────────
INSERT INTO public.quote_venues (id, parent_id, name, location, status, sort_order)
SELECT parent->>'id', NULL, parent->>'name', parent->>'location', COALESCE(parent->>'status', 'live'), (p_ord - 1)::int
FROM public.quote_config, jsonb_array_elements(value) WITH ORDINALITY AS p(parent, p_ord)
WHERE key = 'venues';

INSERT INTO public.quote_venues (id, parent_id, name, location, status, sort_order)
SELECT sub->>'id', parent->>'id', sub->>'name', parent->>'location', COALESCE(sub->>'status', 'live'), (s_ord - 1)::int
FROM public.quote_config,
     jsonb_array_elements(value) WITH ORDINALITY AS p(parent, p_ord),
     jsonb_array_elements(p.parent->'sub_venues') WITH ORDINALITY AS s(sub, s_ord)
WHERE key = 'venues';

-- ── decor: one row per tier that actually exists, regular and lunch
--    override kept separate by is_lunch_override. The branch below is the
--    same flat-vs-nested distinction fn_quote_grid_val reads defensively at
--    query time — here it's resolved once, into real rows, so nothing ever
--    has to guess the shape again. ──────────────────────────────────────
DO $migrate_decor$
DECLARE
  dv record;
  v_card_id int;
  v_idx int;
  v_tier_count int;
  v_lunch jsonb;
BEGIN
  FOR dv IN
    SELECT e.key AS venue_key, e.value AS val
    FROM public.quote_config qc, jsonb_each(qc.value) AS e(key, value)
    JOIN public.quote_venues qv ON qv.id = e.key
    WHERE qc.key = 'decor'
  LOOP
    -- Regular tiers — always nested (q[tier][date_category]) in the live
    -- data; no venue's own regular table is stored flat.
    v_tier_count := jsonb_array_length(dv.val->'labels');
    FOR v_idx IN 0..(v_tier_count - 1) LOOP
      INSERT INTO public.quote_decor_rate_cards (venue_id, tier_label, is_lunch_override, nw_offset, sort_order)
      VALUES (dv.venue_key, dv.val->'labels'->>v_idx, false, COALESCE((dv.val->>'nw_offset')::numeric, 0), v_idx)
      RETURNING id INTO v_card_id;

      INSERT INTO public.quote_decor_rate_cells (rate_card_id, date_category_id, quote_amt, target_amt, floor_amt)
      SELECT v_card_id, dc.id,
        (dv.val->'q'->v_idx->>dc.id)::numeric,
        (dv.val->'t'->v_idx->>dc.id)::numeric,
        (dv.val->'f'->v_idx->>dc.id)::numeric
      FROM public.quote_date_categories dc;
    END LOOP;

    -- Lunch override, when present — either tiered (nested, same shape as
    -- regular — Pushpanjali) or flat (one unnamed tier, q/t/f indexed
    -- directly by date category — Valencia/Aura/Alstonia/Emerald Green,
    -- the exact shape the original ₹0 bug came from).
    v_lunch := dv.val->'lunch_override';
    IF v_lunch IS NOT NULL THEN
      IF jsonb_array_length(COALESCE(v_lunch->'labels', '[]'::jsonb)) > 0 THEN
        v_tier_count := jsonb_array_length(v_lunch->'labels');
        FOR v_idx IN 0..(v_tier_count - 1) LOOP
          INSERT INTO public.quote_decor_rate_cards (venue_id, tier_label, is_lunch_override, nw_offset, sort_order)
          VALUES (dv.venue_key, v_lunch->'labels'->>v_idx, true, COALESCE((v_lunch->>'nw_offset')::numeric, 0), v_idx)
          RETURNING id INTO v_card_id;

          INSERT INTO public.quote_decor_rate_cells (rate_card_id, date_category_id, quote_amt, target_amt, floor_amt)
          SELECT v_card_id, dc.id,
            (v_lunch->'q'->v_idx->>dc.id)::numeric,
            (v_lunch->'t'->v_idx->>dc.id)::numeric,
            (v_lunch->'f'->v_idx->>dc.id)::numeric
          FROM public.quote_date_categories dc;
        END LOOP;
      ELSIF jsonb_array_length(COALESCE(v_lunch->'q', '[]'::jsonb)) > 0 THEN
        INSERT INTO public.quote_decor_rate_cards (venue_id, tier_label, is_lunch_override, nw_offset, sort_order)
        VALUES (dv.venue_key, 'Lunch', true, COALESCE((v_lunch->>'nw_offset')::numeric, 0), 0)
        RETURNING id INTO v_card_id;

        INSERT INTO public.quote_decor_rate_cells (rate_card_id, date_category_id, quote_amt, target_amt, floor_amt)
        SELECT v_card_id, dc.id,
          (v_lunch->'q'->>dc.id)::numeric,
          (v_lunch->'t'->>dc.id)::numeric,
          (v_lunch->'f'->>dc.id)::numeric
        FROM public.quote_date_categories dc;
      END IF;
    END IF;
  END LOOP;
END
$migrate_decor$;

-- ── rentals: always nested (q[date_category][slot]), no flat variant ever
--    existed for this key. ───────────────────────────────────────────────
INSERT INTO public.quote_rental_rate_cells (venue_id, date_category_id, slot_id, quote_amt, target_amt, floor_amt)
SELECT v.id, dc.id, s.id,
  (rv.value->'q'->dc.id->>s.id)::numeric,
  (rv.value->'t'->dc.id->>s.id)::numeric,
  (rv.value->'f'->dc.id->>s.id)::numeric
FROM public.quote_config qc, jsonb_each(qc.value) AS rv(venue_key, value)
JOIN public.quote_venues v ON v.id = rv.venue_key
CROSS JOIN public.quote_date_categories dc
CROSS JOIN public.quote_slots s
WHERE qc.key = 'rentals';

-- ── dj: keyed by PARENT venue, always nested (q[option][date_category]).
INSERT INTO public.quote_dj_options (parent_venue_id, label, sort_order)
SELECT v.id, lbl, (l_ord - 1)::int
FROM public.quote_config qc, jsonb_each(qc.value) AS dv(venue_key, value)
JOIN public.quote_venues v ON v.id = dv.venue_key
, jsonb_array_elements_text(dv.value->'labels') WITH ORDINALITY AS t(lbl, l_ord)
WHERE qc.key = 'dj';

INSERT INTO public.quote_dj_rate_cells (dj_option_id, date_category_id, quote_amt, target_amt, floor_amt)
SELECT o.id, dc.id,
  (dv.value->'q'->o.sort_order->>dc.id)::numeric,
  (dv.value->'t'->o.sort_order->>dc.id)::numeric,
  (dv.value->'f'->o.sort_order->>dc.id)::numeric
FROM public.quote_dj_options o
JOIN public.quote_config qc ON qc.key = 'dj'
JOIN jsonb_each(qc.value) AS dv(venue_key, value) ON dv.venue_key = o.parent_venue_id
CROSS JOIN public.quote_date_categories dc;

-- ── menu + menu_lms: two independent variants, same as today; is_sliding
--    dropped (confirmed dead — no editor control, never read). ──────────
INSERT INTO public.quote_menu_items (variant, label, base_rate, flat_add, max_pax, restro_only, sort_order)
SELECT 'quote_calc', m.value->'labels'->>i.idx,
  (m.value->'base_rate'->>i.idx)::numeric,
  (m.value->'flat_add'->>i.idx)::numeric,
  (m.value->'max_pax'->>i.idx)::int,
  COALESCE((m.value->'restro_only'->>i.idx)::boolean, false),
  i.idx
FROM public.quote_config m, generate_series(0, jsonb_array_length(m.value->'labels') - 1) AS i(idx)
WHERE m.key = 'menu'
UNION ALL
SELECT 'lms_push', m.value->'labels'->>i.idx,
  (m.value->'base_rate'->>i.idx)::numeric,
  (m.value->'flat_add'->>i.idx)::numeric,
  (m.value->'max_pax'->>i.idx)::int,
  COALESCE((m.value->'restro_only'->>i.idx)::boolean, false),
  i.idx
FROM public.quote_config m, generate_series(0, jsonb_array_length(m.value->'labels') - 1) AS i(idx)
WHERE m.key = 'menu_lms';

INSERT INTO public.quote_menu_item_also_available (menu_item_id, venue_id)
SELECT mi.id, elem
FROM public.quote_menu_items mi
JOIN public.quote_config m ON m.key = CASE WHEN mi.variant = 'quote_calc' THEN 'menu' ELSE 'menu_lms' END
, jsonb_array_elements_text(COALESCE(m.value->'also_available_on'->mi.sort_order, '[]'::jsonb)) AS elem;

INSERT INTO public.quote_menu_settings (variant, nv_upgrade)
SELECT 'quote_calc', (value->>'nv_upgrade')::numeric FROM public.quote_config WHERE key = 'menu'
UNION ALL
SELECT 'lms_push', (value->>'nv_upgrade')::numeric FROM public.quote_config WHERE key = 'menu_lms';

-- ── ttd + ttd_restro ──────────────────────────────────────────────────
INSERT INTO public.quote_ttd_discounts (is_restro, label, discount_pct, sort_order)
SELECT false, t.value->'labels'->>i.idx, (t.value->'discounts'->>i.idx)::numeric, i.idx
FROM public.quote_config t, generate_series(0, jsonb_array_length(t.value->'labels') - 1) AS i(idx)
WHERE t.key = 'ttd'
UNION ALL
SELECT true, t.value->'labels'->>i.idx, (t.value->'discounts'->>i.idx)::numeric, i.idx
FROM public.quote_config t, generate_series(0, jsonb_array_length(t.value->'labels') - 1) AS i(idx)
WHERE t.key = 'ttd_restro';

-- ── event_types, inquiry_modes ────────────────────────────────────────
INSERT INTO public.quote_event_types (label, icon, is_wedding, pinned, sort_order)
SELECT elem->>'label', elem->>'icon', COALESCE((elem->>'wedding')::boolean, false), COALESCE((elem->>'pinned')::boolean, false), (ord - 1)::int
FROM public.quote_config, jsonb_array_elements(value) WITH ORDINALITY AS t(elem, ord)
WHERE key = 'event_types';

INSERT INTO public.quote_inquiry_modes (label, sort_order)
SELECT elem, (ord - 1)::int
FROM public.quote_config, jsonb_array_elements_text(value) WITH ORDINALITY AS t(elem, ord)
WHERE key = 'inquiry_modes';

-- ── season_dates: "MM-DD" (length 5) is the year-less recurring fallback,
--    "YYYY-MM-DD" (length 10) is a specific-year override. ──────────────
INSERT INTO public.quote_season_dates (year, month, day, date_category_id)
SELECT
  CASE WHEN length(sd.key) = 10 THEN split_part(sd.key, '-', 1)::int ELSE NULL END,
  CASE WHEN length(sd.key) = 10 THEN split_part(sd.key, '-', 2)::int ELSE split_part(sd.key, '-', 1)::int END,
  CASE WHEN length(sd.key) = 10 THEN split_part(sd.key, '-', 3)::int ELSE split_part(sd.key, '-', 2)::int END,
  sd.value::int
FROM public.quote_config qc, jsonb_each_text(qc.value) AS sd(key, value)
WHERE qc.key = 'season_dates';

COMMIT;
