// Shared permissions catalog + helpers.
// Consumed by Users.jsx (per-user perms), RoleTemplates.jsx (role defaults),
// and runtime perm hooks (useHasPerm, useDataScope).
//
// SCOPES:      'mobile' | 'desktop' | 'both' — which UI surface exposes the feature.
// DATA SCOPES: 'all' | 'own_dept' | 'own_venue' | 'own' — row-level filter,
//              enforced in RLS via public.user_scope(feature_key).

export var DEFAULT_ROLES = ['admin', 'auditor', 'sales', 'production', 'logistics']

// ---- Data scope options (used by editor chip dropdown) ----
export var DATA_SCOPE_OPTIONS = [
  { value: 'all',       label: 'All',       icon: 'ti-world',    note: 'No restriction' },
  { value: 'own_dept',  label: 'My dept',   icon: 'ti-building', note: 'profiles.department_ids' },
  { value: 'own_venue', label: 'My venue',  icon: 'ti-home',     note: 'profiles.default_venue_id' },
  { value: 'own',       label: 'Mine only', icon: 'ti-user',     note: 'created_by = auth.uid()' },
]

// ---- Nested feature catalog (mirrors Shell.jsx + AdminShell.jsx UI) ----
// Node fields:
//   key        — new namespaced identifier (finance.wallet, finance.ledgers.expense)
//   label      — human display name
//   scope      — 'mobile' | 'desktop' | 'both'
//   dataScope? — true if this feature supports row-level scoping
//   children?  — nested toggles (e.g. individual ledgers under Ledgers)
//   optional?  — sub-actions (approve, delete) rendered as extra toggles under the row
//   note?      — small helper text under the toggle row

export var PERM_GROUPS = [
  { group: 'Personal', icon: '🪪', scope: 'both', children: [
    { key: 'personal.profile', label: 'My Profile', scope: 'both' },
  ]},
  { group: 'Inventory', icon: '📦', scope: 'both', children: [
    { key: 'inventory.add',        label: 'Add Items',         scope: 'both' },
    { key: 'inventory.items',      label: 'View & Edit',       scope: 'both', dataScope: true,
      optional: [{ key: 'inventory.items.delete', label: 'Delete items' }] },
    { key: 'inventory.production', label: 'Production Orders', scope: 'both', dataScope: true },
    { key: 'inventory.boxes',      label: 'Boxes',             scope: 'both' },
    { key: 'inventory.challans',   label: 'Challans',          scope: 'both' },
    { key: 'inventory.receive',    label: 'Receiving',         scope: 'both' },
  ]},
  { group: 'Review', icon: '✅', scope: 'both', children: [
    { key: 'review.dept',    label: 'Dept Review',    scope: 'both', dataScope: true,
      optional: [{ key: 'review.dept.approve', label: 'Approve/reject' }] },
    { key: 'review.pending', label: 'Pending Review', scope: 'both', dataScope: true,
      optional: [{ key: 'review.pending.approve', label: 'Admin-tier approve' }] },
  ]},
  { group: 'Events', icon: '📅', scope: 'both', children: [
    { key: 'events.list',                label: 'Events',                 scope: 'both', dataScope: true,
      optional: [{ key: 'events.list.setup_teardown', label: 'Set setup/teardown days' }] },
    { key: 'events.extra_plate_collect', label: 'Extra Plate Collection', scope: 'mobile', dataScope: true,
      note: 'F&B floor staff collecting extra plate revenue on event day' },
    { key: 'events.quote',               label: 'Quote Calculator',       scope: 'both' },
    { key: 'events.ratecard',            label: 'Rate Card Editor',       scope: 'both' },
  ]},
  { group: 'Procurement', icon: '🛒', scope: 'both', children: [
    { key: 'procurement.requisitions',   label: 'Requisitions',    scope: 'both', dataScope: true,
      optional: [
        { key: 'procurement.requisitions.dept_approve',  label: 'Dept-tier approve' },
        { key: 'procurement.requisitions.admin_approve', label: 'Admin-tier approve' },
      ]},
    { key: 'procurement.purchase_orders', label: 'Purchase Orders', scope: 'both', dataScope: true },
    { key: 'procurement.vendors',         label: 'Vendors Master',  scope: 'both' },
  ]},
  { group: 'Finance', icon: '💰', scope: 'both', children: [
    { key: 'finance.wallet',         label: 'Wallet',         scope: 'both',
      optional: [{ key: 'finance.wallet.admin', label: 'Manage all wallets (cross-user)' }] },
    { key: 'finance.view_costs',     label: 'View Item Costs', scope: 'both',
      note: 'See ₹ rates on inventory items across the app' },
    { key: 'finance.expenses',       label: 'Expenses',       scope: 'both', dataScope: true,
      optional: [
        { key: 'finance.expenses.approve', label: 'Approve/reject expenses' },
        { key: 'finance.gv',               label: 'Raise/reverse JVs (General Vouchers)' },
      ]},
    { key: 'finance.payments',       label: 'Payments',       scope: 'both', dataScope: true },
    { key: 'finance.salary_payouts', label: 'Salary Payouts', scope: 'both', dataScope: true,
      note: 'Also grant "See salaries" in HR → Employees' },
    { key: 'finance.cost_transfers', label: 'Cost Transfers', scope: 'both', dataScope: true },
    { key: 'finance.ledgers',        label: 'Ledgers',        scope: 'both', children: [
      { key: 'finance.ledgers.expense',       label: 'Expense Ledger',       scope: 'both', dataScope: true },
      { key: 'finance.ledgers.event',         label: 'Event Ledger',         scope: 'both', dataScope: true },
      { key: 'finance.ledgers.vendor',        label: 'Vendor Ledger',        scope: 'both', dataScope: true },
      { key: 'finance.ledgers.salary',        label: 'Salary Ledger',        scope: 'both', dataScope: true },
      { key: 'finance.ledgers.inventory',     label: 'Inventory Ledger',     scope: 'both', dataScope: true },
      { key: 'finance.ledgers.cost_transfer', label: 'Cost Transfer Ledger', scope: 'both', dataScope: true },
      { key: 'finance.ledgers.gv',            label: 'JV Log',               scope: 'both', dataScope: true },
    ]},
  ]},
  { group: 'HR', icon: '👔', scope: 'both', children: [
    { key: 'hr.employees', label: 'Employees', scope: 'both', dataScope: true,
      optional: [{ key: 'hr.employees.salary_view', label: 'See salaries' }] },
  ]},
  { group: 'Admin', icon: '⚙️', scope: 'both', children: [
    { key: 'admin.dashboard', label: 'Admin Panel',        scope: 'both' },
    { key: 'admin.overview',  label: 'Overview Dashboard', scope: 'desktop' },
    { key: 'admin.analytics', label: 'Analytics',          scope: 'desktop' },
    { key: 'admin.masters',   label: 'Manage Masters',     scope: 'desktop' },
    { key: 'admin.users',     label: 'Manage Users',       scope: 'desktop' },
  ]},
]

