-- The verification pass (calculate_quote vs calculate_quote_v2 across every
-- real combination) found calculate_quote_v2 pricing 'exotica' and
-- 'manaktala' directly, when the original returns venue_not_found for both.
-- calculate_quote's leaf resolution deliberately only accepts a parent
-- venue as a leaf when it has ZERO sub_venues (a parent with subs isn't
-- bookable on its own — only Aura/Valencia under Exotica, or
-- Alstonia/Emerald Green under Manaktala, are). quote_venues has a row for
-- every parent regardless of whether it has children, so a plain id lookup
-- found exotica/manaktala when it shouldn't have.

CREATE OR REPLACE FUNCTION public.calculate_quote_v2(p_venue_id text, p_pax integer, p_slot integer, p_date_category integer, p_menu_idx integer, p_decor_idx integer, p_dj_idx integer, p_ttd_idx integer, p_is_wedding boolean, p_food_pref integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_venue record;
  v_leaf_id text; v_parent_id text; v_ven_name text; v_ven_loc text; v_status text;
  v_regular_tier_count int; v_dm text; v_decor_rel jsonb;
  v_use_override boolean; v_edc int; v_active_decor_idx int; v_decor_count int;
  v_dq numeric; v_dt numeric; v_df numeric; v_nw_off numeric;
  v_rq numeric; v_rt numeric; v_rf numeric;
  v_djq numeric; v_djt numeric; v_djf numeric;
  v_vq numeric; v_vt numeric; v_vf numeric; v_gq numeric; v_gt numeric; v_gf numeric;
  v_menu_count int; v_active int; v_act_flat numeric; v_per_head numeric; v_menu_cost numeric; v_nv_up numeric;
  v_all_menus jsonb := '[]'::jsonb; v_avail jsonb := '[]'::jsonb; v_menu_label text;
  mi record; v_available boolean; v_reason text;
  v_use_restro_ttd boolean; v_discount numeric; v_ttd_out jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.quote_venues WHERE id = p_venue_id;

  -- A parent with sub-venues is not itself a bookable leaf — only its subs
  -- are (matches calculate_quote's "parent-as-leaf only when sub_venues is
  -- empty" rule).
  IF v_venue IS NOT NULL AND v_venue.parent_id IS NULL
     AND EXISTS (SELECT 1 FROM public.quote_venues WHERE parent_id = v_venue.id) THEN
    v_venue := NULL;
  END IF;

  IF v_venue IS NULL THEN
    RETURN jsonb_build_object('error', 'venue_not_found', 'venue_id', p_venue_id);
  END IF;

  v_leaf_id := v_venue.id;
  v_parent_id := COALESCE(v_venue.parent_id, v_venue.id);
  v_ven_name := v_venue.name;
  v_ven_loc := v_venue.location;
  v_status := v_venue.status;

  IF v_status = 'placeholder' THEN
    RETURN jsonb_build_object('venue_id', v_leaf_id, 'parent_id', v_parent_id,
      'venue_name', v_ven_name, 'venue_location', v_ven_loc, 'is_placeholder', true);
  END IF;

  v_nv_up := CASE WHEN p_food_pref = 1 THEN (SELECT nv_upgrade FROM public.quote_menu_settings WHERE variant = 'quote_calc') ELSE 0 END;

  -- Menu loop (mirrors the all_menus/available_menus construction exactly)
  v_menu_count := (SELECT count(*) FROM public.quote_menu_items WHERE variant = 'quote_calc');
  v_active := p_menu_idx;
  FOR mi IN SELECT * FROM public.quote_menu_items WHERE variant = 'quote_calc' ORDER BY sort_order LOOP
    v_available := true; v_reason := null;
    IF mi.restro_only AND v_parent_id != 'restro' THEN
      IF NOT EXISTS (SELECT 1 FROM public.quote_menu_item_also_available WHERE menu_item_id = mi.id AND venue_id = v_parent_id) THEN
        v_available := false; v_reason := 'Restro exclusive';
      END IF;
    END IF;
    v_all_menus := v_all_menus || jsonb_build_object('idx', mi.sort_order, 'label', mi.label, 'per_head', mi.base_rate + v_nv_up, 'flat_add', mi.flat_add, 'max_pax', mi.max_pax, 'available', v_available, 'reason', v_reason);
    IF v_available THEN
      v_avail := v_avail || jsonb_build_object('idx', mi.sort_order, 'per_head', mi.base_rate + v_nv_up, 'flat_add', mi.flat_add);
    END IF;
  END LOOP;

  IF v_active < 0 OR v_active > v_menu_count - 1 THEN v_active := 0; END IF;

  SELECT base_rate + v_nv_up, flat_add, label INTO v_per_head, v_act_flat, v_menu_label
  FROM public.quote_menu_items WHERE variant = 'quote_calc' AND sort_order = v_active;

  v_menu_cost := ROUND((v_per_head * p_pax)::numeric / 100000, 2) + v_act_flat;

  v_use_restro_ttd := (v_parent_id = 'restro');
  SELECT discount_pct INTO v_discount FROM public.quote_ttd_discounts WHERE is_restro = v_use_restro_ttd AND sort_order = p_ttd_idx;
  v_discount := COALESCE(v_discount, 0);

  SELECT quote_amt, target_amt, floor_amt INTO v_rq, v_rt, v_rf
  FROM public.quote_rental_rate_cells
  WHERE venue_id = v_leaf_id AND date_category_id = p_date_category AND slot_id = p_slot;

  v_rq := GREATEST(2, ROUND((v_rq * (1 - v_discount)) * 100) / 100);
  v_rt := GREATEST(2, ROUND((v_rt * (1 - v_discount)) * 100) / 100);
  v_rf := GREATEST(2, ROUND((v_rf * (1 - v_discount)) * 100) / 100);

  v_vq := ROUND((v_menu_cost + v_rq)::numeric, 2);
  v_vt := ROUND((v_menu_cost + v_rt)::numeric, 2);
  v_vf := ROUND((v_menu_cost + v_rf)::numeric, 2);

  -- Decor: unified across every tier count instead of branching on a stored
  -- mode — a 1/2/3-row card set behaves exactly like the old 'f'/'eg'/'p',
  -- and 0 rows like decor_mode=''.
  v_regular_tier_count := (SELECT count(*) FROM public.quote_decor_rate_cards WHERE venue_id = v_leaf_id AND is_lunch_override = false);
  v_dm := CASE v_regular_tier_count WHEN 1 THEN 'f' WHEN 2 THEN 'eg' WHEN 3 THEN 'p' ELSE '' END;
  SELECT COALESCE(jsonb_agg(true), '[]'::jsonb) INTO v_decor_rel FROM generate_series(1, v_regular_tier_count);

  v_use_override := p_slot = 2 AND EXISTS (SELECT 1 FROM public.quote_decor_rate_cards WHERE venue_id = v_leaf_id AND is_lunch_override = true);
  v_edc := CASE WHEN v_use_override THEN p_date_category WHEN p_slot = 2 THEN 2 ELSE p_date_category END;

  v_decor_count := (SELECT count(*) FROM public.quote_decor_rate_cards WHERE venue_id = v_leaf_id AND is_lunch_override = v_use_override);
  IF v_decor_count = 0 THEN
    v_dq := 0; v_dt := 0; v_df := 0;
  ELSE
    v_active_decor_idx := CASE WHEN p_decor_idx < 0 OR p_decor_idx > v_decor_count - 1 THEN 0 ELSE p_decor_idx END;

    SELECT c.quote_amt, c.target_amt, c.floor_amt, r.nw_offset INTO v_dq, v_dt, v_df, v_nw_off
    FROM public.quote_decor_rate_cards r
    JOIN public.quote_decor_rate_cells c ON c.rate_card_id = r.id AND c.date_category_id = v_edc
    WHERE r.venue_id = v_leaf_id AND r.is_lunch_override = v_use_override AND r.sort_order = v_active_decor_idx;

    IF NOT p_is_wedding THEN
      v_dq := v_dq + COALESCE(v_nw_off, 0); v_dt := v_dt + COALESCE(v_nw_off, 0); v_df := v_df + COALESCE(v_nw_off, 0);
    END IF;
  END IF;

  SELECT c.quote_amt, c.target_amt, c.floor_amt INTO v_djq, v_djt, v_djf
  FROM public.quote_dj_options o
  JOIN public.quote_dj_rate_cells c ON c.dj_option_id = o.id AND c.date_category_id = p_date_category
  WHERE o.parent_venue_id = v_parent_id AND o.sort_order = p_dj_idx;
  v_djq := COALESCE(v_djq, 0); v_djt := COALESCE(v_djt, 0); v_djf := COALESCE(v_djf, 0);

  v_gq := CEIL((v_vq + v_dq + v_djq)::numeric * 2) / 2;
  v_gt := CEIL((v_vt + v_dt + v_djt)::numeric * 2) / 2;
  v_gf := CEIL((v_vf + v_df + v_djf)::numeric * 2) / 2;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'pct', discount_pct) ORDER BY sort_order), '[]'::jsonb) INTO v_ttd_out
  FROM public.quote_ttd_discounts WHERE is_restro = v_use_restro_ttd;

  RETURN jsonb_build_object(
    'venue_id', v_leaf_id, 'parent_id', v_parent_id,
    'venue_name', v_ven_name, 'venue_location', v_ven_loc, 'venue_decor_mode', v_dm, 'is_placeholder', false,
    'all_menus', v_all_menus, 'available_menus', v_avail, 'active_menu', v_active,
    'menu_label', v_menu_label, 'per_head', v_per_head, 'menu_cost', v_menu_cost,
    'rental', jsonb_build_object('q', v_rq, 't', v_rt, 'f', v_rf),
    'vm', jsonb_build_object('q', v_vq, 't', v_vt, 'f', v_vf),
    'decor', jsonb_build_object('q', v_dq, 't', v_dt, 'f', v_df),
    'decor_relevance', v_decor_rel,
    'dj', jsonb_build_object('q', v_djq, 't', v_djt, 'f', v_djf),
    'total', jsonb_build_object('q', v_gq, 't', v_gt, 'f', v_gf),
    'ttd', v_ttd_out
  );
END;
$function$;
