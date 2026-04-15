-- ============================================
-- EXPENSE CATEGORIES
-- ============================================
CREATE TABLE expense_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- EXPENSES (Petty Cash)
-- ============================================
CREATE TABLE expenses (
  id               SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES profiles(id),
  category_id      INT NOT NULL REFERENCES expense_categories(id),
  amount_paise     INT NOT NULL,
  description      TEXT NOT NULL,
  receipt_path     TEXT,
  status           TEXT NOT NULL CHECK (status IN (
                     'pending', 'approved', 'rejected'
                   )) DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT amount_positive CHECK (amount_paise > 0)
);

CREATE INDEX idx_expenses_user ON expenses(user_id);
CREATE INDEX idx_expenses_status ON expenses(status);

-- ============================================
-- PURCHASE REQUESTS
-- ============================================
CREATE TABLE purchase_requests (
  id                   SERIAL PRIMARY KEY,
  item_name            TEXT NOT NULL,
  qty                  INT NOT NULL,
  category_id          INT REFERENCES categories(id) ON DELETE SET NULL,
  reason               TEXT,
  requested_by         UUID NOT NULL REFERENCES profiles(id),
  estimated_cost_paise INT,
  vendor               TEXT,
  notes                TEXT,
  status               TEXT NOT NULL CHECK (status IN (
                         'Pending', 'Approved', 'Rejected', 'Purchased', 'Added to Inventory'
                       )) DEFAULT 'Pending',
  reviewed_by          UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT purchase_qty_positive CHECK (qty > 0)
);

CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX idx_purchase_requests_user ON purchase_requests(requested_by);