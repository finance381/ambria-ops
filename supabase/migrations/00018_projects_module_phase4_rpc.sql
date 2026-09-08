-- Projects module — Phase 4: rpc_project_upsert
-- Apply via Supabase SQL editor (this repo's migrations aren't applied through the CLI).
--
-- NOTE on conventions: this function is SECURITY DEFINER but intentionally NOT marked
-- STABLE, unlike fn_projects_scope_visible. STABLE tells Postgres the function's result
-- can be cached within a statement because it never modifies the database — a mutating
-- function (this one inserts/updates/deletes) marked STABLE is a real correctness bug,
-- not a style choice. The two real write-RPCs already in this codebase (pay_vendor,
-- fn_create_cost_transfer) both omit STABLE for the same reason; only read-only scope
-- checks like fn_events_scope_visible/fn_projects_scope_visible use it.
--
-- p_project: jsonb object of project columns the client can set. Include "id" (bigint)
--   to update an existing project; omit/null it to insert a new one.
--   { id?, name, project_type, priority, category, work_details, status, venue_id,
--     sub_venue, address, project_manager_id, pm_contact, site_supervisor_id,
--     approved_by, start_date, estimated_end_date, actual_end_date,
--     approved_budget_paise, payment_terms, warranty_months, event_id, notes }
-- p_vendors: jsonb array of { vendor_id, trade, contact_override, sort_order }
-- p_estimation_items: jsonb array of { description, quantity, unit, rate_paise, category_tag, notes, sort_order }
--
-- Vendor/estimation lines are replaced wholesale (delete-then-reinsert) rather than
-- diffed row-by-row — functionally identical to a diff-sync for tables this small, far
-- simpler to get right. The estimation-items reinsert fires trg_recalc_estimated_cost
-- automatically, so estimated_cost_paise doesn't need recomputing here.

BEGIN;

CREATE OR REPLACE FUNCTION rpc_project_upsert(p_project jsonb, p_vendors jsonb, p_estimation_items jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id bigint;
  v_venue_id integer;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;

  v_id := NULLIF(p_project->>'id', '')::bigint;
  v_venue_id := NULLIF(p_project->>'venue_id', '')::integer;

  IF v_id IS NULL THEN
    IF NOT user_can('projects.create') THEN
      RAISE EXCEPTION 'permission denied' USING errcode = '42501';
    END IF;
    IF user_scope('projects.create') = 'own_venue'
       AND (v_venue_id IS NULL OR NOT (v_venue_id = ANY (current_user_venue_ids()))) THEN
      RAISE EXCEPTION 'permission denied: venue not in scope' USING errcode = '42501';
    END IF;

    INSERT INTO projects (
      name, project_type, priority, category, work_details, status, venue_id, sub_venue, address,
      project_manager_id, pm_contact, site_supervisor_id, approved_by,
      start_date, estimated_end_date, actual_end_date,
      approved_budget_paise, payment_terms, warranty_months, event_id, notes, created_by
    ) VALUES (
      p_project->>'name',
      COALESCE((p_project->>'project_type')::project_type_e, 'renovation'),
      COALESCE((p_project->>'priority')::project_priority_e, 'medium'),
      (p_project->>'category')::project_category_e,
      p_project->>'work_details',
      COALESCE((p_project->>'status')::project_status_e, 'draft'),
      v_venue_id,
      p_project->>'sub_venue',
      p_project->>'address',
      NULLIF(p_project->>'project_manager_id', '')::uuid,
      p_project->>'pm_contact',
      NULLIF(p_project->>'site_supervisor_id', '')::uuid,
      NULLIF(p_project->>'approved_by', '')::uuid,
      NULLIF(p_project->>'start_date', '')::date,
      NULLIF(p_project->>'estimated_end_date', '')::date,
      NULLIF(p_project->>'actual_end_date', '')::date,
      NULLIF(p_project->>'approved_budget_paise', '')::bigint,
      p_project->'payment_terms',
      NULLIF(p_project->>'warranty_months', '')::integer,
      NULLIF(p_project->>'event_id', '')::bigint,
      p_project->>'notes',
      v_uid
    ) RETURNING id INTO v_id;
  ELSE
    IF NOT (user_can('projects.edit') AND fn_projects_scope_visible(v_id, 'projects.edit')) THEN
      RAISE EXCEPTION 'permission denied' USING errcode = '42501';
    END IF;

    UPDATE projects SET
      name = p_project->>'name',
      project_type = COALESCE((p_project->>'project_type')::project_type_e, project_type),
      priority = COALESCE((p_project->>'priority')::project_priority_e, priority),
      category = (p_project->>'category')::project_category_e,
      work_details = p_project->>'work_details',
      status = COALESCE((p_project->>'status')::project_status_e, status),
      venue_id = COALESCE(v_venue_id, venue_id),
      sub_venue = p_project->>'sub_venue',
      address = p_project->>'address',
      project_manager_id = NULLIF(p_project->>'project_manager_id', '')::uuid,
      pm_contact = p_project->>'pm_contact',
      site_supervisor_id = NULLIF(p_project->>'site_supervisor_id', '')::uuid,
      approved_by = NULLIF(p_project->>'approved_by', '')::uuid,
      start_date = NULLIF(p_project->>'start_date', '')::date,
      estimated_end_date = NULLIF(p_project->>'estimated_end_date', '')::date,
      actual_end_date = NULLIF(p_project->>'actual_end_date', '')::date,
      approved_budget_paise = NULLIF(p_project->>'approved_budget_paise', '')::bigint,
      payment_terms = p_project->'payment_terms',
      warranty_months = NULLIF(p_project->>'warranty_months', '')::integer,
      event_id = NULLIF(p_project->>'event_id', '')::bigint,
      notes = p_project->>'notes'
    WHERE id = v_id;
  END IF;

  DELETE FROM project_vendors WHERE project_id = v_id;
  IF p_vendors IS NOT NULL THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
      INSERT INTO project_vendors (project_id, vendor_id, trade, contact_override, sort_order)
      VALUES (
        v_id,
        (v_row->>'vendor_id')::integer,
        v_row->>'trade',
        v_row->>'contact_override',
        COALESCE((v_row->>'sort_order')::integer, 0)
      );
    END LOOP;
  END IF;

  DELETE FROM project_estimation_items WHERE project_id = v_id;
  IF p_estimation_items IS NOT NULL THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_estimation_items) LOOP
      INSERT INTO project_estimation_items (project_id, description, quantity, unit, rate_paise, category_tag, notes, sort_order)
      VALUES (
        v_id,
        v_row->>'description',
        COALESCE((v_row->>'quantity')::numeric, 0),
        COALESCE(v_row->>'unit', 'Nos'),
        COALESCE((v_row->>'rate_paise')::bigint, 0),
        COALESCE((v_row->>'category_tag')::project_estimation_category_e, 'material'),
        v_row->>'notes',
        COALESCE((v_row->>'sort_order')::integer, 0)
      );
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
