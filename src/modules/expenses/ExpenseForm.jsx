import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import SearchDropdown from '../../components/ui/SearchDropdown'
import AllocationRows from '../../components/ui/AllocationRows'
import ysFixWebmDuration from 'fix-webm-duration'
import { useVoice } from '../../hooks/useVoice'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { compressImage } from '../../lib/imageCompress'
import VoiceInput from '../../components/ui/VoiceInput'
import Icon from '../../components/ui/Icon'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { deptInk, deptOrder } from '../../lib/ui'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

// One evening at one venue is booked as up to four contracts — one per
// department — and every one of them carries the same client, venue and
// session. Listed flat, or grouped under department headers, the picker repeats
// "ENGAGEMENT — Rao Yashvardhan · Ambria Pushpanjali" once per department and
// the operator scrolls past four near-identical lines to find the right one.
//
// So the picker lists each function once and hangs its contracts off it as
// department chips — the function reads once, and the departments read as
// colours on a single row.
//
// Not a silent merge: event_id lands on the expense row, so which contract the
// cost is tagged to has to stay a deliberate tap.
function funcKeyOf(r) {
  return [r.client_name || '', r.venue_name || '', r.session || '', (r.event_name || '').trim().toLowerCase()].join('|')
}

function groupFunctions(rows) {
  var byKey = {}
  var order = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    var k = funcKeyOf(r)
    if (!byKey[k]) {
      byKey[k] = {
        key: k,
        label: r.event_name + (r.client_name ? ' — ' + r.client_name : '') + ' · ' + (r.venue_name || '') + (r.session ? ' · ' + r.session : ''),
        contracts: [],
      }
      order.push(k)
    }
    byKey[k].contracts.push(r)
  }
  order.forEach(function (k) {
    byKey[k].contracts.sort(function (a, b) { return deptOrder(a.department) - deptOrder(b.department) })
  })
  return order.map(function (k) { return byKey[k] })
}

function makeEntry() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    expenseTypeId: '',
    expenseSubTypeId: '',
    description: '',
    amount: '',
    taxAmount: '',
    expenseDate: new Date().toISOString().split('T')[0],
    fieldValues: {},
    allocations: [{ departmentId: '', venueId: '', expenseTypeId: '', expenseSubTypeId: '', amountRupees: '', remarks: '' }],
    showAllocations: false,
    receiptFiles: [],
    receiptPreviews: [],
    audioBlob: null,
    audioUrl: '',
    recording: false,
    isItemPurchase: false,
    items: [makeItem()],
    paymentCreditRupees: '',  // vendor-credit total (rupees). Cash = amount - credit.
    payWithCash: false,       // cash leg toggle (only when credit > 0)
    payWithBank: false,       // bank leg toggle (only when credit > 0)
    paymentCreditCashRupees: '', // cash portion of credit total
    paymentCreditBankRupees: '', // bank portion of credit total
    cashDueDate: '',          // required when payWithCash + cash portion > 0
    bankDueDate: ''           // required when payWithBank + bank portion > 0
  }
}

function makeAllocation() {
  return { departmentId: '', venueId: '', expenseTypeId: '', expenseSubTypeId: '', amountRupees: '', remarks: '' }
}

// ── Auto-save draft (new-entry only) ──────────────────────────
// Persists typed fields to localStorage across reloads. File/Blob objects
// (receipts, voice notes) can't serialize — saved as metadata so the UI
// can prompt the user to re-attach. One draft per user (overwrite on save).
var DRAFT_KEY_PREFIX = 'ambria_expense_draft_'
var DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
var DRAFT_DEBOUNCE_MS = 800

function serializeDraftEntry(e) {
  return Object.assign({}, e, {
    receiptFiles: [],
    receiptPreviews: [],
    receiptFilesMeta: (e.receiptFiles || []).map(function (f) {
      return { name: f.name || 'file', size: f.size || 0, type: f.type || '' }
    }),
    audioBlob: null,
    audioUrl: '',
    recording: false,
    audioBlobMeta: e.audioBlob ? { size: e.audioBlob.size || 0, type: e.audioBlob.type || 'audio/webm' } : null
  })
}

function deserializeDraftEntry(e) {
  return Object.assign({}, e, {
    receiptFiles: [],
    receiptPreviews: [],
    audioBlob: null,
    audioUrl: '',
    recording: false,
    receiptFilesMeta: e.receiptFilesMeta || [],
    audioBlobMeta: e.audioBlobMeta || null
  })
}

function isEmptyDraftEntry(e) {
  if (!e) return true
  if (e.description && e.description.trim()) return false
  if (e.amount && String(e.amount).trim() && String(e.amount).trim() !== '0') return false
  if (e.expenseTypeId || e.expenseSubTypeId) return false
  var fv = e.fieldValues || {}
  for (var k in fv) { if (fv[k]) return false }
  if ((e.receiptFilesMeta || []).length > 0) return false
  if (e.audioBlobMeta) return false
  return true
}

function formatDraftAge(ts) {
  if (!ts) return ''
  var s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return s + 's ago'
  var m = Math.floor(s / 60)
  if (m < 60) return m + 'm ago'
  var h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.floor(h / 24) + 'd ago'
}



// Extract dominant root token from a name for cross-dept sub-type matching
// e.g. "flr-food" → "food", "fbr-food" → "food"
function extractRootToken(name) {
  if (!name) return ''
  var tokens = String(name).toLowerCase().split(/[-_\s\/\.]+/).filter(function (t) { return t.length >= 3 })
  if (tokens.length === 0) return String(name).toLowerCase()
  tokens.sort(function (a, b) { return b.length - a.length })
  return tokens[0]
}

function makeItem() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemMode: 'existing',
    itemQuery: '',
    itemMatchedId: null,
    itemMatchedSource: null,
    itemMatchedCategoryId: null,
    itemQty: '',
    itemUnit: 'Pieces',
    itemNotes: '',
    itemRate: ''
  }
}

function isItemComplete(im) {
  return !!(im && String(im.itemQuery || '').trim() && Number(im.itemQty) > 0 && Number(im.itemRate) > 0)
}

function hydrateEntry(exp) {
  var meta = (exp.metadata && typeof exp.metadata === 'object') ? Object.assign({}, exp.metadata) : {}
  if (!meta.vendor_name && exp.vendor_name) meta.vendor_name = exp.vendor_name
  if (!meta.travel_from && exp.travel_from) meta.travel_from = exp.travel_from
  if (!meta.travel_to && exp.travel_to) meta.travel_to = exp.travel_to
  if (!meta.travel_mode && exp.travel_mode) meta.travel_mode = exp.travel_mode

  var allocs = (exp.expense_allocations || []).map(function (a) {
    return {
      _origId: a.id,
      departmentId: a.department_id ? String(a.department_id) : '',
      venueId: a.venue_id ? String(a.venue_id) : '',
      expenseTypeId: a.expense_type_id ? String(a.expense_type_id) : '',
      expenseSubTypeId: a.expense_sub_type_id ? String(a.expense_sub_type_id) : '',
      amountRupees: a.amount_paise != null ? String(a.amount_paise / 100) : '',
      remarks: a.remarks || ''
    }
  })
  if (allocs.length === 0) {
    allocs = [{ departmentId: '', venueId: '', expenseTypeId: '', expenseSubTypeId: '', amountRupees: '', remarks: '' }]
  }

  var itemsFromMeta = Array.isArray(meta.item_receipts) ? meta.item_receipts.map(function (it, i) {
    return {
      _key: Date.now() + '_i' + i + '_' + Math.random().toString(36).slice(2, 6),
      itemMode: it.matched_source === 'new' ? 'new' : 'existing',
      itemQuery: it.query || '',
      itemMatchedId: it.matched_item_id || null,
      itemMatchedSource: it.matched_source || null,
      itemMatchedCategoryId: it.matched_category_id || null,
      itemQty: it.qty != null ? String(it.qty) : '',
      itemUnit: it.unit || 'Pieces',
      itemNotes: it.notes || '',
      itemRate: it.rate_paise != null ? String(it.rate_paise / 100) : ''
    }
  }) : []

  var isItemP = !!exp.item_receipt_status || itemsFromMeta.length > 0

  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    expenseTypeId: exp.expense_type_id ? String(exp.expense_type_id) : '',
    expenseSubTypeId: exp.expense_sub_type_id ? String(exp.expense_sub_type_id) : '',
    description: exp.description || '',
    amount: exp.amount_paise != null ? String((exp.amount_paise - (exp.tax_paise || 0)) / 100) : '',
    taxAmount: exp.tax_paise ? String(exp.tax_paise / 100) : '',
    expenseDate: exp.expense_date || new Date().toISOString().split('T')[0],
    fieldValues: meta,
    allocations: allocs,
    receiptFiles: [],
    receiptPreviews: [],
    audioBlob: null,
    audioUrl: '',
    recording: false,
    isItemPurchase: isItemP,
    items: isItemP && itemsFromMeta.length > 0 ? itemsFromMeta : [makeItem()],
    showAllocations: allocs.length > 1 || allocs.some(function (a) { return !!a.venueId }),
    paymentCreditRupees: exp.payment_credit_paise ? String(exp.payment_credit_paise / 100) : '',
    payWithCash: (exp.payment_credit_cash_paise || 0) > 0,
    payWithBank: (exp.payment_credit_bank_paise || 0) > 0,
    paymentCreditCashRupees: exp.payment_credit_cash_paise ? String(exp.payment_credit_cash_paise / 100) : '',
    paymentCreditBankRupees: exp.payment_credit_bank_paise ? String(exp.payment_credit_bank_paise / 100) : '',
    cashDueDate: exp.cash_due_date || '',
    bankDueDate: exp.bank_due_date || ''
  }
}

