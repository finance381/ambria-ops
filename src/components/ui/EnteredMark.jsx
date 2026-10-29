import { formatDate, formatDateTime } from '../../lib/format'

// A second, independent stamp alongside CheckedStamp — "entered into Tally"
// is a bookkeeping step separate from "checked", with its own permission,
// column and toggle RPC per table (fn_toggle_*_tally_entered). Deliberately
// plain colored text rather than another chip/stamp shape: two lookalike
// badges in the same row read as one blurred-together signal, two different
// weights read as two different facts.
function EnteredMark({ entered, enteredByName, enteredAt, canToggle, busy, onToggle }) {
  if (!entered) {
    if (!canToggle) return null
    return (
      <button type="button" disabled={busy} onClick={onToggle}
        className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400 hover:text-sky-600 transition-colors disabled:opacity-50">
        Mark entered
      </button>
    )
  }

  // One-way once entered: this is a record that it's already been pushed
  // into Tally, not a checkbox — letting whoever can toggle it un-enter it
  // again (as a canUnenter prop here used to allow) meant the same bill
  // could silently flip back to "not entered" after someone already acted
  // on that being done.
  var title = 'Entered in Tally' + (enteredByName ? ' by ' + enteredByName : '') + (enteredAt ? ' · ' + formatDateTime(enteredAt) : '')

  // The name and date are printed, not just left in the hover title — a
  // touch device has no hover, and "who did this, and when" is the first
  // thing anyone checking a Tally entry asks.
  return (
    <span title={title} className="shrink-0 text-right leading-tight">
      <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.04em] text-sky-600">Entered</span>
      {enteredByName && <span className="block whitespace-nowrap text-[9.5px] font-medium text-slate-400">{enteredByName}</span>}
      {enteredAt && <span className="block whitespace-nowrap text-[9.5px] font-medium text-slate-400">{formatDate(enteredAt)}</span>}
    </span>
  )
}

export default EnteredMark
