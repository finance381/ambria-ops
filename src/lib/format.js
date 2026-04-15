export function formatPaise(paise) {
  if (paise == null) return '—'
  var rupees = Math.abs(paise) / 100
  var formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return (paise < 0 ? '-' : '') + '₹' + formatted
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  var d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function titleCase(str) {
  if (!str) return ''
  return str.toLowerCase().replace(/(?:^|\s)\S/g, function (c) { return c.toUpperCase() })
}