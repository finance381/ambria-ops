-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INVENTORY ITEMS
-- ============================================
CREATE TABLE inventory_items (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('Budgeted', 'Premium')),
  qty         INT NOT NULL DEFAULT 0,
  blocked     INT NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'Pcs',
  location    TEXT,
  box_id      TEXT,
  image_path  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qty_not_negative CHECK (qty >= 0),
  CONSTRAINT blocked_not_negative CHECK (blocked >= 0),
  CONSTRAINT blocked_lte_qty CHECK (blocked <= qty)
);

CREATE INDEX idx_inventory_category ON inventory_items(category_id);
CREATE INDEX idx_inventory_type ON inventory_items(type);