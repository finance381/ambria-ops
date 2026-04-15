-- Change created_at to date type for inventory items
ALTER TABLE inventory_items
  ADD COLUMN entry_date DATE NOT NULL DEFAULT CURRENT_DATE;