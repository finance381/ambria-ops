-- Fnbapp confirmed it will NOT rename its two near-miss section names to
-- match this table's existing hyphen/prefix spelling (00186's "still
-- unresolved" note) -- it sends both variants depending on context, so both
-- need their own row rather than picking one. Same targets as their
-- already-mapped cousins.

INSERT INTO public.fnb_section_map (fnb_section_name, ops_section, ops_sub_department, notes) VALUES
  ('Chinese & Pan Asian', 'Chinese', 'Kitchen', 'Same target as "Chinese & Pan-Asian" -- Fnbapp sends both spellings.'),
  ('Main Course',         'Indian',  'Kitchen', 'Same target as "Indian Main Course" -- Fnbapp sends both.')
ON CONFLICT (fnb_section_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
