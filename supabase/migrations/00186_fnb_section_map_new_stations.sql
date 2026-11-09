-- Fnbapp's recipe_categories grew from the 6 stations 00168 originally
-- seeded fnb_section_map from to 14 -- 8 of them had no row at all, which is
-- exactly what fn_fnb_store_requisition_sync's "No section mapping" error
-- exists to catch loudly rather than guess silently.
--
-- Decisions below confirmed directly: Indian Desserts moves from its
-- original approximate 'Indian' target to 'Halwai' (still no dedicated
-- Desserts section, Halwai is the better fit). European Desserts and Fruits
-- are routed to their own sub-departments under Catering -- Bakery and
-- FRT-Fruits respectively (confirmed via sub_departments; note the latter is
-- NOT spelled plain "Fruits") -- same pattern Beverages already uses: no
-- match among the 8 kitchen sections, so ops_section stays NULL and
-- ops_sub_department carries the routing instead.
--
-- Two of Fnbapp's 14 names are deliberately NOT addressed here --
-- "Chinese & Pan Asian" (vs this table's existing "Chinese & Pan-Asian") and
-- "Main Course" (vs this table's existing "Indian Main Course") are each a
-- near-miss on an already-mapped row, still pending a decision on which side
-- renames to match the other.

UPDATE public.fnb_section_map
  SET ops_section = 'Halwai', notes = NULL, updated_at = now()
  WHERE fnb_section_name = 'Indian Desserts';

INSERT INTO public.fnb_section_map (fnb_section_name, ops_section, ops_sub_department, notes) VALUES
  ('Soup Station',      'Chinese', 'Kitchen',    NULL),
  ('Chaat Station',     'Chaat',   'Kitchen',    NULL),
  ('Continental',       'Conti',   'Kitchen',    NULL),
  ('Salads',            'Conti',   'Kitchen',    NULL),
  ('European Desserts', NULL,      'Bakery',     'Routed to Catering -> Bakery sub-department. No matching entry among Ops'' 8 kitchen sections, so the section tag is left blank.'),
  ('APC',               'Indian',  'Kitchen',    NULL),
  ('Add-On Counters',   'Indian',  'Kitchen',    NULL),
  ('Fruits',            NULL,      'FRT-Fruits', 'Routed to Catering -> FRT-Fruits sub-department. No matching entry among Ops'' 8 kitchen sections, so the section tag is left blank.')
ON CONFLICT (fnb_section_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
