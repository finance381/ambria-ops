-- Reviews module — Phase 10c: backfill the new review.masters permission.
-- Admin only, matching PendingReview.jsx's real access today — DeptReview.jsx
-- (dept tier) never touches categories/sub_categories, and the base-table RLS
-- for those two tables already only allows admin to see 'pending' rows anyway.

BEGIN;

UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['review.masters'])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['review.masters']))
WHERE role = 'admin';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['review.masters'])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['review.masters']))
WHERE role = 'admin';

COMMIT;

NOTIFY pgrst, 'reload schema';
