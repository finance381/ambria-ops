-- ALTER DATABASE ... SET is blocked for regular project roles on Supabase
-- Cloud (only true superuser can set custom GUCs that way) — fn_notify's
-- current_setting() approach from 00060 can't work as written. Switching to
-- Supabase Vault, which is exactly what it's for: letting a trigger/function
-- call an edge function securely, without hardcoding a secret in source
-- (readable by anyone who can read pg_proc) or needing superuser.

BEGIN;

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.fn_notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supabase_url text;
  v_service_role text;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (p_user_id, p_type, p_title, p_body, p_link);

  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  -- If the two vault secrets below haven't been created yet, skip the push
  -- silently rather than erroring and losing the notifications row insert
  -- above — the in-app bell still works either way.
  IF v_supabase_url IS NULL OR v_service_role IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'body', p_body, 'link', p_link)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- ONE-TIME MANUAL STEP — run these two separately (not part of the
-- migration transaction above; vault.create_secret does its own commit).
-- Safe to run only once each — running create_secret again with the same
-- name adds a second secret, and the SELECT above would then pick whichever
-- one happens to sort first, so don't re-run these on a later deploy.
--
--   select vault.create_secret('https://ptksdithbytzrznplfiq.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key from Project Settings > API>', 'service_role_key');
-- ═══════════════════════════════════════════════════════════════════════
