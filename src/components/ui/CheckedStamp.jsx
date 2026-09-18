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
        className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border border-dashed border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors disabled:opacity-50">
        <Icon name="checkCircle" size={10} />
        Mark checked
      </button>
    )
  }
  var interactive = canToggle && canUncheck
  var title = 'Checked' + (checkerName ? ' by ' + checkerName : '') + (checkedAt ? ' · ' + formatDateTime(checkedAt) : '') +
    (canToggle && !canUncheck ? ' (only they can un-check)' : '')
  return (
    <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
      style={{ transform: 'rotate(-4deg)' }}
      className={"inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border-2 border-green-600 text-green-700 bg-green-50" +
        (interactive ? " cursor-pointer hover:bg-green-100" : " cursor-default")}>
      <Icon name="checkCircle" size={10} />
      Checked
    </button>
  )
}

export default CheckedStamp
