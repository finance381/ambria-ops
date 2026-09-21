import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../lib/useBodyScrollLock'

// Portalled to <body>, not rendered in place. The admin shell wraps each page
// in `relative isolate`, which makes a stacking context: everything inside it
// competes with the sidebar at one level, so no z-index on a sheet in that
// subtree can paint over the sidebar. In place, a sheet opened from an admin
// page had the sidebar showing through its left ~250px. Matches Modal.jsx's
// fix for the identical bug.
function BottomSheet({ open, onClose, title, children }) {
  // Was clearing the lock on close rather than restoring what it found, so a
  // sheet opened over another overlay unlocked the page when only the sheet
  // closed.
  useBodyScrollLock(open)

  if (!open) return null

  return createPortal((
    <div className="fixed inset-0 z-[9998]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 transition-opacity" />
      {/* A sheet on a phone, a dialog on anything wider.
          Anchored to the bottom edge and stretched between the sides, this was
          a form running the full width of a desk — a label at one end of
          nineteen hundred pixels and its field at the other. A sheet is the
          right shape for a screen you hold; on a screen you sit at, the same
          panel wants a width it can be read across and the middle of the
          viewport to sit in.

          sm: measures the viewport rather than the column the phone shell
          renders into, which is usually a trap — here it is exactly right, because
          this is portalled to <body> and covers the whole window whatever the
          shell around it is doing. */}
      <div
        className={"absolute bg-white/60 backdrop-blur-2xl max-h-[85vh] flex flex-col shadow-2xl border-white/60 " +
          "inset-x-0 bottom-0 rounded-t-2xl border-t " +
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 " +
          "sm:w-[min(36rem,calc(100vw-3rem))] sm:rounded-2xl sm:border"}
        onClick={function (e) { e.stopPropagation() }}
      >
        {/* The grab handle is a promise about dragging that only a sheet makes. */}
        <div className="flex items-center justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>
        {/* No × here. Every sheet that uses this carries its own dismissal —
            Cancel on the five wallet forms, Skip on Add Vendor — and the
            backdrop closes it too, so the cross was a third way to do the same
            thing, sitting at the opposite end of the sheet from the button
            people actually reach for.

            If a sheet ever ships without one, it needs a × back, not a user
            hunting for the backdrop behind a full-height panel. */}
        {/* sm:pt-4 replaces the space the hidden grab handle was leaving. */}
        {title && (
          <div className="px-5 pb-3 sm:pt-4 border-b border-slate-900/[0.06]">
            <h3 className="font-display text-[15px] font-bold text-slate-900">{title}</h3>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  ), document.body)
}

export default BottomSheet