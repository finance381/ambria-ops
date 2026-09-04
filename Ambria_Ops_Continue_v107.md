# Ambria Ops — v107 Continue Log

## Phase 4 — QuoteCalc

- **4.1** `quotes_update` WITH CHECK hardening — already correct, `USING`/`WITH CHECK` are byte-for-byte identical. No action.
- **4.2** `menu_cost_paise` save bug — no bug found. Column persists correctly (same atomic write as every other field), no trigger touches it, and it's intentionally write-only — a save-time cost snapshot, correctly not re-read on load since the calculator always recomputes live from current rates.
- **4.3** Legacy `menu_idx > 3` — already fixed server-side. `calculate_quote()`'s own inline comments document the prior hardcoded `0..3`/`> 3` behavior and its replacement with a dynamic, config-driven range + clamp-to-0 fallback. Minor residual: frontend's `MENU_LABELS` fallback array only covers 4 entries, but it's a transient pre-load fallback, not a functional bug.
- **4.4** Mobile ActionBar density — fixed. All 6 ActionBar buttons collapse to icon-only below 400px via `max-[400px]:hidden` on text labels. Build-verified, not visually verified in an actual narrow viewport.
- **4.5** AI Analysis session-token verification — traced the auth flow (session token → Bearer header → `quote-assist` edge function → `supabase.auth.getUser()`), looks correct, but needs a live click-through to actually confirm post-redeploy — **pending user verification**.

Rate calibration items (Pearl/Sapphire/Bliss/Restro TTD/Alstonia) — untouched, per instruction.

## Phase 1 — Safe autonomous cleanup

- **1.1a** Stripped dead `legacy: r.permissions` read in `Users.jsx` roleDefaultsMap.
- **1.1b** Stripped dead `lookupFields` computation in `CostTransfers.jsx` PartySection (computed every render, never rendered). Removed its now-orphaned helpers `lookupItems`/`updMeta`.
- **1.1c** Stripped `LEGACY_KEY_MAP` compat layer from `permissions.js` — zero callers passed legacy keys anywhere in the codebase.
- **1.1d** No action — `PARTY_TYPES` was already clean, no legacy filter logic existed.
- **1.2** SQL cosmetic renames (`user_can`/`user_scope` param `feature_key` → `p_perm_key`) — **skipped**. Postgres can't rename a function parameter via `CREATE OR REPLACE` without `DROP`, and the `DROP` would cascade through ~15 RLS policies + 13 dependent functions for zero functional gain (every caller uses positional args). Left as `feature_key`.
- **1.3** Added venue-count badge to RoleTemplates card footer (`_tVenues` was computed but never rendered).

## Phase 2 — Diagnose-then-fix

