import { createPortal } from 'react-dom'
import Icon from './Icon'

// Portalled to <body>, not rendered in place. The admin shell wraps each page
// in `relative isolate`, which makes a stacking context: everything inside it
// competes with the sidebar at one level, so no z-index on a modal in that
// subtree can paint over the sidebar. In place, a modal opened from an admin
// page had the sidebar showing through its left 248px. EventDatePicker's panel
// portals for the same reason.
function Modal({ open, onClose, title, wide, children }) {
  if (!open) return null

  return createPortal((
    <div className="fixed inset-0 z-[9998] flex items-end sm:items-center sm:justify-center">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={
        "relative bg-white w-full max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto ambria-thin-scroll " +
        "rounded-t-2xl sm:rounded-2xl shadow-2xl " +
        (wide ? "sm:max-w-4xl" : "sm:max-w-lg") +
        " sm:m-4"
      }>
        <div className="sticky top-0 bg-white flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200 z-10">
          <h3 className="text-[15px] sm:text-base font-bold text-slate-900 truncate">{title}</h3>
          <button onClick={onClose} aria-label="Close" title="Close"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="p-4 sm:p-5 pb-8 sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  ), document.body)
}

export default Modal
