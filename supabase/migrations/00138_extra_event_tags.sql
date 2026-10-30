-- A single Expense/GV entry or Decor Var Cost sheet still anchors to one
-- function (event_id) for the ledger — every function in a contract already
-- rolls that up the same way (see fn_event_group_balance), so which one
-- anchors it doesn't change what it hits financially. extra_event_ids is
-- purely a traceability tag: the OTHER functions in the same contract this
-- entry also covers (e.g. a decor cost that touched both the Mehndi and the
-- Reception setups), for display/reporting only — nothing reads it to
-- compute a balance.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS extra_event_ids bigint[];

ALTER TABLE public.decor_var_costs
  ADD COLUMN IF NOT EXISTS extra_event_ids bigint[];
