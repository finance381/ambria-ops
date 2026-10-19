-- Vendors: a current-quotation snapshot (period text + attached images/PDFs
-- in Storage's "receipts" bucket). Replaced wholesale as a vendor sends an
-- updated quote — not a history table, just the latest one on file.

BEGIN;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS quotation_period text,
  ADD COLUMN IF NOT EXISTS quotation_image_paths text[] NOT NULL DEFAULT '{}'::text[];

NOTIFY pgrst, 'reload schema';

COMMIT;
