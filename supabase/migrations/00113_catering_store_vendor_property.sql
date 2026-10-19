-- Catering Store items get the Vendor property too. Every category under the
-- "Catering Store" sub-department (the name InventoryForm.jsx also keys on)
-- that has no Vendor yet gets one appended to its properties: a dropdown with
-- no fixed options — the form suggests the vendors already used on Catering
-- Store items and takes a typed new name, and the item cards show it.

BEGIN;

UPDATE public.categories c
SET dimension_fields = coalesce(
      CASE WHEN jsonb_typeof(c.dimension_fields) = 'array' THEN c.dimension_fields END,
      '[]'::jsonb
    ) || '[{"name": "Vendor", "type": "select", "options": []}]'::jsonb
WHERE c.sub_department_id = (SELECT id FROM public.sub_departments WHERE name = 'Catering Store' LIMIT 1)
  -- coalesce: a category with no properties at all (NULL) still qualifies
  AND NOT coalesce(
    jsonb_typeof(c.dimension_fields) = 'array'
    AND c.dimension_fields @> '[{"name": "Vendor"}]',
    false
  );

COMMIT;
