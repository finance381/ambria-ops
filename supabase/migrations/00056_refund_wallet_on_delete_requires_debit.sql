-- refund_wallet_on_delete blindly credited a refund whenever an approved
-- expense was deleted, assuming the wallet debit it once caused was still
-- sitting there to refund against. That assumption breaks whenever the
-- debit's own wallet_transactions row is gone for any reason (most recently:
-- a full wallet reset that deliberately cleared old wallet_transactions
-- without touching the expenses table) — the trigger then manufactures a
-- credit with nothing behind it. Raheesh hit this twice (see chat: two
-- separate manual cleanups for the same root cause).
--
-- Now only refunds when a matching debit row for this exact expense is
-- still actually there. Everything else about the function is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.refund_wallet_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_wallet  wallets%ROWTYPE;
  v_refund  bigint;
  v_debit_exists boolean;
BEGIN
  IF OLD.status != 'approved' THEN RETURN OLD; END IF;

  -- v87+: wallet was debited by cash portion only
  v_refund := COALESCE(OLD.payment_cash_paise, OLD.amount_paise);
  IF v_refund <= 0 THEN RETURN OLD; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = OLD.user_id;
  IF NOT FOUND THEN RETURN OLD; END IF;

  -- Only refund if the original debit is still actually there to refund
  -- against — otherwise this manufactures a credit with nothing behind it.
  SELECT EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet.id AND type = 'debit'
      AND reference_type = 'expense' AND reference_id = OLD.id::text
  ) INTO v_debit_exists;
  IF NOT v_debit_exists THEN RETURN OLD; END IF;

  UPDATE wallets SET balance_paise = balance_paise + v_refund, updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description,
     reference_type, reference_id, performed_by)
  VALUES
    (v_wallet.id, 'credit', v_refund, v_wallet.balance_paise + v_refund,
     'Refund: deleted expense #' || OLD.id, 'expense_refund',
     OLD.id::TEXT, auth.uid());
  RETURN OLD;
END $function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
