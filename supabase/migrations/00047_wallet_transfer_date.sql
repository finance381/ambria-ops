-- Adds a user-chosen "transfer date" to wallet_transfers, separate from
-- created_at (when the transfer was actually logged) — the same
-- expense_date / entry_date pattern already used by expenses and
-- ledger_entries. The frontend bounds it to today minus 3 days, same as
-- expense_date; no server-side range check, matching how expense_date
-- itself is only bounded client-side.

ALTER TABLE wallet_transfers
  ADD COLUMN IF NOT EXISTS transfer_date date;

UPDATE wallet_transfers SET transfer_date = created_at::date WHERE transfer_date IS NULL;

CREATE OR REPLACE FUNCTION public.initiate_transfer(p_to_user_id uuid, p_amount_paise bigint, p_description text DEFAULT ''::text, p_sender_image text DEFAULT NULL::text, p_transfer_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_from_id uuid := auth.uid();
  v_wallet wallets%rowtype;
  v_transfer_id uuid;
begin
  if v_from_id = p_to_user_id then
    raise exception 'Cannot transfer to yourself';
  end if;
  -- Auto-create recipient wallet if missing
  insert into wallets (user_id, balance_paise) values (p_to_user_id, 0) on conflict (user_id) do nothing;
  select * into v_wallet from wallets where user_id = v_from_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  -- Negative balance allowed by design; no insufficient-balance check.
  update wallets set balance_paise = balance_paise - p_amount_paise where user_id = v_from_id;
  insert into wallet_transfers (from_user_id, to_user_id, amount_paise, description, sender_image_path, transfer_date)
  values (v_from_id, p_to_user_id, p_amount_paise, p_description, p_sender_image, coalesce(p_transfer_date, current_date))
  returning id into v_transfer_id;
  insert into wallet_transactions (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  values (v_wallet.id, 'debit', p_amount_paise, v_wallet.balance_paise - p_amount_paise, 'Transfer: ' || p_description, 'transfer', v_transfer_id::text, v_from_id, 'completed');
  return v_transfer_id;
end;
$function$;

NOTIFY pgrst, 'reload schema';