// ---- Helpers ----

// Walk every node in the nested tree (children + optionals).
function walkNodes(nodes, cb) {
  if (!Array.isArray(nodes)) return
  nodes.forEach(function (c) {
    cb(c)
    if (c.children) walkNodes(c.children, cb)
    if (c.optional) c.optional.forEach(function (o) { cb(o) })
  })
}

// Flat list of every leaf permission key across the whole catalog.
export function getAllPermKeys() {
  var all = []
  PERM_GROUPS.forEach(function (g) {
    walkNodes(g.children, function (c) {
      if (c.key && all.indexOf(c.key) === -1) all.push(c.key)
    })
  })
  return all
}

// All keys visible on a given surface ('mobile' | 'desktop'). Used to filter
// the catalog per column in the matrix editor.
export function getScopedKeys(surface) {
  var out = []
  PERM_GROUPS.forEach(function (g) {
    walkNodes(g.children, function (c) {
      if (!c.key) return
      var s = c.scope || 'both'
      if (s === surface || s === 'both') {
        if (out.indexOf(c.key) === -1) out.push(c.key)
      }
    })
  })
  return out
}

// Normalize a raw perms array into a deduped list. Runtime callers use this
// before membership checks.
export function normalizePerms(perms) {
  if (!Array.isArray(perms)) return []
  var out = []
  perms.forEach(function (k) {
    if (out.indexOf(k) === -1) out.push(k)
  })
  return out
}

// Check a permission key against a scoped perms array. Callers pass the
// surface-specific array (mobile_permissions on Shell, desktop_permissions on AdminShell).
export function hasPerm(scopedPerms, key) {
  if (!Array.isArray(scopedPerms)) return false
  var normalized = normalizePerms(scopedPerms)
  return normalized.indexOf(key) !== -1
}

// Resolve data scope for a feature key from a merged data_scopes JSONB.
// Defaults to 'all' when unset (open-by-default; restriction is opt-in).
export function getDataScope(scopesObj, key, fallback) {
  if (!scopesObj || typeof scopesObj !== 'object') return fallback || 'all'
  var val = scopesObj[key]
  return val || fallback || 'all'
}



// Count distinct feature rows fully on in a scoped perms array. Counts
// top-level children + their grandchildren; skips optional sub-toggles.
export function countActiveFeatures(scopedPerms) {
  if (!Array.isArray(scopedPerms)) return 0
  var normalized = normalizePerms(scopedPerms)
  var n = 0
  PERM_GROUPS.forEach(function (g) {
    ;(g.children || []).forEach(function (c) {
      if (c.key && normalized.indexOf(c.key) !== -1) n += 1
      ;(c.children || []).forEach(function (gc) {
        if (gc.key && normalized.indexOf(gc.key) !== -1) n += 1
      })
    })
  })
  return n
}