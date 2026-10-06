import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { useBodyScrollLock } from '../../lib/useBodyScrollLock'

// The app's own confirm and alert, in place of the browser's.
//
// window.confirm/alert put up a black OS box titled "localhost:5173 says" (or
// the site's address): nothing of the app's look, no room to say which
// button does what, and in the installed PWA it reads as the browser
// stepping in. These draw the same card as every other dialog here.
//
//   appConfirm(message, opts?) → Promise<boolean>
//     if (!(await appConfirm('Delete box B-12? All contents will be removed.'))) return
//   appAlert(message) → Promise<void>
//
// The message is split at its first "?" (or "." / "!") into a title and the
// line under it, so the existing one-string messages read as a heading and
// an explanation without each call site being rewritten. opts can set
// { title, message, confirmLabel, cancelLabel, danger } outright.
//
// window.alert is pointed at appAlert once the host mounts, so the two
// hundred-odd alert() calls already in the app show this card too. An alert
// never returned anything and nothing waits on it, so it is safe to swap;
// confirm has to be awaited, which is why those call sites use appConfirm.
//
// One dialog at a time; any asked for meanwhile wait their turn.

var queue = []
var notify = null

function ask(item) {
  return new Promise(function (resolve) {
    queue.push(Object.assign({}, item, { resolve: resolve }))
    if (notify) notify()
  })
}

export function appConfirm(message, opts) {
  return ask(Object.assign({ kind: 'confirm', text: message }, opts || {}))
}

export function appAlert(message, opts) {
  return ask(Object.assign({ kind: 'alert', text: message }, opts || {}))
}

// "Delete box B-12? All contents will be removed." → title + body.
function split(text) {
  var s = String(text == null ? '' : text).trim()
  var m = s.match(/^([^\n]{1,140}?[?!.])(\s+[\s\S]*)?$/)
  if (m && m[2] && m[2].trim()) return { title: m[1], body: m[2].trim() }
  return { title: s, body: '' }
}

var DANGER = /^(delete|remove|cancel|write off|overwrite|clear|discard|opt this|merge|leave|reject)/i

// The confirm button says what it does, from the message's first word.
function labelsFor(text) {
  var t = String(text || '').trim()
  var w = t.toLowerCase()
  if (w.indexOf('delete') === 0) return ['Delete', 'Cancel']
  if (w.indexOf('remove') === 0) return ['Remove', 'Cancel']
  if (w.indexOf('cancel') === 0) return ['Yes, cancel', 'Go back']
  if (w.indexOf('write off') === 0) return ['Write off', 'Cancel']
  if (w.indexOf('overwrite') === 0) return ['Overwrite', 'Cancel']
  if (w.indexOf('clear') === 0) return ['Clear', 'Cancel']
  if (w.indexOf('opt this') === 0) return ['Opt out', 'Cancel']
  if (w.indexOf('merge') === 0) return ['Merge', 'Cancel']
  if (w.indexOf('leave') === 0) return ['Leave', 'Stay']
  if (w.indexOf('resubmit') === 0) return ['Resubmit', 'Cancel']
  if (w.indexOf('submit') === 0) return ['Submit', 'Cancel']
  if (w.indexOf('copy') === 0) return ['Copy', 'Cancel']
  return ['Confirm', 'Cancel']
}

export function AppDialogHost() {
  var [cur, setCur] = useState(null)
  // What is on screen, outside React's updater: taking from the queue inside
  // a setState updater ran twice under StrictMode and dropped a dialog.
  var curRef = useRef(null)
  var okRef = useRef(null)

  useEffect(function () {
    function pull() {
      if (curRef.current) return
      var next = queue.shift()
      if (next) { curRef.current = next; setCur(next) }
    }
    notify = pull
    pull()
    var nativeAlert = window.alert
    window.alert = function (msg) { appAlert(msg) }
    return function () {
      notify = null
      window.alert = nativeAlert
    }
  }, [])

  useBodyScrollLock(!!cur)

  useEffect(function () {
    if (!cur) return
    var t = setTimeout(function () { if (okRef.current) okRef.current.focus() }, 30)
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
    }
    document.addEventListener('keydown', onKey)
    return function () { clearTimeout(t); document.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur])

  function close(result) {
    if (!cur) return
    cur.resolve(cur.kind === 'confirm' ? !!result : undefined)
    var next = queue.shift() || null
    curRef.current = next
    setCur(next)
  }

  if (!cur) return null

  var parts = cur.title ? { title: cur.title, body: cur.message || '' } : split(cur.text)
  var isConfirm = cur.kind === 'confirm'
  var labels = labelsFor(cur.text || cur.title)
  var raw = String(cur.text || cur.title || '').trim()
  // An alert that reports a failure gets the warning look; any other alert
  // is information.
  var danger = cur.danger != null ? cur.danger
    : isConfirm ? DANGER.test(raw)
      : /fail|error|could ?n.t|cannot|can.t|not allowed|invalid|denied|required|missing/i.test(raw)
  var okLabel = cur.confirmLabel || (isConfirm ? labels[0] : 'OK')
  var cancelLabel = cur.cancelLabel || labels[1]
  var icon = danger ? 'alert' : 'info'
  var tint = danger ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'

  return createPortal((
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center" role="presentation">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={function () { close(false) }} />
      <div role={isConfirm ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="app-dialog-title"
        className="ambria-rise relative w-full sm:max-w-[420px] sm:m-4 bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5">
        <div className="flex items-start gap-3.5">
          <span className={'shrink-0 w-11 h-11 rounded-2xl inline-flex items-center justify-center ' + tint}>
            <Icon name={icon} size={20} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 id="app-dialog-title" className="font-display text-[16px] font-extrabold text-slate-900 leading-snug tracking-[-0.01em] break-words whitespace-pre-line">{parts.title}</h3>
            {parts.body && <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed break-words whitespace-pre-line">{parts.body}</p>}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {isConfirm && (
            <button type="button" onClick={function () { close(false) }}
              className="h-11 sm:h-10 px-5 rounded-xl border border-slate-300 bg-white text-[14px] font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all">
              {cancelLabel}
            </button>
          )}
          <button type="button" ref={okRef} onClick={function () { close(true) }}
            className={'h-11 sm:h-10 px-5 rounded-xl text-[14px] font-bold text-white active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
              (danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500')}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}
