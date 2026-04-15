-- Sub-categories table
CREATE TABLE sub_categories (
  id          SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category_id, name)
);

CREATE INDEX idx_sub_categories_cat ON sub_categories(category_id);

ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sub_categories_select" ON sub_categories FOR SELECT USING (true);
CREATE POLICY "sub_categories_insert" ON sub_categories FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'sales'));
CREATE POLICY "sub_categories_update" ON sub_categories FOR UPDATE USING (public.user_role() = 'admin');
CREATE POLICY "sub_categories_delete" ON sub_categories FOR DELETE USING (public.user_role() = 'admin');

-- Add missing columns to inventory_items
ALTER TABLE inventory_items
  ADD COLUMN sub_category_id INT REFERENCES sub_categories(id) ON DELETE SET NULL,
  ADD COLUMN name_hindi      TEXT,
  ADD COLUMN description     TEXT,
  ADD COLUMN min_order_qty   INT,
  ADD COLUMN reorder_qty     INT,
  ADD COLUMN rate_paise      INT,
  ADD COLUMN is_asset        TEXT CHECK (is_asset IN ('yes', 'no', 'unknown')) DEFAULT 'unknown',
  ADD COLUMN department      TEXT;

CREATE INDEX idx_inventory_subcat ON inventory_items(sub_category_id);