-- Add starting code to categories
ALTER TABLE categories
  ADD COLUMN code TEXT;

-- Add sequence counter for inventory IDs per category
ALTER TABLE categories
  ADD COLUMN next_seq INT NOT NULL DEFAULT 1;

-- Update inventory ID generation to use category code
CREATE OR REPLACE FUNCTION generate_inventory_id()
RETURNS TRIGGER AS $$
DECLARE
  cat_code TEXT;
  cat_seq INT;
BEGIN
  -- Get category code and next sequence
  IF NEW.category_id IS NOT NULL THEN
    SELECT COALESCE(code, LEFT(UPPER(REPLACE(name, ' ', '')), 3)), next_seq
    INTO cat_code, cat_seq
    FROM categories WHERE id = NEW.category_id;

    -- Increment sequence
    UPDATE categories SET next_seq = next_seq + 1 WHERE id = NEW.category_id;
  ELSE
    cat_code := 'GEN';
    cat_seq := COALESCE(
      (SELECT MAX(id) FROM inventory_items) + 1, 1
    );
  END IF;

  NEW.inventory_id := cat_code || '-' || LPAD(cat_seq::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;