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
  recorded: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-green-100 text-green-700',
  flagged: 'bg-amber-100 text-amber-700',
  deducted: 'bg-rose-100 text-rose-700',
  penalized: 'bg-red-100 text-red-700',
  fulfilled: 'bg-indigo-100 text-indigo-700',
  deleted: 'bg-red-100 text-red-600',
}

export var APPROVAL_STATUS_LABELS = {
  pending_dept: 'Dept Review',
  pending: 'Admin Review',
  approved: 'Approved',
  rejected: 'Rejected',
  recorded: 'Recorded',
  acknowledged: 'Acknowledged',
  flagged: 'Resubmit',
  deducted: 'Deducted',
  penalized: 'Penalized',
  fulfilled: 'Fulfilled',
  deleted: 'Deleted',
}

// events.catering (synced from LMS's fisd_menu / chcd_catering etc.) is just
// a numeric catering_menu_id, not a name — this is the same veg/non-veg
// menu-tier map lms-push/index.ts uses to send OUR quotes TO LMS
// (MENU_ID_MAP there), inverted so synced LMS contracts can be read back
// into a label here.
export var CATERING_MENU_LABELS = {
  '2': 'Magnum (Veg)', '3': 'Magnum (Non-Veg)',
  '4': 'Double Magnum (Veg)', '5': 'Double Magnum (Non-Veg)',
  '6': 'Multi Cuisine (Veg)', '7': 'Multi Cuisine (Non-Veg)',
  '8': 'Luxury (Veg)', '9': 'Luxury (Non-Veg)',
  '32': 'Pearl (Veg)', '33': 'Pearl (Non-Veg)',
  '34': 'Sapphire (Veg)', '35': 'Sapphire (Non-Veg)',
  '36': 'Bliss (Veg)', '37': 'Bliss (Non-Veg)',
}

export function cateringMenuLabel(code) {
  if (code == null || code === '') return null
  return CATERING_MENU_LABELS[String(code)] || null
}