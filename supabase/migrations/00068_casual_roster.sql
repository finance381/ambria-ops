-- Staff Roles → Casual Roster. The old shape was Name/Department(text)/
-- Default Rate/Sort Order — one untracked column of code confirmed zero
-- other consumers in the app (StaffRoles.jsx + its AdminShell registration
-- are the only two references), so it's safe to reshape in place rather
-- than build a parallel table.
--
-- New shape: Department (FK → departments, cascading), Sub-Department
-- (FK → sub_departments, cascades from Department), Casual Type (free-typed,
-- backed by a small casual_types master so the app can suggest + persist new
-- values the same way Purchase.jsx's vendor datalist already does), Type
-- (unit/set), Rate.
--
-- RLS carried over unchanged from staff_roles (sr_admin/sr_read): everyone
-- can read, only admin/auditor can write.

BEGIN;

CREATE TABLE IF NOT EXISTS public.casual_types (
  id bigserial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.casual_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ct_admin ON public.casual_types;
CREATE POLICY ct_admin ON public.casual_types
  FOR ALL USING (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]));

DROP POLICY IF EXISTS ct_read ON public.casual_types;
CREATE POLICY ct_read ON public.casual_types
  FOR SELECT USING (true);

-- ── Reshape staff_roles → casual_roster ─────────────────────────────────

ALTER TABLE public.staff_roles RENAME TO casual_roster;

ALTER TABLE public.casual_roster RENAME COLUMN name TO casual_type;
ALTER TABLE public.casual_roster RENAME COLUMN default_rate_paise TO rate_paise;

ALTER TABLE public.casual_roster DROP COLUMN IF EXISTS department;

ALTER TABLE public.casual_roster ADD COLUMN IF NOT EXISTS department_id integer REFERENCES public.departments(id);
ALTER TABLE public.casual_roster ADD COLUMN IF NOT EXISTS sub_department_id integer REFERENCES public.sub_departments(id);
ALTER TABLE public.casual_roster ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'unit' CHECK (rate_type IN ('unit', 'set'));

-- The existing "Painter" row (previously department='Decor' as plain text)
-- — best-effort carry it forward onto the real Decor department row so it
-- doesn't just silently lose its department on this migration.
UPDATE public.casual_roster
   SET department_id = (SELECT id FROM public.departments WHERE name = 'Decor' LIMIT 1)
 WHERE casual_type = 'Painter' AND department_id IS NULL;

-- Old RLS policy names (sr_admin/sr_read) still apply to the renamed table —
-- Postgres carries policies through a table rename. Recreated here only so
-- the names/definition read correctly against the new table name.
DROP POLICY IF EXISTS sr_admin ON public.casual_roster;
CREATE POLICY sr_admin ON public.casual_roster
  FOR ALL USING (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]));

DROP POLICY IF EXISTS sr_read ON public.casual_roster;
CREATE POLICY sr_read ON public.casual_roster
  FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
