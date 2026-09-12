-- pay_vendor exists as two overloads: an older 9-parameter version, and a newer
-- 10-parameter version that adds p_source_expense_id (DEFAULT NULL). The new one's
-- extra behavior is entirely gated behind `IF p_source_expense_id IS NOT NULL`, so
-- with that argument omitted it's byte-for-byte identical to the old one — the old
-- overload is pure dead weight now.
--
-- Because a call from the frontend that omits p_source_expense_id could match
-- either overload, PostgREST can't pick one and every such call fails with
-- "Could not choose the best candidate function" (this is exactly the error the
-- Pay Vendor flow was hitting). Dropping the stale 9-parameter overload leaves
-- only one candidate, so both call patterns (with and without a source expense)
-- resolve unambiguously.

drop function if exists public.pay_vendor(
  bigint,  -- p_vendor_id
  bigint,  -- p_amount_paise
  text,    -- p_description
  date,    -- p_entry_date
  text,    -- p_mode
  bigint,  -- p_deduction_paise
  text,    -- p_deduction_reason
  text[],  -- p_image_paths
  text     -- p_deduction_image_path
);
