-- One quantity per item. The "Quantity" property (a dimension some categories
-- carried in Masters → Categories) only repeated the stock quantity in
-- Stock & pricing, so it is dropped from every category and item. What it had
-- that stock lacked — pieces in one set — moves onto the item itself:
-- pieces_per_set, filled in under the stock quantity when its unit is Sets
-- (InventoryForm.jsx) and shown on the item cards. A per_set already typed on
-- the old property is carried over first.

BEGIN;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS pieces_per_set numeric CHECK (pieces_per_set > 0);
ALTER TABLE public.catering_store_items
  ADD COLUMN IF NOT EXISTS pieces_per_set numeric CHECK (pieces_per_set > 0);

-- carry over pieces per set typed on the old property
UPDATE public.inventory_items i
SET pieces_per_set = (
  SELECT (d->>'per_set')::numeric FROM jsonb_array_elements(i.dimensions) d
  WHERE d->>'name' = 'Quantity' AND d->>'per_set' ~ '^[0-9]+(\.[0-9]+)?$' AND (d->>'per_set')::numeric > 0
  LIMIT 1
)
WHERE i.pieces_per_set IS NULL AND i.unit = 'Sets'
  AND jsonb_typeof(i.dimensions) = 'array' AND i.dimensions @> '[{"name": "Quantity"}]';

UPDATE public.catering_store_items i
SET pieces_per_set = (
  SELECT (d->>'per_set')::numeric FROM jsonb_array_elements(i.dimensions) d
  WHERE d->>'name' = 'Quantity' AND d->>'per_set' ~ '^[0-9]+(\.[0-9]+)?$' AND (d->>'per_set')::numeric > 0
  LIMIT 1
)
WHERE i.pieces_per_set IS NULL AND i.unit = 'Sets'
  AND jsonb_typeof(i.dimensions) = 'array' AND i.dimensions @> '[{"name": "Quantity"}]';

-- the property itself, off categories and items
UPDATE public.categories
SET dimension_fields = (
  SELECT coalesce(jsonb_agg(f ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimension_fields) WITH ORDINALITY AS t(f, ord)
  WHERE f->>'name' <> 'Quantity'
)
WHERE jsonb_typeof(dimension_fields) = 'array'
  AND dimension_fields @> '[{"name": "Quantity"}]';

UPDATE public.inventory_items
SET dimensions = (
  SELECT coalesce(jsonb_agg(d ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(d, ord)
  WHERE d->>'name' <> 'Quantity'
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Quantity"}]';

UPDATE public.catering_store_items
SET dimensions = (
  SELECT coalesce(jsonb_agg(d ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(dimensions) WITH ORDINALITY AS t(d, ord)
  WHERE d->>'name' <> 'Quantity'
)
WHERE jsonb_typeof(dimensions) = 'array'
  AND dimensions @> '[{"name": "Quantity"}]';

COMMIT;

NOTIFY pgrst, 'reload schema';
