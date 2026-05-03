export const NAV_ITEMS = {
  admin: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'inventory', label: 'Inventory', icon: '📦' },
    { key: 'events', label: 'Events', icon: '📅' },
    { key: 'expenses', label: 'Petty Cash', icon: '💰' },
    { key: 'boxes', label: 'Boxes', icon: '📋' },
    { key: 'challans', label: 'Challans', icon: '🚛' },
    { key: 'purchase', label: 'Purchase', icon: '🛒' },
    { key: 'calendar', label: 'Calendar', icon: '📅' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'categories', label: 'Categories', icon: '⚙️' },
  ],
  sales: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'inventory', label: 'Inventory', icon: '📦' },
    { key: 'events', label: 'Events', icon: '📅' },
    { key: 'expenses', label: 'Petty Cash', icon: '💰' },
    { key: 'purchase', label: 'Purchase', icon: '🛒' },
    { key: 'calendar', label: 'Calendar', icon: '📅' },
  ],
  production: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'inventory', label: 'Inventory', icon: '📦' },
    { key: 'events', label: 'Events', icon: '📅' },
    { key: 'expenses', label: 'Petty Cash', icon: '💰' },
    { key: 'purchase', label: 'Purchase', icon: '🛒' },
  ],
  logistics: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'inventory', label: 'Inventory', icon: '📦' },
    { key: 'boxes', label: 'Boxes', icon: '📋' },
    { key: 'challans', label: 'Challans', icon: '🚛' },
    { key: 'expenses', label: 'Petty Cash', icon: '💰' },
    { key: 'purchase', label: 'Purchase', icon: '🛒' },
  ],
  auditor: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'inventory', label: 'Inventory', icon: '📦' },
    { key: 'expenses', label: 'Petty Cash', icon: '💰' },
  ],
}

export const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700',
  sales: 'bg-blue-100 text-blue-700',
  production: 'bg-amber-100 text-amber-700',
  logistics: 'bg-green-100 text-green-700',
  auditor: 'bg-pink-100 text-pink-700',
}

export var APPROVAL_STATUS_COLORS = {
  pending_dept: 'bg-amber-100 text-amber-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  fulfilled: 'bg-indigo-100 text-indigo-700',
}

export var APPROVAL_STATUS_LABELS = {
  pending_dept: 'Dept Review',
  pending: 'Admin Review',
  approved: 'Approved',
  rejected: 'Rejected',
  fulfilled: 'Fulfilled',
}