-- Add status to inventory_items
ALTER TABLE inventory_items
  ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE INDEX idx_inventory_status ON inventory_items(status);

-- Add auditor to profiles role check
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'auditor', 'sales', 'production', 'logistics'));

-- Update user_role helper for RLS (already in public schema)
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Auditors can read all items (including pending)
DROP POLICY "inventory_select" ON inventory_items;
CREATE POLICY "inventory_select" ON inventory_items
  FOR SELECT USING (
    status = 'approved'
    OR submitted_by = auth.uid()
    OR public.user_role() IN ('admin', 'auditor')
  );

-- Admins and auditors can update status (approve/reject)
DROP POLICY "inventory_update" ON inventory_items;
CREATE POLICY "inventory_update" ON inventory_items
  FOR UPDATE USING (
    public.user_role() IN ('admin', 'auditor')
    OR (submitted_by = auth.uid() AND status = 'pending')
  );

-- Auditors can also see pending categories/subcategories
DROP POLICY "categories_select" ON categories;
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (
    status = 'approved'
    OR added_by = auth.uid()
    OR public.user_role() IN ('admin', 'auditor')
  );

DROP POLICY "sub_categories_select" ON sub_categories;
CREATE POLICY "sub_categories_select" ON sub_categories
  FOR SELECT USING (
    status = 'approved'
    OR added_by = auth.uid()
    OR public.user_role() IN ('admin', 'auditor')
  );