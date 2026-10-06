import { formatDateTime } from '../../lib/format'

// A second, independent stamp alongside CheckedStamp — "entered into Tally"
// is a bookkeeping step separate from "checked", with its own permission,
// column and toggle RPC per table (fn_toggle_*_tally_entered). Deliberately
// plain colored text rather than another chip/stamp shape: two lookalike
// badges in the same row read as one blurred-together signal, two different
// weights read as two different facts.
function EnteredMark({ entered, enteredByName, enteredAt, canToggle, canUnenter, busy, onToggle }) {
  if (!entered) {
    if (!canToggle) return null
    return (
      <button type="button" disabled={busy} onClick={onToggle}
        className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400 hover:text-sky-600 transition-colors disabled:opacity-50">
        Mark entered
      </button>
    )
  }

  var interactive = canToggle && canUnenter
  var title = 'Entered in Tally' + (enteredByName ? ' by ' + enteredByName : '') + (enteredAt ? ' · ' + formatDateTime(enteredAt) : '') +
    (canToggle && !canUnenter ? ' (only they can undo)' : '')

  return (
    <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
      className={"shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.04em] text-sky-600 transition-opacity " +
        (interactive ? "cursor-pointer hover:opacity-70" : "cursor-default")}>
      Entered
    </button>
  )
}

export default EnteredMark
