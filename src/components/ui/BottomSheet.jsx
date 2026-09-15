import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Portalled to <body>, not rendered in place. The admin shell wraps each page
// in `relative isolate`, which makes a stacking context: everything inside it
// competes with the sidebar at one level, so no z-index on a sheet in that
// subtree can paint over the sidebar. In place, a sheet opened from an admin
// page had the sidebar showing through its left ~250px. Matches Modal.jsx's
// fix for the identical bug.
function BottomSheet({ open, onClose, title, children }) {
  useEffect(function () {
    if (open) document.body.style.overflow = 'hidden'
    return function () { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal((
    <div className="fixed inset-0 z-[9998]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 transition-opacity" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white/60 backdrop-blur-2xl rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl border-t border-white/60"
        onClick={function (e) { e.stopPropagation() }}
      >
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>
        {/* No × here. Every sheet that uses this carries its own dismissal —
            Cancel on the five wallet forms, Skip on Add Vendor — and the
            backdrop closes it too, so the cross was a third way to do the same
            thing, sitting at the opposite end of the sheet from the button
            people actually reach for.

            If a sheet ever ships without one, it needs a × back, not a user
            hunting for the backdrop behind a full-height panel. */}
        {title && (
          <div className="px-5 pb-3 border-b border-slate-900/[0.06]">
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