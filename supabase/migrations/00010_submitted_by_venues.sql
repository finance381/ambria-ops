-- Track who submitted each item
ALTER TABLE inventory_items
  ADD COLUMN submitted_by UUID REFERENCES profiles(id);

-- Auto-generated inventory ID (INV-YYYYMMDDHHMMSS-DEPT-USERID)
ALTER TABLE inventory_items
  ADD COLUMN inventory_id TEXT UNIQUE;

-- Generate inventory_id on insert
CREATE OR REPLACE FUNCTION generate_inventory_id()
RETURNS TRIGGER AS $$
DECLARE
  dept_code TEXT;
  user_short TEXT;
BEGIN
  dept_code := COALESCE(
    LEFT(REPLACE(UPPER(COALESCE(NEW.department, 'OTH')), ' ', ''), 3),
    'OTH'
  );
  user_short := LEFT(NEW.submitted_by::TEXT, 8);
  NEW.inventory_id := 'INV-' ||
    TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
    dept_code || '-' ||
    user_short;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_id
  BEFORE INSERT ON inventory_items
  FOR EACH ROW
  WHEN (NEW.inventory_id IS NULL OR NEW.inventory_id = '')
  EXECUTE FUNCTION generate_inventory_id();

-- Venues table
CREATE TABLE venues (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venues_select" ON venues FOR SELECT USING (true);
CREATE POLICY "venues_insert" ON venues FOR INSERT WITH CHECK (public.user_role() = 'admin');
CREATE POLICY "venues_update" ON venues FOR UPDATE USING (public.user_role() = 'admin');
CREATE POLICY "venues_delete" ON venues FOR DELETE USING (public.user_role() = 'admin');

-- Seed default venues
INSERT INTO venues (code, name) VALUES
  ('AP', 'Ambria Pushpanjali'),
  ('AE', 'Ambria Exotica'),
  ('MKT', 'Ambria Manaktala'),
  ('AR', 'Ambria Restro');

-- Venue allocations per inventory item
CREATE TABLE venue_allocations (
  id          SERIAL PRIMARY KEY,
  item_id     INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  qty         INT NOT NULL DEFAULT 0,
  CONSTRAINT venue_alloc_qty_positive CHECK (qty > 0)
);

ALTER TABLE venue_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venue_alloc_select" ON venue_allocations FOR SELECT USING (true);
CREATE POLICY "venue_alloc_insert" ON venue_allocations FOR INSERT WITH CHECK (true);
CREATE POLICY "venue_alloc_delete" ON venue_allocations FOR DELETE USING (true);

CREATE INDEX idx_venue_alloc_item ON venue_allocations(item_id);