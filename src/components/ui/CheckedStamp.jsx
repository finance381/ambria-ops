import Icon from './Icon'
import { formatDateTime } from '../../lib/format'

// The worn ink. An SVG turbulence tile, screened over the stamp: white where
// the noise is bright, which on a green mark reads as ink that did not take
// and on the white card around it reads as nothing at all. That is why it can
// sit over the whole circle without being clipped to the strokes.
//
// Inline rather than a Tailwind arbitrary value, because a url() with a data
// URI in a class name is a quoting fight nobody wins — and inline styles skip
// the scanner entirely, so it cannot be purged by accident.
var STAMP_WEAR = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='w'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' seed='7'/></filter><rect width='90' height='90' filter='url(%23w)'/></svg>\")"

function StampStars() {
  // Three, the middle one larger — the arrangement every rubber stamp of this
  // kind uses, and the thing that stops a ring with a word in it reading as a
  // badge.
  return (
    <span aria-hidden="true" className="flex items-center justify-center gap-1 text-emerald-600">
      <Icon name="star" size={9} className="fill-current stroke-none" />
      <Icon name="star" size={12} className="fill-current stroke-none" />
      <Icon name="star" size={9} className="fill-current stroke-none" />
    </span>
  )
}

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
    // Drawn rather than an image: two rings, three stars above and below, a
    // rule either side of the word, and a tilt. A PNG would be one fixed green
    // at one fixed size and could not dim or take a hover — this is type and
    // borders, so it scales, inherits and animates like anything else.
    //
    // The tilt is on the circle, not the button, so the button's own box stays
    // square to the layout and nothing around it is nudged by a rotated
    // bounding box.
    return (
      <button type="button" disabled={busy || !interactive} onClick={interactive ? onToggle : undefined} title={title}
        aria-label={title}
        className={"shrink-0 w-[118px] h-[118px] inline-flex items-center justify-center transition-opacity " +
          (interactive ? "cursor-pointer opacity-90 hover:opacity-100" : "cursor-default opacity-80")}>
        <span aria-hidden="true" className="relative w-[112px] h-[112px] rotate-[-9deg]">
          <span className="absolute inset-0 rounded-full border-[3.5px] border-emerald-600" />
          <span className="absolute inset-[7px] rounded-full border-2 border-emerald-600" />
          <span className="absolute inset-[7px] flex flex-col items-center justify-center gap-[3px] px-2">
            <StampStars />
            <span className="w-full h-[2.5px] bg-emerald-600" />
            <span className="font-display text-[17px] font-extrabold uppercase tracking-[0.06em] text-emerald-600 leading-none">
              Checked
            </span>
            <span className="w-full h-[2.5px] bg-emerald-600" />
            <StampStars />
          </span>
          {/* The wear goes last, over everything, so the rings, the rules, the
              stars and the word are all worn by the same tile rather than each
              carrying its own. */}
          <span className="absolute inset-0 rounded-full pointer-events-none"
            style={{ backgroundImage: STAMP_WEAR, backgroundSize: '90px 90px', mixBlendMode: 'screen', opacity: 0.55 }} />
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
