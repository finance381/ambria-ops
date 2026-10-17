-- The "Vendor Number" property is dropped. It was a number-type dimension on
-- some categories (Masters → Categories), so the form showed it with a unit
-- dropdown, beside the Quantity property that already carries the count. It
-- comes off every category's property list, and off the items that saved a
-- value for it (inventory_items, catering_store_items), so nothing still
-- holds it. Other properties and their order are kept.

BEGIN;

UPDATE public.categories
SET dimension_fields = (
  SELECT coalesce(jsonb_agg(f ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimension_fields) WITH ORDINALITY AS t(f, ord)
  WHERE f->>'name' <> 'Vendor Number'
)
WHERE jsonb_typeof(dimension_fields) = 'array'
  AND dimension_fields @> '[{"name": "Vendor Number"}]';

UPDATE public.inventory_items
SET dimensions = (
  SELECT coalesce(jsonb_agg(d ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(d, ord)
  WHERE d->>'name' <> 'Vendor Number'
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Vendor Number"}]';

UPDATE public.catering_store_items
SET dimensions = (
  SELECT coalesce(jsonb_agg(d ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(d, ord)
  WHERE d->>'name' <> 'Vendor Number'
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Vendor Number"}]';

COMMIT;
