-- Reviews module — Phase 2: permission backfill
-- Companion JS change: new "Review" group in src/lib/permissions.js (already edited,
-- replacing the old review.dept / review.pending / review.dept.approve / review.pending.approve
-- entries — those old keys are intentionally left untouched on existing profiles/role_defaults
-- rows below, not stripped, so DeptReview.jsx / AdminReview.jsx / PendingReview.jsx keep working
-- unmodified for current grantees through the Phase 8 deprecation window. They just can no
-- longer be granted to new users via the Users.jsx editor now that they're off the catalog.
--
-- None of the 5 review.* domain keys use the standard data-scope chip (dataScope: true) —
-- row visibility for them is controlled entirely by the new review_scopes JSONB tag picker
-- (Phase 6.2), not the generic data_scopes/user_scope() mechanism, so there's nothing to set
-- in data_scopes for these keys. admin/auditor bypass review_scopes entirely at the RLS/RPC
-- layer regardless (see fn_review_scope_visible), so review_scopes is left at its default '{}'.
--
-- No feature_review_* legacy keys were found in Phase 0 audit — nothing to migrate/retire there.

BEGIN;

-- Admin: all 8 review.* keys, both surfaces
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.bulk','review.reopen','review.history'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.bulk','review.reopen','review.history'
  ]))
WHERE role = 'admin';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.bulk','review.reopen','review.history'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.bulk','review.reopen','review.history'
  ]))
WHERE role = 'admin';

-- Auditor: 5 domain keys + review.history (no bulk / reopen)
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.history'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.history'
  ]))
WHERE role = 'auditor';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.history'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'review.inventory','review.item_receipts','review.expenses','review.requisitions',
    'review.vendor_payments','review.history'
  ]))
WHERE role = 'auditor';

COMMIT;

NOTIFY pgrst, 'reload schema';
