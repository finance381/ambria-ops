import { useState, useEffect } from 'react'
import Modal from './Modal'
import Icon from './Icon'

// One dialog for every reversal in the app.
//
// These were window.prompt and window.confirm — a black OS box with the origin
// as its title, no room to say what reversing actually does, and an input that
// cannot be marked optional or required, validated, or cancelled without
// guessing which of OK and Cancel returned null. On a phone it is a system
// sheet over the page; in a PWA it looks like the browser has intervened.
//
// `reasonLabel` off means there is nothing to type: the dialog is then a plain
// confirmation. `reasonRequired` makes the action wait for something to be
// typed, which is the difference between the ledger reversals (a note, if you
// have one) and reversing a JV (it has to be recorded).
function ReverseDialog({
  open, onClose, onConfirm, busy,
  title, description, reasonLabel, reasonRequired, confirmLabel,
}) {
  var [reason, setReason] = useState('')

  // A fresh box each time it opens, so the last reversal's note is never
  // submitted against the next one.
  useEffect(function () { if (open) setReason('') }, [open])

  var trimmed = reason.trim()
  var ready = !busy && (!reasonRequired || trimmed.length >= 3)

  function submit() {
    if (!ready) return
    onConfirm(trimmed || null)
  }

  return (
    <Modal open={open} onClose={busy ? function () {} : onClose} title={title || 'Reverse this entry'}>
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 text-[13px] text-slate-600 leading-relaxed">
          <span className="shrink-0 mt-0.5 text-amber-500"><Icon name="alert" size={16} /></span>
          <span>{description || 'This posts a new offsetting entry. The original stays in the ledger — nothing is deleted.'}</span>
        </p>

        {reasonLabel && (
          <div>
            <label htmlFor="reverse-reason" className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              {reasonLabel}
              {!reasonRequired && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
            </label>
            <textarea id="reverse-reason" rows={3} value={reason} autoFocus
              onChange={function (e) { setReason(e.target.value) }}
              placeholder="What is being corrected?"
              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow resize-none"
              style={{ fontSize: '16px' }} />
            {reasonRequired && trimmed.length > 0 && trimmed.length < 3 && (
              <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">A few more characters, so the note says something.</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-10 px-4 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!ready}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-rose-600 transition-all">
            <Icon name={busy ? 'refresh' : 'reverse'} size={15} />
            {busy ? 'Reversing…' : (confirmLabel || 'Reverse')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ReverseDialog
