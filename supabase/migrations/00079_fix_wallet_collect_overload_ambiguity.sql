-- 00078 added p_bank_payment_type to fn_wallet_collect via CREATE OR REPLACE,
-- but Postgres treats a different parameter list as a distinct overload, not
-- a replacement — the old 5-arg version was never dropped, so the schema had
-- both fn_wallet_collect/5 and fn_wallet_collect/6 at once. Any RPC call
-- then failed with "could not choose the best candidate function", since a
-- defaulted new parameter is exactly the case where Postgres can't tell the
-- two apart.
--
-- Drop the old signature explicitly. The 6-arg version from 00078 is left
-- untouched (CREATE OR REPLACE is safe here since this call is replacing a
-- function with the SAME signature it already has).

BEGIN;

DROP FUNCTION IF EXISTS public.fn_wallet_collect(bigint, text, bigint, text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
