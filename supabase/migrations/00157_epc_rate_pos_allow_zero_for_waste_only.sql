-- fn_extra_plate_collect stores rate_paise = 0 for returns-only logs (no
-- plates charged, so no contract rate is required) — the old epc_rate_pos
-- constraint required rate_paise > 0 on every row, which blocked exactly
-- that case ("new row ... violates check constraint epc_rate_pos").
-- A positive rate is only meaningful when plates were actually charged.
alter table public.extra_plate_collections
  drop constraint epc_rate_pos;

alter table public.extra_plate_collections
  add constraint epc_rate_pos check (rate_paise > 0 or extras_charged = 0);
