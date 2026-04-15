-- ============================================
-- Enable RLS on all tables
-- ============================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_manpower ENABLE ROW LEVEL SECURITY;
ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- PROFILES (already has policies from 00001)
-- ============================================

-- ============================================
-- CATEGORIES: all read, admin write
-- ============================================
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (true);

CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (public.user_role() = 'admin');

CREATE POLICY "categories_update" ON categories
  FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "categories_delete" ON categories
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- INVENTORY: all read, admin/sales write
-- ============================================
CREATE POLICY "inventory_select" ON inventory_items
  FOR SELECT USING (true);

CREATE POLICY "inventory_insert" ON inventory_items
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "inventory_update" ON inventory_items
  FOR UPDATE USING (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "inventory_delete" ON inventory_items
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- EVENTS: all read, admin/sales write
-- ============================================
CREATE POLICY "events_select" ON events
  FOR SELECT USING (true);

CREATE POLICY "events_insert" ON events
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "events_update" ON events
  FOR UPDATE USING (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "events_delete" ON events
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- EVENT ITEMS: all read, admin/sales write
-- ============================================
CREATE POLICY "event_items_select" ON event_items
  FOR SELECT USING (true);

CREATE POLICY "event_items_insert" ON event_items
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "event_items_update" ON event_items
  FOR UPDATE USING (public.user_role() IN ('admin', 'sales', 'logistics'));

CREATE POLICY "event_items_delete" ON event_items
  FOR DELETE USING (public.user_role() IN ('admin', 'sales'));

-- ============================================
-- EVENT MANPOWER: all read, admin/sales write
-- ============================================
CREATE POLICY "event_manpower_select" ON event_manpower
  FOR SELECT USING (true);

CREATE POLICY "event_manpower_insert" ON event_manpower
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "event_manpower_update" ON event_manpower
  FOR UPDATE USING (public.user_role() IN ('admin', 'sales'));

CREATE POLICY "event_manpower_delete" ON event_manpower
  FOR DELETE USING (public.user_role() IN ('admin', 'sales'));

-- ============================================
-- BOXES: all read, admin/logistics write
-- ============================================
CREATE POLICY "boxes_select" ON boxes
  FOR SELECT USING (true);

CREATE POLICY "boxes_insert" ON boxes
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'logistics'));

CREATE POLICY "boxes_update" ON boxes
  FOR UPDATE USING (public.user_role() IN ('admin', 'logistics', 'production'));

CREATE POLICY "boxes_delete" ON boxes
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- CHALLANS: all read, admin/logistics write
-- ============================================
CREATE POLICY "challans_select" ON challans
  FOR SELECT USING (true);

CREATE POLICY "challans_insert" ON challans
  FOR INSERT WITH CHECK (public.user_role() IN ('admin', 'logistics'));

CREATE POLICY "challans_update" ON challans
  FOR UPDATE USING (public.user_role() IN ('admin', 'logistics'));

CREATE POLICY "challans_delete" ON challans
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- EXPENSE CATEGORIES: all read, admin write
-- ============================================
CREATE POLICY "expense_cat_select" ON expense_categories
  FOR SELECT USING (true);

CREATE POLICY "expense_cat_insert" ON expense_categories
  FOR INSERT WITH CHECK (public.user_role() = 'admin');

CREATE POLICY "expense_cat_update" ON expense_categories
  FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "expense_cat_delete" ON expense_categories
  FOR DELETE USING (public.user_role() = 'admin');

-- ============================================
-- EXPENSES: own records + admin sees all
-- ============================================
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT USING (
    auth.uid() = user_id OR public.user_role() = 'admin'
  );

CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE USING (
    (auth.uid() = user_id AND status = 'pending')
    OR public.user_role() = 'admin'
  );

CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE USING (
    auth.uid() = user_id AND status = 'pending'
  );

-- ============================================
-- PURCHASE REQUESTS: own + admin sees all
-- ============================================
CREATE POLICY "purchase_select" ON purchase_requests
  FOR SELECT USING (
    auth.uid() = requested_by OR public.user_role() = 'admin'
  );

CREATE POLICY "purchase_insert" ON purchase_requests
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "purchase_update" ON purchase_requests
  FOR UPDATE USING (
    (auth.uid() = requested_by AND status = 'Pending')
    OR public.user_role() = 'admin'
  );

CREATE POLICY "purchase_delete" ON purchase_requests
  FOR DELETE USING (
    auth.uid() = requested_by AND status = 'Pending'
  );