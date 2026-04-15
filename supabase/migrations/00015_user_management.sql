-- Add phone to profiles (may already exist but ensure it's there)
-- phone column already exists from 00001, no change needed

-- Add activity log table
CREATE TABLE activity_logs (
  id          SERIAL PRIMARY KEY,
  user_id     UUID REFERENCES profiles(id),
  action      TEXT NOT NULL,
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select" ON activity_logs
  FOR SELECT USING (public.user_role() IN ('admin', 'auditor'));

CREATE POLICY "logs_insert" ON activity_logs
  FOR INSERT WITH CHECK (true);

CREATE INDEX idx_logs_user ON activity_logs(user_id);
CREATE INDEX idx_logs_created ON activity_logs(created_at DESC);