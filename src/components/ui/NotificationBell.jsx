import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useRealtime } from '../../lib/useRealtime'
import { formatDate } from '../../lib/format'
import Icon from './Icon'

// A push subscription's applicationServerKey must be the raw key bytes, not
// the base64url text VAPID keys are generated/stored as.
function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4)
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  var rawData = atob(base64)
  var outputArray = new Uint8Array(rawData.length)
  for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// profile: the logged-in user. onNavigate(link): optional — called with a
// notification's `link` when clicked, so whichever shell mounts this can
// route it (deep link format is intentionally simple strings like
// 'broadcast:inbox' / 'expense:123' / 'wallet', resolved by the caller).
function NotificationBell({ profile, onNavigate }) {
  var [open, setOpen] = useState(false)
  var [items, setItems] = useState([])
  // 'unsupported' | 'default' | 'granted' | 'denied' | 'subscribing'
  var [pushState, setPushState] = useState('unsupported')
  var btnRef = useRef(null)
  var panelRef = useRef(null)

  function load() {
    if (!profile || !profile.id) return
    supabase.from('notifications').select('*').eq('user_id', profile.id)
      .order('created_at', { ascending: false }).limit(30)
      .then(function (res) { setItems(res.data || []) })
  }

  useEffect(function () { load() }, [profile && profile.id])
  // Realtime fires for every row in the table, not just this user's — cheap
  // enough at this scale, and matches the same table-wide pattern every
  // other useRealtime caller in this app already uses.
  useRealtime(['notifications'], load)

  useEffect(function () {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported'); return
    }
    setPushState(Notification.permission === 'granted' ? 'granted' : (Notification.permission === 'denied' ? 'denied' : 'default'))
  }, [])

  useEffect(function () {
    function onDocClick(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return
      if (panelRef.current && panelRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return function () { document.removeEventListener('click', onDocClick) }
  }, [])

  async function enablePush() {
    if (pushState === 'subscribing') return
    setPushState('subscribing')
    try {
      var perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'default'); return }
      var reg = await navigator.serviceWorker.ready
      var existing = await reg.pushManager.getSubscription()
      var sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      })
      var json = sub.toJSON()
      await supabase.from('push_subscriptions').upsert({
        user_id: profile.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
      }, { onConflict: 'endpoint' })
      setPushState('granted')
    } catch (e) {
      console.error('push subscribe failed', e)
      setPushState('default')
    }
  }

  var unreadCount = items.filter(function (n) { return !n.read_at }).length

  function markRead(n) {
    if (!n.read_at) {
      var now = new Date().toISOString()
      setItems(function (prev) { return prev.map(function (x) { return x.id === n.id ? Object.assign({}, x, { read_at: now }) : x }) })
      supabase.from('notifications').update({ read_at: now }).eq('id', n.id).then(function () {})
    }
    setOpen(false)
    if (n.link && onNavigate) onNavigate(n.link)
  }

  async function markAllRead() {
    var ids = items.filter(function (n) { return !n.read_at }).map(function (n) { return n.id })
    if (ids.length === 0) return
    var now = new Date().toISOString()
    setItems(function (prev) { return prev.map(function (x) { return Object.assign({}, x, { read_at: x.read_at || now }) }) })
    await supabase.from('notifications').update({ read_at: now }).in('id', ids)
  }

  return (
    <div className="relative">
      <button type="button" ref={btnRef} onClick={function () { setOpen(!open) }}
        aria-label="Notifications" aria-pressed={open}
        className="relative w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors">
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span data-notranslate
            className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold inline-flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal((
        <div ref={panelRef}
          style={(function () {
            var panelWidth = Math.min(340, window.innerWidth - 16)
            var r = btnRef.current ? btnRef.current.getBoundingClientRect() : null
            var left = r ? Math.min(Math.max(8, r.right - panelWidth), window.innerWidth - panelWidth - 8) : 8
            var top = r ? r.bottom + 6 : 48
            return { position: 'fixed', top: top, left: left, width: panelWidth }
          })()}
          className="z-[9999] max-h-[70vh] overflow-y-auto ambria-thin-scroll bg-white border border-slate-200 rounded-xl shadow-2xl">
          <div className="sticky top-0 bg-white flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100">
            <p className="text-[13px] font-bold text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800">
                Mark all read
              </button>
            )}
          </div>

          {pushState === 'default' && (
            <button type="button" onClick={enablePush}
              className="w-full text-left px-3.5 py-2.5 border-b border-slate-100 bg-indigo-50/60 hover:bg-indigo-50 text-[12px] font-bold text-indigo-700 flex items-center gap-1.5 transition-colors">
              <Icon name="bell" size={13} /> Enable push notifications
            </button>
          )}
          {pushState === 'subscribing' && (
            <div className="px-3.5 py-2.5 border-b border-slate-100 text-[12px] text-slate-500">Enabling…</div>
          )}
          {pushState === 'denied' && (
            <div className="px-3.5 py-2.5 border-b border-slate-100 text-[11.5px] text-slate-400">
              Notifications are blocked for this site in your browser settings.
            </div>
          )}

          {items.length === 0 ? (
            <p className="px-3.5 py-8 text-center text-[12.5px] text-slate-400">Nothing yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map(function (n) {
                return (
                  <button key={n.id} type="button" onClick={function () { markRead(n) }}
                    className={'w-full text-left px-3.5 py-2.5 transition-colors ' + (n.read_at ? 'hover:bg-slate-50' : 'bg-indigo-50/50 hover:bg-indigo-50')}>
                    <p className="text-[12.5px] font-bold text-slate-900 leading-snug">{n.title}</p>
                    {n.body && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{n.body}</p>}
                    <p className="text-[10.5px] text-slate-400 mt-1" data-notranslate>{formatDate(n.created_at)}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ), document.body)}
    </div>
  )
}

export default NotificationBell
