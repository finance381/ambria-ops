-- Wallet's Collect action gets a second collection type: Other Income (a
-- Restaurant Collection type is coming separately once its own form is
-- defined). Mirrors event collections (fn_wallet_collect) where it makes
-- sense -- Cash/Bank mode, bank requires a payment type, a receipt photo is
-- always required here -- but there's no event to post an event_ledger
-- entry against, so other_income_entries IS the ledger for this money.

-- income_types: admin-managed master list for the "type of income" dropdown.
CREATE TABLE public.income_types (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.income_types ENABLE ROW LEVEL SECURITY;
-- Same shape as expense_types' own policies (et_select / et_admin).
CREATE POLICY it_select ON public.income_types FOR SELECT USING (true);
CREATE POLICY it_admin ON public.income_types FOR ALL USING (user_role() = 'admin');

-- other_income_entries: one row per Other Income collection -- entry date
-- (backdatable), income type, amount, description, mode, proof photo, and
-- the wallet_transactions row it produced. Direct writes denied, same as
-- wallet_transactions itself (wt_deny_write) -- everything goes through
-- fn_wallet_collect_other_income below.
CREATE TABLE public.other_income_entries (
  id bigserial PRIMARY KEY,
  income_type_id bigint NOT NULL REFERENCES public.income_types(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash', 'bank')),
  bank_payment_type text,
  description text,
  entry_date date NOT NULL,
  receipt_path text NOT NULL,
  receipt_no text,
  wallet_tx_id uuid,
  collected_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.other_income_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY oie_deny_write ON public.other_income_entries FOR ALL USING (false) WITH CHECK (false);
-- Same visibility shape as wallet_transactions' own wt_select: see your own,
-- or anyone fn_can_view_user already says you can see.
CREATE POLICY oie_select ON public.other_income_entries FOR SELECT USING (
  collected_by = auth.uid() OR fn_can_view_user(collected_by)
);

CREATE OR REPLACE FUNCTION public.fn_wallet_collect_other_income(
  p_income_type_id bigint,
  p_payment_mode text,
  p_amount_paise bigint,
  p_description text,
  p_receipt_path text,
  p_bank_payment_type text DEFAULT NULL,
  p_entry_date date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_new_bal bigint;
  v_tx_id uuid;
  v_entry_id bigint;
  v_receipt_no text;
BEGIN
  IF p_payment_mode NOT IN ('cash', 'bank') THEN RAISE EXCEPTION 'invalid payment_mode'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF p_receipt_path IS NULL OR length(trim(p_receipt_path)) = 0 THEN
    RAISE EXCEPTION 'receipt photo is required';
  END IF;
  IF p_payment_mode = 'bank' AND (p_bank_payment_type IS NULL OR length(trim(p_bank_payment_type)) = 0) THEN
    RAISE EXCEPTION 'payment type required for bank collections';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE id = p_income_type_id AND active) THEN
    RAISE EXCEPTION 'income type not found or inactive';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;

  -- Only cash physically sits with the collector — only cash moves the
  -- wallet (same rule as fn_wallet_collect).
  IF p_payment_mode = 'cash' THEN
    v_new_bal := v_wallet.balance_paise + p_amount_paise;
  ELSE
    v_new_bal := v_wallet.balance_paise;
  END IF;
  UPDATE public.wallets SET balance_paise = v_new_bal WHERE id = v_wallet.id;

  -- Own mode letter ('O') rather than reusing event collections' C/B so
  -- Other Income receipts are their own recognizable series.
  v_receipt_no := fn_next_receipt_no(fn_indian_fy_code(COALESCE(p_entry_date, current_date)), 'O');

  INSERT INTO public.other_income_entries
    (income_type_id, amount_paise, payment_mode, bank_payment_type, description, entry_date, receipt_path, receipt_no, collected_by)
  VALUES
    (p_income_type_id, p_amount_paise, p_payment_mode, p_bank_payment_type, p_description, COALESCE(p_entry_date, current_date), p_receipt_path, v_receipt_no, auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status, payment_mode, bank_payment_type, received_image_path, received_at, receipt_no, collection_date)
  VALUES
    (v_wallet.id, 'credit', p_amount_paise, v_new_bal, p_description, 'other_income', v_entry_id::text, auth.uid(), 'completed', p_payment_mode, p_bank_payment_type, p_receipt_path, now(), v_receipt_no, COALESCE(p_entry_date, current_date))
  RETURNING id INTO v_tx_id;

  UPDATE public.other_income_entries SET wallet_tx_id = v_tx_id WHERE id = v_entry_id;

  RETURN json_build_object(
    'wallet_tx_id', v_tx_id,
    'entry_id', v_entry_id,
    'receipt_no', v_receipt_no,
    'new_balance_paise', v_new_bal
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
