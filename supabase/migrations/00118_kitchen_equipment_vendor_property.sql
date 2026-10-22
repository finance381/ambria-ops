-- Kitchen Equipments items get the Vendor property too, as Crockery and
-- Catering Store (00113) have it. Every category under the Kitchen Equipments
-- sub-department that has no Vendor yet gets one appended to its properties:
-- a dropdown with no fixed options — the form suggests the vendors already
-- used in that department and takes a typed new name, and the item cards
-- show it.

BEGIN;

UPDATE public.categories c
SET dimension_fields = coalesce(
      CASE WHEN jsonb_typeof(c.dimension_fields) = 'array' THEN c.dimension_fields END,
      '[]'::jsonb
    ) || '[{"name": "Vendor", "type": "select", "options": []}]'::jsonb
WHERE c.sub_department_id IN (SELECT id FROM public.sub_departments WHERE name ILIKE 'kitchen equipment%')
  -- coalesce: a category with no properties at all (NULL) still qualifies
  AND NOT coalesce(
    jsonb_typeof(c.dimension_fields) = 'array'
    AND c.dimension_fields @> '[{"name": "Vendor"}]',
    false
  );

COMMIT;
