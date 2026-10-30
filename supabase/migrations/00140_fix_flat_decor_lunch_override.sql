-- Valencia (decor_mode 'f') priced ₹0 décor on a Lunch booking. Its Lunch
-- override activated correctly (q/t/f are populated, non-empty), but
-- calculate_quote always read a decor cell as a nested grid —
-- (cfg->field->row->>col) — assuming a tier row like
-- [[4, 3.5, 3]] (Valencia's own REGULAR décor table, one tier named
-- "Valencia flat"). RateCardEditor.jsx's flat-mode Lunch override editor
-- (no named tiers) instead saves a plain one-level array — q: [2.5, 2, 2] —
-- so (cfg->'q'->0) pulled out a single NUMBER, and indexing a number with
-- ->>col always returns NULL. Confirmed live: quote_config.decor->'valencia'
-- carries both shapes side by side.
--
-- fn_decor_grid_val reads either shape correctly by checking what's
-- actually at that row before indexing into it, so it drops in wherever a
-- decor cell was being read and changes nothing for configs already shaped
-- as a nested grid.
--
-- Also widens the 'p'/'eg' Lunch-override activation check, which only
-- ever looked at 'labels' — a flat 'p'/'eg' Lunch override (labels empty,
-- q/t/f populated, same shape Valencia's turned out to have) would have
-- silently never activated at all, same root cause as the 'f' branch here,
-- just not yet hit by this specific venue's config.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_decor_grid_val(p_cfg jsonb, p_field text, p_row int, p_col int)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN jsonb_typeof((p_cfg->p_field)->p_row) = 'array' THEN ((p_cfg->p_field)->p_row->>p_col)::numeric
    ELSE ((p_cfg->p_field)->>p_col)::numeric
  END
$function$;

CREATE OR REPLACE FUNCTION public.calculate_quote(p_venue_id text, p_pax integer, p_slot integer, p_date_category integer, p_menu_idx integer, p_decor_idx integer, p_dj_idx integer, p_ttd_idx integer, p_is_wedding boolean, p_food_pref integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg jsonb; v_venues jsonb; v_rentals jsonb; v_menu jsonb;
  v_decor_all jsonb; v_dj_all jsonb; v_ttd_cfg jsonb;
  v_leaf_json jsonb; v_parent_json jsonb; v_leaf_id text; v_parent_id text;
  v_ven_name text; v_ven_loc text; v_dm text; v_status text;
  v_ven_rentals jsonb; v_ven_decor jsonb; v_ven_dj jsonb;
  v_dcfg jsonb; v_lunch_dc jsonb;
  i int; v_ph numeric; v_nv_up numeric; v_flat_add numeric;
  v_max_pax int; v_all_menus jsonb := '[]'::jsonb; v_avail jsonb := '[]'::jsonb;
  v_active int; v_found boolean := false; v_available boolean; v_reason text;
  v_menu_count int; v_restro_only boolean; v_also_avail jsonb;
  v_per_head numeric; v_menu_cost numeric; v_act_flat numeric; v_discount numeric;
  v_rq numeric; v_rt numeric; v_rf numeric; v_edc int;
  v_dq numeric; v_dt numeric; v_df numeric; v_decor_rel jsonb := '[]'::jsonb;
  v_nw_off numeric; v_djq numeric; v_djt numeric; v_djf numeric;
  v_vq numeric; v_vt numeric; v_vf numeric; v_gq numeric; v_gt numeric; v_gf numeric;
  v_ttd_out jsonb := '[]'::jsonb;
BEGIN
  SELECT jsonb_object_agg(key, value) INTO v_cfg FROM public.quote_config WHERE key NOT LIKE '\_v0\_backup\_%' ESCAPE '\';
  v_venues := v_cfg->'venues'; v_rentals := v_cfg->'rentals'; v_menu := v_cfg->'menu';
  v_decor_all := v_cfg->'decor'; v_dj_all := v_cfg->'dj';

  -- Resolve leaf: try parent-as-leaf first, then sub_venue
  SELECT parent INTO v_leaf_json
  FROM jsonb_array_elements(v_venues) parent
  WHERE parent->>'id' = p_venue_id
    AND COALESCE(jsonb_array_length(parent->'sub_venues'), 0) = 0
  LIMIT 1;

  IF v_leaf_json IS NOT NULL THEN
    v_leaf_id := p_venue_id; v_parent_id := p_venue_id;
    v_ven_name := v_leaf_json->>'name'; v_ven_loc := v_leaf_json->>'location';
  ELSE
    SELECT sub, parent INTO v_leaf_json, v_parent_json
    FROM jsonb_array_elements(v_venues) parent,
         jsonb_array_elements(parent->'sub_venues') sub
    WHERE sub->>'id' = p_venue_id
    LIMIT 1;
    IF v_leaf_json IS NULL THEN
      RETURN jsonb_build_object('error', 'venue_not_found', 'venue_id', p_venue_id);
    END IF;
    v_leaf_id := v_leaf_json->>'id'; v_parent_id := v_parent_json->>'id';
    v_ven_name := v_leaf_json->>'name'; v_ven_loc := v_parent_json->>'location';
  END IF;

  v_status := COALESCE(v_leaf_json->>'status', 'live');
  v_dm := v_leaf_json->>'decor_mode';

  IF v_status = 'placeholder' THEN
    RETURN jsonb_build_object('venue_id', v_leaf_id, 'parent_id', v_parent_id,
      'venue_name', v_ven_name, 'venue_location', v_ven_loc, 'is_placeholder', true);
  END IF;

  v_ven_rentals := v_rentals->v_leaf_id;
  v_ven_decor   := v_decor_all->v_leaf_id;
  v_ven_dj      := v_dj_all->v_parent_id;

  -- Pick TTD config: ttd_restro for Restro parent, else default ttd
  IF v_parent_id = 'restro' AND v_cfg->'ttd_restro' IS NOT NULL THEN
    v_ttd_cfg := v_cfg->'ttd_restro';
  ELSE
    v_ttd_cfg := v_cfg->'ttd';
  END IF;

  v_discount := COALESCE((v_ttd_cfg->'discounts'->>p_ttd_idx)::numeric, 0);
  v_nv_up := CASE WHEN p_food_pref = 1 THEN (v_menu->>'nv_upgrade')::numeric ELSE 0 END;
  v_active := p_menu_idx;

  -- Menu loop (was hardcoded 0..3, now iterates all defined menus)
  v_menu_count := jsonb_array_length(v_menu->'labels');
  FOR i IN 0..(v_menu_count - 1) LOOP
    v_max_pax := (v_menu->'max_pax'->>i)::int;
    v_flat_add := (v_menu->'flat_add'->>i)::numeric;
    -- No pax-based sliding: per-head is simply this menu's own base rate.
    v_ph := (v_menu->'base_rate'->>i)::numeric;
    v_ph := v_ph + v_nv_up;

    -- Venue availability: restro_only + also_available_on gate
    v_available := true; v_reason := null;
    v_restro_only := COALESCE((v_menu->'restro_only'->>i)::boolean, false);
    v_also_avail := COALESCE(v_menu->'also_available_on'->i, '[]'::jsonb);
    IF v_restro_only AND v_parent_id != 'restro' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_also_avail) elem
        WHERE elem = v_parent_id
      ) THEN
        v_available := false;
        v_reason := 'Restro exclusive';
      END IF;
    END IF;

    v_all_menus := v_all_menus || jsonb_build_object('idx', i, 'label', v_menu->'labels'->>i, 'per_head', v_ph, 'flat_add', v_flat_add, 'max_pax', v_max_pax, 'available', v_available, 'reason', v_reason);
    IF v_available THEN
      v_avail := v_avail || jsonb_build_object('idx', i, 'per_head', v_ph, 'flat_add', v_flat_add);
      IF i = p_menu_idx THEN v_found := true; END IF;
    END IF;
  END LOOP;

  -- Clamp active menu to valid range (was hardcoded > 3)
  IF v_active < 0 OR v_active > v_menu_count - 1 THEN v_active := 0; END IF;
  v_act_flat := (v_menu->'flat_add'->>v_active)::numeric;
  v_per_head := (v_menu->'base_rate'->>v_active)::numeric;
  v_per_head := v_per_head + v_nv_up;
  v_menu_cost := ROUND((v_per_head * p_pax)::numeric / 100000, 2) + v_act_flat;

  v_rq := GREATEST(2, ROUND(((v_ven_rentals->'q'->p_date_category->>p_slot)::numeric * (1 - v_discount)) * 100) / 100);
  v_rt := GREATEST(2, ROUND(((v_ven_rentals->'t'->p_date_category->>p_slot)::numeric * (1 - v_discount)) * 100) / 100);
  v_rf := GREATEST(2, ROUND(((v_ven_rentals->'f'->p_date_category->>p_slot)::numeric * (1 - v_discount)) * 100) / 100);
  v_vq := ROUND((v_menu_cost + v_rq)::numeric, 2);
  v_vt := ROUND((v_menu_cost + v_rt)::numeric, 2);
  v_vf := ROUND((v_menu_cost + v_rf)::numeric, 2);

  -- Decor branching
  IF v_dm = 'p' THEN
    v_lunch_dc := v_ven_decor->'lunch_override';
    IF p_slot = 2 AND v_lunch_dc IS NOT NULL AND (
      (v_lunch_dc->'labels' IS NOT NULL AND jsonb_array_length(v_lunch_dc->'labels') > 0)
      OR (v_lunch_dc->'q' IS NOT NULL AND jsonb_array_length(v_lunch_dc->'q') > 0)
    ) THEN
      v_dcfg := v_lunch_dc; v_edc := p_date_category;
    ELSE
      v_dcfg := v_ven_decor; v_edc := CASE WHEN p_slot = 2 THEN 2 ELSE p_date_category END;
    END IF;
    IF p_decor_idx < 0 OR p_decor_idx > jsonb_array_length(v_dcfg->'labels') - 1 THEN
      v_dq := public.fn_decor_grid_val(v_dcfg, 'q', 0, v_edc);
      v_dt := public.fn_decor_grid_val(v_dcfg, 't', 0, v_edc);
      v_df := public.fn_decor_grid_val(v_dcfg, 'f', 0, v_edc);
    ELSE
      v_dq := public.fn_decor_grid_val(v_dcfg, 'q', p_decor_idx, v_edc);
      v_dt := public.fn_decor_grid_val(v_dcfg, 't', p_decor_idx, v_edc);
      v_df := public.fn_decor_grid_val(v_dcfg, 'f', p_decor_idx, v_edc);
    END IF;
    IF NOT p_is_wedding THEN
      v_nw_off := COALESCE((v_dcfg->>'nw_offset')::numeric, 0);
      v_dq := v_dq + v_nw_off; v_dt := v_dt + v_nw_off; v_df := v_df + v_nw_off;
    END IF;
    v_decor_rel := '[true, true, true]'::jsonb;

  ELSIF v_dm = 'eg' THEN
    v_lunch_dc := v_ven_decor->'lunch_override';
    IF p_slot = 2 AND v_lunch_dc IS NOT NULL AND (
      (v_lunch_dc->'labels' IS NOT NULL AND jsonb_array_length(v_lunch_dc->'labels') > 0)
      OR (v_lunch_dc->'q' IS NOT NULL AND jsonb_array_length(v_lunch_dc->'q') > 0)
    ) THEN
      v_dcfg := v_lunch_dc; v_edc := p_date_category;
    ELSE
      v_dcfg := v_ven_decor; v_edc := CASE WHEN p_slot = 2 THEN 2 ELSE p_date_category END;
    END IF;
    IF p_decor_idx < 0 OR p_decor_idx > jsonb_array_length(v_dcfg->'labels') - 1 THEN
      v_dq := public.fn_decor_grid_val(v_dcfg, 'q', 0, v_edc);
      v_dt := public.fn_decor_grid_val(v_dcfg, 't', 0, v_edc);
      v_df := public.fn_decor_grid_val(v_dcfg, 'f', 0, v_edc);
    ELSE
      v_dq := public.fn_decor_grid_val(v_dcfg, 'q', p_decor_idx, v_edc);
      v_dt := public.fn_decor_grid_val(v_dcfg, 't', p_decor_idx, v_edc);
      v_df := public.fn_decor_grid_val(v_dcfg, 'f', p_decor_idx, v_edc);
    END IF;
    IF NOT p_is_wedding THEN
      v_nw_off := COALESCE((v_dcfg->>'nw_offset')::numeric, 0);
      v_dq := v_dq + v_nw_off; v_dt := v_dt + v_nw_off; v_df := v_df + v_nw_off;
    END IF;
    v_decor_rel := '[true, true]'::jsonb;

  ELSIF v_dm = 'f' THEN
    v_lunch_dc := v_ven_decor->'lunch_override';
    IF p_slot = 2 AND v_lunch_dc IS NOT NULL AND v_lunch_dc->'q' IS NOT NULL AND jsonb_array_length(v_lunch_dc->'q') > 0 THEN
      v_dcfg := v_lunch_dc; v_edc := p_date_category;
    ELSE
      v_dcfg := v_ven_decor; v_edc := CASE WHEN p_slot = 2 THEN 2 ELSE p_date_category END;
    END IF;
    v_dq := public.fn_decor_grid_val(v_dcfg, 'q', 0, v_edc);
    v_dt := public.fn_decor_grid_val(v_dcfg, 't', 0, v_edc);
    v_df := public.fn_decor_grid_val(v_dcfg, 'f', 0, v_edc);
    IF NOT p_is_wedding THEN
      v_nw_off := COALESCE((v_dcfg->>'nw_offset')::numeric, 0);
      v_dq := v_dq + v_nw_off; v_dt := v_dt + v_nw_off; v_df := v_df + v_nw_off;
    END IF;
    v_decor_rel := '[true]'::jsonb;

  ELSE
    v_dq := 0; v_dt := 0; v_df := 0; v_decor_rel := '[]'::jsonb;
  END IF;

  v_djq := COALESCE((v_ven_dj->'q'->p_dj_idx->>p_date_category)::numeric, 0);
  v_djt := COALESCE((v_ven_dj->'t'->p_dj_idx->>p_date_category)::numeric, 0);
  v_djf := COALESCE((v_ven_dj->'f'->p_dj_idx->>p_date_category)::numeric, 0);

  v_gq := CEIL((v_vq + v_dq + v_djq)::numeric * 2) / 2;
  v_gt := CEIL((v_vt + v_dt + v_djt)::numeric * 2) / 2;
  v_gf := CEIL((v_vf + v_df + v_djf)::numeric * 2) / 2;

  FOR i IN 0..(jsonb_array_length(v_ttd_cfg->'labels') - 1) LOOP
    v_ttd_out := v_ttd_out || jsonb_build_object('label', v_ttd_cfg->'labels'->>i, 'pct', (v_ttd_cfg->'discounts'->>i)::numeric);
  END LOOP;

  RETURN jsonb_build_object(
    'venue_id', v_leaf_id, 'parent_id', v_parent_id,
    'venue_name', v_ven_name, 'venue_location', v_ven_loc, 'venue_decor_mode', v_dm, 'is_placeholder', false,
    'all_menus', v_all_menus, 'available_menus', v_avail, 'active_menu', v_active,
    'menu_label', v_menu->'labels'->>v_active, 'per_head', v_per_head, 'menu_cost', v_menu_cost,
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

NOTIFY pgrst, 'reload schema';

COMMIT;
