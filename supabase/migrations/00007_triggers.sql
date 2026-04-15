-- ============================================
-- Auto-update inventory blocked count
-- when event_items are inserted or deleted
-- ============================================

CREATE OR REPLACE FUNCTION update_blocked_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET blocked = blocked + NEW.qty
  WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_blocked_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET blocked = blocked - OLD.qty
  WHERE id = OLD.item_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_blocked_on_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.qty <> NEW.qty OR OLD.item_id <> NEW.item_id THEN
    -- Remove old block
    UPDATE inventory_items
    SET blocked = blocked - OLD.qty
    WHERE id = OLD.item_id;
    -- Add new block
    UPDATE inventory_items
    SET blocked = blocked + NEW.qty
    WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_event_items_insert
  AFTER INSERT ON event_items
  FOR EACH ROW EXECUTE FUNCTION update_blocked_on_insert();

CREATE TRIGGER trg_event_items_delete
  AFTER DELETE ON event_items
  FOR EACH ROW EXECUTE FUNCTION update_blocked_on_delete();

CREATE TRIGGER trg_event_items_update
  AFTER UPDATE ON event_items
  FOR EACH ROW EXECUTE FUNCTION update_blocked_on_update();

-- ============================================
-- Validate expense amount limits
-- ============================================

CREATE OR REPLACE FUNCTION validate_expense()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.amount_paise > 10000000 THEN
    RAISE EXCEPTION 'Expense amount cannot exceed ₹1,00,000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_validate
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION validate_expense();

-- ============================================
-- Auto-generate box_code sequence
-- ============================================

CREATE OR REPLACE FUNCTION generate_box_code()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(box_code FROM 5) AS INT)), 0) + 1
  INTO next_num
  FROM boxes;
  NEW.box_code := 'BOX-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_box_code
  BEFORE INSERT ON boxes
  FOR EACH ROW
  WHEN (NEW.box_code IS NULL OR NEW.box_code = '')
  EXECUTE FUNCTION generate_box_code();

-- ============================================
-- Auto-generate challan_no sequence
-- ============================================

CREATE OR REPLACE FUNCTION generate_challan_no()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(challan_no FROM 4) AS INT)), 0) + 1
  INTO next_num
  FROM challans;
  NEW.challan_no := 'CH-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_challan_no
  BEFORE INSERT ON challans
  FOR EACH ROW
  WHEN (NEW.challan_no IS NULL OR NEW.challan_no = '')
  EXECUTE FUNCTION generate_challan_no();