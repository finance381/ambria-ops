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

// The figure without its unit, for the places that have already said what the
// number is. formatPoints is built from it rather than the grouping being
// written twice, so the two cannot come to disagree about where a lakh breaks.
export function formatPointsPlain(paise) {
  if (paise == null) return '—'
  return (paise / 100).toLocaleString('en-IN')
}

// Several amount_paise-shaped columns in this schema are plain Postgres
// `int` (max 2,147,483,647), not `bigint` -- a search term that parses past
// that as paise would otherwise go out as `amount_paise.eq.<N>` and the
// server would 400 the whole query. Capped here, at the one shared spot,
// rather than per caller.
var INT4_MAX = 2147483647

// A typed search term, read as a rupee amount (commas/whitespace and an
// optional trailing "pts" stripped) and matched EXACTLY against one or more
// paise-denominated fields on a row -- so "3000" finds a ₹3,000 row but not
// a ₹33,000 one. Returns false for a non-numeric term (or one no real amount
// could be -- the all-zero case matches almost everything and is never what
// someone actually typed a search for); callers fall back to their own text
// match in that case. Reference: the amount half of WalletManager's
// transaction search.
export function matchesAmountQuery(query, paiseValues) {
  var qNum = String(query || '').trim().toLowerCase().replace(/[,\s]/g, '').replace(/pts?$/, '')
  if (!qNum || !/^\d+(\.\d+)?$/.test(qNum)) return false
  var target = Math.round(parseFloat(qNum) * 100)
  if (target === 0 || target > INT4_MAX) return false
  var values = Array.isArray(paiseValues) ? paiseValues : [paiseValues]
  // A debit/outstanding figure is sometimes stored signed; nobody searching
  // for an amount types the minus sign, so this matches on magnitude.
  return values.some(function (v) { return v != null && target === Math.abs(v) })
}

// Same idea, but the query is already a plain rupee number string (no paise
// conversion) -- for the handful of lists whose amount column is stored in
// rupees, not paise, and for callers that build their own paise-equality
// filter. Returns null (not a usable amount) once converting to paise would
// overflow an `int` column -- see INT4_MAX above -- so an oversized numeric
// term (a pasted UTR, a phone number) falls through to the caller's own text
// search instead of erroring the request.
export function parseAmountQuery(query) {
  var qNum = String(query || '').trim().toLowerCase().replace(/[,\s]/g, '').replace(/pts?$/, '')
  if (!qNum || !/^\d+(\.\d+)?$/.test(qNum)) return null
  var amt = parseFloat(qNum)
  if (Math.round(amt * 100) > INT4_MAX) return null
  return amt
}