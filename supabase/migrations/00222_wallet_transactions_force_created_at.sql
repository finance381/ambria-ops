-- Closes off the exact failure mode behind 00221: Harsh Sharma's "05.09
-- opening" row was inserted directly via SQL with created_at backdated to a
-- date weeks before it actually landed, so every screen (which orders this
-- history by created_at) displayed it next to transactions it had no real
-- relationship to. Confirmed no app RPC or migration has ever set
-- created_at explicitly on this table -- it always relies on the column
-- default (now()) -- so there is nothing legitimate this could break.
--
-- Rather than rely on every future manual correction remembering not to set
-- it, this makes it impossible: created_at is always the real wall-clock
-- insertion time, full stop, no matter what a future INSERT (RPC, migration,
-- or anything else) tries to pass.
CREATE OR REPLACE FUNCTION public.fn_wallet_transactions_force_created_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_force_created_at ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_force_created_at
BEFORE INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_wallet_transactions_force_created_at();
