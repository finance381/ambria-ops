-- Same display-order issue as 00221 (Harsh Sharma's "05.09 opening"), but a
-- different cause: every correction row 00203 inserted for the same wallet
-- shares the exact same created_at (one timestamp per migration run), and
-- Postgres's FOR loop over jsonb_to_recordset has no guaranteed iteration
-- order without an explicit ORDER BY -- so the rows didn't necessarily land
-- in the jsonb array's own listed order. Verified against the real balance
-- chain (matching each row's own balance_after_paise to what must have
-- preceded it) for Amar Kumar, Guddu Light (Add) and Jai Singh: the true
-- order exactly matches 00203's array order in every case. Re-stamping the
-- whole batch per wallet, one second apart, in that confirmed order, starting
-- comfortably after the original shared timestamp and comfortably before
-- the next real transaction on each wallet.
--
-- David's pair (401, 421) and Mohan Sharma's/Puspender Driver's flagged
-- members are included the same way -- their own balance chain already
-- confirmed the relative order needed between the flagged rows themselves
-- (unflagged siblings in the same original batch, if any, are left alone
-- since their own position already checks out).
--
-- No amount, description, or balance_after_paise is touched -- only
-- created_at, which only affects display order.
DO $$
DECLARE
  v_wallet_id uuid;
  v_base timestamptz;
  v_targets jsonb := '[
    {"name": "Amar Kumar", "ids": [13, 14, 184, 803, 1022, 1027]},
    {"name": "Guddu Light (Add)", "ids": [23, 25, 26, 27, 28, 30, 32]},
    {"name": "Jai Singh", "ids": [3597, 3599, 3600]},
    {"name": "Mohan Sharma", "ids": [1079, 1082]},
    {"name": "Puspender Driver (CD)", "ids": [573, 574]},
    {"name": "David", "ids": [401, 421]}
  ]'::jsonb;
  v_group record;
  v_id int;
  v_idx int;
BEGIN
  FOR v_group IN SELECT * FROM jsonb_to_recordset(v_targets) AS x(name text, ids jsonb)
  LOOP
    SELECT w.id INTO v_wallet_id FROM public.wallets w JOIN public.profiles p ON p.id = w.user_id WHERE p.name = v_group.name;
    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Wallet not found for %', v_group.name;
    END IF;

    v_base := '2026-11-25 12:07:14+00'::timestamptz;
    v_idx := 0;
    FOR v_id IN SELECT x::int FROM jsonb_array_elements_text(v_group.ids) AS x
    LOOP
      UPDATE public.wallet_transactions
      SET created_at = v_base + (v_idx || ' seconds')::interval
      WHERE wallet_id = v_wallet_id
        AND reference_type = 'expense_refund_correction'
        AND description LIKE '%#' || v_id::text || ' (%';
      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;
END $$;
