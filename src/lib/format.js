export function formatPaise(paise) {
  if (paise == null) return '—'
  var rupees = Math.abs(paise) / 100
  var formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return (paise < 0 ? '-' : '') + '₹' + formatted
}

// Case/whitespace-insensitive duplicate check against a list, excluding one id (for edit-in-place).
export function dupExists(list, keyFn, val, excludeId) {
  var norm = String(val || '').trim().toLowerCase()
  if (!norm) return false
  return list.some(function (x) {
    if (excludeId != null && x.id === excludeId) return false
    return String(keyFn(x) || '').trim().toLowerCase() === norm
  })
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

// System-captured timestamp (date + time) — distinct from the user-entered business
// date (formatDate), used wherever a ledger needs to show "when this was actually
// logged" alongside "what date it's for".
export function formatDateTime(dateStr) {
  if (!dateStr) return ''
  var d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }) + ', ' + formatTime(dateStr)
}

// The time half on its own, for the places that stack the two lines instead of
// running them together. formatDateTime is built from it rather than the two
// being written out twice, so they cannot drift into different clocks.
export function formatTime(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function titleCase(str) {
  if (!str) return ''
  return str.toLowerCase().replace(/(?:^|\s)\S/g, function (c) { return c.toUpperCase() })
}

export function formatPoints(paise) {
  if (paise == null) return '—'
  return formatPointsPlain(paise) + ' pts'
}

// The figure without its unit, for the places that already say what the number
// is. formatPoints is built from it rather than the grouping being written out
// twice, so the two cannot come to disagree about how a lakh is punctuated.
export function formatPointsPlain(paise) {
  if (paise == null) return '—'
  return (paise / 100).toLocaleString('en-IN')
}