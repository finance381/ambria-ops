import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { pushBack, goBack } from '../../lib/backNav'
import Icon from '../../components/ui/Icon'

// Sales Quick Send — pick a client (booked or still on a quote), work
// through that stage's message sequence (src/modules/broadcast/
// QuickSendSequences.jsx configures it), send what's ready now and
// schedule the rest. A quote-stage follow-up can be sent more than once
// ("Send again"); a booked-stage milestone is always one-shot.
var CTRL = 'w-full h-11 px-3 border border-gray-300 rounded-xl text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300'

function last10(phone) { return String(phone || '').replace(/\D/g, '').slice(-10) }

function relDate(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  var days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return days + ' days ago'
  return formatDate(iso)
}

// Auto-fills a template's {{1}}, {{2}}… from what's already known about the
// client — same handful of guesses QuickSendDrawer.jsx already makes for
// the single-contact inline flow this replaces.
function autoValues(template, client, contact) {
  var values = {}
  ;(template.variable_labels || []).forEach(function (label, i) {
    var idx = String(i + 1)
    var key = (label || '').toLowerCase()
    if (key.indexOf('name') !== -1) values[idx] = client.name || ''
    else if (key.indexOf('venue') !== -1) values[idx] = client.venue || ''
    else if (key.indexOf('date') !== -1) values[idx] = client.date ? formatDate(client.date) : ''
    else if (key.indexOf('phone') !== -1) values[idx] = (contact && contact.phone_e164) || ''
    else values[idx] = ''
  })
  return values
}

