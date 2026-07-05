import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { useVoice } from '../../hooks/useVoice'
import { filterUserCategories } from '../../lib/categories'
import EventDatePicker from '../../components/ui/EventDatePicker'

function makeEntry() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    department: '',
    subDeptId: '',
    venueIdTop: '',
    categoryId: '',
    expenseTypeId: '',
    expenseSubTypeId: '',
    description: '',
    amount: '',
    taxAmount: '',
    expenseDate: new Date().toISOString().split('T')[0],
    fieldValues: {},
    allocations: [{ departmentId: '', subDepartmentId: '', venueId: '', amountPaise: '' }],
    receiptFile: null,
    receiptPreview: '',
    audioBlob: null,
    audioUrl: '',
    recording: false
  }
}

function makeAllocation() {
  return { departmentId: '', subDepartmentId: '', venueId: '', amountPaise: '' }
}

function ExpenseForm({ profile, onDone }) {
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [expenseTypes, setExpenseTypes] = useState([])
  var [expenseSubTypes, setExpenseSubTypes] = useState([])
  var [departments, setDepartments] = useState([])
  var [venues, setVenues] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [loading, setLoading] = useState(true)
  var [lookupCache, setLookupCache] = useState({})

  var [entries, setEntries] = useState([makeEntry()])
  var [saving, setSaving] = useState(false)
  var [isFunction, setIsFunction] = useState(false)
  var [eventDate, setEventDate] = useState('')
  var [eventId, setEventId] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var voice = useVoice()
  var [error, setError] = useState('')
  var [success, setSuccess] = useState('')
  var [zoomImg, setZoomImg] = useState('')

  useEffect(function () { loadRefData() }, [])

  async function loadRefData() {
    var [catR, scR, etR, estR, dR, vR, sdR] = await Promise.all([
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('sub_categories').select('id, category_id, name').order('name'),
      supabase.from('expense_types').select('id, name, icon, description, sort_order').eq('active', true).order('sort_order').order('name'),
      supabase.from('expense_sub_types').select('id, expense_type_id, name, extra_fields, active, sort_order').eq('active', true).order('sort_order').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
    ])
    setCategories(catR.data || [])
    setSubCategories(scR.data || [])
    setExpenseTypes(etR.data || [])
    setExpenseSubTypes(estR.data || [])
    var allDepts = dR.data || []
    var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'
    var userDeptIds = profile?.event_dept_ids || []
    setDepartments((isAdminRole || userDeptIds.length === 0) ? allDepts : allDepts.filter(function (d) { return userDeptIds.indexOf(d.id) !== -1 }))
    setVenues(vR.data || [])
    setSubDepartments(sdR.data || [])
    setLoading(false)
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, contract_type, venue_name, session, client_name')
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    setEvents(rows)
    setEventsLoading(false)
    if (rows.length === 1) setEventId(String(rows[0].id))
    else if (!rows.some(function (r) { return String(r.id) === eventId })) setEventId('')
  }

  function toggleFunction(val) {
    setIsFunction(val)
    if (!val) { setEventId(''); setEventDate(''); setEvents([]) }
  }

  // ── Lookup data loader ──
  async function ensureLookupData(source) {
    if (!source || lookupCache[source]) return
    var items = []
    if (source === 'vendors') {
      var { data } = await supabase.from('purchase_order_items')
        .select('vendor_name').not('vendor_name', 'is', null).order('vendor_name')
      var seen = {}
      ;(data || []).forEach(function (r) {
        if (r.vendor_name && !seen[r.vendor_name]) {
          seen[r.vendor_name] = true
          items.push({ label: r.vendor_name, value: r.vendor_name })
        }
      })
    } else if (source === 'staff') {
      var { data: pData } = await supabase.from('profiles').select('id, name').order('name')
      items = (pData || []).map(function (p) { return { label: p.name || '—', value: String(p.id) } })
    } else if (source === 'categories') {
      var { data: cData } = await supabase.from('categories').select('id, name').order('name')
      items = (cData || []).map(function (c) { return { label: c.name, value: String(c.id) } })
    } else if (source === 'venues') {
      var { data: vData } = await supabase.from('venues').select('id, code, name').eq('active', true).order('name')
      items = (vData || []).map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })
    }
    setLookupCache(function (prev) {
      var next = Object.assign({}, prev)
      next[source] = items
      return next
    })
  }

  // ── Entry helpers ──
  function updateEntry(idx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      var copy = Object.assign({}, e)
      copy[field] = val
      if (field === 'department') { copy.subDeptId = ''; copy.venueIdTop = ''; copy.categoryId = '' }
      if (field === 'subDeptId') copy.categoryId = ''
      if (field === 'expenseTypeId') { copy.expenseSubTypeId = ''; copy.fieldValues = {} }
      if (field === 'expenseSubTypeId') { copy.fieldValues = {} }
      return copy
    })
    setEntries(updated)

    // Pre-fetch lookup data when sub-type changes
    if (field === 'expenseSubTypeId' && val) {
      var st = expenseSubTypes.find(function (s) { return String(s.id) === val })
      if (st && st.extra_fields) {
        st.extra_fields.forEach(function (f) {
          if (f.type === 'lookup' && f.source) ensureLookupData(f.source)
        })
      }
    }
  }

  function addEntry() { setEntries(entries.concat([makeEntry()])) }

  function removeEntry(idx) {
    if (entries.length <= 1) return
    setEntries(entries.filter(function (_, i) { return i !== idx }))
  }

  function handleReceipt(idx, file) {
    if (!file) return
    var preview = URL.createObjectURL(file)
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.receiptPreview) URL.revokeObjectURL(e.receiptPreview)
      return Object.assign({}, e, { receiptFile: file, receiptPreview: preview })
    })
    setEntries(updated)
  }

  function removeReceipt(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.receiptPreview) URL.revokeObjectURL(e.receiptPreview)
      return Object.assign({}, e, { receiptFile: null, receiptPreview: '' })
    })
    setEntries(updated)
  }

  var mediaRecorders = useRef({})

  function startRecording(idx) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []
      var recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorders.current[idx] = { recorder: recorder, stream: stream }
      recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop() })
        var blob = new Blob(chunks, { type: 'audio/webm' })
        var url = URL.createObjectURL(blob)
        var updated = entries.map(function (e, i) {
          if (i !== idx) return e
          if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
          return Object.assign({}, e, { audioBlob: blob, audioUrl: url, recording: false, receiptFile: null, receiptPreview: '' })
        })
        setEntries(updated)
        delete mediaRecorders.current[idx]
      }
      var updated = entries.map(function (e, i) {
        if (i !== idx) return e
        return Object.assign({}, e, { recording: true })
      })
      setEntries(updated)
      recorder.start()
      setTimeout(function () { stopRecording(idx) }, 30000)
    }).catch(function () { setError('Microphone access denied') })
  }

  function stopRecording(idx) {
    var mr = mediaRecorders.current[idx]
    if (mr && mr.recorder.state === 'recording') mr.recorder.stop()
  }

  function removeAudio(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
      return Object.assign({}, e, { audioBlob: null, audioUrl: '', recording: false })
    })
    setEntries(updated)
  }

  function duplicateEntry(idx) {
    var src = entries[idx]
    var dup = Object.assign({}, src, {
      _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      receiptFile: null, receiptPreview: '', audioBlob: null, audioUrl: '', recording: false,
      fieldValues: Object.assign({}, src.fieldValues),
      allocations: src.allocations.map(function (a) { return Object.assign({}, a) })
    })
    var updated = entries.slice()
    updated.splice(idx + 1, 0, dup)
    setEntries(updated)
  }

  // ── Allocation helpers ──
  function updateAllocation(entryIdx, allocIdx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var copy = Object.assign({}, e)
      copy.allocations = e.allocations.map(function (a, j) {
        if (j !== allocIdx) return a
        var ac = Object.assign({}, a)
        ac[field] = val
        return ac
      })
      return copy
    })
    setEntries(updated)
  }

  function addAllocation(entryIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      return Object.assign({}, e, { allocations: e.allocations.concat([makeAllocation()]) })
    })
    setEntries(updated)
  }

  function removeAllocation(entryIdx, allocIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      if (e.allocations.length <= 1) return e
      return Object.assign({}, e, { allocations: e.allocations.filter(function (_, j) { return j !== allocIdx }) })
    })
    setEntries(updated)
  }

  // ── Sub-type field helpers ──
  function getSubTypeFields(subTypeId) {
    var st = expenseSubTypes.find(function (s) { return s.id === Number(subTypeId) })
    if (!st || !st.extra_fields) return []
    return st.extra_fields
  }

  function updateFieldValue(entryIdx, key, val) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var fv = Object.assign({}, e.fieldValues)
      fv[key] = val
      return Object.assign({}, e, { fieldValues: fv })
    })
    setEntries(updated)
  }

  function renderDynamicField(field, value, onChange) {
    var cls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400'
    var sty = { fontSize: '16px' }

    if (field.type === 'lookup') {
      var items = lookupCache[field.source] || []
      return (
        <SearchDropdown
          key={field.key}
          label={field.label + (field.required ? ' *' : '')}
          items={items}
          value={value || ''}
          onChange={onChange}
          placeholder={'Select ' + field.label + '...'}
        />
      )
    }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <select value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls + ' bg-white'} style={sty}>
            <option value="">Select...</option>
            {(field.options || []).map(function (opt) { return <option key={opt} value={opt}>{opt}</option> })}
          </select>
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={value || ''} onChange={function (e) { onChange(e.target.value) }} rows={2} className={cls + ' resize-none'} style={sty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls} style={sty} />
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
      </div>
    )
  }

  // ── Validation ──
  function validateEntries() {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.categoryId) return 'Entry ' + (i + 1) + ': Select a category'
      if (!e.expenseTypeId) return 'Entry ' + (i + 1) + ': Select expense type'
      if (!e.expenseSubTypeId) return 'Entry ' + (i + 1) + ': Select sub-type'
      if (!e.description.trim()) return 'Entry ' + (i + 1) + ': Add description'
      if (!e.amount || Number(e.amount) <= 0) return 'Entry ' + (i + 1) + ': Enter valid amount'
      if (!e.expenseDate) return 'Entry ' + (i + 1) + ': Select date'
      var fields = getSubTypeFields(e.expenseSubTypeId)
      for (var f = 0; f < fields.length; f++) {
        if (fields[f].required && !(e.fieldValues[fields[f].key] || '').toString().trim()) {
          return 'Entry ' + (i + 1) + ': ' + fields[f].label + ' is required'
        }
      }
      if (!e.receiptFile && !e.audioBlob) return 'Entry ' + (i + 1) + ': Receipt image or voice note is required'
    }
    return null
  }

  // ── Submit ──
  async function handleSubmit() {
    if (saving) return
    setError('')
    setSuccess('')
    var valErr = validateEntries()
    if (valErr) { setError(valErr); return }

    setSaving(true)
    var submitted = 0
    var failed = 0

    try {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        var paise = Math.round(Number(e.amount) * 100)

        try {
          var payload = {
            user_id: profile.id,
            category_id: Number(e.categoryId),
            sub_category_id: null,
            expense_type_id: Number(e.expenseTypeId),
            expense_sub_type_id: Number(e.expenseSubTypeId),
            amount_paise: paise,
            tax_paise: e.taxAmount ? Math.round(Number(e.taxAmount) * 100) : 0,
            description: e.description.trim(),
            expense_date: e.expenseDate,
            status: 'recorded',
            event_id: eventId ? Number(eventId) : null,
            metadata: e.fieldValues,
            vendor_name: e.fieldValues.vendor_name || null,
            travel_from: e.fieldValues.travel_from || null,
            travel_to: e.fieldValues.travel_to || null,
            travel_mode: e.fieldValues.travel_mode || null,
          }

          var { data: exp, error: insErr } = await supabase.from('expenses').insert(payload).select('id').single()
          if (insErr || !exp) { failed++; continue }

          if (e.receiptFile) {
            var ext = e.receiptFile.name.split('.').pop()
            var rPath = profile.id + '/' + exp.id + '_' + Date.now() + '.' + ext
            var { error: upErr } = await supabase.storage.from('receipts').upload(rPath, e.receiptFile, { upsert: true })
            if (!upErr) await supabase.from('expenses').update({ receipt_path: rPath }).eq('id', exp.id)
          }

          if (!e.receiptFile && e.audioBlob) {
            var aPath = profile.id + '/' + exp.id + '_voice_' + Date.now() + '.webm'
            var { error: aErr } = await supabase.storage.from('receipts').upload(aPath, e.audioBlob, { contentType: 'audio/webm', upsert: true })
            if (!aErr) await supabase.from('expenses').update({ receipt_path: aPath }).eq('id', exp.id)
          }

          var deptName = e.department ? (departments.find(function (d) { return String(d.id) === e.department }) || {}).name || '' : ''
          var allocRows = e.allocations
            .filter(function (a) { return a.venueId || a.departmentId })
            .map(function (a) {
              return {
                expense_id: exp.id,
                department: a.departmentId ? (departments.find(function (d) { return String(d.id) === a.departmentId }) || {}).name || deptName : deptName,
                department_id: a.departmentId ? Number(a.departmentId) : null,
                sub_department_id: a.subDepartmentId ? Number(a.subDepartmentId) : null,
                venue_id: a.venueId ? Number(a.venueId) : null,
                amount_paise: a.amountPaise ? Math.round(Number(a.amountPaise) * 100) : 0
              }
            })
          if (allocRows.length > 0) await supabase.from('expense_allocations').insert(allocRows)

          try {
            await supabase.rpc('wallet_self_debit', {
              p_amount_paise: paise,
              p_description: 'Expense: ' + e.description.trim().slice(0, 50),
              p_ref_type: 'expense',
              p_ref_id: String(exp.id),
            })
          } catch (_) {}

          try { await logActivity('EXPENSE_SUBMIT', (paise / 100) + ' pts | ' + e.description.trim().slice(0, 50)) } catch (_) {}
          submitted++
        } catch (_) { failed++ }
      }
    } finally { setSaving(false) }

    if (failed > 0 && submitted > 0) {
      setError(failed + ' failed, ' + submitted + ' submitted')
    } else if (failed > 0) {
      setError('All ' + failed + ' entries failed to submit')
    } else {
      setSuccess(submitted + ' expense' + (submitted > 1 ? 's' : '') + ' submitted')
      setTimeout(function () { setEntries([makeEntry()]); if (onDone) onDone() }, 1500)
    }
  }

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      {success && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{success}</div>}

      {/* For a Function? */}
      <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">For a Function?</label>
          <button type="button" onClick={function () { toggleFunction(!isFunction) }} className="flex items-center gap-2">
            <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-500" : "bg-gray-300")}>
              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
            </div>
          </button>
        </div>
        {isFunction && (
          <div className="space-y-2">
            <EventDatePicker label="Function Date" value={eventDate}
              onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
            {eventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
            {eventDate && !eventsLoading && events.length === 0 && <p className="text-xs text-gray-400">No events on this date</p>}
            {events.length > 0 && (
              <select value={eventId} onChange={function (e) { setEventId(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                <option value="">Select event...</option>
                {events.map(function (ev) { return <option key={ev.id} value={String(ev.id)}>{ev.event_name + ' · ' + (ev.venue_name || '')}</option> })}
              </select>
            )}
            {(function () {
              var sel = eventId ? events.find(function (ev) { return String(ev.id) === eventId }) : null
              if (!sel) return null
              return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-bold text-indigo-700">{sel.event_name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-indigo-600">
                    {sel.function_date && <span>📅 {sel.function_date}</span>}
                    {sel.contract_type && <span>🎉 {sel.contract_type}</span>}
                    {sel.venue_name && <span>📍 {sel.venue_name}</span>}
                    {sel.session && <span>🕐 {sel.session}</span>}
                    {sel.client_name && <span>👤 {sel.client_name}</span>}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {entries.map(function (entry, idx) {
        var subTypesForType = expenseSubTypes.filter(function (st) { return st.expense_type_id === Number(entry.expenseTypeId) })
        var subTypeFields = entry.expenseSubTypeId ? getSubTypeFields(entry.expenseSubTypeId) : []

        return (
          <div key={entry._key} className="border border-amber-200 rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200">
              <span className="font-semibold text-amber-900 text-sm">{'Expense #' + (idx + 1)}</span>
              <div className="flex gap-1">
                <button type="button" onClick={function () { duplicateEntry(idx) }}
                  className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200" title="Duplicate">📋</button>
                {entries.length > 1 && (
                  <button type="button" onClick={function () { removeEntry(idx) }}
                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200" title="Remove">✕</button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Department */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                <select value={entry.department} onChange={function (e) { updateEntry(idx, 'department', e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                  <option value="">Select department...</option>
                  {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                </select>
              </div>

              {/* Sub-department or Venue */}
              {entry.department && (function () {
                var selDept = departments.find(function (d) { return String(d.id) === entry.department })
                var isVenueDept = selDept && selDept.name.toLowerCase().indexOf('venue') === 0
                if (isVenueDept) {
                  return (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Venue</label>
                      <select value={entry.venueIdTop} onChange={function (e) { updateEntry(idx, 'venueIdTop', e.target.value) }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                        <option value="">Select venue...</option>
                        {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code + ' — ' + v.name}</option> })}
                      </select>
                    </div>
                  )
                }
                var deptSubs = subDepartments.filter(function (sd) { return sd.department_id === Number(entry.department) })
                if (deptSubs.length === 0) return null
                return (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Sub-Department</label>
                    <select value={entry.subDeptId} onChange={function (e) { updateEntry(idx, 'subDeptId', e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                      <option value="">Select sub-department...</option>
                      {deptSubs.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                    </select>
                  </div>
                )
              })()}

              {/* Category */}
              {(function () {
                var catList = entry.subDeptId
                  ? filterUserCategories(categories, profile).filter(function (c) { return c.sub_department_id === Number(entry.subDeptId) })
                  : filterUserCategories(categories, profile)
                return (
                  <SearchDropdown label="Category" items={catList.map(function (c) { return { label: c.name, value: String(c.id) } })}
                    value={entry.categoryId} onChange={function (val) { updateEntry(idx, 'categoryId', val) }} placeholder="Select category..." />
                )
              })()}

              {/* Expense Type */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expense Type</label>
                <select value={entry.expenseTypeId}
                  onChange={function (e) { updateEntry(idx, 'expenseTypeId', e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                  <option value="">Select type...</option>
                  {expenseTypes.map(function (et) {
                    return <option key={et.id} value={String(et.id)}>{(et.icon ? et.icon + ' ' : '') + et.name}</option>
                  })}
                </select>
              </div>

              {/* Sub-Type */}
              {entry.expenseTypeId && subTypesForType.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sub-Type</label>
                  <select value={entry.expenseSubTypeId}
                    onChange={function (e) { updateEntry(idx, 'expenseSubTypeId', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                    <option value="">Select sub-type...</option>
                    {subTypesForType.map(function (st) {
                      return <option key={st.id} value={String(st.id)}>{st.name}</option>
                    })}
                  </select>
                </div>
              )}

              {/* Auto-select if only 1 sub-type */}
              {entry.expenseTypeId && subTypesForType.length === 1 && !entry.expenseSubTypeId && (function () {
                setTimeout(function () { updateEntry(idx, 'expenseSubTypeId', String(subTypesForType[0].id)) }, 0)
                return null
              })()}

              {/* No sub-types warning */}
              {entry.expenseTypeId && subTypesForType.length === 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No sub-types configured for this type. Contact admin.</p>
              )}

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Description</label>
                  <button type="button"
                    onClick={function () {
                      if (voice.listening) { voice.stop() }
                      else { voice.start(function (text) { updateEntry(idx, 'description', entry.description + (entry.description ? ' ' : '') + text) }) }
                    }}
                    className={"px-2 py-0.5 rounded text-xs font-medium transition-all " +
                      (voice.listening ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}
                  >{voice.listening ? '⏹ Stop' : '🎤 Dictate'}</button>
                </div>
                <textarea value={entry.description} onChange={function (e) { updateEntry(idx, 'description', e.target.value) }}
                  placeholder="What was this expense for..." rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 resize-none" />
              </div>

              {/* Dynamic fields from sub-type */}
              {subTypeFields.map(function (field) {
                return renderDynamicField(field, entry.fieldValues[field.key] || '', function (val) {
                  updateFieldValue(idx, field.key, val)
                })
              })}

              {/* Amount + Tax + Date row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts)</label>
                  <input type="number" inputMode="numeric" value={entry.amount}
                    onChange={function (e) { updateEntry(idx, 'amount', e.target.value) }}
                    placeholder="0" min="1"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tax (pts)</label>
                  <input type="number" inputMode="numeric" value={entry.taxAmount}
                    onChange={function (e) { updateEntry(idx, 'taxAmount', e.target.value) }}
                    placeholder="0" min="0"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={entry.expenseDate}
                    onChange={function (e) { updateEntry(idx, 'expenseDate', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300" />
                </div>
              </div>

              {/* Allocations */}
              <div className="border border-gray-100 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Allocations</label>
                  <button type="button" onClick={function () { addAllocation(idx) }}
                    className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium">+ Row</button>
                </div>
                <div className="space-y-2">
                  {entry.allocations.map(function (alloc, aIdx) {
                    var allocSubDepts = alloc.departmentId ? subDepartments.filter(function (sd) { return sd.department_id === Number(alloc.departmentId) }) : []
                    var allocDept = alloc.departmentId ? departments.find(function (d) { return String(d.id) === alloc.departmentId }) : null
                    var allocIsVenue = allocDept && allocDept.name.toLowerCase().indexOf('venue') === 0
                    return (
                      <div key={aIdx} className="flex gap-2 items-start">
                        <div className="flex-1 space-y-1.5">
                          <div className="grid grid-cols-2 gap-2">
                            <select value={alloc.departmentId}
                              onChange={function (e) { setEntries(function (prev) { return prev.map(function (en, i) { if (i !== idx) return en; var copy = Object.assign({}, en); copy.allocations = en.allocations.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { departmentId: e.target.value, subDepartmentId: '', venueId: '' }) : a }); return copy }) }) }}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                              <option value="">Dept</option>
                              {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                            </select>
                            {allocIsVenue ? (
                              <select value={alloc.venueId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Venue</option>
                                {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code + ' — ' + v.name}</option> })}
                              </select>
                            ) : allocSubDepts.length > 0 ? (
                              <select value={alloc.subDepartmentId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'subDepartmentId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Sub-dept</option>
                                {allocSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                              </select>
                            ) : <div />}
                          </div>
                          <div className={"grid gap-2 " + (allocIsVenue ? "" : "grid-cols-2")}>
                            {!allocIsVenue && (
                              <select value={alloc.venueId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Venue</option>
                                {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code}</option> })}
                              </select>
                            )}
                            <input type="number" inputMode="numeric" value={alloc.amountPaise}
                              onChange={function (e) { updateAllocation(idx, aIdx, 'amountPaise', e.target.value) }}
                              placeholder="Amt" className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                          </div>
                        </div>
                        {entry.allocations.length > 1 && (
                          <button type="button" onClick={function () { removeAllocation(idx, aIdx) }}
                            className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Receipt */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Receipt <span className="text-red-500">*</span></label>
                {entry.receiptPreview ? (
                  <div className="relative inline-block">
                    <img src={entry.receiptPreview} alt="Receipt"
                      onClick={function () { setZoomImg(entry.receiptPreview) }}
                      className="h-32 rounded-lg border border-gray-200 object-cover cursor-pointer active:opacity-80" />
                    <p className="text-[10px] text-gray-400 text-center mt-1">Tap to enlarge</p>
                    <button type="button" onClick={function () { removeReceipt(idx) }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600">✕</button>
                  </div>
                ) : entry.audioUrl ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <audio src={entry.audioUrl} controls className="flex-1 h-8" />
                    <button type="button" onClick={function () { removeAudio(idx) }}
                      className="w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600 flex-shrink-0">✕</button>
                  </div>
                ) : entry.recording ? (
                  <button type="button" onClick={function () { stopRecording(idx) }}
                    className="w-full py-3 rounded-lg bg-red-500 text-white text-sm font-medium animate-pulse flex items-center justify-center gap-2">
                    <span className="w-2.5 h-2.5 bg-white rounded-full" />Recording... Tap to stop
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📁</span><span>Gallery</span>
                      <input type="file" accept="image/*,.pdf" className="hidden"
                        onChange={function (e) { handleReceipt(idx, e.target.files?.[0] || null); e.target.value = '' }} />
                    </label>
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📷</span><span>Camera</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={function (e) { handleReceipt(idx, e.target.files?.[0] || null); e.target.value = '' }} />
                    </label>
                    <button type="button" onClick={function () { startRecording(idx) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                      <span>🎙</span><span>Voice</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Add entry + Submit bar */}
      <div className="flex gap-3">
        <button type="button" onClick={addEntry}
          className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-700 font-medium text-sm hover:bg-amber-50 transition-colors">
          + Add Another Expense
        </button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className={'flex-1 py-2.5 rounded-xl font-semibold text-sm text-white shadow-sm transition-all ' +
            (saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 active:scale-[0.98]')}>
          {saving ? 'Submitting...' : 'Submit ' + entries.length + ' Expense' + (entries.length > 1 ? 's' : '')}
        </button>
      </div>

      {zoomImg && (
        <div onClick={function () { setZoomImg('') }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" style={{ margin: 0 }}>
          <button onClick={function () { setZoomImg('') }}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 text-white rounded-full text-xl flex items-center justify-center hover:bg-white/30">✕</button>
          <img src={zoomImg} alt="Receipt" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  )
}

export default ExpenseForm