function ExpenseForm({ profile, walletBalance, editExp, onDone }) {
  var isEditing = !!editExp
  var refData = useReferenceData()
  var expenseTypes = refData.expenseTypes.filter(function (t) { return t.active })
  var expenseSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active })
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [itemCategories, setItemCategories] = useState([])
  var [loading, setLoading] = useState(true)
  var [lookupCache, setLookupCache] = useState({})

  var [entries, setEntries] = useState(function () { return [editExp ? hydrateEntry(editExp) : makeEntry()] })
  var [saving, setSaving] = useState(false)
  // `saving` (React state) doesn't close the window between two rapid clicks landing in
  // the same tick and the next re-render — a plain ref mutation is synchronous and closes
  // it, guarding against a fast double-tap submitting the same entries twice.
  var submitLockRef = useRef(false)
  var [isFunction, setIsFunction] = useState(!!(editExp && editExp.event_id))
  var [eventDate, setEventDate] = useState(editExp && editExp.event_id ? (editExp.expense_date || '') : '')
  var [eventId, setEventId] = useState(editExp && editExp.event_id ? String(editExp.event_id) : '')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var voice = useVoice()
  var [error, setError] = useState('')
  var [success, setSuccess] = useState('')
  var [zoomImg, setZoomImg] = useState('')
  var [itemSearchKey, setItemSearchKey] = useState('')
  var [itemMatches, setItemMatches] = useState([])
  var itemSearchTimer = useRef(null)
  var [existingReceipts, setExistingReceipts] = useState(function () {
    if (!editExp) return []
    if (editExp.receipt_paths && editExp.receipt_paths.length > 0) return editExp.receipt_paths.slice()
    if (editExp.receipt_path) return [editExp.receipt_path]
    return []
  })
  var [removedReceipts, setRemovedReceipts] = useState([])

  // Draft (new-entry only) — restore banner + debounced save + save-indicator
  var [draftRestorable, setDraftRestorable] = useState(null)
  var [draftSavedAt, setDraftSavedAt] = useState(null)
  var [draftTick, setDraftTick] = useState(0)  // forces "Xs ago" refresh
  var draftSaveTimer = useRef(null)
  // Scroll target for the submit-failure card.
  var errorRef = useRef(null)
  var draftKey = profile ? DRAFT_KEY_PREFIX + profile.id : null

  useEffect(function () { loadRefData(); ensureLookupData('vendors') }, [])

  useEffect(function () {
    if (isEditing && editExp && editExp.event_id && editExp.expense_date) {
      loadEventsByDate(editExp.expense_date)
    }
  }, [])

  // ─── Draft: check localStorage on mount ───
  useEffect(function () {
    if (isEditing || !draftKey) return
    try {
      var raw = localStorage.getItem(draftKey)
      if (!raw) return
      var parsed = JSON.parse(raw)
      if (!parsed || !parsed.savedAt) return
      if (Date.now() - parsed.savedAt > DRAFT_EXPIRY_MS) { localStorage.removeItem(draftKey); return }
      if (!parsed.entries || parsed.entries.length === 0) return

      if (parsed.entries.every(isEmptyDraftEntry)) { localStorage.removeItem(draftKey); return }
      setDraftRestorable(parsed)
    } catch (_) {}
  }, [])

  // ─── Draft: debounced auto-save on changes ───
  useEffect(function () {
    if (isEditing || !draftKey || saving) return
    if (draftRestorable) return  // don't clobber a pending restore with the blank default
    if (!entries || entries.every(isEmptyDraftEntry)) return
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    draftSaveTimer.current = setTimeout(function () {
      try {
        var payload = {
          savedAt: Date.now(),
          entries: entries.map(serializeDraftEntry),
          isFunction: isFunction,
          eventDate: eventDate,
          eventId: eventId
        }
        localStorage.setItem(draftKey, JSON.stringify(payload))
        setDraftSavedAt(payload.savedAt)
      } catch (_) {}
    }, DRAFT_DEBOUNCE_MS)
    return function () { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current) }
  }, [entries, isFunction, eventDate, eventId, isEditing, saving, draftRestorable])

  // ─── Draft: safety-save on tab close / navigate away ───
  useEffect(function () {
    if (isEditing || !draftKey) return
    function handler() {
      try {
        if (!entries || entries.every(isEmptyDraftEntry)) return
        var payload = {
          savedAt: Date.now(),
          entries: entries.map(serializeDraftEntry),
          isFunction: isFunction,
          eventDate: eventDate,
          eventId: eventId
        }
        localStorage.setItem(draftKey, JSON.stringify(payload))
      } catch (_) {}
    }
    window.addEventListener('beforeunload', handler)
    return function () { window.removeEventListener('beforeunload', handler) }
  }, [entries, isFunction, eventDate, eventId, isEditing])

  // ─── Draft: tick "Xs ago" indicator every 15s ───
  useEffect(function () {
    if (!draftSavedAt) return
    var iv = setInterval(function () { setDraftTick(function (x) { return x + 1 }) }, 15000)
    return function () { clearInterval(iv) }
  }, [draftSavedAt])

  function restoreDraft() {
    if (!draftRestorable) return
    try {
      setEntries((draftRestorable.entries || []).map(deserializeDraftEntry))
      if (draftRestorable.isFunction != null) setIsFunction(!!draftRestorable.isFunction)
      if (draftRestorable.eventDate) { setEventDate(draftRestorable.eventDate); loadEventsByDate(draftRestorable.eventDate) }
      if (draftRestorable.eventId) setEventId(draftRestorable.eventId)
      setDraftSavedAt(draftRestorable.savedAt)
    } catch (_) {}
    setDraftRestorable(null)
  }

  function discardDraft() {
    try { if (draftKey) localStorage.removeItem(draftKey) } catch (_) {}
    setDraftRestorable(null)
    setDraftSavedAt(null)
  }

  // The "clear" link sits one tap away from destroying everything typed so far,
  // with no undo. The restore banner's "Start fresh" is already a deliberate
  // choice between two buttons, so only this one asks.
  function confirmDiscardDraft() {
    if (!window.confirm('Clear the saved draft? Anything typed but not submitted will be lost.')) return
    discardDraft()
  }

  function clearDraftAfterSubmit() {
    try { if (draftKey) localStorage.removeItem(draftKey) } catch (_) {}
    setDraftSavedAt(null)
  }

  async function loadRefData() {
    var [dR, sdR, cR] = await Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false).order('name'),
      supabase.from('sub_departments').select('id, name, department_id, departments!inner(hide_from_lists)').eq('active', true).eq('departments.hide_from_lists', false).order('name'),
      supabase.from('categories').select('id, name').order('name'),
    ])
    var allDepts = dR.data || []
    var isAdminRole = hasPerm(profile?.permsNew, 'finance.expenses.approve')
    var userDeptIds = profile?.event_dept_ids || []
    setDepartments((isAdminRole || userDeptIds.length === 0) ? allDepts : allDepts.filter(function (d) { return userDeptIds.indexOf(d.id) !== -1 }))
    setSubDepartments(sdR.data || [])
    setItemCategories(cR.data || [])
    setLoading(false)
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, contract_type, venue_name, session, client_name, department, contract_no, created_user_name')
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
      // Store raw rows — filtered by parent sub-type at render time.
      var { data } = await supabase.from('vendors')
        .select('id, name, contact, phone, status, expense_type_ids, expense_sub_type_ids').eq('active', true).order('name')
      items = data || []
    } else if (source === 'job_departments') {
      // Fetches employees, not departments — filtered by field.allowed_dept_ids at render time (dept overlap).
      items = refData.employees.filter(function (e) { return ['probation', 'active', 'on_leave'].indexOf(e.status) !== -1 })
    } else if (source === 'staff') {
      var { data: pData } = await supabase.from('profiles').select('id, name').order('name')
      items = (pData || []).map(function (p) { return { label: p.name || '—', value: String(p.id) } })
    } else if (source === 'categories') {
      var { data: cData } = await supabase.from('categories').select('id, name').order('name')
      items = (cData || []).map(function (c) { return { label: c.name, value: String(c.id) } })
    } else if (source === 'venues') {
      items = venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })
    }
    setLookupCache(function (prev) {
      var next = Object.assign({}, prev)
      next[source] = items
      return next
    })
  }

  // ── Entry helpers ──
  function updateEntry(idx, field, val) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        var copy = Object.assign({}, e)
        copy[field] = val
        if (field === 'expenseTypeId') { copy.expenseSubTypeId = ''; copy.fieldValues = {} }
        if (field === 'expenseSubTypeId') { copy.fieldValues = {} }
        return copy
      })
    })

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

  function addEntry() {
    // Build off `prev` inside the updater (not the outer `entries` closure) — reading the
    // closure var here raced against very recent edits (e.g. an allocation row just filled
    // in) under React 18 batching, silently reverting them when both landed in the same tick.
    setEntries(function (prev) {
      var next = makeEntry()
      var last = prev[prev.length - 1]
      if (last && last.expenseDate) next.expenseDate = last.expenseDate
      // Fold everything already on screen. Four open expense cards is four
      // screens of scrolling to reach the one field you came here to type, and
      // the card you just asked for is the one at the bottom.
      return prev.map(function (e) { return Object.assign({}, e, { _collapsed: true }) }).concat([next])
    })
  }

  function removeEntry(idx) {
    setEntries(function (prev) {
      if (prev.length <= 1) return prev
      return prev.filter(function (_, i) { return i !== idx })
    })
  }

  async function addReceipts(idx, fileList) {
    if (!fileList || fileList.length === 0) return
    var raw = Array.from(fileList)
    var files = []
    for (var i = 0; i < raw.length; i++) {
      var f = await compressImage(raw[i], 100)
      files.push(f)
    }
    setEntries(function (prev) {
      return prev.map(function (e, ii) {
        if (ii !== idx) return e
        var newFiles = e.receiptFiles.concat(files)
        var newPreviews = e.receiptPreviews.concat(files.map(function (fl) { return URL.createObjectURL(fl) }))
        return Object.assign({}, e, { receiptFiles: newFiles, receiptPreviews: newPreviews })
      })
    })
  }

  function removeReceipt(idx, rIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        var url = e.receiptPreviews[rIdx]
        if (url) URL.revokeObjectURL(url)
        return Object.assign({}, e, {
          receiptFiles: e.receiptFiles.filter(function (_, j) { return j !== rIdx }),
          receiptPreviews: e.receiptPreviews.filter(function (_, j) { return j !== rIdx })
        })
      })
    })
  }

  var mediaRecorders = useRef({})

  function startRecording(idx) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []
      var recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      var startedAt = Date.now()
      mediaRecorders.current[idx] = { recorder: recorder, stream: stream, startedAt: startedAt }
      recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop() })
        var rawBlob = new Blob(chunks, { type: 'audio/webm' })
        var durationMs = Date.now() - startedAt
        // Patch the WebM header with actual duration so seek/playback works past ~3s
        ysFixWebmDuration(rawBlob, durationMs, { logger: false }).then(function (fixedBlob) {
          var blob = fixedBlob || rawBlob
          var url = URL.createObjectURL(blob)
          setEntries(function (prev) {
            return prev.map(function (e, i) {
              if (i !== idx) return e
              if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
              e.receiptPreviews.forEach(function (u) { URL.revokeObjectURL(u) })
              return Object.assign({}, e, { audioBlob: blob, audioUrl: url, recording: false, receiptFiles: [], receiptPreviews: [] })
            })
          })
          delete mediaRecorders.current[idx]
        }).catch(function () {
          // Fallback: use unpatched blob
          var url = URL.createObjectURL(rawBlob)
          setEntries(function (prev) {
            return prev.map(function (e, i) {
              if (i !== idx) return e
              if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
              e.receiptPreviews.forEach(function (u) { URL.revokeObjectURL(u) })
              return Object.assign({}, e, { audioBlob: rawBlob, audioUrl: url, recording: false, receiptFiles: [], receiptPreviews: [] })
            })
          })
          delete mediaRecorders.current[idx]
        })
      }
      setEntries(function (prev) {
        return prev.map(function (e, i) {
          if (i !== idx) return e
          return Object.assign({}, e, { recording: true })
        })
      })
      recorder.start()
      setTimeout(function () { stopRecording(idx) }, 30000)
    }).catch(function () { setError('Microphone access denied') })
  }

  function stopRecording(idx) {
    var mr = mediaRecorders.current[idx]
    if (mr && mr.recorder.state === 'recording') mr.recorder.stop()
  }

  function removeAudio(idx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
        return Object.assign({}, e, { audioBlob: null, audioUrl: '', recording: false })
      })
    })
  }

  // ── Item receipt helpers ──
  function toggleItemPurchase(idx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        var on = !e.isItemPurchase
        return Object.assign({}, e, {
          isItemPurchase: on,
          items: on ? (e.items && e.items.length > 0 ? e.items : [makeItem()]) : [makeItem()]
        })
      })
    })
    setItemMatches([])
    setItemSearchKey('')
  }

  function toggleShowAllocations(idx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        return Object.assign({}, e, { showAllocations: !e.showAllocations })
      })
    })
  }

  function computeItemsTotal(entry) {
    if (!entry || !entry.items) return 0
    var total = 0
    entry.items.forEach(function (it) {
      var qty = Number(it.itemQty) || 0
      var rate = Number(it.itemRate) || 0
      total += qty * rate
    })
    return total
  }

  function addItem(entryIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var newItems = e.items.concat([makeItem()])
        return Object.assign({}, e, { items: newItems, _editingItemIdx: newItems.length - 1 })
      })
    })
  }

  function removeItem(entryIdx, itemIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        // Item Select needs at least one row, so deleting the last one wipes it
        // back to blank rather than refusing. Refusing left the button hidden
        // and no way to clear a wrongly-filled item.
        if (e.items.length <= 1) {
          return Object.assign({}, e, { items: [makeItem()], _editingItemIdx: 0 })
        }
        // Same default as the render path, so deleting a row does not silently
        // collapse an item that was visibly open.
        var cur = e._editingItemIdx == null ? 0 : e._editingItemIdx
        var next = cur === itemIdx ? -1 : (cur > itemIdx ? cur - 1 : cur)
        return Object.assign({}, e, {
          items: e.items.filter(function (_, j) { return j !== itemIdx }),
          _editingItemIdx: next,
        })
      })
    })
    var key = entryIdx + '_' + itemIdx
    if (itemSearchKey === key) { setItemMatches([]); setItemSearchKey('') }
  }

  function setItemEditing(entryIdx, itemIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        return Object.assign({}, e, { _editingItemIdx: itemIdx })
      })
    })
  }

  // Closing an item is now an explicit act. Auto-folding it the moment the last
  // field validated used to snatch the card away mid-typing.
  function setItemDone(entryIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        return Object.assign({}, e, { _editingItemIdx: -1 })
      })
    })
  }

  function toggleItemMode(entryIdx, itemIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var newItems = e.items.map(function (it, j) {
          if (j !== itemIdx) return it
          var nextMode = it.itemMode === 'new' ? 'existing' : 'new'
          return Object.assign({}, it, {
            itemMode: nextMode,
            itemMatchedId: null,
            itemMatchedSource: null,
            itemMatchedCategoryId: null,
          })
        })
        return Object.assign({}, e, { items: newItems, _editingItemIdx: itemIdx })
      })
    })
    var key = entryIdx + '_' + itemIdx
    if (itemSearchKey === key) { setItemMatches([]); setItemSearchKey('') }
  }

  function updateItem(entryIdx, itemIdx, field, val) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var copy = Object.assign({}, e)
        copy._editingItemIdx = itemIdx
        copy.items = e.items.map(function (it, j) {
          if (j !== itemIdx) return it
          var ic = Object.assign({}, it)
          ic[field] = val
          if (field === 'itemQuery' && it.itemMode !== 'new') {
            ic.itemMatchedId = null
            ic.itemMatchedSource = null
            ic.itemMatchedCategoryId = null
          }
          return ic
        })
        return copy
      })
    })
  }

  function searchInventoryItems(entryIdx, itemIdx, term) {
    setItemSearchKey(entryIdx + '_' + itemIdx)
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.trim().length < 2) { setItemMatches([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      Promise.all([
        supabase.from('inventory_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
        supabase.from('catering_store_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
      ]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
        setItemMatches(inv.concat(cs).slice(0, 8))
      })
    }, 300)
  }

  function pickItemMatch(entryIdx, itemIdx, item) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var copy = Object.assign({}, e)
        copy._editingItemIdx = itemIdx
        copy.items = e.items.map(function (it, j) {
          if (j !== itemIdx) return it
          return Object.assign({}, it, {
            itemQuery: item.name,
            itemMatchedId: item.id,
            itemMatchedSource: item._source,
            itemMatchedCategoryId: item.category_id || null,
            itemUnit: item.unit || it.itemUnit
          })
        })
        return copy
      })
    })
    setItemMatches([])
    setItemSearchKey('')
  }

  function duplicateEntry(idx) {
    // Read the source entry from `prev` inside the updater too — the same stale-closure
    // race as addEntry/removeEntry could otherwise duplicate an outdated snapshot of the
    // entry being duplicated (e.g. missing the allocation row just added to it).
    setEntries(function (prev) {
      var src = prev[idx]
      if (!src) return prev
      var dup = Object.assign({}, src, {
        _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        receiptFiles: [], receiptPreviews: [], audioBlob: null, audioUrl: '', recording: false,
        fieldValues: Object.assign({}, src.fieldValues),
        allocations: src.allocations.map(function (a) { return Object.assign({}, a) }),
        items: (src.items || []).map(function (it) {
          return Object.assign({}, it, { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8) })
        }),
        // The copy opens; it is the one you are about to change.
        _collapsed: false
      })
      // ...and the rest fold, for the same reason as addEntry.
      var next = prev.map(function (e) { return Object.assign({}, e, { _collapsed: true }) })
      next.splice(idx + 1, 0, dup)
      return next
    })
  }

  // ── Allocation helpers ──
  function updateAllocation(entryIdx, allocIdx, field, val) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
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
    })
  }

  function addAllocation(entryIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var nA = makeAllocation()
        // Prefill from entry's top-level; dept-specific match applied when dept picked
        nA.expenseTypeId = e.expenseTypeId || ''
        nA.expenseSubTypeId = e.expenseSubTypeId || ''
        return Object.assign({}, e, { allocations: e.allocations.concat([nA]) })
      })
    })
  }

  function removeAllocation(entryIdx, allocIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        // Deleting the last row clears it instead of refusing: an entry needs
        // one allocation, but refusing left no way to empty a wrong one.
        if (e.allocations.length <= 1) return Object.assign({}, e, { allocations: [makeAllocation()] })
        return Object.assign({}, e, { allocations: e.allocations.filter(function (_, j) { return j !== allocIdx }) })
      })
    })
  }

  function duplicateAllocation(entryIdx, allocIdx) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var src = e.allocations[allocIdx]
        if (!src) return e
        var dup = Object.assign({}, src, { amountRupees: '' })
        return Object.assign({}, e, { allocations: e.allocations.concat([dup]) })
      })
    })
  }

  // Pick best-matching allocation-scope type/sub-type for a dept.
  // Ranks scoped types by root-token match against entry's top-level sub-type name.
  // Falls back to top-level values if no dept-specific match exists.
  function pickBestAllocType(entry, allocDeptIdStr) {
    var fallback = { expenseTypeId: entry.expenseTypeId || '', expenseSubTypeId: entry.expenseSubTypeId || '' }
    if (!allocDeptIdStr) return fallback
    var deptId = Number(allocDeptIdStr)
    var scopedTypes = expenseTypes.filter(function (t) { return t.department_id === deptId })
    if (scopedTypes.length === 0) return fallback
    var topSub = expenseSubTypes.find(function (s) { return String(s.id) === String(entry.expenseSubTypeId) })
    var topType = expenseTypes.find(function (t) { return String(t.id) === String(entry.expenseTypeId) })
    var root = extractRootToken(topSub ? topSub.name : (topType ? topType.name : ''))
    if (!root) return { expenseTypeId: String(scopedTypes[0].id), expenseSubTypeId: '' }
    var scopedTypeIds = scopedTypes.map(function (t) { return t.id })
    var subMatch = expenseSubTypes.find(function (s) {
      return scopedTypeIds.indexOf(s.expense_type_id) !== -1 && String(s.name || '').toLowerCase().indexOf(root) !== -1
    })
    if (subMatch) return { expenseTypeId: String(subMatch.expense_type_id), expenseSubTypeId: String(subMatch.id) }
    var typeMatch = scopedTypes.find(function (t) { return String(t.name || '').toLowerCase().indexOf(root) !== -1 })
    if (typeMatch) return { expenseTypeId: String(typeMatch.id), expenseSubTypeId: '' }
    return fallback
  }

  // ── Sub-type field helpers ──
  function getSubTypeFields(subTypeId) {
    var st = expenseSubTypes.find(function (s) { return s.id === Number(subTypeId) })
    if (!st || !st.extra_fields) return []
    return st.extra_fields.filter(function (f) {
      return !(f.type === 'lookup' && f.source === 'categories')
    })
  }

  function updateFieldValue(entryIdx, key, val) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== entryIdx) return e
        var fv = Object.assign({}, e.fieldValues)
        fv[key] = val
        return Object.assign({}, e, { fieldValues: fv })
      })
    })
  }

  // Payment split model (v87+):
  //   amount_paise = basePaise + taxPaise (PAYABLE / gross)
  //   amount_paise = payment_cash_paise + payment_credit_paise                 (invariant)
  //   payment_credit_paise = payment_credit_cash_paise + payment_credit_bank_paise  (invariant)
  //   Ledger L1 credit = amount_paise (gross, only when credit > 0 AND vendor picked)
  //   Ledger L2 debit  = payment_cash_paise
  //   Wallet debit = payment_cash_paise (tax already included since amount is gross)
  function getEntrySplit(e) {
    var basePaise = e.isItemPurchase
      ? Math.round(computeItemsTotal(e) * 100)
      : Math.round(Number(e.amount || 0) * 100)
    var taxPaise = e.taxAmount ? Math.round(Number(e.taxAmount) * 100) : 0
    var payablePaise = basePaise + taxPaise
    var st = expenseSubTypes.find(function (s) { return s.id === Number(e.expenseSubTypeId) })
    var vf = (st && st.extra_fields)
      ? st.extra_fields.find(function (f) { return f.type === 'lookup' && f.source === 'vendors' })
      : null
    var vendorPicked = !!(vf && e.fieldValues[vf.key])
    var creditPaise = 0
    if (vendorPicked) {
      var rawCredit = Math.round(Number(e.paymentCreditRupees || 0) * 100)
      creditPaise = Math.max(0, Math.min(payablePaise, rawCredit))
    }
    var cashPaise = payablePaise - creditPaise
    var walletSpendPaise = cashPaise
    // Leg-level distribution of credit
    var cashLegPaise = 0
    var bankLegPaise = 0
    if (creditPaise > 0) {
      var cashLegRaw = Math.round(Number(e.paymentCreditCashRupees || 0) * 100)
      var bankLegRaw = Math.round(Number(e.paymentCreditBankRupees || 0) * 100)
      var onlyCash = e.payWithCash && !e.payWithBank
      var onlyBank = e.payWithBank && !e.payWithCash
      var both = e.payWithCash && e.payWithBank
      if (onlyCash) { cashLegPaise = creditPaise; bankLegPaise = 0 }
      else if (onlyBank) { cashLegPaise = 0; bankLegPaise = creditPaise }
      else if (both) {
        cashLegPaise = Math.max(0, Math.min(creditPaise, cashLegRaw))
        bankLegPaise = Math.max(0, creditPaise - cashLegPaise)
      }
    }
    return {
      grossPaise: payablePaise,     // legacy name — now equals payable (base + tax)
      basePaise: basePaise,
      payablePaise: payablePaise,
      taxPaise: taxPaise,
      cashPaise: cashPaise,
      creditPaise: creditPaise,
      cashLegPaise: cashLegPaise,
      bankLegPaise: bankLegPaise,
      walletSpendPaise: walletSpendPaise,
      vendorPicked: vendorPicked,
      vendorFieldKey: vf ? vf.key : null
    }
  }

  function setPaymentCredit(idx, valRupees) {
    setEntries(function (prev) {
      return prev.map(function (e, i) {
        if (i !== idx) return e
        var patch = { paymentCreditRupees: valRupees }
        // Reset leg splits — user must re-pick after changing total
        patch.paymentCreditCashRupees = ''
        patch.paymentCreditBankRupees = ''
        if (!Number(valRupees || 0)) {
          patch.payWithCash = false
          patch.payWithBank = false
          patch.cashDueDate = ''
          patch.bankDueDate = ''
        }
        return Object.assign({}, e, patch)
      })
    })
  }

  function setPaymentCash(idx, valRupees) {
    // Editing cash → credit = payable - cash
    var e = entries[idx]
    if (!e) return
    var baseRupees = e.isItemPurchase ? computeItemsTotal(e) : Number(e.amount || 0)
    var taxRupees = Number(e.taxAmount || 0)
    var amtRupees = baseRupees + taxRupees  // payable
    var cashN = Number(valRupees || 0)
    if (!isFinite(cashN) || cashN < 0) cashN = 0
    if (cashN > amtRupees) cashN = amtRupees
    var creditN = Math.max(0, amtRupees - cashN)
    setEntries(function (prev) {
      return prev.map(function (en, i) {
        if (i !== idx) return en
        return Object.assign({}, en, { paymentCreditRupees: creditN ? String(creditN) : '' })
      })
    })
  }

  // Vendor stub auto-create: insert a minimal 'incomplete' vendor row and
  // wire its ID into the lookup cache + calling field. Fuzzy-match skipped
  // for now (v65 decision — start simple, upgrade if false positives seen).
  async function addVendorStub(typedRaw, entry, onChange) {
    var typed = (typedRaw || '').trim()
    if (!typed) return
    var normalized = typed.toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '')
    var cached = lookupCache.vendors || []
    // Exact-normalized match against active vendors → silently reuse
    var hit = cached.find(function (v) {
      var vn = (v.name || '').toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '')
      return vn === normalized
    })
    if (hit) { onChange(String(hit.id)); return }
    // Tag stub to current sub-type so it appears in future picks for this sub-type
    var subTypeIdNum = entry ? Number(entry.expenseSubTypeId) : 0
    var payload = {
      name: typed,
      status: 'incomplete',
      active: true,
      created_by: profile.id,
      expense_sub_type_ids: subTypeIdNum ? [subTypeIdNum] : []
    }
    var { data, error } = await supabase.from('vendors').insert(payload)
      .select('id, name, contact, phone, status, expense_type_ids, expense_sub_type_ids').single()
    if (error || !data) {
      try { logActivity('VENDOR_STUB_FAIL', typed + ' | ' + (error && error.message || '')) } catch (_) {}
      alert('Could not add vendor: ' + (error && error.message || 'unknown error'))
      return
    }
    setLookupCache(function (prev) {
      var next = Object.assign({}, prev)
      next.vendors = (prev.vendors || []).concat([data])
      return next
    })
    onChange(String(data.id))
    try { logActivity('VENDOR_STUB_CREATE', data.name + ' (id ' + data.id + ')') } catch (_) {}
  }

  function renderDynamicField(field, value, onChange, entry) {
    var cls = 'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow'
    var sty = { fontSize: '16px' }

    if (field.type === 'lookup') {
      var items = []
      if (field.source === 'vendors') {
        // Filter vendors: (1) user-tag gating (admin/auditor bypass, else intersect with user's expense_sub_type_ids),
        // then (2) match on current sub-type or parent type if tagged at type level.
        var raw = lookupCache.vendors || []
        var isAdminVend = hasPerm(profile?.permsNew, 'finance.expenses.approve')
        var userEstIdsV = profile?.expense_sub_type_ids || []
        var subTypeIdNum = entry ? Number(entry.expenseSubTypeId) : 0
        var subType = subTypeIdNum ? expenseSubTypes.find(function (s) { return s.id === subTypeIdNum }) : null
        var parentTypeId = subType ? subType.expense_type_id : 0
        items = raw.filter(function (v) {
          // User-tag gate
          if (!isAdminVend) {
            if (userEstIdsV.length === 0) return false
            var vTags = v.expense_sub_type_ids || []
            var hit = false
            for (var gi = 0; gi < vTags.length; gi++) {
              if (userEstIdsV.indexOf(vTags[gi]) !== -1) { hit = true; break }
            }
            if (!hit) return false
          }
          // Existing sub-type / parent-type filter
          if (!subTypeIdNum) return true
          var stIds = v.expense_sub_type_ids || []
          var tIds = v.expense_type_ids || []
          return stIds.indexOf(subTypeIdNum) !== -1 || (parentTypeId && tIds.indexOf(parentTypeId) !== -1)
        }).map(function (v) {
          var suffix = v.status === 'incomplete' ? ' · incomplete' : (v.contact ? ' — ' + v.contact : '')
          return { label: v.name + suffix, value: String(v.id) }
        })
      } else if (field.source === 'job_departments') {
        // Employees whose job_department_ids overlap admin-configured allowed depts (empty list ⇒ show all).
        var rawEmps = lookupCache.job_departments || []
        var allowedEmpDepts = field.allowed_dept_ids || []
        items = rawEmps.filter(function (emp) {
          if (allowedEmpDepts.length === 0) return true
          var jd = emp.job_department_ids || []
          for (var i = 0; i < jd.length; i++) {
            if (allowedEmpDepts.indexOf(jd[i]) !== -1) return true
          }
          return false
        }).map(function (emp) {
          var suffix = emp.employee_code ? ' (' + emp.employee_code + ')' : ''
          return { label: (emp.full_name || '—') + suffix, value: String(emp.id) }
        })
      } else {
        items = lookupCache[field.source] || []
      }
      var isVendors = field.source === 'vendors'
      return (
        <SearchDropdown
          key={field.key}
          label={field.label + (field.required ? ' *' : '')}
          items={items}
          value={value || ''}
          onChange={onChange}
          placeholder={'Select ' + field.label + '...'}
          allowAdd={isVendors}
          onAdd={isVendors ? function (typed) { return addVendorStub(typed, entry, onChange) } : undefined}
        />
      )
    }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
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
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={value || ''} onChange={function (e) { onChange(e.target.value) }} rows={2} className={cls + ' resize-none'} style={sty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls} style={sty} />
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
      </div>
    )
  }

  // ── Validation ──
  function validateEntries() {
    if (isAdminEdit) {
      var eA = entries[0]
      if (!eA.expenseTypeId) return 'Select expense type'
      if (!eA.expenseSubTypeId) return 'Select sub-type'
      return null
    }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.expenseTypeId) return 'Entry ' + (i + 1) + ': Select expense type'
      if (!e.expenseSubTypeId) return 'Entry ' + (i + 1) + ': Select sub-type'
      if (!e.description.trim()) return 'Entry ' + (i + 1) + ': Add description'
      if (!e.isItemPurchase && (!e.amount || Number(e.amount) <= 0)) return 'Entry ' + (i + 1) + ': Enter valid amount'
      if (!e.expenseDate) return 'Entry ' + (i + 1) + ': Select date'
      var _toYMD = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
      var _todayStr = _toYMD(new Date())
      var _minStr = _toYMD(new Date(Date.now() - 3 * 86400000))
      if (e.expenseDate > _todayStr) return 'Entry ' + (i + 1) + ': Future dates require a requisition, not a direct expense'
      // On new expenses only: enforce 3-day back-cap. On edits, allow any date from original up to today.
      if (!isEditing && e.expenseDate < _minStr) return 'Entry ' + (i + 1) + ': Date is more than 3 days old — contact admin or raise a requisition'
      var fields = getSubTypeFields(e.expenseSubTypeId)
      for (var f = 0; f < fields.length; f++) {
        // Employees-lookup (source='job_departments') is always required — the salary-ledger trigger
        // silently no-ops without it, which would look like a successful save with no salary record.
        var isEmpLookup = fields[f].type === 'lookup' && fields[f].source === 'job_departments'
        if ((fields[f].required || isEmpLookup) && !(e.fieldValues[fields[f].key] || '').toString().trim()) {
          return 'Entry ' + (i + 1) + ': ' + fields[f].label + ' is required'
        }
      }
      if (e.isItemPurchase) {
        if (!e.items || e.items.length === 0) return 'Entry ' + (i + 1) + ': Add at least one item'
        for (var it = 0; it < e.items.length; it++) {
          var im = e.items[it]
          var itLabel = 'Entry ' + (i + 1) + ' \u00b7 Item ' + (it + 1)
          if (!im.itemQuery || !im.itemQuery.trim()) return itLabel + ': Item name required'
          if (!im.itemQty || Number(im.itemQty) <= 0) return itLabel + ': Qty must be > 0'
          if (!im.itemUnit) return itLabel + ': Unit required'
          if (im.itemRate === '' || im.itemRate === null || im.itemRate === undefined || Number(im.itemRate) < 0) return itLabel + ': Rate required'
        }
        if (computeItemsTotal(e) <= 0) return 'Entry ' + (i + 1) + ': Items total must be > 0'
      }
      var hasExistingReceipt = isEditing && existingReceipts.some(function (p) { return removedReceipts.indexOf(p) === -1 })
      if (e.receiptFiles.length === 0 && !e.audioBlob && !hasExistingReceipt) {
        // Nothing has been sent to the server yet at this point — validateEntries runs
        // before any insert. A restored draft shows the OLD file name as a reminder
        // (receiptFilesMeta), but the actual file/blob can't survive a browser reload, so
        // this trips even though the name is right there — make that explicit instead of
        // just repeating "required", which reads like the attachment was silently lost.
        var restoredNote = ((e.receiptFilesMeta && e.receiptFilesMeta.length > 0) || e.audioBlobMeta)
          ? ' — this entry was restored from a draft; the file shown above could not be kept in the browser and needs to be re-attached (nothing has been submitted yet)'
          : ''
        return 'Entry ' + (i + 1) + ': Receipt image or voice note is required' + restoredNote
      }
      var _entrySplit = getEntrySplit(e)
      if (_entrySplit.creditPaise > 0) {
        if (!e.payWithCash && !e.payWithBank) return 'Entry ' + (i + 1) + ': Select Cash and/or Bank for credit payment'
        if (e.payWithCash && e.payWithBank) {
          if (_entrySplit.cashLegPaise + _entrySplit.bankLegPaise !== _entrySplit.creditPaise) {
            return 'Entry ' + (i + 1) + ': Cash + Bank portions must equal credit total'
          }
          if (_entrySplit.cashLegPaise === 0 || _entrySplit.bankLegPaise === 0) {
            return 'Entry ' + (i + 1) + ': Both Cash and Bank portions must be > 0 (or uncheck one)'
          }
        }
        if (e.payWithCash && _entrySplit.cashLegPaise > 0 && !e.cashDueDate) {
          return 'Entry ' + (i + 1) + ': Cash payment due date is required'
        }
        if (e.payWithBank && _entrySplit.bankLegPaise > 0 && !e.bankDueDate) {
          return 'Entry ' + (i + 1) + ': Bank payment due date is required'
        }
      }
    }
    // Wallet negative allowed — inline warning shown near the submit bar, no hard block here.
    return null
  }

  // Items can now be collapsed while unfinished, so a message naming "Item 2"
  // is useless if Item 2 is folded away. Open the first incomplete item in each
  // entry and bring that entry's Items panel forward.
  function revealProblems() {
    setEntries(function (prev) {
      return prev.map(function (e) {
        // Unfold first, whatever else is wrong: "Expense 2 needs an amount" is
        // no use while Expense 2 is a one-line header.
        e = e._collapsed ? Object.assign({}, e, { _collapsed: false }) : e
        if (!e.isItemPurchase || !e.items || e.items.length === 0) return e
        var bad = -1
        for (var i = 0; i < e.items.length; i++) {
          if (!isItemComplete(e.items[i])) { bad = i; break }
        }
        if (bad === -1) return e
        return Object.assign({}, e, { _editingItemIdx: bad, _panel: 'items' })
      })
    })
  }

  // ── Submit ──
  async function handleSubmit() {
    if (saving || submitLockRef.current) return
    submitLockRef.current = true
    try {
    setError('')
    setSuccess('')
    var valErr = validateEntries()
    if (valErr) {
      setError(valErr)
      revealProblems()
      // The submit bar is sticky, so a failure can be triggered from the top of
      // a multi-screen form. Without this the error card renders far below the
      // fold and the tap looks like it did nothing.
      setTimeout(function () {
        if (errorRef.current && errorRef.current.scrollIntoView) {
          errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 0)
      return
    }

    setSaving(true)

    // ── Edit branch ──
    if (isEditing) {
      var e0 = entries[0]

      // Admin-only retype: change type/sub-type only, preserve everything else
      if (isAdminEdit) {
        try {
          var { data: updated, error: aErr } = await supabase.from('expenses').update({
            expense_type_id: Number(e0.expenseTypeId),
            expense_sub_type_id: Number(e0.expenseSubTypeId),
          }).eq('id', editExp.id).select('id, expense_type_id, expense_sub_type_id')
          if (aErr) throw new Error(aErr.message)
          if (!updated || updated.length === 0) {
            throw new Error('Update blocked — no row returned. Likely RLS: your role may not be permitted to change this expense\'s type. Contact admin if you believe this is a mistake.')
          }
          var row = updated[0]
          if (row.expense_type_id !== Number(e0.expenseTypeId) || row.expense_sub_type_id !== Number(e0.expenseSubTypeId)) {
            throw new Error('Update returned mismatched values (expected ' + e0.expenseTypeId + '/' + e0.expenseSubTypeId + ', got ' + row.expense_type_id + '/' + row.expense_sub_type_id + ')')
          }
          try { await logActivity('EXPENSE_ADMIN_RETYPE', 'exp #' + editExp.id + ' | type=' + e0.expenseTypeId + '/' + e0.expenseSubTypeId) } catch (_) {}
          setSuccess('Type updated')
          // Keep the form locked (saving stays true) until onDone actually navigates away —
          // otherwise the button re-enables for ~1s with the same data still loaded, and a
          // stray second click resubmits it.
          setTimeout(function () { setSaving(false); if (onDone) onDone() }, 800)
        } catch (err) {
          console.error('ADMIN_RETYPE_FAIL', err, { expenseId: editExp.id, targetType: e0.expenseTypeId, targetSubType: e0.expenseSubTypeId })
          setError('Retype failed: ' + (err.message || err))
          setSaving(false)
        }
        return
      }

      var newBasePaise = e0.isItemPurchase
        ? Math.round(computeItemsTotal(e0) * 100)
        : Math.round(Number(e0.amount) * 100)
      var newTaxPaise = e0.taxAmount ? Math.round(Number(e0.taxAmount) * 100) : 0
      var newPaise = newBasePaise + newTaxPaise
      try {
        var editMeta = Object.assign({}, e0.fieldValues)
        var keepPaths = existingReceipts.filter(function (p) { return removedReceipts.indexOf(p) === -1 })
        var _editSplit = getEntrySplit(e0)
        var editPayload = {
          expense_type_id: Number(e0.expenseTypeId),
          expense_sub_type_id: Number(e0.expenseSubTypeId),
          amount_paise: newPaise,
          tax_paise: newTaxPaise,
          payment_cash_paise: _editSplit.cashPaise,
          payment_credit_paise: _editSplit.creditPaise,
          payment_credit_cash_paise: _editSplit.cashLegPaise,
          payment_credit_bank_paise: _editSplit.bankLegPaise,
          payment_credit_mode: null,
          cash_due_date: _editSplit.cashLegPaise > 0 ? (e0.cashDueDate || null) : null,
          bank_due_date: _editSplit.bankLegPaise > 0 ? (e0.bankDueDate || null) : null,
          description: e0.description.trim(),
          expense_date: e0.expenseDate,
          event_id: eventId ? Number(eventId) : null,
          metadata: editMeta,
          vendor_name: e0.fieldValues.vendor_name || null,
          travel_from: e0.fieldValues.travel_from || null,
          travel_to: e0.fieldValues.travel_to || null,
          travel_mode: e0.fieldValues.travel_mode || null,
          receipt_paths: keepPaths,
        }
        var { data: updRows, error: updErr } = await supabase.from('expenses').update(editPayload).eq('id', editExp.id).select('id')
        if (updErr) throw new Error(updErr.message)
        if (!updRows || updRows.length === 0) {
          throw new Error('Update blocked — no row returned. Likely RLS: you may not be permitted to edit this expense in its current state. Contact admin if you believe this is a mistake.')
        }

        // Upload new receipts (append via RPC)
        if (e0.receiptFiles && e0.receiptFiles.length > 0) {
          var editUploaded = []
          var editUpErrs = []
          for (var ef = 0; ef < e0.receiptFiles.length; ef++) {
            var efile = e0.receiptFiles[ef]
            var eext = (efile.name && efile.name.indexOf('.') !== -1) ? efile.name.split('.').pop() : 'jpg'
            var erPath = profile.id + '/' + editExp.id + '_edit_' + Date.now() + '_' + ef + '.' + eext
            var { error: eUpErr } = await supabase.storage.from('receipts').upload(erPath, efile, { upsert: true })
            if (eUpErr) editUpErrs.push('File ' + (ef + 1) + ': ' + eUpErr.message)
            else editUploaded.push(erPath)
          }
          if (editUploaded.length > 0) {
            var { error: eAttErr } = await supabase.rpc('attach_expense_receipts', { p_expense_id: editExp.id, p_paths: editUploaded })
            if (eAttErr) editUpErrs.push('Attach failed: ' + eAttErr.message)
          }
          if (editUpErrs.length > 0) { setError('Edit saved but some receipts failed:\n' + editUpErrs.join('\n')); setSaving(false); return }
        }

        // Voice (only if no image receipts)
        if ((!e0.receiptFiles || e0.receiptFiles.length === 0) && e0.audioBlob) {
          var eaPath = profile.id + '/' + editExp.id + '_voice_edit_' + Date.now() + '.webm'
          var { error: eaErr } = await supabase.storage.from('receipts').upload(eaPath, e0.audioBlob, { contentType: 'audio/webm', upsert: true })
          if (eaErr) { setError('Voice upload failed: ' + eaErr.message); setSaving(false); return }
          var { error: eaRpcErr } = await supabase.rpc('attach_expense_receipts', { p_expense_id: editExp.id, p_paths: [eaPath] })
          if (eaRpcErr) { setError('Voice attach failed: ' + eaRpcErr.message); setSaving(false); return }
        }

        // Delete removed receipt files (best-effort)
        if (removedReceipts.length > 0) {
          try { await supabase.storage.from('receipts').remove(removedReceipts) } catch (_) {}
        }

        // Replace allocations
        await supabase.from('expense_allocations').delete().eq('expense_id', editExp.id)
        var editAllocRows = e0.allocations
          .filter(function (a) { return a.venueId || a.departmentId })
          .map(function (a) {
            var aTypeId = a.expenseTypeId ? Number(a.expenseTypeId) : (e0.expenseTypeId ? Number(e0.expenseTypeId) : null)
            var aSubTypeId = a.expenseSubTypeId ? Number(a.expenseSubTypeId) : (e0.expenseSubTypeId ? Number(e0.expenseSubTypeId) : null)
            return {
              expense_id: editExp.id,
              department: a.departmentId ? (departments.find(function (d) { return String(d.id) === a.departmentId }) || {}).name || null : null,
              department_id: a.departmentId ? Number(a.departmentId) : null,
              venue_id: a.venueId ? Number(a.venueId) : null,
              expense_type_id: aTypeId,
              expense_sub_type_id: aSubTypeId,
              amount_paise: a.amountRupees ? Math.round(Number(a.amountRupees) * 100) : 0,
              remarks: (a.remarks || '').trim() || null,
              source: 'allocation',
            }
          })
        // Auto-create a default allocation from the entry-level type for whatever portion of
        // the total wasn't explicitly allocated, so the whole amount appears in the ledgers
        // (previously only ran when allocations were empty, silently dropping the remainder
        // whenever a partial allocation was entered).
        var editAllocSum = editAllocRows.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
        var editRemainderPaise = newPaise - editAllocSum
        if (editRemainderPaise > 0) {
          var editExpType = e0.expenseTypeId ? expenseTypes.find(function (t) { return String(t.id) === String(e0.expenseTypeId) }) : null
          var editDefaultDeptId = null
          var editDefaultDeptName = null
          if (editExpType) {
            if (editExpType.department_id) editDefaultDeptId = editExpType.department_id
            else if (editExpType.sub_department_id) {
              var editSd = subDepartments.find(function (s) { return String(s.id) === String(editExpType.sub_department_id) })
              if (editSd && editSd.department_id) editDefaultDeptId = editSd.department_id
            }
          }
          if (editDefaultDeptId) {
            var editDeptRow = departments.find(function (d) { return d.id === editDefaultDeptId })
            if (editDeptRow) editDefaultDeptName = editDeptRow.name
          }
          editAllocRows.push({
            expense_id: editExp.id,
            department: editDefaultDeptName,
            department_id: editDefaultDeptId,
            venue_id: null,
            expense_type_id: e0.expenseTypeId ? Number(e0.expenseTypeId) : null,
            expense_sub_type_id: e0.expenseSubTypeId ? Number(e0.expenseSubTypeId) : null,
            amount_paise: editRemainderPaise,
            remarks: null,
            source: 'auto_default',
          })
        }
        if (editAllocRows.length > 0) {
          var { error: editAllocErr } = await supabase.from('expense_allocations').insert(editAllocRows)
          if (editAllocErr) throw new Error('Allocations failed: ' + editAllocErr.message)
        }

        // Wallet diff — use actual wallet exposure (cash portion + tax if credit), not gross amount
        var newWalletSpend = _editSplit.walletSpendPaise
        var oldWalletSpend = (editExp.payment_credit_paise || 0) > 0
          ? (editExp.payment_cash_paise || 0)
          : (editExp.amount_paise || 0)
        var walletDiff = newWalletSpend - oldWalletSpend
        var walletDiffFailed = false
        if (walletDiff !== 0) {
          var wRpc = walletDiff > 0 ? 'wallet_self_debit' : 'wallet_self_credit'
          var wAmt = Math.abs(walletDiff)
          var wRef = walletDiff > 0 ? 'expense' : 'expense_refund'
          var wDesc = 'Expense edited: ' + (walletDiff > 0 ? '+' : '-') + (wAmt / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' pts'
          var { error: wDiffErr } = await supabase.rpc(wRpc, { p_amount_paise: wAmt, p_description: wDesc, p_ref_type: wRef, p_ref_id: String(editExp.id) })
          // Don't fail the whole edit over this — the expense fields are already saved —
          // but a swallowed error here previously meant the wallet silently went out of
          // sync with no trace at all. Surface it instead.
          if (wDiffErr) { console.error('WALLET_DIFF_FAIL', wDiffErr); walletDiffFailed = true }
        }

        try { await logActivity('EXPENSE_EDIT', e0.description.trim() + ' | ' + (newPaise / 100) + ' pts') } catch (_) {}

        if (walletDiffFailed) {
          // Stay on screen (don't auto-navigate away) — this needs to be seen and acted on,
          // not flash past in the same 1s window the success path uses.
          setError('Expense updated, but the wallet adjustment failed — balance may be out of sync. Flag for admin correction.')
          setSaving(false)
        } else {
          setSuccess('Expense updated')
          // Keep the form locked (saving stays true) until onDone actually navigates away —
          // otherwise the button re-enables for ~1s with the same edits still loaded, and a
          // stray second click re-applies the same update (double wallet diff, etc.).
          setTimeout(function () { setSaving(false); if (onDone) onDone() }, 1000)
        }
      } catch (err) {
        setError('Update failed: ' + (err.message || err))
        setSaving(false)
      }
      return
    }

    // ── Insert branch ──
    var submitted = 0
    var failed = 0
    var failedMsgs = []
    var entryWarnings = []
    var batchId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        var basePaise = e.isItemPurchase
          ? Math.round(computeItemsTotal(e) * 100)
          : Math.round(Number(e.amount) * 100)
        var taxPaise = e.taxAmount ? Math.round(Number(e.taxAmount) * 100) : 0
        var paise = basePaise + taxPaise
        // Reset each iteration — `var` is function-scoped, and a throw before this
        // entry's own insert must not see a stale `exp` left over from a prior entry.
        var exp = null

        try {
          var meta = Object.assign({}, e.fieldValues)
          if (e.isItemPurchase) {
            meta.item_receipts = e.items.map(function (im) {
              var qtyN = Number(im.itemQty) || 0
              var rateN = Number(im.itemRate) || 0
              return {
                query: (im.itemQuery || '').trim(),
                matched_item_id: im.itemMode === 'new' ? null : im.itemMatchedId,
                matched_source: im.itemMode === 'new' ? 'new' : im.itemMatchedSource,
                matched_category_id: im.itemMatchedCategoryId,
                qty: qtyN,
                unit: im.itemUnit,
                notes: (im.itemNotes || '').trim() || null,
                rate_paise: Math.round(rateN * 100),
                line_total_paise: Math.round(qtyN * rateN * 100),
                resulting_item_id: null,
                received_by: null,
                received_at: null,
                cancel_reason: null
              }
            })
          }
          // Resolve legacy vendor_name column from the selected vendor ID
          // (metadata[<vendor field key>] now stores the ID string, not the name).
          var vendorLegacyName = null
          var subTypeRow = expenseSubTypes.find(function (s) { return s.id === Number(e.expenseSubTypeId) })
          if (subTypeRow && subTypeRow.extra_fields) {
            var vendorField = subTypeRow.extra_fields.find(function (f) {
              return f.type === 'lookup' && f.source === 'vendors'
            })
            if (vendorField) {
              var vId = e.fieldValues[vendorField.key]
              if (vId) {
                var vRow = (lookupCache.vendors || []).find(function (v) { return String(v.id) === String(vId) })
                if (vRow) vendorLegacyName = vRow.name
              }
            }
          }
          // Payment split: cash + credit = amount (invariant, in paise)
          var _split = getEntrySplit(e)
          var payload = {
            user_id: profile.id,
            batch_id: batchId,
            expense_type_id: Number(e.expenseTypeId),
            expense_sub_type_id: Number(e.expenseSubTypeId),
            amount_paise: paise,
            tax_paise: taxPaise,
            payment_cash_paise: _split.cashPaise,
            payment_credit_paise: _split.creditPaise,
            payment_credit_cash_paise: _split.cashLegPaise,
            payment_credit_bank_paise: _split.bankLegPaise,
            payment_credit_mode: null,
            due_date: null,
            cash_due_date: _split.cashLegPaise > 0 ? (e.cashDueDate || null) : null,
            bank_due_date: _split.bankLegPaise > 0 ? (e.bankDueDate || null) : null,
            description: e.description.trim(),
            expense_date: e.expenseDate,
            status: 'recorded',
            event_id: eventId ? Number(eventId) : null,
            metadata: meta,
            vendor_name: vendorLegacyName,
            travel_from: e.fieldValues.travel_from || null,
            travel_to: e.fieldValues.travel_to || null,
            travel_mode: e.fieldValues.travel_mode || null,
            item_receipt_status: e.isItemPurchase ? 'pending' : null,
          }

          var { data: exp, error: insErr } = await supabase.from('expenses').insert(payload).select('id').single()
          if (insErr || !exp) { console.error('EXPENSE_INSERT_FAIL', insErr, payload); throw new Error('Expense insert failed: ' + (insErr && insErr.message || 'no row returned')) }

          if (e.receiptFiles && e.receiptFiles.length > 0) {
            var uploadedPaths = []
            var uploadErrors = []
            for (var f = 0; f < e.receiptFiles.length; f++) {
              var file = e.receiptFiles[f]
              var ext = (file.name && file.name.indexOf('.') !== -1) ? file.name.split('.').pop() : 'jpg'
              var rPath = profile.id + '/' + exp.id + '_' + Date.now() + '_' + f + '.' + ext
              var { error: upErr } = await supabase.storage.from('receipts').upload(rPath, file, { upsert: true })
              if (upErr) {
                uploadErrors.push('File ' + (f + 1) + ' (' + (file.name || 'unnamed') + '): ' + upErr.message)
              } else {
                uploadedPaths.push(rPath)
              }
            }
            if (uploadedPaths.length > 0) {
              var { error: updErr } = await supabase.rpc('attach_expense_receipts', {
                p_expense_id: exp.id,
                p_paths: uploadedPaths
              })
              if (updErr) uploadErrors.push('Save paths failed: ' + updErr.message)
            }
            if (uploadErrors.length > 0) {
              // The expense row is already committed at this point — don't abort the whole
              // submission here. Doing so used to leave this entry's data sitting untouched
              // in state, which the draft autosave effect then silently re-persisted as an
              // "unsaved draft" (since it only skips saving while `saving` is true), inviting
              // a genuine duplicate expense on the next Restore + Submit. Keep going instead —
              // allocations/wallet debit still need to run for this real expense — and surface
              // the caveat in the end-of-batch summary.
              entryWarnings.push('#' + (i + 1) + ' (exp #' + exp.id + '): ' + uploadErrors.join('; '))
            }
          }

          if ((!e.receiptFiles || e.receiptFiles.length === 0) && e.audioBlob) {
            var aPath = profile.id + '/' + exp.id + '_voice_' + Date.now() + '.webm'
            var { error: aErr } = await supabase.storage.from('receipts').upload(aPath, e.audioBlob, { contentType: 'audio/webm', upsert: true })
            if (aErr) {
              entryWarnings.push('#' + (i + 1) + ' (exp #' + exp.id + '): voice upload failed — ' + aErr.message)
            } else {
              var { error: aRpcErr } = await supabase.rpc('attach_expense_receipts', {
                p_expense_id: exp.id,
                p_paths: [aPath]
              })
              if (aRpcErr) entryWarnings.push('#' + (i + 1) + ' (exp #' + exp.id + '): voice attach failed — ' + aRpcErr.message)
            }
          }

          var allocRows = e.allocations
            .filter(function (a) { return a.venueId || a.departmentId })
            .map(function (a) {
              // Fallback allocation type to entry's top-level if user left it blank
              var aTypeId = a.expenseTypeId ? Number(a.expenseTypeId) : (e.expenseTypeId ? Number(e.expenseTypeId) : null)
              var aSubTypeId = a.expenseSubTypeId ? Number(a.expenseSubTypeId) : (e.expenseSubTypeId ? Number(e.expenseSubTypeId) : null)
              return {
                expense_id: exp.id,
                department: a.departmentId ? (departments.find(function (d) { return String(d.id) === a.departmentId }) || {}).name || null : null,
                department_id: a.departmentId ? Number(a.departmentId) : null,
                venue_id: a.venueId ? Number(a.venueId) : null,
                expense_type_id: aTypeId,
                expense_sub_type_id: aSubTypeId,
                amount_paise: a.amountRupees ? Math.round(Number(a.amountRupees) * 100) : 0,
                remarks: (a.remarks || '').trim() || null,
                // expense_allocations.source is NOT NULL (allocation | auto_default). Omitting
                // it here works fine when every row in the batch omits it (the column default
                // applies), but as soon as the auto-default remainder row below is also present
                // — which sets source explicitly — PostgREST sends a literal NULL for every row
                // missing the key instead of deferring to the column default, and the whole
                // multi-row insert fails the NOT NULL constraint (losing every row in the batch,
                // not just the unlabeled ones).
                source: 'allocation',
              }
            })
          // Auto-create a default allocation from the entry-level type for whatever portion of
          // the total wasn't explicitly allocated, so the whole amount appears in the ledgers
          // (previously only ran when allocations were empty, silently dropping the remainder
          // whenever a partial allocation was entered).
          var allocSum = allocRows.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
          var remainderPaise = paise - allocSum
          if (remainderPaise > 0) {
            var expType = e.expenseTypeId ? expenseTypes.find(function (t) { return String(t.id) === String(e.expenseTypeId) }) : null
            var defaultDeptId = null
            var defaultDeptName = null
            if (expType) {
              if (expType.department_id) defaultDeptId = expType.department_id
              else if (expType.sub_department_id) {
                var sd = subDepartments.find(function (s) { return String(s.id) === String(expType.sub_department_id) })
                if (sd && sd.department_id) defaultDeptId = sd.department_id
              }
            }
            if (defaultDeptId) {
              var deptRow = departments.find(function (d) { return d.id === defaultDeptId })
              if (deptRow) defaultDeptName = deptRow.name
            }
            allocRows.push({
              expense_id: exp.id,
              department: defaultDeptName,
              department_id: defaultDeptId,
              venue_id: null,
              expense_type_id: e.expenseTypeId ? Number(e.expenseTypeId) : null,
              expense_sub_type_id: e.expenseSubTypeId ? Number(e.expenseSubTypeId) : null,
              amount_paise: remainderPaise,
              remarks: null,
              source: 'auto_default',
            })
          }
          if (allocRows.length > 0) {
            var { error: aErrIns } = await supabase.from('expense_allocations').insert(allocRows)
            if (aErrIns) { console.error('ALLOC_INSERT_FAIL', aErrIns, allocRows); throw new Error('Allocations failed: ' + aErrIns.message) }
          }

          // Wallet only debits the immediate cash portion the user set as "Cash from Wallet".
          // Credit portion (base + tax owed to vendor) leaves the wallet later via pay_vendor.
          // All-cash mode falls back to gross so tax also debits now (no credit obligation).
          var walletDebitPaise = _split.creditPaise > 0
            ? _split.cashPaise
            : paise
          if (walletDebitPaise > 0) {
            var { error: wErr } = await supabase.rpc('wallet_self_debit', {
              p_amount_paise: walletDebitPaise,
              p_description: 'Expense: ' + e.description.trim().slice(0, 50),
              p_ref_type: 'expense',
              p_ref_id: String(exp.id),
            })
            if (wErr) { console.error('WALLET_DEBIT_FAIL', wErr); throw new Error('Wallet debit failed: ' + wErr.message) }
          }

          try { await logActivity('EXPENSE_SUBMIT', (paise / 100) + ' pts | ' + e.description.trim().slice(0, 50)) } catch (_) {}
          submitted++
        } catch (err) {
          console.error('EXPENSE_SUBMIT_FAIL entry', i, err)
          var msg = (err && err.message) ? err.message : String(err)
          // The expense row (and possibly its allocations) may already have been inserted
          // before whatever step just threw — e.g. the wallet debit failing after the
          // expense was created. Without a real DB transaction across these separate calls,
          // that leaves an orphaned expense with no allocation/wallet entry.
          // The allocations delete below is a genuine best-effort cleanup (their RLS allows
          // the owner to remove their own rows). The expenses row itself is NOT deletable
          // here — its RLS delete policy only allows status='pending', but this row was just
          // inserted with status='recorded', so a delete attempt would always silently no-op
          // (0 rows affected, no error) rather than actually removing it. So don't bother
          // attempting it — just say plainly that the row needs manual admin correction.
          if (exp && exp.id) {
            try { await supabase.from('expense_allocations').delete().eq('expense_id', exp.id) } catch (_) {}
            msg += ' (expense #' + exp.id + ' was already recorded and could NOT be auto-removed — an admin must add its missing allocation/wallet entry, or delete it manually)'
          }
          failedMsgs.push('#' + (i + 1) + ': ' + msg)
          try { logActivity('EXPENSE_SUBMIT_FAIL', 'entry ' + i + ' | ' + msg.slice(0, 200)) } catch (_) {}
          failed++
        }
      }

    if (failed > 0 && submitted > 0) {
      setSaving(false)
      setError(failed + ' failed, ' + submitted + ' submitted\n' + failedMsgs.join('\n'))
    } else if (failed > 0) {
      setSaving(false)
      setError('All ' + failed + ' entries failed to submit\n' + failedMsgs.join('\n'))
    } else {
      var successMsg = submitted + ' expense' + (submitted > 1 ? 's' : '') + ' submitted'
      if (entryWarnings.length > 0) {
        successMsg += '\n\n' + entryWarnings.length + ' receipt/voice attachment issue(s) — edit the expense to re-attach:\n' + entryWarnings.join('\n')
      }
      setSuccess(successMsg)
      clearDraftAfterSubmit()
      // Keep the form locked (saving stays true) for a beat so the success message is
      // seen, then hand off to onDone — which always navigates away (unmounting this
      // form), so there's no need to reset `entries` here first.
      setTimeout(function () { setSaving(false); if (onDone) onDone() }, 1500)
    }
    } finally {
      submitLockRef.current = false
    }
  }

  var isAdminEdit = isEditing && editExp && profile && editExp.user_id !== profile.id

  if (loading) return <div className="text-center py-8 text-slate-500">Loading...</div>

  return (
    /* Flex column with a viewport-height floor. The entry card below carries
       flex-1, so on a short form it grows and pushes the sticky action bar down
       to the bottom of the screen -- no reserved padding, and therefore no band
       of empty page to scroll into. The 9rem offset is the Shell header plus the
       page padding above this point; dvh, not vh, so mobile browser chrome
       counts. Erring slightly tall is safe: the bar stays pinned either way. */
    <div className="flex flex-col space-y-3 -mb-8 min-h-[calc(100dvh-8rem)]">
      {/* Draft-restore banner — shows only if a saved draft was found on mount */}
      {/* The old paragraph explained that receipts cannot be restored, but the
          receipt field already says exactly that, with the file names, right
          where you have to act on it. Here it was just a wall of text between
          you and two buttons. */}
      {draftRestorable && (
        <div className="ambria-rise p-3 rounded-xl bg-indigo-50 border border-indigo-200">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-semibold text-indigo-900">Restore your previous data?</p>
            <span className="shrink-0 text-[11px] font-medium text-indigo-500 tabular-nums">
              {formatDraftAge(draftRestorable.savedAt)} · {(draftRestorable.entries || []).length} entr{(draftRestorable.entries || []).length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <div className="flex gap-2 mt-2.5">
            <button type="button" onClick={restoreDraft}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[12.5px] font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:scale-[0.98] transition-all">
              <Icon name="undo" className="w-3.5 h-3.5" />
              Restore
            </button>
            <button type="button" onClick={discardDraft}
              className="flex-1 py-2 text-[12.5px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] transition-all">
              Start fresh
            </button>
          </div>
        </div>
      )}
      {/* Autosave status, top right, as one bordered pill rather than two runs
          of loose text. Floating bare like that it had no edge of its own, so
          it read as a stray caption belonging to the card underneath — and the
          negative margin that pulled it closer made the collision worse.
          Clear lives inside the pill, behind a divider: near the thing it acts
          on, and no longer a red link sitting under the Submit button where a
          mis-tap costs you the whole form. */}
      {!isEditing && draftSavedAt && (
        <div className="flex justify-end">
          <div className="ambria-glass-chip ambria-rise inline-flex items-center h-7 rounded-full overflow-hidden text-[11px]">
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 font-semibold text-slate-700 whitespace-nowrap">
              {/* Two pulses per save, then still. Keyed on draftSavedAt so a
                  new save remounts the halo and replays it — a timer would not
                  do, draftTick only ticks every 15s. A dot pinging forever is
                  noise; a dot that moves the moment your work is safe is the
                  whole point. */}
              <span className="relative flex w-1.5 h-1.5">
                <span key={draftSavedAt}
                  style={{ animationIterationCount: 2 }}
                  className="absolute inset-0 rounded-full bg-emerald-500 opacity-60 animate-ping motion-reduce:hidden" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
              Draft saved
              <span className="font-medium text-slate-400 tabular-nums">{formatDraftAge(draftSavedAt + draftTick * 0)}</span>
            </span>
            <span aria-hidden="true" className="w-px h-3.5 bg-slate-900/10" />
            <button type="button" onClick={confirmDiscardDraft}
              aria-label="Discard saved draft"
              className="inline-flex items-center gap-1 h-full pl-2 pr-2.5 font-semibold text-slate-500 hover:bg-red-500/10 hover:text-red-600 transition-colors">
              <Icon name="trash" size={11} />
              Clear
            </button>
          </div>
        </div>
      )}
      {/* Error banner moved next to the Submit button below — screenshot-friendly, one-tap Copy */}
      {success && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm whitespace-pre-wrap">{success}</div>}
      {isAdminEdit && (
        <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-sm">
          🔧 Admin retype — only expense type & sub-type will be saved. Amount, receipts, allocations, wallet remain unchanged.
        </div>
      )}
      {isAdminEdit && entries.length > 0 && (function () {
        var e0 = entries[0]
        var isAdminEt = hasPerm(profile?.permsNew, 'finance.expenses.approve')
        var userEtIds = profile?.expense_type_ids || []
        var typeList = isAdminEt ? expenseTypes : expenseTypes.filter(function (et) { return userEtIds.indexOf(et.id) !== -1 })
        var userEstIds = profile?.expense_sub_type_ids || []
        var subs = expenseSubTypes.filter(function (st) {
          if (st.expense_type_id !== Number(e0.expenseTypeId)) return false
          if (!isAdminEt && userEstIds.indexOf(st.id) === -1) return false
          return true
        })
        return (
          <div className="border border-purple-200 rounded-xl bg-white shadow-sm p-4 space-y-3">
            <div>
              <SearchDropdown
                label="Expense Type" labelIcon="tag"
                items={typeList.map(function (et) { return { label: (et.icon ? et.icon + ' ' : '') + et.name, value: String(et.id) } })}
                value={e0.expenseTypeId}
                onChange={function (val) { updateEntry(0, 'expenseTypeId', val) }}
                placeholder="Search or select type..."
              />
            </div>
            {e0.expenseTypeId && subs.length > 0 && (
              <div>
                <SearchDropdown
                  label="Sub-Type" labelIcon="split"
                  items={subs.map(function (st) { return { label: st.name, value: String(st.id) } })}
                  value={e0.expenseSubTypeId}
                  onChange={function (val) { updateEntry(0, 'expenseSubTypeId', val) }}
                  placeholder="Search or select sub-type..."
                />
              </div>
            )}
            {e0.expenseTypeId && subs.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No sub-types configured for this type</p>
            )}
          </div>
        )
      })()}

      {/* For a Function? */}
      <div className={"border border-slate-200 rounded-2xl bg-white px-3.5 py-2.5 sm:py-3 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)] " + (isAdminEdit ? "hidden" : "")}>
        <div className="flex items-center justify-between gap-3">
          {/* A tinted glyph tile and one line of why. The row was a bare
              question with a switch: nothing said what turning it on does. */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={"shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center transition-colors " + (isFunction ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400")}>
              <Icon name="calendar" size={17} />
            </span>
            <span className="min-w-0">
              <label className="block text-[13px] font-semibold text-slate-800">For a function?</label>
              <span className="block text-[11px] text-slate-500 leading-snug">For any function or event</span>
            </span>
          </div>
          <button type="button" onClick={function () { toggleFunction(!isFunction) }}
            aria-pressed={isFunction} aria-label="For a function?"
            className="shrink-0 flex items-center gap-2">
            <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-600" : "bg-slate-300")}>
              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
            </div>
          </button>
        </div>
        {isFunction && (
          <div className="space-y-2">
            <EventDatePicker label="Function Date" value={eventDate} collapsible
              onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
            {eventsLoading && <p className="text-xs text-slate-500">Loading events...</p>}
            {eventDate && !eventsLoading && events.length === 0 && <p className="text-xs text-slate-500">No events on this date</p>}
            {/* A card list, not a <select>: one function needs THREE department
                colours on the same row, and a native option can only carry one
                (the iOS wheel ignores even that). Real markup gets the chips —
                and it matches the Extra Plates and Wallet function pickers. */}
            {events.length > 0 && (function () {
              var groups = groupFunctions(events)
              // Once a function is chosen the other cards have done their job.
              // Keeping them on screen pushed the amount, category and receipt
              // fields a full phone-height down the form; the choice collapses
              // to the one card that matters, with a way back beside it.
              var picked = eventId ? groups.filter(function (g) {
                return g.contracts.some(function (c) { return String(c.id) === eventId })
              }) : null
              var shown = (picked && picked.length === 1) ? picked : groups
              return (
              <div className="space-y-1.5">
                {shown.map(function (g) {
                  var head = g.contracts[0]
                  var single = g.contracts.length === 1
                  var sel = g.contracts.filter(function (c) { return String(c.id) === eventId })[0] || null
                  var title = (
                    <>
                      <div className={"text-[13px] font-semibold " + (sel ? "text-indigo-900" : "text-slate-900")}>
                        {head.event_name + (head.client_name ? ' — ' + head.client_name : '')}
                      </div>
                      <div className={"text-[11.5px] " + (sel ? "text-indigo-700" : "text-slate-500")}>
                        {(head.venue_name || '') + (head.session ? ' · ' + head.session : '')}
                      </div>
                    </>
                  )
                  return (
                    <div key={g.key}
                      className={"rounded-xl border transition-colors " +
                        (sel ? "border-indigo-600 border-2 bg-indigo-50" : "border-slate-300 bg-white")}>
                      {/* The card picks the function, nothing finer. event_id
                          takes the first contract in running order (Venue →
                          Decor → Catering → Entertainment); the cost's own
                          department is set per-allocation further down the
                          form, so the contract row this hangs off does not
                          need to be chosen here. */}
                      <button type="button" onClick={function () { setEventId(String(head.id)) }}
                        className="w-full text-left px-3 pt-2">
                        {title}
                      </button>
                      {/* Which departments this evening is booked under — read
                          only. One line, never wrapped: four names plus the
                          label overflow a narrow phone, so the row scrolls
                          sideways rather than folding and pushing every card
                          below it down. */}
                      <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 overflow-x-auto overflow-y-hidden">
                        {!single && <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">Dept:</span>}
                        {g.contracts.map(function (c) {
                          return (
                            <span key={c.id} className={"shrink-0 text-[12px] font-medium " + deptInk(c.department)}>
                              {c.department}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {shown !== groups && groups.length > 1 && (
                  <button type="button" onClick={function () { setEventId('') }}
                    className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-800 px-1">
                    Change function
                  </button>
                )}
              </div>
              )
            })()}
          </div>
        )}
      </div>

      {entries.map(function (entry, idx) {
        if (isAdminEdit) return null
        var isAdminEst = hasPerm(profile?.permsNew, 'finance.expenses.approve')
        var userEstIds = profile?.expense_sub_type_ids || []
        var subTypesForType = expenseSubTypes.filter(function (st) {
          if (st.expense_type_id !== Number(entry.expenseTypeId)) return false
          if (!isAdminEst && userEstIds.indexOf(st.id) === -1) return false
          return true
        })
        var subTypeFields = entry.expenseSubTypeId ? getSubTypeFields(entry.expenseSubTypeId) : []

        return (
          <div key={entry._key} className="ambria-rise flex-1 border border-white/70 rounded-2xl bg-white/70 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-white/45 border-b border-white/70 rounded-t-2xl">
              <button type="button" onClick={function () { updateEntry(idx, '_collapsed', !entry._collapsed) }}
                className="flex items-center gap-2 min-w-0 flex-1 text-left">
                <span className="shrink-0 text-slate-400">
                  <Icon name={entry._collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                </span>
                <span className="shrink-0 w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
                  <Icon name="receipt" size={14} />
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-indigo-800">
                  {/* The rule sits under the label alone, not the full width:
                      it marks which card you are in without spending a row. */}
                  <span className="inline-block border-b-2 border-indigo-500 pb-1 pr-1.5">
                    Expense<span data-notranslate>{' ' + (idx + 1)}</span>
                  </span>
                </span>
                {entry._collapsed && (function () {
                  var et = expenseTypes.find(function (t) { return String(t.id) === String(entry.expenseTypeId) })
                  var st = expenseSubTypes.find(function (x) { return String(x.id) === String(entry.expenseSubTypeId) })
                  var what = [et ? et.name : '', st ? st.name : ''].filter(Boolean).join(' › ') || (entry.description || '').trim()
                  var amt = Number(entry.amount) > 0 ? formatPoints(Math.round(Number(entry.amount) * 100)) : ''
                  return (
                    <span className="flex items-baseline gap-2 min-w-0 text-[11.5px]">
                      <span className="truncate text-slate-600">{what || 'Empty'}</span>
                      {amt && <span className="shrink-0 font-bold text-slate-900 tabular-nums">{amt}</span>}
                    </span>
                  )
                })()}
              </button>
              {!isEditing && (
                /* Same height, same radius. The bin is red — colour on the
                   stroke, no filled box behind it, so it names itself as the
                   destructive one without becoming the loudest thing in a
                   header you read on every card. A bin and not a cross: a
                   cross beside "Duplicate" reads as "close this card", which
                   is what the chevron already does. */
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={function () { duplicateEntry(idx) }}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors" title="Duplicate"><Icon name="copy" size={12} />Duplicate</button>
                  {entries.length > 1 && (
                    <button type="button" onClick={function () { removeEntry(idx) }}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-600 hover:bg-red-100 hover:text-red-700 transition-colors"
                      title="Remove" aria-label={'Remove expense ' + (idx + 1)}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Hidden, not unmounted: every field in here holds typed state and
                a fold must not throw it away. */}
            <div className={"p-3.5 space-y-3" + (entry._collapsed ? " hidden" : "")}>
              {/* Date and Expense Type: the two shortest fields in the form,
                  paired so a wide window does not stretch each of them across
                  the whole page on its own. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,20rem)_minmax(0,34rem)] gap-3">
              {/* Date — new expenses gated to today − 3 days; edits may widen the window to preserve the original date */}
              {(function () {
                var toYMD = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
                var today = toYMD(new Date())
                var minDate = toYMD(new Date(Date.now() - 3 * 86400000))
                // On edit, widen `min` back to the original expense date so users can keep or restore it.
                var effMin = (isEditing && editExp && editExp.expense_date && editExp.expense_date < minDate) ? editExp.expense_date : minDate
                return (
                  <div>
                    <label htmlFor={'exp-date-' + idx} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
                      <span className="shrink-0 w-5 h-5 rounded-md bg-slate-100 text-slate-500 inline-flex items-center justify-center"><Icon name="calendar" size={11} /></span>
                      Date <span className="text-red-500">*</span>
                    </label>
                    <input id={'exp-date-' + idx} type="date" value={entry.expenseDate} min={effMin} max={today}
                      onChange={function (e) {
                        var v = e.target.value
                        // The clamp used to happen silently: you picked a future
                        // date, it snapped back, and nothing said why.
                        if (v && v < effMin) {
                          updateEntry(idx, 'expenseDate', effMin)
                          updateEntry(idx, '_dateNote', 'Backdated to the oldest date you can claim.')
                          return
                        }
                        if (v && v > today) {
                          updateEntry(idx, 'expenseDate', today)
                          updateEntry(idx, '_dateNote', 'Future dates need a requisition, not an expense.')
                          return
                        }
                        updateEntry(idx, 'expenseDate', v)
                        if (entry._dateNote) updateEntry(idx, '_dateNote', '')
                      }}
                      className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                    {entry._dateNote
                      ? <p className="text-[10px] font-medium text-amber-700 mt-1">{entry._dateNote}</p>
                      : <p className="text-[10px] text-slate-500 mt-1">{isEditing ? 'Any date from the original up to today.' : 'Today or up to 3 days back.'}</p>}
                  </div>
                )
              })()}

              {/* Expense Type */}
              {(function () {
                var isAdminEt = hasPerm(profile?.permsNew, 'finance.expenses.approve')
                var userEtIds = profile?.expense_type_ids || []
                var typeList = isAdminEt ? expenseTypes : expenseTypes.filter(function (et) { return userEtIds.indexOf(et.id) !== -1 })
                return (
                  <div>
                    <SearchDropdown
                      label="Expense Type" labelIcon="tag"
                      items={typeList.map(function (et) { return { label: (et.icon ? et.icon + ' ' : '') + et.name, value: String(et.id) } })}
                      value={entry.expenseTypeId}
                      onChange={function (val) { updateEntry(idx, 'expenseTypeId', val) }}
                      placeholder="Search or select type..."
                    />
                  </div>
                )
              })()}
              </div>

              {/* Sub-Type */}
              {entry.expenseTypeId && subTypesForType.length === 1 && (
                <p className="flex items-baseline gap-1.5 text-[11px] text-slate-500">
                  <span className="font-semibold">Sub-type</span>
                  <span className="text-slate-700">{subTypesForType[0].name}</span>
                </p>
              )}
              {entry.expenseTypeId && subTypesForType.length > 1 && (
                <div>
                  <SearchDropdown
                    label="Sub-Type" labelIcon="split"
                    items={subTypesForType.map(function (st) { return { label: st.name, value: String(st.id) } })}
                    value={entry.expenseSubTypeId}
                    onChange={function (val) { updateEntry(idx, 'expenseSubTypeId', val) }}
                    placeholder="Search or select sub-type..."
                  />
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
              <div className="lg:max-w-4xl">
                <label htmlFor={'exp-desc-' + idx} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
                  <span className="shrink-0 w-5 h-5 rounded-md bg-indigo-50 text-indigo-500 inline-flex items-center justify-center"><Icon name="fileText" size={11} /></span>
                  Description <span className="text-red-500">*</span>
                </label>
                <VoiceInput id={'exp-desc-' + idx} as="textarea" value={entry.description}
                  onChange={function (e) { updateEntry(idx, 'description', e.target.value) }}
                  placeholder="What was this expense for..." rows={2} maxLength={500}
                  className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow resize-none" />
                {/* Amber past 90%, so the count is quiet until it matters and
                    the box does not jump as a line appears and disappears. */}
                <p className={"mt-1 text-right text-[10px] tabular-nums " +
                  ((entry.description || '').length > 450 ? "text-amber-600 font-semibold" : "text-slate-400")}
                  data-notranslate>
                  {(entry.description || '').length + '/500'}
                </p>
              </div>

              {/* Dynamic fields from sub-type */}
              {subTypeFields.map(function (field) {
                return renderDynamicField(field, entry.fieldValues[field.key] || '', function (val) {
                  updateFieldValue(idx, field.key, val)
                }, entry)
              })}

              {/* Items and Split used to stack, so switching either one on pushed
                  the amount fields a screenful further down. They now share a
                  card with a segmented switcher.

                  They are NOT made mutually exclusive: item_receipts and
                  expense_allocations are written independently at submit, so
                  buying items AND splitting the cost across departments is a
                  real case. The tab only chooses which panel you are looking
                  at; a dot on the other tab shows it is still switched on. */}
              {(function () {
                var panel = entry._panel === 'split' ? 'split' : 'items'
                var tabs = [
                  { k: 'items', label: 'Items', icon: 'box', on: entry.isItemPurchase },
                  { k: 'split', label: 'Split', icon: 'split', on: entry.showAllocations },
                ]
                return (
                  <div className="border border-slate-200 rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    {/* One pill slides between the two tabs rather than each tab
                        painting its own background on click -- the movement is
                        what tells you which way you just went. */}
                    {/* Pinned: the Items panel runs long enough that the
                        switch back to Split scrolls off the top, and you had
                        to scroll up to find out which panel you were even in.
                        Offset comes from the shell, not a hardcoded height —
                        the admin shell has no top bar. */}
                    {/* The strip spans the card and carries the divider, so
                        the tabs read as this panel's tabs. The control itself
                        is capped inside it — at full width two tabs became two
                        enormous buttons. Opaque, because content scrolls
                        underneath it while it is pinned.

                        No overflow-hidden on the card above: it would pin this
                        to a box that scrolls away, which is the one thing the
                        sticky is here to prevent. */}
                    <div className="sticky z-20 p-1.5 bg-white border-b border-slate-200 rounded-t-xl"
                      style={{ top: 'var(--app-header-h, 0px)' }}>
                    <div className="relative flex gap-1 p-1 bg-slate-100 rounded-lg sm:max-w-xs">
                      <span
                        aria-hidden="true"
                        className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
                        style={{ transform: panel === 'split' ? 'translateX(calc(100% + 0.25rem))' : 'translateX(0)' }}
                      />
                      {tabs.map(function (tb) {
                        var active = panel === tb.k
                        return (
                          <button
                            key={tb.k}
                            type="button"
                            onClick={function () { updateEntry(idx, '_panel', tb.k) }}
                            aria-pressed={active}
                            className={"relative flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors " +
                              (active ? "text-indigo-700" : "text-slate-500 hover:text-slate-900")}
                          >
                            <Icon name={tb.icon} size={13} />
                            {tb.label}
                            {tb.on && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                          </button>
                        )
                      })}
                    </div>
                    </div>
                    {/* keyed on `panel` so the slide-in animation replays on every switch */}
                    <div className="p-2.5">
                      <div key={panel} className={panel === 'split' ? 'ambria-slide-left' : 'ambria-slide-right'}>
                        {panel === 'items' ? (
                          <div>
                            {/* Tinted panel, not a bare row: this is the switch
                                that changes what the rest of the card asks for,
                                so it reads as its own decision. */}
                            <div className={"flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 border transition-colors " + (entry.isItemPurchase ? "bg-indigo-50/70 border-indigo-200" : "bg-slate-50 border-slate-200")}>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={"shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center transition-colors " + (entry.isItemPurchase ? "bg-indigo-600 text-white" : "bg-white text-slate-400 border border-slate-200")}>
                                  <Icon name="box" size={17} />
                                </span>
                                <div className="min-w-0">
                                  <label className="block text-[12.5px] font-semibold text-slate-800">Item select</label>
                                  <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">Item enters inventory via receiver</p>
                                </div>
                              </div>
                              <button type="button" onClick={function () { toggleItemPurchase(idx) }} disabled={isEditing} className={"flex items-center " + (isEditing ? "opacity-50 cursor-not-allowed" : "")}>
                                <div className={"relative w-9 h-5 rounded-full transition-colors " + (entry.isItemPurchase ? "bg-indigo-600" : "bg-slate-300")}>
                                  <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (entry.isItemPurchase ? "translate-x-4" : "translate-x-0.5")} />
                                </div>
                              </button>
                            </div>

                            {entry.isItemPurchase && isEditing && (
                              <div className="mt-3 mb-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                                <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                                  <Icon name="lock" className="w-3.5 h-3.5 shrink-0 mt-px" />
                                  Item details locked. Contact receiver to modify processed items.
                                </p>
                              </div>
                            )}
                            {entry.isItemPurchase && (
                              <div className={"mt-3 space-y-3 " + (isEditing ? "pointer-events-none opacity-70" : "")}>
                                {entry.items.map(function (im, iIdx) {
                                  var key = idx + '_' + iIdx
                                  var lineTotal = (Number(im.itemQty) || 0) * (Number(im.itemRate) || 0)
                                  // Default 0, not -1: a fresh form should show item 1
                                  // open rather than a collapsed, empty chip.
                                  var editingIdx = entry._editingItemIdx == null ? 0 : entry._editingItemIdx
                                  var complete = isItemComplete(im)
                                  // Only the item being edited stays open, so adding a new one
                                  // folds the previous away even when it is half-filled. With
                                  // nothing being edited (a fresh form, or after a failed
                                  // submit) incomplete items open up so the gaps are visible.
                                  // Force-expanding incomplete items made an unfinished
                                  // item impossible to fold. They now collapse like any
                                  // other and carry an "Incomplete" badge on the chip.
                                  var expanded = editingIdx === iIdx
                                  if (!expanded) {
                                    return (
                                      <div key={im._key} className={"border rounded-xl bg-white px-3 py-2.5 flex items-center gap-2 " + (complete ? "border-slate-200" : "border-amber-300")}>
                                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{iIdx + 1}</span>
                                        <button type="button" onClick={function () { if (!isEditing) setItemEditing(idx, iIdx) }}
                                          className={"flex-1 min-w-0 flex items-center gap-2 text-left " + (isEditing ? "cursor-default" : "hover:opacity-70")}>
                                          <div className="min-w-0 flex-1">
                                            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 truncate">
                                              {im.itemQuery ? im.itemQuery : <span className="font-normal text-slate-400">Unnamed item</span>}
                                              {im.itemMode === 'new'
                                                ? <Icon name="sparkle" className="w-3 h-3 shrink-0 text-slate-400" />
                                                : (im.itemMatchedId && <Icon name="check" className="w-3 h-3 shrink-0 text-indigo-600" />)}
                                            </p>
                                            <p className="text-[11px] text-slate-500 truncate">
                                              {(Number(im.itemQty) || 0)} {im.itemUnit} × {(Number(im.itemRate) || 0).toLocaleString('en-IN')} pts{im.itemNotes ? ' · ' + im.itemNotes : ''}
                                            </p>
                                          </div>
                                          {/* A folded item must still admit it is unfinished, or the
                                              gap only surfaces on submit. */}
                                          {complete ? (
                                            <span className="shrink-0 text-[13px] font-bold text-slate-900 tabular-nums">{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                                          ) : (
                                            <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-300/70">Incomplete</span>
                                          )}
                                        </button>
                                        {!isEditing && (
                                          <button type="button" onClick={function () { removeItem(idx, iIdx) }}
                                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete item" aria-label="Delete item"><Icon name="trash" className="w-4 h-4" /></button>
                                        )}
                                      </div>
                                    )
                                  }
                                  return (
                                    // Focusing a field claims this item as the one being edited,
                                    // so filling in the last value does not fold the card away
                                    // from under the caret.
                                    <div key={im._key} className="ambria-rise border border-slate-200 rounded-xl bg-white p-3 space-y-2.5"
                                      onFocusCapture={function () { if (editingIdx !== iIdx && !isEditing) setItemEditing(idx, iIdx) }}>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{'Item ' + (iIdx + 1)}</span>
                                        <div className="flex items-center gap-2">
                                          <button type="button" onClick={function () { toggleItemMode(idx, iIdx) }}
                                            className="flex items-center gap-1.5" title={im.itemMode === 'new' ? 'Switch to inventory search' : 'Create as new item'}>
                                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                                              <Icon name={im.itemMode === 'new' ? 'sparkle' : 'box'} className="w-3.5 h-3.5" />
                                              {im.itemMode === 'new' ? 'New' : 'Inventory'}
                                            </span>
                                            <div className={"relative w-9 h-5 rounded-full transition-colors " + (im.itemMode === 'new' ? "bg-slate-400" : "bg-indigo-600")}>
                                              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (im.itemMode === 'new' ? "translate-x-4" : "translate-x-0.5")} />
                                            </div>
                                          </button>
                                          <button type="button" onClick={function () { removeItem(idx, iIdx) }}
                                            className="w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete item" aria-label="Delete item"><Icon name="trash" className="w-4 h-4" /></button>
                                        </div>
                                      </div>

                                      {im.itemMode === 'new' ? (
                                        <div className="space-y-2">
                                          <div>
                                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Item Name <span className="text-red-500">*</span></label>
                                            <input type="text" value={im.itemQuery}
                                              onChange={function (e) { updateItem(idx, iIdx, 'itemQuery', e.target.value) }}
                                              placeholder="Item name (e.g. A4 Sheets, Broom, Chair)" maxLength="200"
                                              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                          </div>
                                          <div>
                                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category <span className="text-slate-500">(optional)</span></label>
                                            <select value={im.itemMatchedCategoryId || ''}
                                              onChange={function (e) { updateItem(idx, iIdx, 'itemMatchedCategoryId', e.target.value ? Number(e.target.value) : null) }}
                                              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }}>
                                              <option value="">Category (optional)</option>
                                              {itemCategories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
                                            </select>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="relative">
                                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Item Name <span className="text-red-500">*</span>{im.itemMatchedId && <span className="ml-2 text-[10px] font-bold text-green-600">✓ Matched existing</span>}</label>
                                          <input type="text" value={im.itemQuery}
                                            onChange={function (e) { updateItem(idx, iIdx, 'itemQuery', e.target.value); searchInventoryItems(idx, iIdx, e.target.value) }}
                                            onFocus={function () { if (im.itemQuery && im.itemQuery.length >= 2) searchInventoryItems(idx, iIdx, im.itemQuery) }}
                                            placeholder="Search or type new item name..."
                                            className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                          {itemSearchKey === key && itemMatches.length > 0 && (
                                            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                                              {itemMatches.map(function (m) {
                                                return (
                                                  <button key={m._source + '_' + m.id} type="button"
                                                    onMouseDown={function (evt) { evt.preventDefault(); pickItemMatch(idx, iIdx, m) }}
                                                    className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0">
                                                    <div className="text-sm text-slate-800 font-medium truncate">{m.name}</div>
                                                    <div className="text-[10px] text-slate-500">{m._source === 'catering_store' ? 'Catering Store' : 'Inventory'}{m.unit ? ' · ' + m.unit : ''}</div>
                                                  </button>
                                                )
                                              })}
                                            </div>
                                          )}
                                          {im.itemQuery && !im.itemMatchedId && itemMatches.length === 0 && itemSearchKey === key && im.itemQuery.length >= 2 && (
                                            <p className="text-[10px] text-amber-600 mt-1">No match — receiver will create as new inventory item</p>
                                          )}
                                        </div>
                                      )}

                                      {/* Qty, Unit and Rate are all short values, so they share
                                          one row; Notes is free text and gets the full width
                                          underneath rather than being squeezed beside Rate. */}
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <label htmlFor={'item-qty-' + idx + '-' + iIdx} className="block text-[11px] font-semibold text-slate-600 mb-1">Qty <span className="text-red-500">*</span></label>
                                          <input id={'item-qty-' + idx + '-' + iIdx} type="number" inputMode="numeric" value={im.itemQty}
                                            onChange={function (e) { updateItem(idx, iIdx, 'itemQty', e.target.value) }}
                                            placeholder="0" min="0" step="any"
                                            className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                        </div>
                                        <div>
                                          <label htmlFor={'item-unit-' + idx + '-' + iIdx} className="block text-[11px] font-semibold text-slate-600 mb-1">Unit</label>
                                          <select id={'item-unit-' + idx + '-' + iIdx} value={im.itemUnit}
                                            onChange={function (e) { updateItem(idx, iIdx, 'itemUnit', e.target.value) }}
                                            className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }}>
                                            {['Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens', 'Kg', 'Grams', 'Liters', 'ML', 'Meters', 'Feet', 'Rolls', 'Packets', 'Bags', 'Boxes', 'Cartons', 'Bottles', 'Sheets', 'Reams'].map(function (u) {
                                              return <option key={u} value={u}>{u}</option>
                                            })}
                                          </select>
                                        </div>
                                        <div>
                                          <label htmlFor={'item-rate-' + idx + '-' + iIdx} className="block text-[11px] font-semibold text-slate-600 mb-1">Rate <span className="text-red-500">*</span></label>
                                          <input id={'item-rate-' + idx + '-' + iIdx} type="number" inputMode="decimal" value={im.itemRate}
                                            onChange={function (e) { updateItem(idx, iIdx, 'itemRate', e.target.value) }}
                                            placeholder="0" min="0" step="any"
                                            className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                        </div>
                                      </div>

                                      <div>
                                        <label htmlFor={'item-notes-' + idx + '-' + iIdx} className="block text-[11px] font-semibold text-slate-600 mb-1">Notes <span className="font-normal text-slate-500">(brand, size, spec)</span></label>
                                        {/* Collapse rides the Notes row as a bare arrow. A
                                            labelled button needed a line of its own, and Notes
                                            is the last field anyway -- you are already here
                                            when you finish. The word lives in the tooltip and
                                            the aria-label. */}
                                        <div className="flex items-center gap-2">
                                          <input id={'item-notes-' + idx + '-' + iIdx} type="text" value={im.itemNotes}
                                            onChange={function (e) { updateItem(idx, iIdx, 'itemNotes', e.target.value) }}
                                            placeholder="e.g. White ceramic, 10-inch round"
                                            className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                          {!isEditing && (
                                            <button type="button" onClick={function () { setItemDone(idx) }}
                                              title={complete ? 'Done — collapse this item' : 'Collapse this item'}
                                              aria-label={complete ? 'Done, collapse this item' : 'Collapse this item'}
                                              className={"shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border active:scale-95 transition-all " +
                                                (complete
                                                  ? "text-indigo-700 bg-indigo-50 border-indigo-300 hover:bg-indigo-100"
                                                  : "text-slate-500 bg-white border-slate-300 hover:bg-slate-50 hover:text-slate-900")}>
                                              <Icon name="chevronUp" className="w-4 h-4" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {lineTotal > 0 && (
                                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                                          <span className="min-w-0 text-[11px] font-medium text-slate-500">
                                            Line total <span className="text-[13px] font-bold text-slate-900 tabular-nums">{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                                <button type="button" onClick={function () { addItem(idx) }}
                                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                                  + Add item
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                              <div className="flex items-center justify-between">
                                <div>
                                  <label className="text-[12.5px] font-semibold text-slate-800">Split allocations</label>
                                  <p className="text-[10px] text-slate-500 mt-0.5">Divide across departments / venues / sub-types</p>
                                </div>
                                <button type="button" onClick={function () { toggleShowAllocations(idx) }} className="flex items-center">
                                  <div className={"relative w-9 h-5 rounded-full transition-colors " + (entry.showAllocations ? "bg-indigo-600" : "bg-slate-300")}>
                                    <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (entry.showAllocations ? "translate-x-4" : "translate-x-0.5")} />
                                  </div>
                                </button>
                              </div>
                              {entry.showAllocations && <div className="mt-3">{(function () {
                            var headerWarning = null
                            var scopedType = entry.expenseTypeId ? expenseTypes.find(function (et) { return String(et.id) === String(entry.expenseTypeId) }) : null
                            if (scopedType && scopedType.department_id) {
                              var mismatches = entry.allocations.filter(function (a) { return a.departmentId && Number(a.departmentId) !== scopedType.department_id })
                              if (mismatches.length > 0) {
                                var typeDept = departments.find(function (d) { return d.id === scopedType.department_id })
                                var typeDeptName = typeDept ? typeDept.name : ('dept #' + scopedType.department_id)
                                // Name the row and the department: the two
                                // facts that decide whether this is a slip or
                                // the whole point of the split. Each row below
                                // carries its own number, so quoting it here
                                // points straight at the thing to look at.
                                var mismatchRows = []
                                entry.allocations.forEach(function (a, i) {
                                  if (!a.departmentId || Number(a.departmentId) === scopedType.department_id) return
                                  var d = departments.find(function (x) { return x.id === Number(a.departmentId) })
                                  mismatchRows.push({ rowNo: i + 1, deptName: d ? d.name : ('dept #' + a.departmentId) })
                                })
                                headerWarning = (
                                  <div className="relative overflow-hidden flex items-start gap-2 pl-3 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg">
                                    <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />
                                    <span className="shrink-0 mt-[3px] text-amber-600"><Icon name="alert" size={12} /></span>
                                    <p className="min-w-0 text-[11px] leading-snug text-slate-600">
                                      <span className="font-bold text-slate-900">Flagged, not blocked</span>
                                      {' · '}
                                      <span className="font-semibold text-slate-900">{scopedType.name}</span>
                                      {' is '}
                                      <span className={"font-semibold " + deptInk(typeDeptName)}>{typeDeptName}</span>
                                      {', but '}
                                      {mismatchRows.map(function (r, i) {
                                        return (
                                          <span key={r.rowNo}>
                                            {i === 0 ? '' : (i === mismatchRows.length - 1 ? ' and ' : ', ')}
                                            {'Row'}<span data-notranslate>{' ' + r.rowNo}</span>{' is '}
                                            <span className={"font-semibold " + deptInk(r.deptName)}>{r.deptName}</span>
                                          </span>
                                        )
                                      })}
                                      .
                                    </p>
                                  </div>
                                )
                              }
                            }
                            return (
                              <AllocationRows
                                allocations={entry.allocations}
                                accent="amber"
                                headerWarning={headerWarning}
                                onAdd={function () { addAllocation(idx) }}
                                onRemove={function (aIdx) { removeAllocation(idx, aIdx) }}
                                onDuplicate={function (aIdx) { duplicateAllocation(idx, aIdx) }}
                                isComplete={function (a) { return !!a.departmentId && !!a.venueId && !!a.expenseTypeId && !!a.amountRupees && Number(a.amountRupees) > 0 }}
                                renderChip={function (a) {
                                  var v = venues.find(function (x) { return String(x.id) === String(a.venueId) })
                                  var d = departments.find(function (x) { return String(x.id) === String(a.departmentId) })
                                  var et = expenseTypes.find(function (x) { return String(x.id) === String(a.expenseTypeId) })
                                  var st = expenseSubTypes.find(function (x) { return String(x.id) === String(a.expenseSubTypeId) })
                                  var typeLabel = st ? st.name : (et ? et.name : '')
                                  var amt = Number(a.amountRupees) || 0
                                  return {
                                    left: (
                                      <>
                                        {v && <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-[10px] font-semibold text-indigo-700 shrink-0">{v.code}</span>}
                                        {d && <span className={"font-medium truncate " + deptInk(d.name)}>{d.name}</span>}
                                        {typeLabel && <span className="text-slate-500 shrink-0">›</span>}
                                        {typeLabel && <span className="text-slate-500 truncate">{typeLabel}</span>}
                                        {a.remarks && <span className="text-slate-500 truncate italic">· "{a.remarks}"</span>}
                                      </>
                                    ),
                                    right: formatPoints(amt),
                                  }
                                }}
                                renderExpanded={function (alloc, aIdx) {
                                  var allocDeptId = alloc.departmentId ? Number(alloc.departmentId) : null
                                  var scopedTypes = allocDeptId ? expenseTypes.filter(function (t) { return t.department_id === allocDeptId }) : []
                                  var genericTypes = expenseTypes.filter(function (t) { return !t.department_id })
                                  var allocSubTypeOptions = alloc.expenseTypeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(alloc.expenseTypeId) }) : []
                                  var isFallback = !!alloc.expenseTypeId && !!allocDeptId && scopedTypes.findIndex(function (t) { return String(t.id) === String(alloc.expenseTypeId) }) === -1
                                  return (
                                    <div className="space-y-1.5">
                                      <div className="grid grid-cols-2 gap-2">
                                        <select value={alloc.departmentId}
                                          onChange={function (e) {
                                            var newDept = e.target.value
                                            var pick = pickBestAllocType(entries[idx], newDept)
                                            setEntries(function (prev) { return prev.map(function (en, i) { if (i !== idx) return en; var copy = Object.assign({}, en); copy.allocations = en.allocations.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { departmentId: newDept, expenseTypeId: pick.expenseTypeId, expenseSubTypeId: pick.expenseSubTypeId, venueId: '' }) : a }); return copy }) })
                                          }}
                                          className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }}>
                                          <option value="">Dept</option>
                                          {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                                        </select>
                                        <select value={alloc.venueId}
                                          onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                                          className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }}>
                                          <option value="">Venue</option>
                                          {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code}</option> })}
                                        </select>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <select value={alloc.expenseTypeId}
                                          onChange={function (e) { setEntries(function (prev) { return prev.map(function (en, i) { if (i !== idx) return en; var copy = Object.assign({}, en); copy.allocations = en.allocations.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { expenseTypeId: e.target.value, expenseSubTypeId: '' }) : a }); return copy }) }) }}
                                          className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }}>
                                          <option value="">Type</option>
                                          {scopedTypes.length > 0 && (
                                            <optgroup label="Dept-specific">
                                              {scopedTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                                            </optgroup>
                                          )}
                                          {genericTypes.length > 0 && (
                                            <optgroup label="Generic">
                                              {genericTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                                            </optgroup>
                                          )}
                                        </select>
                                        <select value={alloc.expenseSubTypeId}
                                          onChange={function (e) { updateAllocation(idx, aIdx, 'expenseSubTypeId', e.target.value) }}
                                          disabled={!alloc.expenseTypeId}
                                          className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200" style={{ fontSize: '16px' }}>
                                          <option value="">Sub-type</option>
                                          {allocSubTypeOptions.map(function (s) { return <option key={s.id} value={String(s.id)}>{s.name}</option> })}
                                        </select>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <input type="number" inputMode="numeric" value={alloc.amountRupees}
                                          onChange={function (e) { updateAllocation(idx, aIdx, 'amountRupees', e.target.value) }}
                                          placeholder="Amt" className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                                        <VoiceInput type="text" value={alloc.remarks}
                                          onChange={function (e) { updateAllocation(idx, aIdx, 'remarks', e.target.value) }}
                                          placeholder="Remarks" maxLength={200}
                                          className="w-full min-w-0 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" />
                                      </div>
                                      {isFallback && (
                                        <p className="text-[10px] text-amber-700 font-medium">⚠ No dept-specific match — using generic/top-level type</p>
                                      )}
                                    </div>
                                  )
                                }}
                              />
                            )
                          })()}</div>}
                            </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Amount + GST + Gross Total — bottom */}
              <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
                {entry.isItemPurchase && (
                  <p className="text-[10px] font-semibold text-slate-500">Amount auto-calculated from items × rate</p>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,17rem)_minmax(0,17rem)] gap-3">
                  <div>
                    <label htmlFor={'exp-amount-' + idx} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
                      <span className="shrink-0 w-5 h-5 rounded-md bg-indigo-50 text-indigo-500 inline-flex items-center justify-center"><Icon name="banknote" size={11} /></span>
                      Amount (pts) <span className="text-red-500">*</span>
                    </label>
                    <input id={'exp-amount-' + idx} type="number" inputMode="decimal"
                      value={entry.isItemPurchase ? computeItemsTotal(entry).toString() : entry.amount}
                      onChange={function (e) { if (!entry.isItemPurchase) updateEntry(idx, 'amount', e.target.value) }}
                      readOnly={entry.isItemPurchase}
                      placeholder="0" min="0" step="any"
                      className={"w-full px-3 py-2.5 border rounded-xl text-[13px] tabular-nums focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow " + (entry.isItemPurchase ? "border-slate-300 bg-slate-100 text-slate-600 font-semibold cursor-not-allowed" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400")}
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label htmlFor={'exp-gst-' + idx} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
                      <span className="shrink-0 w-5 h-5 rounded-md bg-indigo-50 text-indigo-500 inline-flex items-center justify-center"><Icon name="receipt" size={11} /></span>
                      GST Amount (pts)
                    </label>
                    <input id={'exp-gst-' + idx} type="number" inputMode="decimal" value={entry.taxAmount}
                      onChange={function (e) { updateEntry(idx, 'taxAmount', e.target.value) }}
                      placeholder="0" min="0" step="any"
                      className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" style={{ fontSize: '16px' }} />
                  </div>
                </div>
                {(function () {
                  var amt = entry.isItemPurchase ? computeItemsTotal(entry) : (Number(entry.amount) || 0)
                  var gst = Number(entry.taxAmount) || 0
                  var gross = amt + gst
                  return (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                      <span className="text-xs font-semibold text-slate-600">Gross Total</span>
                      <span className="text-[17px] font-bold text-slate-900 tabular-nums tracking-[-0.01em]">{gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                    </div>
                  )
                })()}
              </div>

              {/* Payment Method — only when vendor lookup field exists AND a vendor is picked */}
              {(function () {
                var split = getEntrySplit(entry)
                if (!split.vendorPicked) return null
                var baseRupees = entry.isItemPurchase ? computeItemsTotal(entry) : Number(entry.amount || 0)
                var taxRupees = Number(entry.taxAmount || 0)
                var amtRupees = baseRupees + taxRupees  // payable = base + tax
                if (amtRupees <= 0) return null
                var cashRupees = (split.cashPaise / 100)
                var creditRupees = (split.creditPaise / 100)
                var vendorRow = (lookupCache.vendors || []).find(function (v) {
                  return String(v.id) === String(entry.fieldValues[split.vendorFieldKey])
                })
                var vendorLabel = vendorRow ? vendorRow.name : ''
                var wOver = walletBalance != null && split.cashPaise > walletBalance
                return (
                  <div className="border border-indigo-200 rounded-lg bg-indigo-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-700">Payment Method</span>
                      <span className="text-[11px] text-slate-500">Total: {amtRupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cash from Wallet</label>
                        <input type="number" inputMode="decimal"
                          value={cashRupees ? String(cashRupees) : (split.creditPaise === 0 ? String(amtRupees) : '0')}
                          onChange={function (ev) { setPaymentCash(idx, ev.target.value) }}
                          min="0" step="any"
                          className={"w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white " + (wOver ? "border-red-300" : "border-slate-200")}
                          style={{ fontSize: '16px' }} />
                        {walletBalance != null && (
                          <p className={"text-[11px] mt-1 " + (wOver ? "text-red-600 font-medium" : "text-slate-500")}>
                            Wallet: {(walletBalance / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Credit to Vendor</label>
                        <input type="number" inputMode="decimal"
                          value={entry.paymentCreditRupees}
                          onChange={function (ev) { setPaymentCredit(idx, ev.target.value) }}
                          min="0" step="any" placeholder="0"
                          className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                          style={{ fontSize: '16px' }} />
                        {vendorLabel && (
                          <p className="text-[11px] text-indigo-600 mt-1 truncate">→ {vendorLabel}</p>
                        )}
                      </div>
                    </div>
                    {split.creditPaise > 0 && (function () {
                      var creditRupees = split.creditPaise / 100
                      var cashChecked = !!entry.payWithCash
                      var bankChecked = !!entry.payWithBank
                      var bothChecked = cashChecked && bankChecked
                      function togglePay(kind) {
                        setEntries(function (prev) {
                          return prev.map(function (en, ei) {
                            if (ei !== idx) return en
                            var patch = {}
                            if (kind === 'cash') {
                              patch.payWithCash = !en.payWithCash
                              if (!patch.payWithCash) { patch.paymentCreditCashRupees = ''; patch.cashDueDate = '' }
                              else if (!en.payWithBank) { patch.paymentCreditCashRupees = String(creditRupees) }
                            } else {
                              patch.payWithBank = !en.payWithBank
                              if (!patch.payWithBank) { patch.paymentCreditBankRupees = ''; patch.bankDueDate = '' }
                              else if (!en.payWithCash) { patch.paymentCreditBankRupees = String(creditRupees) }
                            }
                            // If both now checked and only one has a value, set the other to remainder
                            var nowCash = patch.payWithCash !== undefined ? patch.payWithCash : en.payWithCash
                            var nowBank = patch.payWithBank !== undefined ? patch.payWithBank : en.payWithBank
                            if (nowCash && nowBank) {
                              var cv = Number((patch.paymentCreditCashRupees !== undefined ? patch.paymentCreditCashRupees : en.paymentCreditCashRupees) || 0)
                              var bv = Number((patch.paymentCreditBankRupees !== undefined ? patch.paymentCreditBankRupees : en.paymentCreditBankRupees) || 0)
                              if (cv > 0 && bv === 0) patch.paymentCreditBankRupees = String(Math.max(0, creditRupees - cv))
                              else if (bv > 0 && cv === 0) patch.paymentCreditCashRupees = String(Math.max(0, creditRupees - bv))
                            }
                            return Object.assign({}, en, patch)
                          })
                        })
                      }
                      function setCashPortion(v) {
                        setEntries(function (prev) {
                          return prev.map(function (en, ei) {
                            if (ei !== idx) return en
                            var patch = { paymentCreditCashRupees: v }
                            if (en.payWithBank) {
                              var cv = Number(v || 0)
                              patch.paymentCreditBankRupees = String(Math.max(0, creditRupees - cv))
                            }
                            return Object.assign({}, en, patch)
                          })
                        })
                      }
                      function setBankPortion(v) {
                        setEntries(function (prev) {
                          return prev.map(function (en, ei) {
                            if (ei !== idx) return en
                            var patch = { paymentCreditBankRupees: v }
                            if (en.payWithCash) {
                              var bv = Number(v || 0)
                              patch.paymentCreditCashRupees = String(Math.max(0, creditRupees - bv))
                            }
                            return Object.assign({}, en, patch)
                          })
                        })
                      }
                      function setDate(field, v) {
                        setEntries(function (prev) {
                          return prev.map(function (en, ei) {
                            var o = {}; o[field] = v
                            return ei === idx ? Object.assign({}, en, o) : en
                          })
                        })
                      }
                      function setBankGst(v) {
                        setEntries(function (prev) {
                          return prev.map(function (en, ei) {
                            return ei === idx ? Object.assign({}, en, { taxAmount: v }) : en
                          })
                        })
                      }
                      var portionSum = (Number(entry.paymentCreditCashRupees || 0) + Number(entry.paymentCreditBankRupees || 0))
                      var mismatched = bothChecked && Math.abs(portionSum - creditRupees) > 0.001
                      return (
                        <div className="pt-2 border-t border-indigo-200 space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-2">Pay Credit By <span className="text-red-500">*</span></label>
                            <div className="flex gap-2">
                              <label className={"flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border cursor-pointer transition-colors " + (cashChecked ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50")}>
                                <input type="checkbox" checked={cashChecked} onChange={function () { togglePay('cash') }} className="w-4 h-4" />
                                <span>💵 Cash</span>
                              </label>
                              <label className={"flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border cursor-pointer transition-colors " + (bankChecked ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50")}>
                                <input type="checkbox" checked={bankChecked} onChange={function () { togglePay('bank') }} className="w-4 h-4" />
                                <span>🏦 Bank</span>
                              </label>
                            </div>
                          </div>

                          {(cashChecked || bankChecked) && (
                            <div className="grid grid-cols-2 gap-2">
                              {/* Cash column */}
                              <div className="space-y-2">
                                {cashChecked ? (
                                  <>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cash Portion (pts) <span className="text-red-500">*</span></label>
                                      <input type="number" inputMode="decimal"
                                        value={entry.paymentCreditCashRupees}
                                        onChange={function (ev) { setCashPortion(ev.target.value) }}
                                        min="0" step="any" placeholder="0"
                                        disabled={!bothChecked}
                                        className={"w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 " + (bothChecked ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-500")}
                                        style={{ fontSize: '16px' }} />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cash Due Date <span className="text-red-500">*</span></label>
                                      <input type="date"
                                        value={entry.cashDueDate}
                                        min={entry.expenseDate}
                                        onChange={function (ev) { setDate('cashDueDate', ev.target.value) }}
                                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                                        style={{ fontSize: '16px' }} />
                                    </div>
                                  </>
                                ) : null}
                              </div>
                              {/* Bank column */}
                              <div className="space-y-2">
                                {bankChecked ? (
                                  <>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bank Portion (pts) <span className="text-red-500">*</span></label>
                                      <input type="number" inputMode="decimal"
                                        value={entry.paymentCreditBankRupees}
                                        onChange={function (ev) { setBankPortion(ev.target.value) }}
                                        min="0" step="any" placeholder="0"
                                        disabled={!bothChecked}
                                        className={"w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 " + (bothChecked ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-500")}
                                        style={{ fontSize: '16px' }} />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bank Due Date <span className="text-red-500">*</span></label>
                                      <input type="date"
                                        value={entry.bankDueDate}
                                        min={entry.expenseDate}
                                        onChange={function (ev) { setDate('bankDueDate', ev.target.value) }}
                                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                                        style={{ fontSize: '16px' }} />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">GST Amount (pts)</label>
                                      <input type="number" inputMode="decimal"
                                        value={entry.taxAmount}
                                        onChange={function (ev) { setBankGst(ev.target.value) }}
                                        min="0" step="any" placeholder="0"
                                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                                        style={{ fontSize: '16px' }} />
                                      <p className="text-[10px] text-slate-500 mt-0.5">Mirrors the GST field above</p>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          )}

                          {mismatched && (
                            <p className="text-[11px] text-red-600 font-medium">
                              Cash + Bank = {portionSum.toLocaleString('en-IN')} pts · must equal {creditRupees.toLocaleString('en-IN')} pts
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* Receipt */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Receipt <span className="text-red-500">*</span></label>
                {isEditing && existingReceipts.length > 0 && (function () {
                  var visible = existingReceipts.filter(function (p) { return removedReceipts.indexOf(p) === -1 })
                  var pending = removedReceipts.length
                  return (
                    <div className="mb-3 p-2 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">
                          📎 Existing ({visible.length}{pending > 0 ? ' · ' + pending + ' marked to remove' : ''})
                        </span>
                        {pending > 0 && (
                          <button type="button" onClick={function () { setRemovedReceipts([]) }}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800">Undo</button>
                        )}
                      </div>
                      {visible.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {visible.map(function (path) {
                            var url = supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl
                            var isVoice = /\.(webm|ogg|mp3|wav)$/i.test(path)
                            var isPdf = /\.pdf$/i.test(path)
                            return (
                              <div key={path} className="relative">
                                {isVoice ? (
                                  <div className="h-24 rounded-lg border border-blue-200 bg-white flex items-center justify-center text-blue-600 text-2xl">🎙</div>
                                ) : isPdf ? (
                                  <div className="h-24 rounded-lg border border-blue-200 bg-white flex items-center justify-center text-blue-600 text-2xl">📄</div>
                                ) : (
                                  <img src={url} alt="Existing receipt"
                                    onClick={function () { setZoomImg(url) }}
                                    className="h-24 w-full rounded-lg border border-blue-200 object-cover cursor-pointer active:opacity-80" />
                                )}
                                <button type="button" onClick={function () { setRemovedReceipts(function (prev) { return prev.concat([path]) }) }}
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-sm hover:bg-red-600">✕</button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {entry.receiptFiles.length > 0 ? (
                  <div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {entry.receiptPreviews.map(function (url, rIdx) {
                        var file = entry.receiptFiles[rIdx]
                        var isPdf = file && file.type === 'application/pdf'
                        return (
                          <div key={rIdx} className="relative">
                            {isPdf ? (
                              <div className="h-24 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-500 px-1">
                                <span className="text-2xl">📄</span>
                                <span className="text-[10px] truncate max-w-full">{file.name}</span>
                              </div>
                            ) : (
                              <img src={url} alt={"Receipt " + (rIdx + 1)}
                                onClick={function () { setZoomImg(url) }}
                                className="h-24 w-full rounded-lg border border-slate-200 object-cover cursor-pointer active:opacity-80" />
                            )}
                            <button type="button" onClick={function () { removeReceipt(idx, rIdx) }}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-sm hover:bg-red-600">✕</button>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-[10px] text-slate-500 text-center mb-2">{entry.receiptFiles.length} receipt{entry.receiptFiles.length > 1 ? 's' : ''} attached · tap image to enlarge</p>
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                        <Icon name="gallery" className="w-4 h-4" /><span>Add more</span>
                        <input type="file" accept="image/*,.pdf" multiple className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                        <Icon name="camera" className="w-4 h-4" /><span>Photo</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                    </div>
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
                ) : (entry.receiptFilesMeta && entry.receiptFilesMeta.length > 0) || entry.audioBlobMeta ? (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-[11px] mb-2">
                    <div className="font-bold mb-0.5">🔗 Please re-attach — restored from draft</div>
                    {entry.receiptFilesMeta && entry.receiptFilesMeta.length > 0 && (
                      <div className="truncate">
                        {entry.receiptFilesMeta.length} receipt{entry.receiptFilesMeta.length > 1 ? 's' : ''}: {entry.receiptFilesMeta.map(function (m) { return m.name }).join(', ')}
                      </div>
                    )}
                    {entry.audioBlobMeta && <div>1 voice note</div>}
                    <div className="flex gap-2 mt-2">
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 text-[12px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                        <Icon name="gallery" className="w-[18px] h-[18px]" /><span>Gallery</span>
                        <input type="file" accept="image/*,.pdf" multiple className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 text-[12px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                        <Icon name="camera" className="w-[18px] h-[18px]" /><span>Camera</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                      <button type="button" onClick={function () { startRecording(idx) }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-slate-300 text-[12px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                        <Icon name="mic" className="w-[18px] h-[18px]" /><span>Voice</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 lg:max-w-3xl">
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                      <Icon name="gallery" className="w-[18px] h-[18px]" /><span>Gallery</span>
                      <input type="file" accept="image/*,.pdf" multiple className="hidden"
                        onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                    </label>
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                      <Icon name="camera" className="w-[18px] h-[18px]" /><span>Camera</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                    </label>
                    <button type="button" onClick={function () { startRecording(idx) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                      <Icon name="mic" className="w-[18px] h-[18px]" /><span>Voice</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {(function () {
        if (walletBalance == null) return null
        if (isAdminEdit) return null
        var totalWalletSpend = 0
        for (var i = 0; i < entries.length; i++) {
          totalWalletSpend += getEntrySplit(entries[i]).walletSpendPaise
        }
        var oldSpend = 0
        if (editExp) {
          // v87+: amount_paise is gross → wallet debit = payment_cash_paise (tax already included)
          oldSpend = (editExp.payment_credit_paise || 0) > 0
            ? (editExp.payment_cash_paise || 0)
            : (editExp.amount_paise || 0)
        }
        var effAvail = walletBalance + oldSpend
        if (totalWalletSpend <= effAvail) return null
        var shortPts = ((totalWalletSpend - effAvail) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
        var availPts = (effAvail / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
        return (
          /* Red, not amber: a negative wallet already renders red on the home
             card and in the expense list, so the warning that you are about to
             cause one should speak the same colour. */
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-300">
            <Icon name="alert" className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-red-900 leading-snug">Wallet will go negative</p>
              {/* The two figures were buried mid-sentence; they are the only part
                  of this warning anyone reads, so they get their own line. */}
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-red-800">
                <span>Available <span className="font-semibold tabular-nums">{availPts} pts</span></span>
                <span>Short by <span className="font-bold tabular-nums text-red-900">{shortPts} pts</span></span>
              </p>
              <p className="mt-1.5 text-[11px] text-red-700">You can still submit — this is a warning, not a block.</p>
            </div>
          </div>
        )
      })()}

      {/* Inline error card — sits right above the Submit button, always visible, easy screenshot */}
      {error && error.indexOf('Insufficient wallet balance') === -1 && (
        <div ref={errorRef} className="ambria-rise p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-sm">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-bold uppercase text-[10px] tracking-wider text-red-600">Submit failed</span>
            <div className="flex gap-1.5 flex-shrink-0">
              <button type="button" onClick={function (ev) {
                var b = ev.currentTarget
                try {
                  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(error) }
                  else {
                    var ta = document.createElement('textarea'); ta.value = error; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
                  }
                  var orig = b.textContent; b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = orig }, 1500)
                } catch (_) {}
              }}
                className="px-2 py-0.5 text-[10px] font-bold bg-white border border-red-300 text-red-700 rounded hover:bg-red-100">
                📋 Copy
              </button>
              <button type="button" onClick={function () { setError('') }}
                className="px-2 py-0.5 text-[10px] font-bold bg-white border border-red-300 text-red-700 rounded hover:bg-red-100">
                ✕
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-tight max-h-40 overflow-y-auto m-0">{error}</pre>
        </div>
      )}

      {/* Add entry + Submit bar. Sticky to the bottom of the viewport: the form
          runs several screens long, and having to scroll all the way down to
          reach Submit was the single worst thing about filling it in. The
          negative margins let it sit flush against the viewport edges while the
          form itself stays inside its padded column. */}
      <div className="ambria-glass sticky bottom-0 z-30 -mx-4 px-4 pt-3 pb-3 border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
        <div className="flex gap-3">
          {!isEditing && (
            <button type="button" onClick={addEntry}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-[13px] font-semibold text-slate-600 bg-white hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              {/* The "+" is an icon now, not a character in the label: the
                  extractor treats a string containing a bare + as code and
                  skipped it, so "+ Add another" never reached the dictionary. */}
              <Icon name="plus" size={14} strokeWidth={2.4} />
              Add another
            </button>
          )}
          <button type="button" onClick={handleSubmit} disabled={saving}
            className={'flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-[13px] text-white transition-all ' +
              (saving
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] hover:from-indigo-600 hover:to-indigo-700 active:scale-[0.98]')}>
            <Icon name={saving ? 'refresh' : 'send'} size={15} />
            {saving
              ? (isEditing ? 'Updating…' : 'Submitting…')
              : isAdminEdit ? 'Update type'
              : isEditing ? 'Update expense'
              : (
                <>
                  Submit
                  {entries.length > 1 && <span data-notranslate className="tabular-nums opacity-80">{" · " + entries.length}</span>}
                </>
              )}
            {!saving && <Icon name="arrowRight" size={14} className="opacity-70" />}
          </button>
        </div>
      </div>

      {zoomImg && createPortal((
        <div onClick={function () { setZoomImg('') }}
          className="fixed inset-0 z-[9998] bg-black/90 flex items-center justify-center p-4" style={{ margin: 0 }}>
          <button onClick={function () { setZoomImg('') }}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 text-white rounded-full text-xl flex items-center justify-center hover:bg-white/30">✕</button>
          <img src={zoomImg} alt="Receipt" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      ), document.body)}
    </div>
  )
}

export default ExpenseForm
