import Icon from './Icon'
import { formatDateTime } from '../../lib/format'

// A finance-controller "reviewed this entry" stamp for a wallet_transactions
// row — separate from the expense ack/resubmit/deduct review, which is about
// the bill itself. This is about whether the allocation/entry was already
// checked, so an auditor downstream knows it's safe to just match the bill
// and act. Same-person reversible: `canUncheck` mirrors the server-side rule
// in fn_toggle_wallet_check (only the checker, or an admin/auditor, may undo).
//
// Two shapes, one contract. `chip` is the default and goes inline beside other
// chips; `stamp` is the round one, for a row with the empty space to carry it.
function CheckedStamp({ checked, checkerName, checkedAt, canToggle, canUncheck, busy, onToggle, variant }) {
  var isStamp = variant === 'stamp'

  if (!checked) {
    if (!canToggle) return null
    // Unchecked, the stamp shape would be a large empty circle asking to be
    // pressed, which is a lot of furniture for an action most rows never take.
    // It stays a chip either way.
    return (
      <button type="button" disabled={busy} onClick={onToggle}
        className="h-[22px] inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.04em] px-2 rounded-md border border-dashed border-slate-300 text-slate-400 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
        <Icon name="checkCircle" size={10} />
        Mark checked
      </button>
    )
  }

  var interactive = canToggle && canUncheck
  var title = 'Checked' + (checkerName ? ' by ' + checkerName : '') + (checkedAt ? ' · ' + formatDateTime(checkedAt) : '') +
    (canToggle && !canUncheck ? ' (only they can un-check)' : '')

  if (isStamp) {
    // Drawn rather than an image: two rings, a rule above and below the word,
    // and a tilt. An SVG or a PNG of a stamp would be one fixed green at one
    // fixed size, and would not dim or take a hover — this is type and
    // borders, so it scales, inherits and animates like anything else.
    //
    // The tilt lives on the inner circle, not on the button, so the button's
    // own box stays square to the layout and nothing around it is nudged by a
    // rotated bounding box.
    return (
      <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
        aria-label={title}
        className={"shrink-0 w-[104px] h-[104px] inline-flex items-center justify-center rounded-full transition-opacity " +
          (interactive ? "cursor-pointer opacity-80 hover:opacity-100" : "cursor-default opacity-70")}>
        <span aria-hidden="true"
          className="w-full h-full rounded-full border-[3px] border-emerald-600 p-1.5 rotate-[-12deg] flex items-center justify-center">
          <span className="w-full h-full rounded-full border-2 border-emerald-600 flex flex-col items-center justify-center gap-1">
            <span className="w-3/5 h-[2px] bg-emerald-600" />
            <span className="text-[15px] font-extrabold uppercase tracking-[0.08em] text-emerald-600 leading-none">Checked</span>
            <span className="w-3/5 h-[2px] bg-emerald-600" />
          </span>
        </span>
      </button>
    )
  }

  // A chip, not a rubber stamp. The tilt and the 2px border were doing an
  // impression of one — but it sits inline with Recorded, the type chips and a
  // date, all of which are level and drawn with a hairline, so the one that
  // was neither read as a rendering fault rather than as emphasis. A rotated
  // element is also taller than its own box, which was nudging the whole line
  // it sits on.
  return (
    <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
      className={"h-[22px] inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.04em] px-2 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors" +
        (interactive ? " cursor-pointer hover:bg-emerald-100 hover:border-emerald-300" : " cursor-default")}>
      <Icon name="checkCircle" size={10} />
      Checked
    </button>
  )
}

export default CheckedStamp
