-- Stock batches: each time stock arrives for an item it is kept as a batch of
-- its own — how many, at what unit rate, when, by whom — with how that batch
-- was split across venues. An item with 20 on hand that receives 40 more now
-- reads as two batches (20 + 40 = 60), each with its own rate and venue
-- split, instead of one running number.
--
-- The running totals stay where they were: inventory_items.qty /
-- catering_store_items.qty and venue_allocations / cs_venue_allocations are
-- still what every screen reads for stock on hand. The batches are the record
-- of how that stock came in; the app writes a batch at the same time it adds
-- to the totals (a new item, stock merged into an existing item, and "Add new
-- stock" in the admin Edit form).
--
-- One pair of tables for both item tables: item_source says which one item_id
-- points into ('inventory' -> inventory_items, 'catering_store' ->
-- catering_store_items). No FK on item_id because it can point into either.
--
-- Backfill: every existing item with stock gets one "opening" batch holding
-- its current qty and rate, dated its entry date, split across venues as its
-- allocations are today — so the breakdown starts from what is on hand now.

BEGIN;

CREATE TABLE public.stock_batches (
  id           BIGSERIAL PRIMARY KEY,
  item_id      INT NOT NULL,
  item_source  TEXT NOT NULL CHECK (item_source IN ('inventory', 'catering_store')),
  qty          NUMERIC NOT NULL CHECK (qty > 0),
  rate_paise   BIGINT,
  is_opening   BOOLEAN NOT NULL DEFAULT false,
  added_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_batches_item
  ON public.stock_batches (item_source, item_id, created_at);

-- At most one opening batch per item.
CREATE UNIQUE INDEX uq_stock_batches_opening
  ON public.stock_batches (item_source, item_id) WHERE is_opening;

CREATE TABLE public.stock_batch_allocations (
  id            BIGSERIAL PRIMARY KEY,
  batch_id      BIGINT NOT NULL REFERENCES public.stock_batches(id) ON DELETE CASCADE,
  venue_id      INT REFERENCES public.venues(id) ON DELETE SET NULL,
  sub_venue_id  INT REFERENCES public.sub_venues(id) ON DELETE SET NULL,
  qty           NUMERIC NOT NULL CHECK (qty > 0)
);

CREATE INDEX idx_stock_batch_alloc_batch
  ON public.stock_batch_allocations (batch_id);

-- Same openness as venue_allocations: the app reads and appends; delete is
-- open so removing an item can clear its batches.
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_batches_select" ON public.stock_batches FOR SELECT USING (true);
CREATE POLICY "stock_batches_insert" ON public.stock_batches FOR INSERT WITH CHECK (true);
CREATE POLICY "stock_batches_delete" ON public.stock_batches FOR DELETE USING (true);

ALTER TABLE public.stock_batch_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_batch_alloc_select" ON public.stock_batch_allocations FOR SELECT USING (true);
CREATE POLICY "stock_batch_alloc_insert" ON public.stock_batch_allocations FOR INSERT WITH CHECK (true);
CREATE POLICY "stock_batch_alloc_delete" ON public.stock_batch_allocations FOR DELETE USING (true);

-- ── Backfill: one opening batch per existing item with stock ──
INSERT INTO public.stock_batches (item_id, item_source, qty, rate_paise, is_opening, added_by, created_at)
SELECT i.id, 'inventory', i.qty, i.rate_paise, true, i.submitted_by,
       COALESCE(i.entry_date::timestamptz, i.created_at, now())
FROM public.inventory_items i
WHERE i.qty > 0;

INSERT INTO public.stock_batches (item_id, item_source, qty, rate_paise, is_opening, added_by, created_at)
SELECT i.id, 'catering_store', i.qty, i.rate_paise, true, i.submitted_by,
       COALESCE(i.entry_date::timestamptz, i.created_at, now())
FROM public.catering_store_items i
WHERE i.qty > 0;

-- Its venue split as it stands today (sub-department rows for the same
-- venue and sub-venue are added together). A venue or sub-venue id that no
-- longer exists is left empty rather than failing the whole migration on
-- the new foreign keys.
INSERT INTO public.stock_batch_allocations (batch_id, venue_id, sub_venue_id, qty)
SELECT b.id,
       CASE WHEN v.id IS NOT NULL THEN va.venue_id END,
       CASE WHEN sv.id IS NOT NULL THEN va.sub_venue_id END,
       SUM(va.qty)
FROM public.venue_allocations va
JOIN public.stock_batches b
  ON b.item_id = va.item_id AND b.item_source = 'inventory' AND b.is_opening
LEFT JOIN public.venues v ON v.id = va.venue_id
LEFT JOIN public.sub_venues sv ON sv.id = va.sub_venue_id
GROUP BY 1, 2, 3
HAVING SUM(va.qty) > 0;

INSERT INTO public.stock_batch_allocations (batch_id, venue_id, sub_venue_id, qty)
SELECT b.id,
       CASE WHEN v.id IS NOT NULL THEN va.venue_id END,
       CASE WHEN sv.id IS NOT NULL THEN va.sub_venue_id END,
       SUM(va.qty)
FROM public.cs_venue_allocations va
JOIN public.stock_batches b
  ON b.item_id = va.item_id AND b.item_source = 'catering_store' AND b.is_opening
LEFT JOIN public.venues v ON v.id = va.venue_id
LEFT JOIN public.sub_venues sv ON sv.id = va.sub_venue_id
GROUP BY 1, 2, 3
HAVING SUM(va.qty) > 0;

COMMIT;
