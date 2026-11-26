-- Follow-up to 00205 (pay_vendor): asked to check the rest of the schema
-- for the same "two live overloads" shape. Found 4 more function names with
-- more than one overload live. Checked each one's actual call site(s)
-- before touching anything:
--
-- available_qty_batch -- the real one. Two overloads with IDENTICAL
-- parameter names (p_from, p_to, p_exclude_event_id), differing only in
-- the last param's type (bigint vs integer) -- and the bodies are not the
-- same logic at two revisions, they're two DIFFERENT feature sets: the
-- bigint/plpgsql version accounts for maintenance holds and challan
-- dispatch tracking; the integer/sql version only subtracts confirmed
-- event_items blocks. No caller anywhere in src/ or in any other live
-- function's body -- genuinely unused today, but a real landmine if
-- anything ever calls it, since identical names mean no argument can
-- disambiguate them the way pay_vendor's p_payment_type did. Keeping the
-- more complete (bigint) version, dropping the other.
--
-- fn_create_cost_transfer and fn_dvc_save_entry -- each has one stale
-- overload missing a later, purely-additive optional param
-- (p_receipt_path, p_remark respectively). Both live callers
-- (CostTransfers.jsx, DecorVarCost.jsx) always pass that param explicitly,
-- even as null, and it doesn't exist at all on the older overloads, so
-- Postgres can only ever match the newest one -- these are not live bugs.
-- Dropping the stale ones anyway: fn_dvc_save_entry's original overload
-- checks user_can('finance.expenses') instead of the correct
-- 'finance.decor_var_cost' -- dead code today, but a wrong permission gate
-- waiting to misfire if anything ever reaches it.
--
-- receive_expense_item -- same shape, already noted as known-safe in
-- 00107's own comment (disambiguated by p_receipt_index, which the old
-- overload doesn't declare at all). Dropping the old one for consistency.
DROP FUNCTION IF EXISTS public.available_qty_batch(date, date, integer);

DROP FUNCTION IF EXISTS public.fn_create_cost_transfer(
  bigint, text, integer, integer, bigint, integer, uuid,
  text, integer, integer, bigint, integer, uuid,
  text, text, date, jsonb, jsonb
);

DROP FUNCTION IF EXISTS public.fn_create_cost_transfer(
  bigint, text, integer, integer, bigint, integer, uuid,
  text, integer, integer, bigint, integer, uuid,
  text, text, date, jsonb, jsonb, uuid
);

DROP FUNCTION IF EXISTS public.fn_dvc_save_entry(bigint, jsonb, bigint, date, jsonb, bigint);

DROP FUNCTION IF EXISTS public.receive_expense_item(bigint, bigint, numeric, text);

NOTIFY pgrst, 'reload schema';
