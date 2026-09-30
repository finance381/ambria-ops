-- refund_wallet_on_delete (00056) only refunded when OLD.status was still
-- exactly 'approved' at delete time. But an approved expense keeps moving
-- through a post-approval bookkeeping track (recorded -> flagged/
-- acknowledged -> deducted) that this codebase uses for cash-advance-style
-- categories (e.g. "AE Expenses") -- once status leaves 'approved' for any
-- of those, the guard silently skipped the refund even though the wallet
-- debit was still sitting there untouched. Reported: two of Mahesh's
-- acknowledged AE Expenses ("karb stone", "singonyam") were deleted and
-- never refunded, leaving his wallet short by their full amount.
--
-- Fix: refund on delete for every status except 'rejected'. 'rejected' is
-- the one status that can ALREADY have been refunded elsewhere --
-- refund_wallet_on_reject only ever fires on an approved -> rejected
-- transition, and it never removes the original debit row afterward, so
-- refunding again on delete would double-credit. Every other status
-- (approved, and anything further down the recorded/flagged/acknowledged/
-- deducted track) can never have passed through that transition, so there
-- is nothing to double up against. 'pending' is still naturally excluded by
-- the existing v_debit_exists check below (a pending expense was never
-- debited in the first place).

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
  -- Already refunded via rejection (see header comment) -- refunding again
  -- here would double-credit against the same surviving debit row.
  IF OLD.status = 'rejected' THEN RETURN OLD; END IF;

  -- v87+: wallet was debited by cash portion only
  v_refund := COALESCE(OLD.payment_cash_paise, OLD.amount_paise);
  IF v_refund <= 0 THEN RETURN OLD; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = OLD.user_id;
  IF NOT FOUND THEN RETURN OLD; END IF;

  -- Only refund if the original debit is still actually there to refund
  -- against -- otherwise this manufactures a credit with nothing behind it.
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

-- ── One-time backfill: catch every expense this bug already shorted ──────
-- Same rules as the fixed trigger above (status <> 'rejected', a surviving
-- debit row, no refund already recorded for it), applied retroactively to
-- every already-deleted expense in the table, not just Mahesh's two.
DO $$
DECLARE
  r RECORD;
  v_wallet wallets%ROWTYPE;
  v_refund bigint;
  v_already_refunded boolean;
BEGIN
  FOR r IN
    SELECT e.id, e.user_id, e.payment_cash_paise, e.amount_paise, e.description
    FROM expenses e
    WHERE e.deleted_at IS NOT NULL
      AND e.status <> 'rejected'
  LOOP
    v_refund := COALESCE(r.payment_cash_paise, r.amount_paise);
    IF v_refund IS NULL OR v_refund <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_wallet FROM wallets WHERE user_id = r.user_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Must still have its debit (same guard the trigger uses).
    IF NOT EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE wallet_id = v_wallet.id AND type = 'debit'
        AND reference_type = 'expense' AND reference_id = r.id::text
    ) THEN CONTINUE; END IF;

    -- Skip if a refund for this exact expense already exists (either the
    -- original trigger already caught it while status was still 'approved',
    -- or a manual fix already happened).
    SELECT EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE wallet_id = v_wallet.id AND type = 'credit'
        AND reference_type = 'expense_refund' AND reference_id = r.id::text
    ) INTO v_already_refunded;
    IF v_already_refunded THEN CONTINUE; END IF;

    UPDATE wallets SET balance_paise = balance_paise + v_refund, updated_at = now()
     WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;

    INSERT INTO wallet_transactions
      (wallet_id, type, amount_paise, balance_after_paise, description,
       reference_type, reference_id, performed_by)
    VALUES
      (v_wallet.id, 'credit', v_refund, v_wallet.balance_paise,
       'Refund (backfill): deleted expense #' || r.id, 'expense_refund',
       r.id::TEXT, NULL);

    RAISE NOTICE 'Refunded % paise to wallet % for deleted expense #%', v_refund, v_wallet.id, r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
