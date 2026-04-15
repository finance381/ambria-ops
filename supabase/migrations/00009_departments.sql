-- Departments table
CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select" ON departments FOR SELECT USING (true);
CREATE POLICY "departments_insert" ON departments FOR INSERT WITH CHECK (public.user_role() = 'admin');
CREATE POLICY "departments_update" ON departments FOR UPDATE USING (public.user_role() = 'admin');
CREATE POLICY "departments_delete" ON departments FOR DELETE USING (public.user_role() = 'admin');

-- Seed default departments
INSERT INTO departments (name) VALUES
  ('Fabric'), ('Structure'), ('Furniture'), ('Light'),
  ('Painter & Production'), ('Flower'), ('Props'), ('Venue'), ('Other');