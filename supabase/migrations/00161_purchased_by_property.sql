-- Crockery & Cutlery and Kitchen Equipments items get a "Purchased By"
-- property beside Vendor: who bought the item. Every category under those two
-- sub-departments that has no Purchased By yet gets it appended to its
-- properties — a dropdown with no fixed options, so the form suggests the
-- names already used in that department and takes a typed new one. The item
-- cards show only Material, Menu zone and Vendor, so it stays off the card.

BEGIN;

UPDATE public.categories c
SET dimension_fields = coalesce(
      CASE WHEN jsonb_typeof(c.dimension_fields) = 'array' THEN c.dimension_fields END,
      '[]'::jsonb
    ) || '[{"name": "Purchased By", "type": "select", "options": []}]'::jsonb
WHERE c.sub_department_id IN (
    SELECT id FROM public.sub_departments
    WHERE name ILIKE 'crockery%' OR name ILIKE 'kitchen equipment%'
  )
  -- coalesce: a category with no properties at all (NULL) still qualifies
  AND NOT coalesce(
    jsonb_typeof(c.dimension_fields) = 'array'
    AND c.dimension_fields @> '[{"name": "Purchased By"}]',
    false
  );

COMMIT;
