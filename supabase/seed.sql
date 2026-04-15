-- ============================================
-- TEST USERS
-- ============================================
DO $$
DECLARE
  admin_id UUID;
  sales_id UUID;
  prod_id UUID;
  logi_id UUID;
  uid UUID;
BEGIN
  admin_id := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  VALUES (admin_id, '00000000-0000-0000-0000-000000000000', 'admin@ambria.test', crypt('Admin@123', gen_salt('bf')), now(), '{"name":"Abhishek Admin","role":"admin"}'::jsonb, 'authenticated', 'authenticated', now(), now(), '', '', '', '', false);
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (admin_id, admin_id, jsonb_build_object('sub', admin_id::text, 'email', 'admin@ambria.test'), 'email', admin_id::text, now(), now(), now());

  sales_id := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  VALUES (sales_id, '00000000-0000-0000-0000-000000000000', 'sales@ambria.test', crypt('Sales@123', gen_salt('bf')), now(), '{"name":"Rahul Sales","role":"sales"}'::jsonb, 'authenticated', 'authenticated', now(), now(), '', '', '', '', false);
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (sales_id, sales_id, jsonb_build_object('sub', sales_id::text, 'email', 'sales@ambria.test'), 'email', sales_id::text, now(), now(), now());

  prod_id := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  VALUES (prod_id, '00000000-0000-0000-0000-000000000000', 'prod@ambria.test', crypt('Prod@123', gen_salt('bf')), now(), '{"name":"Vikram Production","role":"production"}'::jsonb, 'authenticated', 'authenticated', now(), now(), '', '', '', '', false);
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (prod_id, prod_id, jsonb_build_object('sub', prod_id::text, 'email', 'prod@ambria.test'), 'email', prod_id::text, now(), now(), now());

  logi_id := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  VALUES (logi_id, '00000000-0000-0000-0000-000000000000', 'logi@ambria.test', crypt('Logi@123', gen_salt('bf')), now(), '{"name":"Suresh Logistics","role":"logistics"}'::jsonb, 'authenticated', 'authenticated', now(), now(), '', '', '', '', false);
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (logi_id, logi_id, jsonb_build_object('sub', logi_id::text, 'email', 'logi@ambria.test'), 'email', logi_id::text, now(), now(), now());

  -- Auditor
  uid := extensions.uuid_generate_v4();
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'audit@ambria.test', crypt('Audit@123', gen_salt('bf')), now(), '{"name":"Priya Auditor","role":"auditor"}'::jsonb, 'authenticated', 'authenticated', now(), now(), '', '', '', '', false);
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (uid, uid, jsonb_build_object('sub', uid::text, 'email', 'audit@ambria.test'), 'email', uid::text, now(), now(), now());

  -- ============================================
  -- INVENTORY CATEGORIES
  -- ============================================
  INSERT INTO categories (name) VALUES
    ('Floral'), ('Lighting'), ('Fabric'), ('Props'), ('Stage');

  -- ============================================
  -- INVENTORY ITEMS (mix of Budgeted/Premium)
  -- ============================================
  INSERT INTO inventory_items (name, category_id, type, qty, unit, location, notes) VALUES
    ('Rose Bunch (50 stems)',      1, 'Budgeted', 200, 'Bunches', 'Godown A', 'Fresh stock weekly'),
    ('Orchid Arrangement',         1, 'Premium',   50, 'Pcs',     'Godown A', 'Handle with care'),
    ('LED Fairy Lights 10m',       2, 'Budgeted', 150, 'Pcs',     'Godown B', ''),
    ('Crystal Chandelier',         2, 'Premium',   20, 'Pcs',     'Godown B', 'Fragile — double wrap'),
    ('Red Velvet Drape 20ft',      3, 'Budgeted', 100, 'Pcs',     'Godown A', ''),
    ('Gold Sequin Backdrop 10x8',  3, 'Premium',   30, 'Pcs',     'Godown A', 'Dry clean only'),
    ('Wooden Arch Frame',          4, 'Budgeted',  40, 'Pcs',     'Godown C', 'Needs assembly'),
    ('Glass Centerpiece Globe',    5, 'Premium',   60, 'Pcs',     'Godown B', 'Breakable');

  -- ============================================
  -- BOXES
  -- ============================================
  INSERT INTO boxes (box_code, label, location, notes) VALUES
    ('BOX-001', 'Floral Supplies A', 'Godown A', 'Roses and fillers'),
    ('BOX-002', 'Lighting Kit 1',    'Godown B', 'Fairy lights and chandeliers'),
    ('BOX-003', 'Fabric Box 1',      'Godown A', 'Drapes and backdrops');

  -- ============================================
  -- EVENTS
  -- ============================================
  INSERT INTO events (name, event_date, client, salesperson, status) VALUES
    ('Sharma Wedding',     '2026-04-15', 'Sharma Family',    'Rahul', 'Confirmed'),
    ('TechCorp Annual Gala','2026-04-22', 'TechCorp Pvt Ltd', 'Rahul', 'Tentative');

  -- ============================================
  -- EVENT ITEMS (blocking inventory for events)
  -- ============================================
  INSERT INTO event_items (event_id, item_id, qty, department, remark, blocked_by) VALUES
    (1, 1, 50,  'Flower',    'Main stage roses',           admin_id),
    (1, 2, 10,  'Flower',    'VIP table arrangements',     admin_id),
    (1, 5, 20,  'Fabric',    'Mandap draping',             admin_id),
    (1, 6,  5,  'Fabric',    'Stage backdrop',             admin_id),
    (1, 3, 30,  'Light',     'Ceiling fairy lights',       admin_id),
    (2, 3, 40,  'Light',     'Venue perimeter lighting',   sales_id),
    (2, 4,  8,  'Light',     'Main hall chandeliers',      sales_id),
    (2, 8, 20,  'Props',     'Table centerpieces',         sales_id);

  -- ============================================
  -- EVENT MANPOWER
  -- ============================================
  INSERT INTO event_manpower (event_id, worker_type, qty, rate_paise, remark, slots) VALUES
    (1, 'Flowerists',     6,  80000, 'Experienced with mandap', '[{"label":"Setup","start":"05:00","end":"12:00"},{"label":"Touch-up","start":"16:00","end":"20:00"}]'::jsonb),
    (1, 'Labours',       10,  50000, '',                        '[{"label":"Full Day","start":"06:00","end":"18:00"}]'::jsonb),
    (1, 'Carpenters',     4,  90000, 'Stage and mandap',        '[{"label":"Setup","start":"06:00","end":"14:00"}]'::jsonb),
    (1, 'Electricians',   3, 100000, 'Chandelier rigging',      '[{"label":"Setup","start":"07:00","end":"15:00"}]'::jsonb),
    (2, 'Labours',        8,  50000, '',                        '[{"label":"Full Day","start":"08:00","end":"20:00"}]'::jsonb),
    (2, 'Electricians',   4, 100000, 'Stage lighting',          '[{"label":"Setup","start":"06:00","end":"14:00"},{"label":"Event","start":"17:00","end":"23:00"}]'::jsonb),
    (2, 'Riggers',        3,  80000, 'Chandelier hanging',      '[{"label":"Morning","start":"06:00","end":"12:00"}]'::jsonb);

  -- ============================================
  -- EXPENSE CATEGORIES
  -- ============================================
  INSERT INTO expense_categories (name) VALUES
    ('Transport'), ('Materials'), ('Food & Beverage'), ('Labour Advance'), ('Miscellaneous');

  -- ============================================
  -- EXPENSES
  -- ============================================
  INSERT INTO expenses (user_id, category_id, amount_paise, description, status) VALUES
    (logi_id, 1, 250000,  'Tempo hire for Sharma Wedding material transport',  'pending'),
    (prod_id, 2, 180000,  'Emergency flower purchase from Crawford Market',     'approved'),
    (logi_id, 3,  45000,  'Tea and snacks for loading crew',                    'rejected');

  -- Update reviewed fields for non-pending expenses
  UPDATE expenses SET reviewed_by = admin_id, reviewed_at = now() WHERE status != 'pending';
  UPDATE expenses SET rejection_reason = 'Use petty cash for food under ₹500 only' WHERE status = 'rejected';

  -- ============================================
  -- PURCHASE REQUESTS
  -- ============================================
  INSERT INTO purchase_requests (item_name, qty, category_id, reason, requested_by, estimated_cost_paise, vendor, status) VALUES
    ('LED Par Lights 200W', 10, 2, 'Current stock insufficient for upcoming gala', sales_id, 1500000, 'LightPro India', 'Pending'),
    ('Silk Fabric Roll 50m', 5, 3, 'Premium draping for Sharma Wedding', prod_id, 2500000, 'Fabric World Mumbai', 'Approved');

  UPDATE purchase_requests SET reviewed_by = admin_id WHERE status = 'Approved';

  -- Departments are seeded via migration 00009

END $$;