-- Push notifications, phase 1: schema + transfer-sent/received-confirmed
-- triggers + the WhatsApp-inbox subscriber list. The expense dept-head
-- trigger is a separate migration (00061) pending one more schema check.
--
-- Two-layer delivery: every notification writes a `notifications` row first
-- (reliable, drives the in-app bell via realtime) and then best-effort calls
-- the `send-push` edge function for actual OS-level delivery. pg_net lets
-- that second step fire directly from SQL (a trigger/RPC), which is what
-- makes it fire reliably regardless of which client path caused the
-- underlying change — no client-side code has to remember to also call
-- send-push itself.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type text not null,  -- 'wa_inbox' | 'expense_dept' | 'transfer_sent' | 'transfer_received'
  title text not null,
  body text,
  link text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- No INSERT policy for plain clients — every row is written by a
-- SECURITY DEFINER trigger/RPC/edge function (service role), never directly.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.wa_inbox_notification_subscribers (
  user_id uuid primary key references public.profiles(id)
);

ALTER TABLE public.wa_inbox_notification_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_inbox_subs_select ON public.wa_inbox_notification_subscribers;
CREATE POLICY wa_inbox_subs_select ON public.wa_inbox_notification_subscribers
  FOR SELECT USING (user_can('broadcast.settings'));
-- No direct INSERT/UPDATE/DELETE policy — written only via
-- rpc_set_wa_inbox_subscribers below (SECURITY DEFINER, permission-checked).

-- ── Settings.jsx's save action ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_set_wa_inbox_subscribers(p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT user_can('broadcast.settings') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  DELETE FROM public.wa_inbox_notification_subscribers;
  IF p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 THEN
    INSERT INTO public.wa_inbox_notification_subscribers (user_id)
    SELECT DISTINCT unnest(p_user_ids);
  END IF;
END;
$function$;

-- ── Shared best-effort push helper, called from every trigger/RPC below ──
-- pg_net's net.http_post is fire-and-forget (queued, processed async by the
-- extension's own worker) — a slow or failing push never blocks the actual
-- wallet/expense transaction it's piggybacking on.

CREATE OR REPLACE FUNCTION public.fn_notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supabase_url text := current_setting('app.settings.supabase_url', true);
  v_service_role text := current_setting('app.settings.service_role_key', true);
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (p_user_id, p_type, p_title, p_body, p_link);

  -- These two GUCs are set once per database via ALTER DATABASE ... SET, a
  -- one-time manual step (see migration notes) — if they're not set yet,
  -- skip the push silently rather than erroring and losing the
  -- notifications row insert above.
  IF v_supabase_url IS NULL OR v_service_role IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'body', p_body, 'link', p_link)
  );
END;
$function$;

-- ── Transfer sent → notify the recipient ────────────────────────────────

CREATE OR REPLACE FUNCTION public.initiate_transfer(p_to_user_id uuid, p_amount_paise bigint, p_description text DEFAULT ''::text, p_sender_image text DEFAULT NULL::text, p_transfer_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_from_id uuid := auth.uid();
  v_wallet wallets%rowtype;
  v_transfer_id uuid;
  v_from_name text;
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

  select name into v_from_name from profiles where id = v_from_id;
  perform fn_notify(
    p_to_user_id, 'transfer_sent', 'Funds received',
    coalesce(v_from_name, 'Someone') || ' sent you ' || (p_amount_paise / 100.0)::numeric(12,2) || ' pts',
    'wallet'
  );

  return v_transfer_id;
end;
$function$;

-- ── Transfer confirmed → notify the original sender ─────────────────────
-- Generic across every kind of pending credit (confirm_wallet_receive isn't
-- transfer-specific — WalletManager.jsx's "Confirm Received" button uses it
-- for any pending credit) — only transfer-type rows look up a sender to
-- notify; everything else behaves exactly as before.

CREATE OR REPLACE FUNCTION public.confirm_wallet_receive(p_txn_id uuid, p_received_image text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_txn wallet_transactions%ROWTYPE;
  v_wallet_id uuid;
  v_new_balance bigint;
  v_from_user_id uuid;
  v_to_name text;
BEGIN
  SELECT * INTO v_txn FROM wallet_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_txn.status <> 'pending' THEN RAISE EXCEPTION 'Transaction is not pending'; END IF;
  SELECT id INTO v_wallet_id FROM wallets WHERE user_id = auth.uid();
  IF v_wallet_id IS NULL OR v_wallet_id <> v_txn.wallet_id THEN
    RAISE EXCEPTION 'Not your wallet';
  END IF;

  -- Apply the pending amount to the wallet now.
  UPDATE wallets
    SET balance_paise = balance_paise + v_txn.amount_paise,
        updated_at = now()
    WHERE id = v_wallet_id
    RETURNING balance_paise INTO v_new_balance;

  UPDATE wallet_transactions
    SET status = 'completed',
        received_image_path = p_received_image,
        received_at = now(),
        balance_after_paise = v_new_balance
    WHERE id = p_txn_id;

  IF v_txn.reference_type = 'transfer' AND v_txn.reference_id ~ '^[0-9a-f-]{36}$' THEN
    SELECT from_user_id INTO v_from_user_id FROM wallet_transfers WHERE id = v_txn.reference_id::uuid;
    IF v_from_user_id IS NOT NULL THEN
      SELECT name INTO v_to_name FROM profiles WHERE id = auth.uid();
      PERFORM fn_notify(
        v_from_user_id, 'transfer_received', 'Transfer confirmed',
        coalesce(v_to_name, 'The recipient') || ' confirmed receiving ' || (v_txn.amount_paise / 100.0)::numeric(12,2) || ' pts',
        'wallet'
      );
    END IF;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- ONE-TIME MANUAL STEP — fn_notify reads these two database-level settings
-- instead of hardcoding them, so run this once (outside the transaction
-- above, it takes effect on new connections):
--
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://ptksdithbytzrznplfiq.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<your service_role key, from Project Settings > API>';
--
-- Until both are set, notifications rows still get written correctly (the
-- in-app bell works) — only the OS push step is skipped, silently, per
-- fn_notify's own null-check above.
-- ═══════════════════════════════════════════════════════════════════════
