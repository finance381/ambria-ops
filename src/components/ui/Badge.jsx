var BADGE_COLORS = {
  green:  'bg-green-100 text-green-700',
  blue:   'bg-blue-100 text-blue-700',
  amber:  'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
  gray:   'bg-gray-100 text-gray-600',
  pink:   'bg-pink-100 text-pink-700',
  indigo: 'bg-indigo-100 text-indigo-700',
}

function Badge({ color, children }) {
  return (
    <span className={"inline-block px-2 py-0.5 rounded-full text-xs font-medium " + (BADGE_COLORS[color] || BADGE_COLORS.gray)}>
      {children}
    </span>
  )
}

function TypeBadge({ type }) {
  if (type === 'Premium') {
    return <Badge color="purple">★ Premium</Badge>
  }
  return <Badge color="blue">$ Budgeted</Badge>
}

function StatusBadge({ status }) {
  var colorMap = {
    Confirmed: 'green',
    Tentative: 'amber',
    pending: 'amber',
    approved: 'green',
    rejected: 'red',
    Pending: 'amber',
    Approved: 'green',
    Rejected: 'red',
    Purchased: 'blue',
    'Added to Inventory': 'indigo',
    'In Warehouse': 'gray',
    Packed: 'blue',
    Loaded: 'amber',
    'At Venue': 'green',
    Returned: 'purple',
    Created: 'gray',
  }
  return <Badge color={colorMap[status] || 'gray'}>{status}</Badge>
}

export { Badge, TypeBadge, StatusBadge }