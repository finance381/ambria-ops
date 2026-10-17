-- The "Purchased Location" property (a dimension field set up on categories in
-- Masters → Categories, e.g. Crockery) is renamed "Vendor". Properties are
-- matched to an item's saved values by name (InventoryForm.jsx), so the items'
-- own dimensions are renamed too — in inventory_items and
-- catering_store_items — or their saved value would stop showing. Order and
-- every other key of each entry are kept.

BEGIN;

UPDATE public.categories
SET dimension_fields = (
  SELECT jsonb_agg(CASE WHEN e->>'name' = 'Purchased Location' THEN jsonb_set(e, '{name}', '"Vendor"') ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(dimension_fields) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(dimension_fields) = 'array'
  AND dimension_fields @> '[{"name": "Purchased Location"}]';

UPDATE public.inventory_items
SET dimensions = (
  SELECT jsonb_agg(CASE WHEN e->>'name' = 'Purchased Location' THEN jsonb_set(e, '{name}', '"Vendor"') ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Purchased Location"}]';

UPDATE public.catering_store_items
SET dimensions = (
  SELECT jsonb_agg(CASE WHEN e->>'name' = 'Purchased Location' THEN jsonb_set(e, '{name}', '"Vendor"') ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Purchased Location"}]';

COMMIT;
