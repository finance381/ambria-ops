-- ============================================
-- BOXES
-- ============================================
CREATE TABLE boxes (
  id          SERIAL PRIMARY KEY,
  box_code    TEXT NOT NULL UNIQUE,
  label       TEXT,
  status      TEXT NOT NULL CHECK (status IN (
                'In Warehouse', 'Packed', 'Loaded', 'At Venue', 'Returned'
              )) DEFAULT 'In Warehouse',
  location    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CHALLANS
-- ============================================
CREATE TABLE challans (
  id           SERIAL PRIMARY KEY,
  challan_no   TEXT NOT NULL UNIQUE,
  event_id     INT REFERENCES events(id) ON DELETE SET NULL,
  vehicle_no   TEXT,
  driver_name  TEXT,
  driver_phone TEXT,
  box_ids      INT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'Created',
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_challans_event ON challans(event_id);