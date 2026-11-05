-- issue_money/deduct_money returned void, so the only way WalletManager.jsx's
-- issuePoints() could attach a receipt image to the row it just created was
-- to guess "whichever is latest with this exact description" afterward -- a
-- genuine race if another write lands on the same wallet in between.
-- Returning the new wallet_transactions row's id lets the caller attach the
-- image to the exact row, closing that window entirely.
--
-- Postgres can't CREATE OR REPLACE a function across a different return type
-- (void -> uuid), so each is dropped and recreated. Bodies are otherwise
-- unchanged from their current definitions.

DROP FUNCTION IF EXISTS public.deduct_money(uuid, bigint, text);

CREATE FUNCTION public.deduct_money(p_user_id uuid, p_amount_paise bigint, p_description text DEFAULT 'Points deducted'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_wallet_id   uuid;
  v_new_balance bigint;
  v_txn_id      uuid;
BEGIN
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT id, balance_paise - p_amount_paise
    INTO v_wallet_id, v_new_balance
    FROM wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  UPDATE wallets
     SET balance_paise = v_new_balance,
         updated_at    = NOW()
   WHERE id = v_wallet_id;

  -- amount_paise is always POSITIVE; the 'debit' type carries the sign.
  -- (matches the wallet_transactions_amount_paise_check CHECK (> 0) constraint)
  INSERT INTO wallet_transactions (
    wallet_id, type, amount_paise, balance_after_paise,
    description, performed_by, status
  ) VALUES (
    v_wallet_id, 'debit', p_amount_paise, v_new_balance,
    p_description, auth.uid(), 'completed'
  )
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.issue_money(uuid, bigint, text);

CREATE FUNCTION public.issue_money(p_user_id uuid, p_amount_paise bigint, p_description text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_wallet_id uuid;
  v_current_balance bigint;
  v_txn_id uuid;
BEGIN
  INSERT INTO wallets (user_id, balance_paise) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id, balance_paise INTO v_wallet_id, v_current_balance
    FROM wallets WHERE user_id = p_user_id;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  -- Do NOT touch balance. Pending row shows in recipient's "Receive" list.
  -- balance_after_paise records the CURRENT balance since nothing was applied yet.
  INSERT INTO wallet_transactions (
    wallet_id, type, amount_paise, balance_after_paise,
    description, performed_by, reference_type, status
  )
  VALUES (
    v_wallet_id, 'credit', p_amount_paise, v_current_balance,
    p_description, auth.uid(), NULL, 'pending'
  )
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
