-- The tentative-event venue picker (WalletManager.jsx + ExpenseForm.jsx)
-- only ever lists venues already in the venues master table -- no way to
-- book a tentative event somewhere genuinely one-off (a client's own
-- residence, an outside hotel, etc.). Adds an "Others" option backed by a
-- free-text venue name instead of a venue_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_tentative_event(
  p_client_name text,
  p_venue_id integer,
  p_function_date date,
  p_pax integer,
  p_function_type text,
  p_venue_name_other text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_name text;
  v_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('events.list.create_tentative') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  IF p_client_name IS NULL OR length(trim(p_client_name)) = 0 THEN
    RAISE EXCEPTION 'guest name required';
  END IF;
  IF p_function_date IS NULL THEN
    RAISE EXCEPTION 'function date required';
  END IF;
  IF p_function_type IS NULL OR length(trim(p_function_type)) = 0 THEN
    RAISE EXCEPTION 'function type required';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT name INTO v_venue_name FROM venues WHERE id = p_venue_id;
    IF v_venue_name IS NULL THEN
      RAISE EXCEPTION 'venue not found';
    END IF;
  ELSIF p_venue_name_other IS NOT NULL AND length(trim(p_venue_name_other)) > 0 THEN
    v_venue_name := trim(p_venue_name_other);
    p_venue_id := NULL;
  ELSE
    RAISE EXCEPTION 'venue required';
  END IF;

  INSERT INTO events (
    event_name, client_name, venue_id, venue_name, function_date, pax, function_type,
    is_tentative, tentative_created_by, tentative_created_at
  ) VALUES (
    p_function_type, trim(p_client_name), p_venue_id, v_venue_name, p_function_date, p_pax, p_function_type,
    true, v_uid, now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
