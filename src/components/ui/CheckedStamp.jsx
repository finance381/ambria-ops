import Icon from './Icon'
import { formatDateTime } from '../../lib/format'
import checkedStamp from '../../assets/checked-stamp.png'

// A finance-controller "reviewed this entry" stamp for a wallet_transactions
// row — separate from the expense ack/resubmit/deduct review, which is about
// the bill itself. This is about whether the allocation/entry was already
// checked, so an auditor downstream knows it's safe to just match the bill
// and act. Same-person reversible: `canUncheck` mirrors the server-side rule
// in fn_toggle_wallet_check (only the checker, or an admin/auditor, may undo).
//
// Two shapes, one contract. `chip` is the default and goes inline beside other
// chips; `stamp` is the round one, for a row with the empty space to carry it.
// One size wherever it appears. A mark that means the same thing on a detail
// page and in a table row should be the same size in both, or a reader starts
// reading the size as part of the message — a big stamp looking more checked
// than a small one. `size` stays for a caller that genuinely needs another,
// but nothing passes it today.
//
// 72 rather than 96: at 96 it was the largest single thing in a row, and a
// mark that says "somebody has looked at this" should not outweigh the amount
// they looked at.
function CheckedStamp({ checked, checkerName, checkedAt, canToggle, canUncheck, busy, onToggle, variant, size }) {
  var isStamp = variant === 'stamp'
  var px = size || 72

  if (!checked) {
    if (!canToggle) return null
    // Unchecked, the stamp shape would be a large empty circle asking to be
    // pressed, which is a lot of furniture for an action most rows never take.
    // It stays a chip either way.
    return (
      <button type="button" disabled={busy} onClick={onToggle}
        // shrink-0 and nowrap because the two ledgers drop this into a
        // fixed-width slot as a flex item, where it was being squeezed until
        // "MARK CHECKED" broke across two lines inside a 22px-tall pill.
        className="h-[22px] shrink-0 whitespace-nowrap inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.04em] px-2 rounded-md border border-dashed border-slate-300 text-slate-500 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
        <Icon name="checkCircle" size={10} />
        Mark checked
      </button>
    )
  }

  var interactive = canToggle && canUncheck
  var title = 'Checked' + (checkerName ? ' by ' + checkerName : '') + (checkedAt ? ' · ' + formatDateTime(checkedAt) : '') +
    (canToggle && !canUncheck ? ' (only they can un-check)' : '')

  if (isStamp) {
    // The artwork, not a drawing of it. Two rings and a word can be built out
    // of borders, but the ink breaking up as it lifts off the paper cannot —
    // that is what makes a stamp read as stamped, and it is what the drawn
    // version could not get close to.
    //
    // Imported rather than written as a path under public/: vite.config sets
    // base to "/ambria-ops/", so a hand-written "/checked-stamp.png" 404s in
    // production. The import also content-hashes it, so a new stamp is never
    // served from a stale cache.
    //
    // The file is 360px wide against a 96px slot, so it still has far more
    // pixels than a retina screen asks for. It is cut from the 1290px original
    // that came in at 925KB — most of a megabyte to draw something the size of
    // a thumbnail.
    return (
      <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
        aria-label={title}
        style={{ width: px, height: px }}
        className={"shrink-0 inline-flex items-center justify-center transition-opacity " +
          (interactive ? "cursor-pointer opacity-90 hover:opacity-100" : "cursor-default opacity-80")}>
        <img src={checkedStamp} alt="" aria-hidden="true" draggable="false"
          className="w-full h-full object-contain select-none" />
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
