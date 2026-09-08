-- Reviews module — Phase 10a: add 'category'/'sub_category' as review domains
-- (folding in the pending category/sub-category NAME approval flow that
-- PendingReview.jsx also handled, per user request after initial rollout).
--
-- New enum values MUST be committed before anything references them — run this
-- file ALONE first, confirm it applied, THEN run 00023 (which uses these values
-- inside v_review_queue / the RPCs). Running both in one transaction would fail.

ALTER TYPE review_domain_e ADD VALUE IF NOT EXISTS 'category';
ALTER TYPE review_domain_e ADD VALUE IF NOT EXISTS 'sub_category';
