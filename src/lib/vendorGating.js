// Vendor visibility gating based on user's sub-expense-type tags.
// Admin + auditor bypass. Users with zero tags see NO vendors (strict default).
// A vendor is visible if the intersection of user's expense_sub_type_ids
// and vendor's expense_sub_type_ids is non-empty.

import { isPrivilegedRole } from './permissions'

// Filters an array of vendor rows to those the profile can see.
// Each vendor row must include `expense_sub_type_ids`.
export function filterVisibleVendors(vendors, profile) {
  if (!vendors || vendors.length === 0) return []
  if (!profile) return []
  if (isPrivilegedRole(profile)) return vendors.slice()
  var userTags = profile.expense_sub_type_ids || []
  if (userTags.length === 0) return []
  return vendors.filter(function (v) {
    var vTags = v.expense_sub_type_ids || []
    for (var i = 0; i < vTags.length; i++) {
      if (userTags.indexOf(vTags[i]) !== -1) return true
    }
    return false
  })
}