- **2.1** `fn_reverse_gv` field-change awareness — added `snapshot_amount_paise`/`snapshot_expense_date`/`snapshot_vendor_name` columns to `general_vouchers`, populated at `fn_create_gv` time, checked (block, not warn) in `fn_reverse_gv`. Backfilled existing rows from current expense state (can't recover pre-migration drift).
- **2.2** `fn_extra_plate_cancel` waste-only null guard — **no fix needed**, already handled correctly on both SQL (keys off `wallet_tx_id`/`ledger_id` nullity, not `payment_mode`) and frontend sides.
- **2.3** Master-table RLS lockdown — `categories`/`sub_categories` `INSERT` was wide open (`with_check = true`) to any role; locked to `user_role() = 'admin'`. Dropped `anon_read_categories` (unauthenticated read policy, no legitimate use — app has no public routes). Other masters tables were already correctly locked. `cost_centers` doesn't exist as a table in this schema.
- **2.4** P&L rollup verification — `event_pnl()` exists but has **zero frontend callers** (dormant) and its revenue side is structurally broken: `quotes.event_id` is never set anywhere in the app (0 of 498 quotes), so revenue is always `0`. Root cause is a missing quote↔event linking mechanism, not an arithmetic bug — **reported only, not fixed** (linking design is a product decision, deferred per user).
- **2.5** Requisitions/POs → `event_ledger` — root cause was narrower than assumed: the `event_id → event_ledger` trigger on `expenses` already existed and worked. Fixed `auto_expense_from_purchase()` (PO path) and `convertToExpense()` in `Requisitions.jsx` (direct-expense path) to carry `event_id` into the created expense. Backfilled PO-derived expenses via `batch_id`, skipping POs whose items span >1 event (ambiguous).
- **2.6** Vendors `cancelEdit` — the function itself was already clean (form is unmounted on cancel, so blank-vs-loaded-snapshot is moot). Found and fixed a real adjacent bug: Cancel button lacked `disabled={saving}`, letting a save-in-flight land even after the user believed they'd cancelled.
- **2.7** Receipt viewer policy — reported only, not fixed. `receipts_select` has no gating, but the deeper issue is the bucket is `public: true` and the app relies on `getPublicUrl()` everywhere — RLS changes alone would do nothing. Fixing this properly means a private bucket + signed-URL migration across ~12 call sites, deferred as separate work. `receipts_insert` also has no ownership check, but the codebase uses two incompatible upload path conventions, so a naive fix would break wallet/requisition uploads. `protect_delete()` trigger confirmed already in place.
- **2.8** EventLedger group-write — contract-picker part skipped (couldn't pin down a concrete ambiguous flow; wallet collection picker already shows department/contract_no distinctly). Shipped `fn_event_group_balance(bigint[])` batch RPC, replacing an N-round-trip `Promise.all` of `fn_event_balance` calls in `EventLedger.jsx` with one.
- **2.9** CostTransfers `meta={}` — wired up the exact block stripped in 1.1b, properly connected this time (`{lookupFields}` now actually renders). Added `validMeta()` submission guard for sub-types with required lookup extra_fields (e.g. salary → employee_id).
- **2.10** Null inventory name — only 1 affected row (`id=2658`). Backfilled to `[Unnamed]` (no description to fall back to). Found and fixed the actual bug: `InventoryForm.jsx` `validate()` skipped the "name required" check whenever a category had a name-generating dimension field, even if that generation produced nothing. Added `NOT NULL` + non-empty `CHECK` constraint on `inventory_items.name`.
- **2.11** Schema gaps — added `employees.default_venue_id` (backfilled via most-recent manpower-assignment event) and `purchase_orders.event_id` (backfilled where unambiguous via requisition chain). Wired real `own_venue` enforcement into `fn_employees_scope_visible`/`fn_purchase_orders_scope_visible` (previously log-and-allow no-ops). Zero profiles currently use `own_venue` on either resource, so no live behavior change today.

## Live bug fixes (reported mid-session, outside the phase list)

- Inventory "Add Item" silently no-op'd on submit whenever the Allocations section was left collapsed (default state) — `validate()` required an allocation, but its error rendered inside the collapsed block. Made allocation optional.
- Wallet event-collection receipt photo was mandatory regardless of payment mode — now optional for cash, still required for bank (both client validation and `fn_wallet_collect` DB-side check).
- Partial expense allocations silently dropped the unallocated remainder from every ledger (fixed in new-expense creation, edit, and `convertToExpense()` — 3 locations). Surfaced a pre-existing, unrelated bug in the same code: `convertToExpense()` referenced a nonexistent `expense_allocations.sub_department_id` column.
- Wallet PDF statement: switched from force-download (`doc.save()`) to open-for-preview (`doc.output('bloburl')` + `window.open`), matching the pattern already used elsewhere. Added full per-allocation breakdown (department + type/sub-type + amount) to expense-linked transaction lines — previously only showed the first allocation's department.

## Known follow-ups, not yet actioned

- **2.7**: private-bucket + signed-URL migration for `receipts` (public bucket currently, ~12 `getPublicUrl()` call sites to convert), plus standardizing the two incompatible upload path conventions before an ownership check can safely be added to `receipts_insert`.
- **2.4**: quote↔event linking mechanism doesn't exist — needed before `event_pnl()` can report real revenue.
- **2.8**: contract-picker ambiguity — exact screen/flow never confirmed; open if a concrete repro shows up.
- Flagged, not fixed: `EmployeeDocTypes.jsx`/`SalaryPayouts.jsx` check raw legacy permission strings (`feature_admin`, `admin_masters`) via `perms.indexOf(...)`, bypassing `hasPerm()` — likely dead/broken checks post-migration to namespaced keys.
- Flagged, not fixed: on-screen (non-PDF) wallet transaction views still show only the first allocation (`expense_allocations[0]`) — the PDF was fixed to show all, the inline UI wasn't (out of the scope that was asked for).

## Not yet started

- Phase 3 (`amountPaise` → `amountRupees` rename)
- Phase 4 (QuoteCalc)
- Phase 5 (v106 cleanup: `finance.view_costs`, CostTransfers mobile card-view)

## Phase 3 — `amountPaise` → `amountRupees` rename

Scope confirmed much smaller than the backlog assumed: 2 files (`WalletManager.jsx`, `pdfReceipt.js`), 16 occurrences total. Zero occurrences in SQL migrations or Edge Functions — those already consistently use `amount_paise`. Traced every occurrence back to its source before renaming; all correctly held paise (assigned from `Math.round(rupeeInput * 100)` or divided by 100 before display) — no latent unit bug found. Pure identifier rename, no arithmetic touched, `p_amount_paise`/`amount_paise` snake_case DB/RPC keys left untouched. Done and shipped in one commit.
