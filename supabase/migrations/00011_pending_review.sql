-- Add status + tracking to categories
ALTER TABLE categories
  ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN added_by UUID REFERENCES profiles(id);

-- Add status + tracking to sub_categories
ALTER TABLE sub_categories
  ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN added_by UUID REFERENCES profiles(id);

-- Add submitted_by to track who submitted inventory (already exists but ensure index)
CREATE INDEX IF NOT EXISTS idx_inventory_submitted_by ON inventory_items(submitted_by);

-- Update RLS: non-admins only see approved categories
DROP POLICY "categories_select" ON categories;
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (
    status = 'approved' OR public.user_role() = 'admin'
  );

DROP POLICY "sub_categories_select" ON sub_categories;
CREATE POLICY "sub_categories_select" ON sub_categories
  FOR SELECT USING (
    status = 'approved' OR public.user_role() = 'admin'
  );

-- Allow all authenticated users to insert categories/subcategories (as pending)
DROP POLICY IF EXISTS "categories_insert" ON categories;
CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "sub_categories_insert" ON sub_categories;
CREATE POLICY "sub_categories_insert" ON sub_categories
  FOR INSERT WITH CHECK (true);