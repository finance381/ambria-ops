-- The Amount-field bug fixed in the same commit as this migration (Amount
-- left at the full balance owed, deduction added on top instead of coming
-- out of it) actually happened twice before it was caught, both processed
-- by Ompal Sharma on 2026-11-24:
--   Pankaj Mishra Labor Thekedar: Amount 10,007 + deduction 7 ("round off")
--     -- wallet debited 10,007, should have been 10,000.
--   Puran Dehari Labour Vendor FD (Layak): Amount 7,910 + deduction 10
--     ("round off") -- wallet debited 7,910, should have been 7,900.
-- Each over-debit exactly matches its own deduction amount. Credited back
-- as its own audited correction entry, same shape as 00203.
DO $$
DECLARE
  v_row record;
  v_wallet public.wallets%ROWTYPE;
  v_targets jsonb := '[
    {"user_id": "111c20c6-0a89-4503-84b1-98952031a5ec", "ref_id": "306282e2-8cf5-4942-9171-5fbb6917092f", "amount_paise": 700,  "description": "Correction: Pankaj Mishra payment debited the deduction (round off) on top of the cash amount"},
    {"user_id": "111c20c6-0a89-4503-84b1-98952031a5ec", "ref_id": "04a052a2-3042-4285-92f6-e438e88770f2", "amount_paise": 1000, "description": "Correction: Puran Dehari payment debited the deduction (round off) on top of the cash amount"}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_targets) AS x(user_id uuid, ref_id text, amount_paise bigint, description text)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE reference_type = 'vendor_payment_correction' AND reference_id = v_row.ref_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_row.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet not found for user % (ref %)', v_row.user_id, v_row.ref_id;
    END IF;

    UPDATE public.wallets SET balance_paise = balance_paise + v_row.amount_paise WHERE id = v_wallet.id;

    INSERT INTO public.wallet_transactions
      (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
    VALUES
      (v_wallet.id, 'credit', v_row.amount_paise, v_wallet.balance_paise + v_row.amount_paise,
       v_row.description, 'vendor_payment_correction', v_row.ref_id, v_row.user_id, 'completed');
  END LOOP;
END $$;
