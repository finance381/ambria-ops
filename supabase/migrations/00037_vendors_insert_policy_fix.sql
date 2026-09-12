-- vendors_insert checked user_can('procurement.purchase_orders') — the Vendors Master
-- screen (Vendors.jsx) is actually gated by a different permission, procurement.vendors,
-- so anyone with only that permission could see and use the "Add Vendor" button but got
-- rejected by RLS on insert.
--
-- Separately, ExpenseForm.jsx's addVendorStub lets ANY employee auto-create a lightweight
-- "incomplete" vendor by typing a new name into a vendor lookup field while logging an
-- expense — no procurement permission involved at all — which hit the exact same wall for
-- anyone without admin/auditor/procurement.purchase_orders.
--
-- Both call sites are legitimate, and vendors_select already lets any active profile read
-- the vendor list — so insert is broadened to match read exactly, rather than layering
-- more specific permission checks that would need to be kept in sync with every future
-- vendor-insert call site.

drop policy if exists vendors_insert on public.vendors;

create policy vendors_insert on public.vendors
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.active = true
    )
  );
