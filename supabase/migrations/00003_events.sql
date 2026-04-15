-- ============================================
-- EVENTS
-- ============================================
CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  event_date  DATE NOT NULL,
  client      TEXT,
  salesperson TEXT,
  status      TEXT NOT NULL CHECK (status IN ('Confirmed', 'Tentative'))
                   DEFAULT 'Tentative',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- EVENT ITEMS (blocked inventory per event)
-- ============================================
CREATE TABLE event_items (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_id     INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty         INT NOT NULL DEFAULT 1,
  department  TEXT NOT NULL DEFAULT 'Other',
  remark      TEXT,
  blocked_by  UUID REFERENCES profiles(id),
  blocked_at  TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT event_item_qty_positive CHECK (qty > 0)
);

CREATE INDEX idx_event_items_event ON event_items(event_id);
CREATE INDEX idx_event_items_item ON event_items(item_id);

-- ============================================
-- EVENT MANPOWER
-- ============================================
CREATE TABLE event_manpower (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  worker_type TEXT NOT NULL,
  qty         INT NOT NULL DEFAULT 1,
  rate_paise  INT NOT NULL,
  remark      TEXT,
  slots       JSONB NOT NULL DEFAULT '[]',

  CONSTRAINT manpower_qty_positive CHECK (qty > 0),
  CONSTRAINT manpower_rate_positive CHECK (rate_paise > 0)
);

CREATE INDEX idx_event_manpower_event ON event_manpower(event_id);