-- The "Pay Vendor" tab used to piggyback on the Vendor Ledger permission
-- key (finance.ledgers.vendor) — same screen, reached a different way. It's
-- now gated by its own permission (finance.pay_vendor) so it can be granted
-- or revoked independently of full Vendor Ledger access. Backfill it onto
-- every profile/role that already had Vendor Ledger, so nobody silently
-- loses the Pay Vendor tile they already see today.

UPDATE profiles
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.pay_vendor']))
WHERE mobile_permissions @> ARRAY['finance.ledgers.vendor'];

UPDATE profiles
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.pay_vendor']))
WHERE desktop_permissions @> ARRAY['finance.ledgers.vendor'];

UPDATE role_defaults
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['finance.pay_vendor']))
WHERE mobile_permissions @> ARRAY['finance.ledgers.vendor'];

UPDATE role_defaults
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['finance.pay_vendor']))
WHERE desktop_permissions @> ARRAY['finance.ledgers.vendor'];

-- Quick-add-vendor (from the expense form's vendor field, and from Pay
-- Vendor) used to be unconditional for anyone who could reach either
-- screen. It's now its own permission (procurement.vendors.quick_create).
-- Backfill it onto everyone who already had Expenses or Vendor Ledger
-- access, so nobody who relies on this today loses it the moment this
-- ships — an admin can selectively revoke it per-user from here on.

UPDATE profiles
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['procurement.vendors.quick_create']))
WHERE mobile_permissions && ARRAY['finance.expenses', 'finance.ledgers.vendor'];

UPDATE profiles
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['procurement.vendors.quick_create']))
WHERE desktop_permissions && ARRAY['finance.expenses', 'finance.ledgers.vendor'];

UPDATE role_defaults
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['procurement.vendors.quick_create']))
WHERE mobile_permissions && ARRAY['finance.expenses', 'finance.ledgers.vendor'];

UPDATE role_defaults
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['procurement.vendors.quick_create']))
WHERE desktop_permissions && ARRAY['finance.expenses', 'finance.ledgers.vendor'];