function SalesQuickSend({ profile }) {
  var [view, setView] = useState('pick')

  // ── pick ──
  var [query, setQuery] = useState('')
  var [searching, setSearching] = useState(false)
  var [results, setResults] = useState([])
  var searchTimer = useRef(null)

  // ── resolved client + contact ──
  var [client, setClient] = useState(null) // { kind: 'booked'|'quote', id, name, phone, venue, date, status }
  var [contact, setContact] = useState(null)
  var [resolving, setResolving] = useState(false)
  var [pickError, setPickError] = useState('')

  // ── checklist ──
  var [steps, setSteps] = useState([])
  var [history, setHistory] = useState([])
  var [loadingSteps, setLoadingSteps] = useState(false)
  var [selected, setSelected] = useState({}) // stepId -> true (one-shot, chosen for Review)
  var [stepBusy, setStepBusy] = useState('')
  var [stepError, setStepError] = useState('')
  var [flash, setFlash] = useState('')

  // ── review ──
  var [scheduleMode, setScheduleMode] = useState({}) // stepId -> 'now' | 'schedule'
  var [scheduleWhen, setScheduleWhen] = useState({}) // stepId -> { date, time }
  var [sending, setSending] = useState(false)
  var [sendError, setSendError] = useState('')

  function flashMsg(m) { setFlash(m); setTimeout(function () { setFlash('') }, 2600) }

  // ═══ pick ═══════════════════════════════════════════════════════════════
  function onQueryChange(e) {
    var term = e.target.value
    setQuery(term)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (term.trim().length < 2) { setResults([]); return }
    setSearching(true)
    searchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      Promise.all([
        supabase.from('quotes')
          .select('id, guest_name, guest_phone, venue_name, event_date, status, updated_at')
          .neq('status', 'converted')
          .or('guest_name.ilike.%' + q + '%,guest_phone.ilike.%' + q + '%')
          .order('updated_at', { ascending: false }).limit(10),
        supabase.from('events_safe')
          .select('id, client_name, contact_person, contact_number, venue_name, function_date, is_tentative')
          .is('merged_into_id', null)
          .or('client_name.ilike.%' + q + '%,contact_person.ilike.%' + q + '%,contact_number.ilike.%' + q + '%')
          .order('function_date', { ascending: false }).limit(10),
      ]).then(function (res) {
        var quotes = (res[0].data || []).map(function (q2) {
          return { kind: 'quote', id: q2.id, name: q2.guest_name, phone: q2.guest_phone, venue: q2.venue_name, date: q2.event_date, status: q2.status }
        })
        var booked = (res[1].data || []).map(function (e) {
          return { kind: 'booked', id: e.id, name: e.contact_person || e.client_name, phone: e.contact_number, venue: e.venue_name, date: e.function_date, status: e.is_tentative ? 'Tentative' : 'Booked' }
        })
        setResults(quotes.concat(booked))
        setSearching(false)
      })
    }, 300)
  }

  async function pickClient(c) {
    setPickError(''); setResolving(true)
    var phone = last10(c.phone)
    if (phone.length < 10) { setPickError('No valid phone number on file for this client'); setResolving(false); return }
    var e164 = '+91' + phone
    var row = { phone: e164, name: c.name || null, source: c.kind === 'quote' ? 'quote' : 'event', external_ids: {} }
    row.external_ids[c.kind + '_id'] = c.id
    var upRes = await supabase.rpc('rpc_wa_contact_upsert_bulk', { p_rows: [row] })
    if (upRes.error) { setPickError(upRes.error.message); setResolving(false); return }
    var result = ((upRes.data || {}).results || [])[0]
    if (!result || result.status === 'skipped_invalid_phone') { setPickError('Invalid phone number for this client'); setResolving(false); return }
    var cRes = await supabase.from('wa_contacts').select('*').eq('id', result.contact_id).maybeSingle()
    setContact(cRes.data || null)
    setClient(c)
    setResolving(false)
    // One stack entry for the whole time spent away from the picker —
    // hardware back / swipe from either checklist or review jumps straight
    // out to Pick (the on-screen "review → checklist" step stays available
    // as its own button below, it just doesn't need its own history entry).
    pushBack(function () { setView('pick') })
    setView('checklist')
    loadChecklist(c.kind, result.contact_id)
  }

  // ═══ checklist ══════════════════════════════════════════════════════════
  function loadChecklist(sequence, contactId) {
    setLoadingSteps(true); setSelected({}); setStepError('')
    supabase.from('wa_quicksend_steps')
      .select('*, wa_templates(id, name, body_text, variable_labels, variable_count, category)')
      .eq('sequence', sequence).order('order_index')
      .then(function (res) {
        var rows = (res.data || []).filter(function (s) { return s.wa_templates })
        setSteps(rows)
        var templateIds = rows.map(function (s) { return s.template_id })
        if (templateIds.length === 0) { setHistory([]); setLoadingSteps(false); return }
        supabase.from('wa_messages').select('id, template_id, created_at, status')
          .eq('contact_id', contactId).in('template_id', templateIds)
          .then(function (hRes) { setHistory(hRes.data || []); setLoadingSteps(false) })
      })
  }

  function stepHistory(step) {
    var rows = history.filter(function (h) { return h.template_id === step.template_id })
    var count = rows.length
    var lastAt = rows.reduce(function (m, h) { return (!m || h.created_at > m) ? h.created_at : m }, null)
    return { count: count, lastAt: lastAt }
  }

  function toggleSelect(step) {
    setSelected(function (s) { var n = Object.assign({}, s); n[step.id] = !n[step.id]; return n })
  }

  async function sendStepNow(step) {
    setStepBusy('send' + step.id); setStepError('')
    var values = autoValues(step.wa_templates, client, contact)
    var res = await supabase.rpc('rpc_wa_quick_send', { p_contact_id: contact.id, p_template_id: step.template_id, p_variable_values: values })
    if (res.error) { setStepBusy(''); setStepError(res.error.message.replace(/_/g, ' ')); return }
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    await supabase.functions.invoke('wa-send', { body: { message_id: res.data }, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setStepBusy('')
    loadChecklist(client.kind, contact.id)
  }

  var selectedCount = Object.keys(selected).filter(function (k) { return selected[k] }).length

  // ═══ review & send ══════════════════════════════════════════════════════
  function openReview() {
    var modes = {}
    steps.forEach(function (s) { if (selected[s.id]) modes[s.id] = 'now' })
    setScheduleMode(modes)
    setScheduleWhen({})
    setSendError('')
    setView('review')
  }

  function setMode(stepId, mode) {
    setScheduleMode(function (m) { var n = Object.assign({}, m); n[stepId] = mode; return n })
  }
  function setWhen(stepId, field, val) {
    setScheduleWhen(function (w) {
      var n = Object.assign({}, w)
      n[stepId] = Object.assign({ date: '', time: '10:00' }, n[stepId])
      n[stepId][field] = val
      return n
    })
  }

  async function confirmSend() {
    if (sending) return
    setSending(true); setSendError('')
    var selectedSteps = steps.filter(function (s) { return selected[s.id] })
    for (var i = 0; i < selectedSteps.length; i++) {
      var step = selectedSteps[i]
      var mode = scheduleMode[step.id] || 'now'
      try {
        if (mode === 'now') {
          var values = autoValues(step.wa_templates, client, contact)
          var res = await supabase.rpc('rpc_wa_quick_send', { p_contact_id: contact.id, p_template_id: step.template_id, p_variable_values: values })
          if (res.error) throw new Error(step.wa_templates.name + ': ' + res.error.message.replace(/_/g, ' '))
          var sessionRes = await supabase.auth.getSession()
          var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
          await supabase.functions.invoke('wa-send', { body: { message_id: res.data }, headers: token ? { Authorization: 'Bearer ' + token } : {} })
        } else {
          var when = scheduleWhen[step.id]
          if (!when || !when.date) throw new Error(step.wa_templates.name + ': pick a date to schedule for')
          var sendAt = new Date(when.date + 'T' + (when.time || '10:00') + ':00')
          if (sendAt.getTime() <= Date.now()) throw new Error(step.wa_templates.name + ': scheduled time must be in the future')
          var values2 = autoValues(step.wa_templates, client, contact)
          var schRes = await supabase.rpc('rpc_wa_quicksend_schedule', {
            p_contact_id: contact.id, p_template_id: step.template_id, p_variable_values: values2, p_send_at: sendAt.toISOString(),
          })
          if (schRes.error) throw new Error(step.wa_templates.name + ': ' + schRes.error.message.replace(/_/g, ' '))
        }
      } catch (err) {
        setSending(false)
        setSendError(err.message)
        return
      }
    }
    setSending(false)
    flashMsg('Sent')
    setQuery(''); setResults([]); setClient(null); setContact(null); setSteps([]); setHistory([]); setSelected({})
    goBack()
  }

  // ═══ render ═════════════════════════════════════════════════════════════
  function header(title, sub, onBack) {
    return (
      <div className="flex items-center gap-2.5 mb-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back"
            className="shrink-0 w-10 h-10 rounded-xl border border-gray-200 bg-white inline-flex items-center justify-center text-gray-700 hover:bg-gray-50">
            <Icon name="arrowLeft" size={17} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[19px] font-extrabold text-gray-900 leading-tight tracking-[-0.02em]">{title}</h2>
          {sub && <p className="text-[12px] font-medium text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </div>
    )
  }

  if (view === 'pick') {
    return (
      <div className="space-y-3">
        {header('Quick Send', 'Pick a client to send booked-deal or follow-up messages')}
        {flash && <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] font-bold text-emerald-800">{flash}</div>}
        <div className="relative">
          <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={query} onChange={onQueryChange} placeholder="Search client, event or phone…"
            className={CTRL + ' pl-9'} style={{ fontSize: '16px' }} />
        </div>
        {pickError && <p className="text-[12.5px] text-red-600">{pickError}</p>}
        {resolving && <p className="text-[12.5px] text-gray-400 text-center py-4">Resolving contact…</p>}
        {!resolving && (
          <div className="space-y-2">
            {searching && <p className="text-[12.5px] text-gray-400 text-center py-3">Searching…</p>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-[12.5px] text-gray-400 text-center py-3">No matching clients or quotes</p>
            )}
            {results.map(function (c) {
              var isBooked = c.kind === 'booked'
              return (
                <button key={c.kind + ':' + c.id} type="button" onClick={function () { pickClient(c) }}
                  className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-gray-900 text-white inline-flex items-center justify-center text-[11px] font-bold">
                    {(c.name || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-gray-900 truncate">{c.name || 'Unnamed'}</span>
                    <span className="block text-[11.5px] text-gray-500 truncate">{[c.venue, c.date ? formatDate(c.date) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={'shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ' +
                    (isBooked ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                    {isBooked ? 'Booked' : 'Quote'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (view === 'checklist') {
    return (
      <div className="space-y-3 pb-24">
        {header('Quick Send', 'Step 2 of 3 · Choose messages', goBack)}
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
          <span className="shrink-0 w-9 h-9 rounded-full bg-gray-900 text-white inline-flex items-center justify-center text-[11px] font-bold">
            {(client.name || '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-gray-900 truncate">{client.name}</span>
            <span className="block text-[11.5px] text-gray-500 truncate">{[client.venue, client.date ? formatDate(client.date) : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className={'shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ' +
            (client.kind === 'booked' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
            {client.kind === 'booked' ? 'Booked' : 'Quote'}
          </span>
        </div>

        {stepError && <p className="text-[12.5px] text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{stepError}</p>}
        {loadingSteps && <p className="text-[12.5px] text-gray-400 text-center py-6">Loading…</p>}

        {!loadingSteps && steps.length === 0 && (
          <p className="text-[12.5px] text-gray-400 text-center py-6">No messages configured for this sequence yet — ask an admin to set one up under API Marketing → Quick Send.</p>
        )}

        <div className="space-y-2">
          {steps.map(function (step, i) {
            var t = step.wa_templates
            var h = stepHistory(step)
            var isSent = h.count > 0
            var atCap = step.repeatable && step.repeat_max_count != null && h.count >= step.repeat_max_count
            return (
              <div key={step.id} className={'bg-white border border-gray-200 rounded-xl p-3 ' + (!step.repeatable && isSent ? 'opacity-60' : '')}>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 inline-flex items-center justify-center text-[11px] font-extrabold">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-gray-900 truncate">{t.name}</span>
                    <span className="block text-[11px] text-gray-500">
                      {step.repeatable
                        ? (h.count > 0 ? 'Sent ' + h.count + (step.repeat_max_count ? ' of ' + step.repeat_max_count : ' times') + ' · last sent ' + relDate(h.lastAt) : 'Not sent yet')
                        : (isSent ? 'Sent · ' + relDate(h.lastAt) : 'Pending')}
                    </span>
                  </span>
                  {!step.repeatable && (
                    isSent ? (
                      <span className="shrink-0 w-6 h-6 rounded-md bg-emerald-600 text-white inline-flex items-center justify-center">
                        <Icon name="check" size={13} strokeWidth={3} />
                      </span>
                    ) : (
                      <button type="button" onClick={function () { toggleSelect(step) }} aria-pressed={!!selected[step.id]}
                        className={'shrink-0 w-6 h-6 rounded-md border-2 inline-flex items-center justify-center ' +
                          (selected[step.id] ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300')}>
                        {selected[step.id] && <Icon name="check" size={13} strokeWidth={3} />}
                      </button>
                    )
                  )}
                </div>
                {step.repeatable && (
                  <button type="button" onClick={function () { sendStepNow(step) }} disabled={atCap || stepBusy === 'send' + step.id}
                    className={'mt-2 w-full h-8 rounded-lg text-[12px] font-bold inline-flex items-center justify-center gap-1.5 ' +
                      (atCap ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100')}>
                    {atCap ? 'Limit reached' : (
                      <>
                        <Icon name="send" size={12} />
                        {stepBusy === 'send' + step.id ? 'Sending…' : 'Send again'}
                      </>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {steps.length > 0 && (
          <div className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[540px] bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3">
            <span className="text-[12.5px] font-semibold text-gray-600"><span className="font-bold text-gray-900">{selectedCount}</span> selected</span>
            <button type="button" onClick={openReview} disabled={selectedCount === 0}
              className="flex-1 h-11 rounded-xl bg-indigo-600 text-white font-bold text-[13.5px] disabled:opacity-40">
              Review & Send
            </button>
          </div>
        )}
      </div>
    )
  }

  // view === 'review'
  var selectedSteps = steps.filter(function (s) { return selected[s.id] })
  var nowCount = selectedSteps.filter(function (s) { return (scheduleMode[s.id] || 'now') === 'now' }).length
  var schedCount = selectedSteps.length - nowCount
  return (
    <div className="space-y-3 pb-24">
      {header('Quick Send', 'Step 3 of 3 · Review & send', function () { setView('checklist') })}
      {sendError && <p className="text-[12.5px] text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{sendError}</p>}

      <div className="space-y-2">
        {selectedSteps.map(function (step) {
          var mode = scheduleMode[step.id] || 'now'
          var when = scheduleWhen[step.id] || { date: '', time: '10:00' }
          return (
            <div key={step.id} className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[13px] font-bold text-gray-900 mb-2">{step.wa_templates.name}</p>
              <div className="inline-flex p-0.5 rounded-lg bg-gray-100">
                <button type="button" onClick={function () { setMode(step.id, 'now') }}
                  className={'h-7 px-3 rounded-md text-[11.5px] font-bold ' + (mode === 'now' ? 'bg-indigo-600 text-white' : 'text-gray-500')}>
                  Send now
                </button>
                <button type="button" onClick={function () { setMode(step.id, 'schedule') }}
                  className={'h-7 px-3 rounded-md text-[11.5px] font-bold ' + (mode === 'schedule' ? 'bg-indigo-600 text-white' : 'text-gray-500')}>
                  Schedule
                </button>
              </div>
              {mode === 'schedule' && (
                <div className="flex gap-2 mt-2">
                  <input type="date" value={when.date} min={new Date().toISOString().slice(0, 10)}
                    onChange={function (e) { setWhen(step.id, 'date', e.target.value) }}
                    className="flex-1 h-9 px-2 border border-gray-300 rounded-lg text-[13px]" style={{ fontSize: '16px' }} />
                  <input type="time" value={when.time}
                    onChange={function (e) { setWhen(step.id, 'time', e.target.value) }}
                    className="w-28 h-9 px-2 border border-gray-300 rounded-lg text-[13px]" style={{ fontSize: '16px' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11.5px] text-gray-400">Scheduled messages send automatically at the time above — you don't need to come back and send them yourself.</p>

      <div className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-[540px] bg-white border-t border-gray-200 px-4 py-3">
        <button type="button" onClick={confirmSend} disabled={sending}
          className="w-full h-11 rounded-xl bg-indigo-600 text-white font-bold text-[13.5px] disabled:opacity-50">
          {sending ? 'Sending…' : (nowCount > 0 && schedCount > 0
            ? 'Send ' + nowCount + ' now · Schedule ' + schedCount
            : nowCount > 0 ? 'Send ' + nowCount + ' now' : 'Schedule ' + schedCount + ' message' + (schedCount === 1 ? '' : 's'))}
        </button>
      </div>
    </div>
  )
}

export default SalesQuickSend
