-- The actual reason users felt like they "had to manually sync" to see the
-- latest contracts: sync-events-15min (pg_cron, every 15 min) has been
-- running and returning HTTP 200 the whole time, but every single run fails
-- to upsert the Decor and Entertainment chunks with:
--   insert or update on table "event_ledger" violates foreign key
--   constraint "event_ledger_event_id_fkey"
-- (confirmed via net._http_response — identical error, every run, for
-- hours). 1162 of 1399 contracts synced; 237 never made it in, and never
-- will, because the same chunk fails identically every single time (the
-- whole chunk's upsert statement rolls back together). Manual sync from the
-- Events screen hits the exact same bug — it isn't a "sync more often" gap,
-- the sync itself is broken for any brand-new contract with an LMS advance.
--
-- Root cause: trg_seed_event_advances_ins is a BEFORE INSERT trigger that
-- inserts a row into event_ledger referencing NEW.id. Postgres only
-- physically writes the NEW row to events after BEFORE ROW triggers
-- return — so event_ledger's FK check (events.id = NEW.id) can never find
-- it yet, for every brand-new contract with a cash/bank advance, always.
-- The UPDATE trigger is fine as-is: an UPDATE's id already exists from a
-- prior INSERT, so that FK check always succeeds.
--
-- Fix: move the INSERT side to AFTER INSERT, where the row genuinely exists
-- by the time the trigger fires. An AFTER trigger's NEW mutations are
-- ignored, so "mark seeded" becomes an explicit UPDATE instead of NEW.lms_
-- advances_seeded := true — the UPDATE only touches that one column, so it
-- doesn't re-trigger trg_seed_event_advances_upd (its WHEN clause requires
-- the advance *amounts* to have changed).

BEGIN;

CREATE OR REPLACE FUNCTION trg_seed_event_advances_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cash bigint := coalesce(new.lms_advance_cash_paise, 0);
  v_bank bigint := coalesce(new.lms_advance_bank_paise, 0);
BEGIN
  IF new.lms_advances_seeded THEN RETURN new; END IF;
  IF v_cash <= 0 AND v_bank <= 0 THEN RETURN new; END IF;

  IF v_cash > 0 THEN
    INSERT INTO public.event_ledger (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description)
    VALUES (new.id, 'lms_advance', 'in', 'cash', v_cash, 'lms_advance_cash', new.id::text, 'LMS advance (cash) — seeded from contract');
  END IF;
  IF v_bank > 0 THEN
    INSERT INTO public.event_ledger (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description)
    VALUES (new.id, 'lms_advance', 'in', 'bank', v_bank, 'lms_advance_bank', new.id::text, 'LMS advance (bank) — seeded from contract');
  END IF;

  UPDATE public.events SET lms_advances_seeded = true WHERE id = new.id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_event_advances_ins ON public.events;
CREATE TRIGGER trg_seed_event_advances_ins AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION trg_seed_event_advances_after_insert();

-- One-time backfill: any row that's been sitting there unseeded all along
-- because it already existed before this bug started (or its advance
-- values happen to never change, which means the UPDATE trigger's WHEN
-- clause — advance amounts must change — would never re-fire for it
-- either). Same logic as the trigger, just run once directly.
DO $$
DECLARE
  r RECORD;
  v_cash bigint;
  v_bank bigint;
BEGIN
  FOR r IN
    SELECT id, lms_advance_cash_paise, lms_advance_bank_paise
    FROM events
    WHERE NOT lms_advances_seeded
      AND (COALESCE(lms_advance_cash_paise, 0) > 0 OR COALESCE(lms_advance_bank_paise, 0) > 0)
  LOOP
    v_cash := COALESCE(r.lms_advance_cash_paise, 0);
    v_bank := COALESCE(r.lms_advance_bank_paise, 0);

    IF v_cash > 0 THEN
      INSERT INTO event_ledger (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description)
      VALUES (r.id, 'lms_advance', 'in', 'cash', v_cash, 'lms_advance_cash', r.id::text, 'LMS advance (cash) — seeded from contract')
      ON CONFLICT DO NOTHING;
    END IF;
    IF v_bank > 0 THEN
      INSERT INTO event_ledger (event_id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description)
      VALUES (r.id, 'lms_advance', 'in', 'bank', v_bank, 'lms_advance_bank', r.id::text, 'LMS advance (bank) — seeded from contract')
      ON CONFLICT DO NOTHING;
    END IF;

    UPDATE events SET lms_advances_seeded = true WHERE id = r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
