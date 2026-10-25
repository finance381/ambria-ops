-- LMS-sourced payment rows (collected straight into LMS, never touching
-- Ambria Ops' own wallet) now show up in EventLedger's Transactions tab
-- alongside real wallet collections. They have no wallet_transactions or
-- expenses row of their own to carry a checked_by/tally_entered_by on, so
-- this gives them one, keyed by LMS's own receive_id (pr_receive_id) —
-- globally unique per LMS payment record.

CREATE TABLE IF NOT EXISTS public.lms_payment_marks (
  receive_id text PRIMARY KEY,
  checked_by uuid REFERENCES public.profiles(id),
  checked_at timestamptz,
  tally_entered_by uuid REFERENCES public.profiles(id),
  tally_entered_at timestamptz
);

ALTER TABLE public.lms_payment_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_payment_marks_select ON public.lms_payment_marks;
CREATE POLICY lms_payment_marks_select ON public.lms_payment_marks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Writes only through the RPCs below (SECURITY DEFINER, permission-checked
-- server-side) — same shape as fn_toggle_wallet_check/fn_toggle_wallet_tally_entered.

CREATE OR REPLACE FUNCTION public.fn_toggle_lms_payment_check(p_receive_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.lms_payment_marks;
BEGIN
  IF NOT public.user_can('finance.wallet.mark_checked') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT * INTO v_row FROM public.lms_payment_marks WHERE receive_id = p_receive_id;

  IF v_row.receive_id IS NULL THEN
    INSERT INTO public.lms_payment_marks (receive_id, checked_by, checked_at)
    VALUES (p_receive_id, auth.uid(), now());
    RETURN true;
  END IF;

  IF v_row.checked_by IS NOT NULL THEN
    IF v_row.checked_by <> auth.uid() AND public.user_role() NOT IN ('admin', 'auditor') THEN
      RAISE EXCEPTION 'Only whoever checked this, or an admin, can un-check it';
    END IF;
    UPDATE public.lms_payment_marks SET checked_by = NULL, checked_at = NULL WHERE receive_id = p_receive_id;
    RETURN false;
  ELSE
    UPDATE public.lms_payment_marks SET checked_by = auth.uid(), checked_at = now() WHERE receive_id = p_receive_id;
    RETURN true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_toggle_lms_payment_entered(p_receive_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.lms_payment_marks;
BEGIN
  IF NOT public.user_can('finance.wallet.mark_entered') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT * INTO v_row FROM public.lms_payment_marks WHERE receive_id = p_receive_id;

  IF v_row.receive_id IS NULL THEN
    INSERT INTO public.lms_payment_marks (receive_id, tally_entered_by, tally_entered_at)
    VALUES (p_receive_id, auth.uid(), now());
    RETURN true;
  END IF;

  IF v_row.tally_entered_by IS NOT NULL THEN
    IF v_row.tally_entered_by <> auth.uid() AND public.user_role() NOT IN ('admin', 'auditor') THEN
      RAISE EXCEPTION 'Only whoever entered this, or an admin, can un-enter it';
    END IF;
    UPDATE public.lms_payment_marks SET tally_entered_by = NULL, tally_entered_at = NULL WHERE receive_id = p_receive_id;
    RETURN false;
  ELSE
    UPDATE public.lms_payment_marks SET tally_entered_by = auth.uid(), tally_entered_at = now() WHERE receive_id = p_receive_id;
    RETURN true;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
