-- Editing a saved expense (ExpenseForm.jsx's edit-save path) wrote the raw
-- vendor ID string (e.g. "73") into expenses.vendor_name instead of
-- resolving it to the vendor's real name, since the create-path's ID->name
-- lookup was never mirrored into the edit path. Any expense whose
-- vendor_name is purely numeric is a real vendor name's stand-in: a bare
-- digit string is not a vendor anyone actually named, so re-resolve it from
-- the vendors table and overwrite it with the real name.
UPDATE public.expenses e
SET vendor_name = v.name
FROM public.vendors v
WHERE e.vendor_name ~ '^[0-9]+$'
  AND v.id = e.vendor_name::bigint;
