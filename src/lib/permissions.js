// Shared permissions catalog + helpers.
// Consumed by Users.jsx (per-user perms), RoleTemplates.jsx (role defaults).

export var DEFAULT_ROLES = ['admin', 'auditor', 'sales', 'production', 'logistics']

export var PERM_GROUPS = [
  { group: 'Personal', icon: '🪪', children: [
    { key: 'feature_my_profile', label: 'My Profile', grants: ['feature_my_profile'] },
  ]},
  { group: 'Inventory', icon: '📦', children: [
    { key: 'feature_add', label: 'Add Items', grants: ['feature_add', 'inventory_add'] },
    { key: 'feature_items', label: 'View & Edit', grants: ['feature_items', 'inventory_view', 'inventory_edit'], optional: [{ key: 'inventory_delete', label: 'Delete items' }] },
    { key: 'feature_dept_review', label: 'Dept Review', grants: ['feature_dept_review', 'dept_approve'] },
    { key: 'feature_pending', label: 'Pending Review', grants: ['feature_pending', 'admin_approve'] },
  ]},
  { group: 'Events', icon: '📅', children: [
    { key: 'feature_events', label: 'Events', grants: ['feature_events'], optional: [{ key: 'event_buffer', label: 'Set setup/teardown days' }] },
    { key: 'feature_extra_plate_collect', label: 'Extra Plate Collection', grants: ['feature_extra_plate_collect'], note: 'F&B floor staff collecting extra plate revenue on event day' },
    { key: 'feature_requisitions', label: 'Requisitions', grants: ['feature_requisitions'], optional: [{ key: 'req_dept_approve', label: 'Dept-tier approve' }, { key: 'req_admin_approve', label: 'Admin-tier approve' }] },
    { key: 'feature_production', label: 'Production Orders', grants: ['feature_production'] },
    { key: 'feature_manpower', label: 'Manpower', grants: ['feature_manpower'] },
  ]},
  { group: 'Finance', icon: '💰', children: [
    { key: 'feature_quote', label: 'Quote Calculator', grants: ['feature_quote'] },
    { key: 'feature_ratecard', label: 'Rate Card Editor', grants: ['feature_ratecard'] },
    { key: 'feature_wallet', label: 'Wallet', grants: ['feature_wallet'] },
    { key: 'feature_expenses', label: 'Expenses', grants: ['feature_expenses', 'expense_submit'], optional: [{ key: 'expense_approve', label: 'Approve/reject expenses' }, { key: 'finance_gv', label: 'Raise/reverse General Vouchers' }] },
    { key: 'feature_ledger_view', label: 'Expense Ledger', grants: ['feature_ledger_view'] },
    { key: 'feature_payments', label: 'Payments', grants: ['feature_payments'] },
    { key: 'feature_vendor_ledger', label: 'Vendor Ledger', grants: ['feature_vendor_ledger'] },
    { key: 'feature_inventory_ledger', label: 'Inventory Ledger', grants: ['feature_inventory_ledger'] },
    { key: 'feature_salary_pay', label: 'Salary Payouts', grants: ['feature_salary_pay'], note: 'Also grant "See salaries" in HR → Employees' },
    { key: 'finance_cost_transfer', label: 'Cost Transfers', grants: ['finance_cost_transfer'] },
  ]},
  { group: 'Operations', icon: '🚚', children: [
    { key: 'feature_purchase', label: 'Purchase Orders', grants: ['feature_purchase'] },
    { key: 'feature_vendors', label: 'Vendors Master', grants: ['feature_vendors'] },
    { key: 'feature_receive', label: 'Receiving', grants: ['feature_receive'] },
    { key: 'feature_boxes', label: 'Boxes', grants: ['feature_boxes'] },
    { key: 'feature_challans', label: 'Challans', grants: ['feature_challans'] },
  ]},
  { group: 'HR', icon: '👔', children: [
    { key: 'feature_employees', label: 'Employees', grants: ['feature_employees'], optional: [{ key: 'feature_employees_salary', label: 'See salaries' }] },
    { key: 'feature_salary_ledger', label: 'Salary Ledger', grants: ['feature_salary_ledger'], note: 'Requires "See salaries" toggle above' },
  ]},
  { group: 'Admin', icon: '⚙️', children: [
    { key: 'feature_admin', label: 'Admin Panel', grants: ['feature_admin'], optional: [{ key: 'admin_masters', label: 'Manage masters' }, { key: 'admin_users', label: 'Manage users' }, { key: 'admin_approve', label: 'Approve items' }] },
  ]},
]

// Flat list of every possible permission key (grants + optional) — used by RoleTemplates to reason about coverage.
export function getAllPermKeys() {
  var all = []
  PERM_GROUPS.forEach(function (g) {
    g.children.forEach(function (c) {
      c.grants.forEach(function (k) { if (all.indexOf(k) === -1) all.push(k) })
      ;(c.optional || []).forEach(function (o) { if (all.indexOf(o.key) === -1) all.push(o.key) })
    })
  })
  return all
}

// Given a permissions array, count distinct "features" (checkbox rows) that are fully on.
export function countActiveFeatures(perms) {
  if (!Array.isArray(perms)) return 0
  var n = 0
  PERM_GROUPS.forEach(function (g) {
    g.children.forEach(function (c) {
      var on = c.grants.every(function (k) { return perms.indexOf(k) >= 0 })
      if (on) n += 1
    })
  })
  return n
}