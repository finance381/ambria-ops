import Icon from './Icon'
import { formatDateTime } from '../../lib/format'

// A finance-controller "reviewed this entry" stamp for a wallet_transactions
// row — separate from the expense ack/resubmit/deduct review, which is about
// the bill itself. This is about whether the allocation/entry was already
// checked, so an auditor downstream knows it's safe to just match the bill
// and act. Same-person reversible: `canUncheck` mirrors the server-side rule
// in fn_toggle_wallet_check (only the checker, or an admin/auditor, may undo).
function CheckedStamp({ checked, checkerName, checkedAt, canToggle, canUncheck, busy, onToggle }) {
  if (!checked) {
    if (!canToggle) return null
    return (
      <button type="button" disabled={busy} onClick={onToggle}
        className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-400 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
        <Icon name="checkCircle" size={10} />
        Mark checked
      </button>
    )
  }
  var interactive = canToggle && canUncheck
  var title = 'Checked' + (checkerName ? ' by ' + checkerName : '') + (checkedAt ? ' · ' + formatDateTime(checkedAt) : '') +
    (canToggle && !canUncheck ? ' (only they can un-check)' : '')
  // A chip, not a rubber stamp. The tilt and the 2px border were doing an
  // impression of one — but it sits inline with Recorded, the type chips and a
  // date, all of which are level and drawn with a hairline, so the one that
  // was neither read as a rendering fault rather than as emphasis. A rotated
  // element is also taller than its own box, which was nudging the whole line
  // it sits on.
  return (
    <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
      className={"inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors" +
        (interactive ? " cursor-pointer hover:bg-emerald-100 hover:border-emerald-300" : " cursor-default")}>
      <Icon name="checkCircle" size={10} />
      Checked
    </button>
  )
}

export default CheckedStamp
