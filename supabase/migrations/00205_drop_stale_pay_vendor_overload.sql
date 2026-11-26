-- 00052's own DROP FUNCTION IF EXISTS never actually matched what was live:
-- it targeted the 11-arg signature ending in (..., p_source_expense_id
-- bigint, p_payment_type text) — but the function actually deployed at the
-- time (from 00050) only had 10 args and no p_payment_type at all. The DROP
-- was a silent no-op against a signature that didn't exist, so 00052's
-- CREATE OR REPLACE added a second overload instead of replacing the first
-- -- the exact PostgREST ambiguity bug 00052's own comment says it was
-- written to avoid (and that 00038 already had to fix once before).
--
-- Found while investigating a vendor-payment wallet discrepancy: that bug
-- turned out to be unrelated (PayVendorModal.jsx always sends
-- p_payment_type, which only the new overload accepts, so PostgREST was
-- resolving correctly) -- but two live overloads sitting here is still a
-- real landmine, not a safe no-op, so it gets closed now that it's found.
DROP FUNCTION IF EXISTS public.pay_vendor(
  bigint,  -- p_vendor_id
  bigint,  -- p_amount_paise
  text,    -- p_description
  date,    -- p_entry_date
  text,    -- p_mode
  bigint,  -- p_deduction_paise
  text,    -- p_deduction_reason
  text[],  -- p_image_paths
  text,    -- p_deduction_image_path
  bigint   -- p_source_expense_id
);

NOTIFY pgrst, 'reload schema';
