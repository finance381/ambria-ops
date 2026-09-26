import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import SearchDropdown from '../../components/ui/SearchDropdown'
import FilterDropdown from '../../components/ui/FilterDropdown'
import { logActivity } from '../../lib/logger'
import { formatDate, formatDateTime } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import VoiceInput from '../../components/ui/VoiceInput'
import SearchField from '../../components/ui/SearchField'
import EventDatePicker from '../../components/ui/EventDatePicker'
import Icon from '../../components/ui/Icon'
import CheckedStamp from '../../components/ui/CheckedStamp'
import CameraCapture from '../../components/ui/CameraCapture'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { getReceiptUrl, isVoiceNotePath } from '../../lib/uploadHelper'
import { compressImage } from '../../lib/imageCompress'
import ReverseDialog from '../../components/ui/ReverseDialog'
import { pushBack, goBack as navBack } from '../../lib/backNav'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

var PARTY_TYPES = [
  { key: 'expense', label: 'Expense Type', icon: 'ti-receipt' },
  { key: 'event', label: 'Event', icon: 'ti-calendar-event' },
  { key: 'vendor', label: 'Vendor', icon: 'ti-building-store' },
  { key: 'employee', label: 'Employee', icon: 'ti-user' },
]

// Transfers only ever move cost between expense types now (no event/vendor/employee
// parties for new transfers) — one From, and one-or-many To rows so a single source
// can be split across several destination types in one go.
function makeToRow() {
  return { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8), expense_type_id: '', expense_sub_type_id: '', meta: {}, amount_pts: '', remarks: '' }
}
function makeEmptyForm() {
  return {
    from: { expense_type_id: '', expense_sub_type_id: '', meta: {} },
    to_rows: [makeToRow()],
    description: '',
    effective_date: new Date().toISOString().substring(0, 10),
  }
}

// The phone's ground behind Cost Transfers, in the app's own indigo and kept
// quiet: a wash from pale lavender at the top to near-white at the foot, two
// soft glows with no edges to them, and a fine dot grid that fades out as it
// goes down. Colour enough that the screen is not a grey sheet, and nothing
// with an edge or a subject to compete with the white cards on top of it.
// The body takes the foot's colour while the screen is up, so dragging past
// either end of the list meets the same tone. The admin console has its own
// ground and gets none of this.
var COST_BG_TOP = '#ECEEFF'
var COST_BG_FOOT = '#F8F8FD'

function CostBackdrop({ inAdmin }) {
  useEffect(function () {
    if (inAdmin) return
    var b = document.body
    var h = document.documentElement
    var prevBg = b.style.backgroundColor
    var prevHtmlBg = h.style.backgroundColor
    var prevOver = b.style.overscrollBehaviorY
    b.style.backgroundColor = COST_BG_FOOT
    h.style.backgroundColor = COST_BG_FOOT
    b.style.overscrollBehaviorY = 'none'
    return function () {
      b.style.backgroundColor = prevBg
      h.style.backgroundColor = prevHtmlBg
      b.style.overscrollBehaviorY = prevOver
    }
  }, [inAdmin])

  if (inAdmin) return null
  return (
    <div aria-hidden="true" className="sm:hidden pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, ' + COST_BG_TOP + ' 0%, #F3F3FE 38%, ' + COST_BG_FOOT + ' 100%)', minHeight: '100lvh' }}>
      <div className="absolute -top-24 -right-24 w-[26rem] h-[26rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.28) 0%, rgba(129,140,248,0) 70%)' }} />
      <div className="absolute top-[38%] -left-32 w-[28rem] h-[28rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.16) 0%, rgba(167,139,250,0) 70%)' }} />
      <div className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(79,70,229,0.10) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.35) 45%, transparent 80%)',
          maskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.35) 45%, transparent 80%)',
        }} />
    </div>
  )
}

function CostTransfers({ profile, inAdmin }) {
  var canCreate = hasPerm(profile?.permsNew, 'finance.cost_transfers')
  var isAdmin = hasPerm(profile?.permsNew, 'admin.dashboard')
  var canMarkChecked = hasPerm(profile?.permsNew, 'finance.wallet.mark_checked')
  var [checkingTransferId, setCheckingTransferId] = useState(null)
  var [transfers, setTransfers] = useState([])
  var [loading, setLoading] = useState(true)
  // A refetch after the first keeps the rows on screen, dimmed, instead of
  // blanking the table to "Loading..." for every change of filter.
  var [refreshing, setRefreshing] = useState(false)
  var loadReqRef = useRef(0)
  var [showForm, setShowForm] = useState(false)
  var [saving, setSaving] = useState(false)
  var [reversing, setReversing] = useState(null)
  var [error, setError] = useState('')
  var [expandedBatches, setExpandedBatches] = useState({})
  // Desktop only: the table's sort, and which row's ⋮ menu is open.
  var [sortBy, setSortBy] = useState('date_desc')
  // Ten entries a page. An entry is a group — a split's allocations stay
  // together on one page rather than breaking across two. Any change to what
  // the list holds or its order goes back to page one: page three of the old
  // list is not page three of the new one.
  var PAGE_SIZE = 10
  var [page, setPage] = useState(1)
  var listTopRef = useRef(null)
  var [menuRowId, setMenuRowId] = useState(null)
  var [editTarget, setEditTarget] = useState(null) // the cost_transfers row being edited
  var [editForm, setEditForm] = useState(null)
  var [editSaving, setEditSaving] = useState(false)
  var [editError, setEditError] = useState('')

  // One proof slot per form — image/PDF or a voice note, same three ways in as
  // the expense form (capture, upload, or record), mutually exclusive.
  var [proofFile, setProofFile] = useState(null)
  var proofRec = useAudioRecorder()
  var [showCamera, setShowCamera] = useState(false)
  var [editProofFile, setEditProofFile] = useState(null)
  var editProofRec = useAudioRecorder()
  var [editShowCamera, setEditShowCamera] = useState(false)
  var [editRemoveReceipt, setEditRemoveReceipt] = useState(false)

  function resetProof() {
    setProofFile(null)
    proofRec.remove()
  }

  // Uploads whichever of file/voice-note is set (they're mutually exclusive in
  // the UI) and returns the storage path, or null if neither is set.
  async function uploadTransferProof(file, rec) {
    if (file) {
      var isPdf = file.type === 'application/pdf'
      var compressed = isPdf ? file : await compressImage(file, 150)
      var path = profile.id + '/costxfer_' + Date.now() + (isPdf ? '.pdf' : '.jpg')
      var up = await supabase.storage.from('receipts').upload(path, compressed, { upsert: true, contentType: isPdf ? 'application/pdf' : 'image/jpeg' })
      if (up.error) throw new Error('Proof upload failed: ' + up.error.message)
      return path
    }
    if (rec.blob) {
      var vPath = profile.id + '/costxfer_' + Date.now() + '.webm'
      var vUp = await supabase.storage.from('receipts').upload(vPath, rec.blob, { upsert: true, contentType: 'audio/webm' })
      if (vUp.error) throw new Error('Voice note upload failed: ' + vUp.error.message)
      return vPath
    }
    return null
  }

  var [events, setEvents] = useState([])
  var [vendors, setVendors] = useState([])
  var [jobDepts, setJobDepts] = useState([])
  var refData = useReferenceData()
  var employees = refData.employees
  var expTypes = refData.expenseTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var expSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  var [categories, setCategories] = useState([])

  var [form, setForm] = useState(makeEmptyForm)

  // "For a Function?" — optional event tag applied to the whole transfer (both From and
  // every To row), mirroring the toggle on the expense submit form.
  var [isFunction, setIsFunction] = useState(false)
  var [eventDate, setEventDate] = useState('')
  var [eventId, setEventId] = useState('')
  var [formEvents, setFormEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)

  // Functions by date, remembered. Pressing a date used to be a round trip
  // every time, and the list sat empty until it came back. Turning "For a
  // function?" on now fetches the months around today in one query and files
  // them by date, so a date in that window answers at once; a date outside it
  // is fetched on its own the old way, and remembered too.
  var EVENT_COLS = 'id, event_name, function_date, contract_type, venue_name, session, client_name, department, contract_no, created_user_name'
  var eventsByDateRef = useRef({})
  var prefetchedRef = useRef(false)

  function isoDay(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }

  async function prefetchEvents() {
    if (prefetchedRef.current) return
    prefetchedRef.current = true
    var from = new Date(); from.setDate(from.getDate() - 45)
    var to = new Date(); to.setDate(to.getDate() + 120)
    var { data, error } = await supabase.from('events')
      .select(EVENT_COLS)
      .gte('function_date', isoDay(from))
      .lte('function_date', isoDay(to))
      .order('function_date')
      .order('event_name')
    if (error) { prefetchedRef.current = false; return }
    var rows = data || []
    // The server caps a reply at 1000 rows. If this one hit the cap, the last
    // date in it may be cut short and everything after it is missing, so the
    // window is trusted only up to the day before the last date it holds;
    // later dates are fetched one at a time as before.
    var until = isoDay(to)
    if (rows.length >= 1000) {
      var last = String(rows[rows.length - 1].function_date || '').slice(0, 10)
      var cut = new Date(last + 'T00:00:00'); cut.setDate(cut.getDate() - 1)
      until = isoDay(cut)
    }
    var byDate = {}
    // Every trusted day gets an entry, empty ones included, so a date with
    // nothing on it is known to have nothing rather than fetched again.
    for (var d = new Date(from); isoDay(d) <= until; d.setDate(d.getDate() + 1)) byDate[isoDay(d)] = []
    rows.forEach(function (r) {
      var k = String(r.function_date || '').slice(0, 10)
      if (byDate[k]) byDate[k].push(r)
    })
    eventsByDateRef.current = Object.assign(byDate, eventsByDateRef.current)
  }

  function showEventsFor(rows) {
    setFormEvents(rows)
    if (rows.length === 1) setEventId(String(rows[0].id))
    else if (!rows.some(function (r) { return String(r.id) === eventId })) setEventId('')
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setFormEvents([]); setEventId(''); return }
    var cached = eventsByDateRef.current[dateStr]
    if (cached) { setEventsLoading(false); showEventsFor(cached); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select(EVENT_COLS)
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    eventsByDateRef.current[dateStr] = rows
    setEventsLoading(false)
    showEventsFor(rows)
  }

  // Once a function is picked the calendar and list fold into one line
  // naming it, with Change to open them again; the form below is where the
  // user is headed next. fnQuery narrows a busy day's list.
  var [fnPickerOpen, setFnPickerOpen] = useState(true)
  var [fnQuery, setFnQuery] = useState('')
  function toggleFunction(val) {
    setIsFunction(val)
    setFnPickerOpen(true)
    setFnQuery('')
    if (val) prefetchEvents()
    if (!val) { setEventId(''); setEventDate(''); setFormEvents([]) }
  }

  // Filters
  var [fromPartyFilter, setFromPartyFilter] = useState('')
  var [toPartyFilter, setToPartyFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('all') // 'all' | 'active' | 'reversed'
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [searchRaw, setSearchRaw] = useState('')
  var [searchD, setSearchD] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)
  // Here, below the filters it watches: written above them it read each one
  // before it was assigned, saw undefined every render, and never fired.
  useEffect(function () { setPage(1) }, [statusFilter, fromPartyFilter, toPartyFilter, dateFrom, dateTo, searchD, sortBy])

  useEffect(function () {
    var t = setTimeout(function () { setSearchD(searchRaw) }, 400)
    return function () { clearTimeout(t) }
  }, [searchRaw])

  useEffect(function () { loadLookups() }, [])

  useEffect(function () { loadTransfers() }, [fromPartyFilter, toPartyFilter, dateFrom, dateTo, searchD])

  // Realtime: refresh list on any cost_transfers change. Subscribed once, and
  // through a ref so the refresh uses the filters of the moment — it used to
  // tear the channel down and open a new one on every change of filter.
  var loadTransfersRef = useRef(null)
  useEffect(function () {
    var channel = supabase.channel('cost_transfers_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_transfers' }, function () { if (loadTransfersRef.current) loadTransfersRef.current() })
      .subscribe()
    return function () { supabase.removeChannel(channel) }
  }, [])

  async function loadLookups() {
    try {
      var results = await Promise.all([
        supabase.from('events').select('id, function_date, event_name, client_name').order('function_date', { ascending: false }).limit(500),
        supabase.from('vendors').select('id, name, category_ids').eq('active', true).order('name'),
        supabase.from('job_departments').select('id, name').order('name'),
        supabase.from('categories').select('id, sub_department_id').order('id'),
      ])
      setEvents(results[0].data || [])
      setVendors(results[1].data || [])
      setJobDepts(results[2].data || [])
      setCategories(results[3].data || [])
    } catch (_) { setError('Lookup load failed') }
  }

  // Status is not asked of the server. All, Active and Reversed are three
  // views of the same rows, and each press used to be a round trip with the
  // table blank until it came back; now it is a filter over rows already
  // here, and it is instant. The filters that do narrow the query keep the
  // old rows on screen while the new ones load, and a ticket stops a slow
  // earlier reply from landing on top of a newer one.
  async function loadTransfers() {
    var ticket = ++loadReqRef.current
    if (transfers.length === 0) setLoading(true)
    else setRefreshing(true)
    try {
      var q = supabase.from('cost_transfers').select('*').order('created_at', { ascending: false }).limit(500)
      if (fromPartyFilter) q = q.eq('from_party_type', fromPartyFilter)
      if (toPartyFilter) q = q.eq('to_party_type', toPartyFilter)
      if (dateFrom) q = q.gte('effective_date', dateFrom)
      if (dateTo) q = q.lte('effective_date', dateTo)
      if (searchD) q = q.ilike('description', '%' + searchD + '%')
      var res = await q
      if (ticket !== loadReqRef.current) return
      if (res.error) throw res.error
      setTransfers(res.data || [])
    } catch (err) { if (ticket === loadReqRef.current) setError(err.message || 'Load failed') }
    if (ticket === loadReqRef.current) { setLoading(false); setRefreshing(false) }
  }
  loadTransfersRef.current = loadTransfers

  var shownTransfers = transfers.filter(function (r) {
    if (statusFilter === 'active') return r.reversal_of == null && r.reversed_by_id == null
    if (statusFilter === 'reversed') return r.reversed_by_id != null
    return true
  })

  // The filters are what the Filters panel holds — status, the two parties,
  // the dates. The search box sits outside the panel and has its own clear,
  // so it is neither counted on the Filters badge nor cleared by Reset.
  function resetFilters() {
    setFromPartyFilter(''); setToPartyFilter('')
    setStatusFilter('all')
    setDateFrom(''); setDateTo('')
  }

  function activeFilterCount() {
    var n = 0
    if (fromPartyFilter) n++
    if (toPartyFilter) n++
    if (statusFilter !== 'all') n++
    if (dateFrom) n++
    if (dateTo) n++
    return n
  }

  function partyLabel(row, side) {
    var t = row[side + '_party_type']
    if (t === 'expense') {
      var et = expTypes.find(function (x) { return x.id === row[side + '_expense_type_id'] })
      var est = row[side + '_expense_sub_type_id'] ? expSubTypes.find(function (x) { return x.id === row[side + '_expense_sub_type_id'] }) : null
      var name = et ? et.name : ('Type#' + row[side + '_expense_type_id'])
      return est ? (name + ' → ' + est.name) : name
    }
    if (t === 'event') {
      var ev = events.find(function (x) { return x.id === row[side + '_event_id'] })
      if (!ev) return 'Event#' + row[side + '_event_id']
      return (ev.event_name || ev.client_name || 'Event') + ' · ' + (ev.function_date || '')
    }
    if (t === 'vendor') {
      var vd = vendors.find(function (x) { return x.id === row[side + '_vendor_id'] })
      return vd ? vd.name : ('Vendor#' + row[side + '_vendor_id'])
    }
    if (t === 'employee') {
      var em = employees.find(function (x) { return x.id === row[side + '_employee_id'] })
      return em ? em.full_name : 'Employee'
    }
    return t
  }

  // The desktop table's From / To. An expense party is two names — its type
  // and the sub-type under it — and joined with an arrow on one line they
  // broke wherever the column ran out ("LGT-Light (ADD) → LGT-" / "Casual
  // Labour Expenses"). Stacked, the type reads first and the sub-type under
  // it in grey, each whole.
  function partyCell(row, side) {
    var subId = row[side + '_party_type'] === 'expense' ? row[side + '_expense_sub_type_id'] : null
    if (!subId) return <div className="text-slate-900">{partyLabel(row, side)}</div>
    var et = expTypes.find(function (x) { return x.id === row[side + '_expense_type_id'] })
    var est = expSubTypes.find(function (x) { return x.id === subId })
    return (
      <div>
        <div className="text-slate-900">{et ? et.name : ('Type#' + row[side + '_expense_type_id'])}</div>
        {est && <div className="mt-0.5 text-[12.5px] text-slate-500">{est.name}</div>}
      </div>
    )
  }

  function partyMeta(row, side) {
    if (row[side + '_party_type'] !== 'expense') return null
    var meta = row[side + '_meta'] || {}
    var items = []
    if (meta._event_name) items.push({ label: 'Event', value: '🎯 ' + meta._event_name })
    var subId = row[side + '_expense_sub_type_id']
    var picked = subId ? expSubTypes.find(function (x) { return x.id === subId }) : null
    if (picked && Array.isArray(picked.extra_fields)) {
      picked.extra_fields.forEach(function (f) {
        if (f.type !== 'lookup' || !f.source) return
        var val = meta[f.key]
        if (val === '' || val == null) return
        var label = ''
        if (f.source === 'vendors') {
          var vd = vendors.find(function (x) { return String(x.id) === String(val) })
          label = vd ? vd.name : ('#' + val)
        } else if (f.source === 'venues') {
          var vn = venues.find(function (x) { return String(x.id) === String(val) })
          label = vn ? (vn.code ? vn.code + ' — ' + vn.name : vn.name) : ('#' + val)
        } else if (f.source === 'job_departments') {
          var emp = employees.find(function (x) { return String(x.id) === String(val) })
          label = emp ? emp.full_name : ('#' + val)
        }
        if (label) items.push({ label: f.label, value: label })
      })
    }
    if (items.length === 0) return null
    return (
      <div className="mt-1 space-y-0.5">
        {items.map(function (it, i) {
          return (
            <div key={i} className="text-[10px] text-gray-500">
              <span className="font-medium">{it.label}:</span> {it.value}
            </div>
          )
        })}
      </div>
    )
  }

  function updForm(patch) {
    setForm(function (p) { return Object.assign({}, p, patch) })
  }
  function updFrom(patch) {
    setForm(function (p) { return Object.assign({}, p, { from: Object.assign({}, p.from, patch) }) })
  }
  function updToRow(idx, patch) {
    setForm(function (p) {
      var rows = p.to_rows.map(function (r, i) { return i === idx ? Object.assign({}, r, patch) : r })
      return Object.assign({}, p, { to_rows: rows })
    })
  }
  // One To row is open at a time. Adding a row opens the new one and folds
  // the rest into a one-line summary each, so a split into four is four short
  // lines and one form, not four forms down the page. A summary opens its
  // row again. null means the last row, which is where a new form starts.
  var [openToKey, setOpenToKey] = useState(null)
  function isToRowOpen(row, idx) {
    return openToKey ? row._key === openToKey : idx === form.to_rows.length - 1
  }
  function addToRow() {
    var nr = makeToRow()
    setForm(function (p) { return Object.assign({}, p, { to_rows: p.to_rows.concat([nr]) }) })
    setOpenToKey(nr._key)
  }
  function removeToRow(idx) {
    setForm(function (p) {
      if (p.to_rows.length <= 1) return p
      return Object.assign({}, p, { to_rows: p.to_rows.filter(function (_, i) { return i !== idx }) })
    })
    setOpenToKey(null)
  }
  // The line for a To row in the list: what it moves to and how much. The
  // row being edited is marked, and its form opens under the From | To pair.
  function toRowSummary(row, idx) {
    var active = isToRowOpen(row, idx)
    var et = expTypes.find(function (x) { return String(x.id) === String(row.expense_type_id) })
    var est = row.expense_sub_type_id ? expSubTypes.find(function (x) { return String(x.id) === String(row.expense_sub_type_id) }) : null
    var amt = Number(row.amount_pts) || 0
    return (
      <div key={row._key} className={"flex items-center gap-2 rounded-xl border transition-colors " + (active ? "border-indigo-300 bg-white" : "border-slate-200 bg-white hover:border-slate-300")}>
        <button type="button" onClick={function () { setOpenToKey(row._key) }}
          className="flex-1 min-w-0 flex items-center gap-3 px-3.5 py-2.5 text-left">
          <span className={"shrink-0 w-6 h-6 rounded-full text-[11px] font-bold inline-flex items-center justify-center " + (active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700")}>{idx + 1}</span>
          <span className="min-w-0 flex-1">
            <span className={"block truncate text-[13.5px] " + (et ? "font-semibold text-slate-900" : "text-slate-600")}>
              {et ? et.name : 'No expense type yet'}
            </span>
            {est && <span className="block truncate text-[12px] text-slate-600">{est.name}</span>}
          </span>
          <span className={"shrink-0 text-[13.5px] tabular-nums " + (amt > 0 ? "font-bold text-slate-900" : "font-medium text-slate-600")}>
            Rs {amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
          <Icon name={active ? 'edit' : 'chevronDown'} size={15} className={"shrink-0 " + (active ? "text-indigo-500" : "text-slate-500")} />
        </button>
        {form.to_rows.length > 1 && (
          <button type="button" onClick={function () { removeToRow(idx) }} aria-label={'Remove row ' + (idx + 1)}
            className="shrink-0 mr-1.5 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
    )
  }

  function validExpense(v) { return !!v.expense_type_id }

  function sameExpense(a, b) {
    return String(a.expense_type_id) === String(b.expense_type_id) && String(a.expense_sub_type_id || '') === String(b.expense_sub_type_id || '')
  }

  var toTotalPaise = form.to_rows.reduce(function (s, r) { return s + Math.round((Number(r.amount_pts) || 0) * 100) }, 0)

  async function handleSave() {
    if (saving) return
    setError('')
    if (!form.description.trim()) { setError('Description required'); return }
    if (!validExpense(form.from)) { setError('Select a From expense type'); return }
    for (var i = 0; i < form.to_rows.length; i++) {
      var row = form.to_rows[i]
      if (!validExpense(row)) { setError('Row ' + (i + 1) + ': select an expense type'); return }
      if (!Number(row.amount_pts) || Number(row.amount_pts) <= 0) { setError('Row ' + (i + 1) + ': amount must be positive'); return }
      if (sameExpense(form.from, row)) { setError('Row ' + (i + 1) + ': To cannot be the same as From'); return }
    }

    setSaving(true)
    var receiptPath = null
    try {
      receiptPath = await uploadTransferProof(proofFile, proofRec)
    } catch (err) {
      setError(err.message || 'Proof upload failed')
      setSaving(false)
      return
    }
    var selEvent = (isFunction && eventId) ? formEvents.find(function (e) { return String(e.id) === eventId }) : null
    var eventTag = selEvent ? { _event_id: selEvent.id, _event_name: selEvent.event_name } : null
    var fromMetaOut = eventTag ? Object.assign({}, form.from.meta || {}, eventTag) : (form.from.meta || {})
    // One id shared by every leg created in this submission, so a multi-row split
    // (several To rows off one From) groups back into a single expandable entry.
    var batchId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2)))

    var okCount = 0
    for (var j = 0; j < form.to_rows.length; j++) {
      var r = form.to_rows[j]
      var amt = Number(r.amount_pts)
      var toMetaOut = eventTag ? Object.assign({}, r.meta || {}, eventTag) : (r.meta || {})
      var rowDesc = form.description.trim() + (r.remarks && r.remarks.trim() ? ' — ' + r.remarks.trim() : '')
      try {
        var res = await supabase.rpc('fn_create_cost_transfer', {
          p_amount_paise: Math.round(amt * 100),
          p_from_party_type: 'expense',
          p_from_expense_type_id: Number(form.from.expense_type_id),
          p_from_expense_sub_type_id: form.from.expense_sub_type_id ? Number(form.from.expense_sub_type_id) : null,
          p_from_event_id: null,
          p_from_vendor_id: null,
          p_from_employee_id: null,
          p_to_party_type: 'expense',
          p_to_expense_type_id: Number(r.expense_type_id),
          p_to_expense_sub_type_id: r.expense_sub_type_id ? Number(r.expense_sub_type_id) : null,
          p_to_event_id: null,
          p_to_vendor_id: null,
          p_to_employee_id: null,
          p_description: rowDesc,
          p_reason_note: null,
          p_effective_date: form.effective_date,
          p_from_meta: fromMetaOut,
          p_to_meta: toMetaOut,
          p_batch_id: batchId,
          p_receipt_path: receiptPath,
        })
        if (res.error) throw res.error
        try { logActivity('COST_TRANSFER_CREATE', '#' + res.data + ' Rs ' + amt.toFixed(2)) } catch (_) {}
        okCount++
      } catch (err) {
        setError((okCount > 0 ? okCount + ' of ' + form.to_rows.length + ' transfers were created before this failed — ' : '') +
          'Row ' + (j + 1) + ': ' + (err.message || 'Save failed'))
        setSaving(false)
        loadTransfers()
        return
      }
    }
    closeForm()
    setForm(makeEmptyForm())
    toggleFunction(false)
    resetProof()
    loadTransfers()
    setSaving(false)
  }

  var [reverseTarget, setReverseTarget] = useState(null)

  async function handleReverse() {
    var id = reverseTarget
    if (reversing || !id) return
    setReversing(id)
    setError('')
    try {
      var res = await supabase.rpc('fn_reverse_cost_transfer', { p_id: id })
      if (res.error) throw res.error
      try { logActivity('COST_TRANSFER_REVERSE', '#' + id) } catch (_) {}
      loadTransfers()
    } catch (err) { setError(err.message || 'Reverse failed') }
    setReversing(null)
    setReverseTarget(null)
  }

  async function toggleTransferCheck(t) {
    if (checkingTransferId) return
    setCheckingTransferId(t.id)
    var { data, error } = await supabase.rpc('fn_toggle_cost_transfer_check', { p_id: t.id })
    setCheckingTransferId(null)
    if (error) { setError(error.message || 'Could not update'); return }
    var nowChecked = !!data
    setTransfers(function (prev) { return prev.map(function (x) {
      if (x.id !== t.id) return x
      return Object.assign({}, x, {
        checked_by: nowChecked ? profile.id : null,
        checked_at: nowChecked ? new Date().toISOString() : null,
      })
    }) })
  }

  function toggleBatch(batchId) {
    setExpandedBatches(function (p) { return Object.assign({}, p, { [batchId]: !p[batchId] }) })
  }

  // Multi-row splits (one From, several To rows) share a batch_id from creation —
  // group them back into one expandable entry. A batch_id shared by only one row
  // (the normal case, and every legacy pre-batching row) just renders as itself.
  function groupedTransfers() {
    var order = []
    var byBatch = {}
    shownTransfers.forEach(function (r) {
      var key = r.batch_id || ('single_' + r.id)
      if (!byBatch[key]) { byBatch[key] = []; order.push(key) }
      byBatch[key].push(r)
    })
    var groups = order.map(function (key) {
      var rows = byBatch[key]
      return { batchId: key, rows: rows, totalPaise: rows.reduce(function (s, r) { return s + (r.amount_paise || 0) }, 0) }
    })
    // By the date the transfer counts on, then by when it was logged, so two
    // on the same day keep the order they were entered in.
    function when(g) { return String(g.rows[0].effective_date || '') + ' ' + String(g.rows[0].created_at || '') }
    return groups.slice().sort(function (a, b) {
      if (sortBy === 'date_asc') return when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0
      if (sortBy === 'amount_desc') return b.totalPaise - a.totalPaise
      if (sortBy === 'amount_asc') return a.totalPaise - b.totalPaise
      return when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0
    })
  }

  function canEditRow(r) {
    return canCreate && r.from_party_type === 'expense' && r.to_party_type === 'expense' &&
      r.reversed_by_id == null && r.reversal_of == null
  }

  function openEdit(r) {
    setEditError('')
    setEditTarget(r)
    setEditForm({
      from: { expense_type_id: String(r.from_expense_type_id || ''), expense_sub_type_id: String(r.from_expense_sub_type_id || '') },
      to: { expense_type_id: String(r.to_expense_type_id || ''), expense_sub_type_id: String(r.to_expense_sub_type_id || '') },
      amount_pts: r.amount_paise != null ? (r.amount_paise / 100).toString() : '',
      description: r.description || '',
      effective_date: r.effective_date || '',
      receipt_path: r.receipt_path || null,
    })
    setEditProofFile(null)
    editProofRec.remove()
    setEditRemoveReceipt(false)
  }

  async function handleEditSave() {
    if (editSaving || !editTarget || !editForm) return
    setEditError('')
    if (!editForm.description.trim()) { setEditError('Description required'); return }
    if (!editForm.from.expense_type_id) { setEditError('Select a From expense type'); return }
    if (!editForm.to.expense_type_id) { setEditError('Select a To expense type'); return }
    if (!Number(editForm.amount_pts) || Number(editForm.amount_pts) <= 0) { setEditError('Amount must be positive'); return }
    setEditSaving(true)
    try {
      var newReceiptPath = await uploadTransferProof(editProofFile, editProofRec)
      var res = await supabase.rpc('fn_edit_cost_transfer', {
        p_id: editTarget.id,
        p_amount_paise: Math.round(Number(editForm.amount_pts) * 100),
        p_from_expense_type_id: Number(editForm.from.expense_type_id),
        p_from_expense_sub_type_id: editForm.from.expense_sub_type_id ? Number(editForm.from.expense_sub_type_id) : null,
        p_to_expense_type_id: Number(editForm.to.expense_type_id),
        p_to_expense_sub_type_id: editForm.to.expense_sub_type_id ? Number(editForm.to.expense_sub_type_id) : null,
        p_description: editForm.description.trim(),
        p_effective_date: editForm.effective_date || null,
        p_receipt_path: newReceiptPath,
        p_remove_receipt: !newReceiptPath && editRemoveReceipt,
      })
      if (res.error) throw res.error
      try { logActivity('COST_TRANSFER_EDIT', '#' + editTarget.id) } catch (_) {}
      setEditTarget(null)
      setEditForm(null)
      loadTransfers()
    } catch (err) { setEditError(err.message || 'Save failed') }
    setEditSaving(false)
  }

  // Nested so they close over partyLabel/partyMeta/canEditRow/handleReverse/openEdit —
  // all of which need the reference-data lookups (expTypes, vendors, etc.) in scope here.
  //
  // Called as functions, never as <DesktopRow />. Defined inside this
  // component, each render made them a new component type, so every state
  // change anywhere on the screen — a key typed in the New Transfer form, a
  // function picked — unmounted and rebuilt every row of the table behind it.
  // That was the lag. As plain calls React diffs their output like any other
  // markup and only what changed is touched. Neither uses a hook, which is
  // what makes that safe.
  function DesktopRow({ r, indent }) {
    var isReversed = r.reversed_by_id != null
    var isReversal = r.reversal_of != null
    var canReverse = canCreate && !isReversed && !isReversal
    var canEdit = canEditRow(r)
    var menuOpen = menuRowId === r.id
    return (
      <tr className={isReversed ? "bg-slate-50/70 text-slate-400" : "hover:bg-slate-50/60 transition-colors"}>
        <td className={"px-4 py-3.5 align-middle whitespace-nowrap" + (indent ? " pl-10" : "")}>
          <div className={"text-[14px] font-semibold " + (isReversed ? "" : "text-slate-900")}>{formatDate(r.effective_date)}</div>
          <div className="mt-0.5 text-[12px] text-slate-500">Logged {formatDateTime(r.created_at)}</div>
        </td>
        <td className="px-4 py-3.5 align-middle text-[13.5px]">{partyCell(r, 'from')}{partyMeta(r, 'from')}</td>
        {/* Which way the cost moves, in a column of its own so every arrow
            stands in the same place down the table. */}
        <td aria-hidden="true" className="px-0 py-3.5 align-middle text-center text-slate-500"><Icon name="arrowRight" size={18} strokeWidth={2.6} className="inline-block" /></td>
        <td className="px-4 py-3.5 align-middle text-[13.5px]">{partyCell(r, 'to')}{partyMeta(r, 'to')}</td>
        {/* The check goes with the figure. In the description cell it was a
            chip among Reversal, Reversed and Edited — three labels about the
            row and one verdict on it, all dressed the same. */}
        <td className="px-4 py-3.5 align-middle whitespace-nowrap">
          <span className="text-[14px] tabular-nums">
            <span className="font-semibold text-slate-500">Rs</span>{' '}
            <span className={"font-bold " + (isReversed ? "" : "text-slate-900")}>{(r.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </span>
          {(canMarkChecked || r.checked_by) && (
            <span className="mt-1.5 flex" onClick={function (ev) { ev.stopPropagation() }}>
              <CheckedStamp
                variant="stamp"
                checked={!!r.checked_by}
                checkedAt={r.checked_at}
                canToggle={canMarkChecked}
                canUncheck={r.checked_by === profile?.id || isAdmin}
                busy={checkingTransferId === r.id}
                onToggle={function () { toggleTransferCheck(r) }}
              />
            </span>
          )}
        </td>
        <td className="px-4 py-3.5 align-middle text-[13.5px] text-slate-700">
          {r.description}
          {(isReversal || isReversed || r.edited_at) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {isReversal && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Reversal</span>}
              {isReversed && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">Reversed</span>}
              {r.edited_at && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">Edited</span>}
            </span>
          )}
        </td>
        {/* Reverse is the action a row is opened for, so it is a button of
            its own, centred under the Actions heading. Edit is rarer and
            lives behind a ⋮ pinned to the cell's right edge — out of the flow,
            so its presence on one row and absence on the next cannot push
            Reverse off the centre line the way a slot beside it did. */}
        <td className="relative px-4 py-3.5 align-middle whitespace-nowrap">
          <div className="flex items-center justify-center">
            {canReverse ? (
              <button onClick={function () { setReverseTarget(r.id) }} disabled={reversing === r.id}
                className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-40">
                <Icon name={reversing === r.id ? 'refresh' : 'reverse'} size={14} className="text-indigo-600" />
                {reversing === r.id ? 'Reversing…' : 'Reverse'}
              </button>
            ) : (
              <span className="text-[13px] text-slate-300">—</span>
            )}
          </div>
          {canEdit && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2">
              <button type="button" aria-label="More actions" aria-expanded={menuOpen}
                onClick={function () { setMenuRowId(menuOpen ? null : r.id) }}
                className="w-7 h-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                <Icon name="more" size={18} className="rotate-90" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={function () { setMenuRowId(null) }} />
                  <div className="absolute right-0 top-full mt-1 z-30 min-w-[140px] py-1 bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
                    <button type="button" onClick={function () { setMenuRowId(null); openEdit(r) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                      <Icon name="edit" size={14} className="text-slate-400" />
                      Edit
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </td>
      </tr>
    )
  }

  // The phone card: date and amount across the top, the move as two labelled
  // lines — From with its type over its sub-type, To under it — the reason
  // in grey, and the actions along the foot. It was one run-on line of
  // arrows ("LGT-Light (ADD) → LGT-Casual Labour Expenses → Parveen…") that
  // broke wherever the screen ran out.
  function MobileCard({ r }) {
    var isReversed = r.reversed_by_id != null
    var isReversal = r.reversal_of != null
    var canReverse = canCreate && !isReversed && !isReversal
    var canEdit = canEditRow(r)
    var hasFoot = canReverse || canEdit || isReversal || isReversed || r.edited_at
    return (
      <div className={"bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(15,23,42,0.06)] " + (isReversed ? "opacity-60" : "")}>
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-900">{formatDate(r.effective_date)}</p>
              <p className="text-[11.5px] text-slate-500">Logged {formatDateTime(r.created_at)}</p>
            </div>
            {/* The check goes with the figure, as it does in the desktop
                table — a verdict on the amount, under the amount.

                The slot hangs under the amount out of the flow, lined up with
                its right edge, so it adds no height to the top row. Right, not
                centred: the chip is wider than a short amount, and centred it
                ran past the card's edge and was cut off. In the flow it made
                that row taller than the date beside it and pushed From down,
                leaving a gap under "Logged". The chip or the stamp is pinned
                to the slot's top-right corner. The chip is 22px tall and the stamp 56px, so
                in the flow the swap grew the card and shoved everything under
                it down. Pinned, the stamp lands where the chip was and hangs
                over the empty space to the right of From / To; nothing moves. */}
            <div className="relative shrink-0">
              <p className="text-[16px] tabular-nums">
                <span className="font-semibold text-slate-500">Rs</span>{' '}
                <span className="font-bold text-slate-900">{(r.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </p>
              {(canMarkChecked || r.checked_by) && (
                <span className="absolute right-0 top-full mt-2.5 w-[104px] h-[22px] z-10" onClick={function (ev) { ev.stopPropagation() }}>
                  <span className="absolute right-0 top-0 z-10">
                  <CheckedStamp
                    variant="stamp" compact
                    checked={!!r.checked_by}
                    checkedAt={r.checked_at}
                    canToggle={canMarkChecked}
                    canUncheck={r.checked_by === profile?.id || isAdmin}
                    busy={checkingTransferId === r.id}
                    onToggle={function () { toggleTransferCheck(r) }}
                  />
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* The move as a short track: a hollow dot for where the cost
              leaves, a filled one for where it lands, a rule between them.
              The direction reads before the labels do, with no colour to it
              beyond the one filled dot. */}
          <div className="relative mt-3.5 pl-6 text-[13.5px]">
            <span aria-hidden="true" className="absolute left-[5px] top-[18px] bottom-[18px] w-px bg-slate-300" />
            <div className="relative">
              <span aria-hidden="true" className="absolute -left-6 top-[3px] w-[11px] h-[11px] rounded-full border-2 border-slate-400 bg-white" />
              <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-500 leading-none mb-1">From</p>
              {partyCell(r, 'from')}{partyMeta(r, 'from')}
            </div>
            <div className="relative mt-3">
              <span aria-hidden="true" className="absolute -left-6 top-[3px] w-[11px] h-[11px] rounded-full bg-indigo-600" />
              <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-500 leading-none mb-1">To</p>
              {partyCell(r, 'to')}{partyMeta(r, 'to')}
            </div>
          </div>

          {r.description && (
            <p className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 text-[13px] text-slate-700">
              <Icon name="fileText" size={14} className="shrink-0 mt-0.5 text-slate-400" />
              <span className="min-w-0">{r.description}</span>
            </p>
          )}
        </div>

        {hasFoot && (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100">
            <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
              {isReversal && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Reversal</span>}
              {isReversed && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">Reversed</span>}
              {r.edited_at && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">Edited</span>}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {canEdit && (
                <button type="button" onClick={function () { openEdit(r) }}
                  className="h-8 px-3 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Edit</button>
              )}
              {canReverse && (
                <button type="button" onClick={function () { setReverseTarget(r.id) }} disabled={reversing === r.id}
                  className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:border-rose-300 hover:text-rose-700 transition-colors disabled:opacity-40">
                  <Icon name={reversing === r.id ? 'refresh' : 'reverse'} size={13} className="text-indigo-600" />
                  {reversing === r.id ? 'Reversing…' : 'Reverse'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // On a phone New Transfer is a page, not a sheet over the list: the form
  // takes the list's place, and the header's back arrow (or a swipe) closes
  // it — so opening it is a step on the app's back stack there, and every way
  // out (Cancel, a save, the arrow) leaves through that step so none is left
  // behind to swallow a later back press. A desktop keeps the dialog.
  var formStepRef = useRef(false)
  function phoneNow() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 639px)').matches
  }
  var [isPhone, setIsPhone] = useState(phoneNow)
  useEffect(function () {
    if (!window.matchMedia) return
    var mq = window.matchMedia('(max-width: 639px)')
    function onChange() { setIsPhone(mq.matches) }
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return function () {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  var formAsPage = isPhone && !inAdmin

  function openNewTransfer() {
    setForm(makeEmptyForm()); setOpenToKey(null); toggleFunction(false); setError(''); setShowForm(true); prefetchEvents()
    if (!inAdmin && phoneNow()) {
      formStepRef.current = true
      pushBack(function () { formStepRef.current = false; setShowForm(false); resetProof() })
      window.requestAnimationFrame(function () { window.scrollTo(0, 0) })
    }
  }
  function closeForm() {
    if (formStepRef.current) navBack()
    else { setShowForm(false); resetProof() }
  }

  var allGroups = groupedTransfers()
  var pageCount = Math.max(1, Math.ceil(allGroups.length / PAGE_SIZE))
  var curPage = Math.min(page, pageCount)
  var pageGroups = allGroups.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)
  var fromN = allGroups.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1
  var toN = Math.min(curPage * PAGE_SIZE, allGroups.length)
  function goToPage(n) {
    setPage(n)
    // The new page replaced the rows under you; bring its top into view.
    window.requestAnimationFrame(function () {
      if (listTopRef.current) listTopRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }
  // First, last, and the pages either side of the current one, with a gap
  // mark wherever numbers are skipped.
  function pageNumbers() {
    var out = []
    for (var i = 1; i <= pageCount; i++) {
      if (i === 1 || i === pageCount || Math.abs(i - curPage) <= 1) out.push(i)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }
  var pager = pageCount > 1 && (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-[13px] text-slate-600">
        Showing <span className="font-semibold text-slate-900 tabular-nums">{fromN}–{toN}</span> of <span className="font-semibold text-slate-900 tabular-nums">{allGroups.length}</span>
      </p>
      {/* ml-auto: on a phone the buttons wrap under the count, and there
          they keep to the right edge instead of falling to the left. */}
      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={function () { goToPage(curPage - 1) }} disabled={curPage === 1} aria-label="Previous page"
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition-colors">
          <Icon name="chevronRight" size={15} className="rotate-180" />
        </button>
        {pageNumbers().map(function (n, i) {
          if (n === '…') return <span key={'gap' + i} className="w-7 text-center text-[13px] text-slate-400">…</span>
          var on = n === curPage
          return (
            <button key={n} type="button" onClick={function () { goToPage(n) }} aria-current={on ? 'page' : undefined}
              className={"min-w-9 h-9 px-2 rounded-lg text-[13px] font-semibold tabular-nums transition-colors " +
                (on ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
              {n}
            </button>
          )
        })}
        <button type="button" onClick={function () { goToPage(curPage + 1) }} disabled={curPage === pageCount} aria-label="Next page"
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition-colors">
          <Icon name="chevronRight" size={15} />
        </button>
      </div>
    </div>
  )

  var formBody = (
        <div className="ambria-ct-form divide-y divide-slate-200 -mt-1">

          {/* 1 · For a function */}
          <div className="pb-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-900">For a function?</p>
                <p className="text-[12.5px] text-slate-600">Link this transfer to a specific function</p>
              </div>
              <button type="button" role="switch" aria-checked={isFunction} aria-label="For a function"
                onClick={function () { toggleFunction(!isFunction) }}
                className={"shrink-0 relative w-11 h-6 rounded-full transition-colors " + (isFunction ? "bg-indigo-600" : "bg-slate-300")}>
                <span className={"absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-5" : "translate-x-0")} />
              </button>
            </div>
            {isFunction && (function () {
              var sel = eventId ? formEvents.find(function (ev) { return String(ev.id) === eventId }) : null
              function metaOf(ev) {
                return [ev.venue_name, ev.department, ev.session, ev.contract_no ? '#' + ev.contract_no : null, ev.created_user_name ? 'by ' + ev.created_user_name : null].filter(Boolean)
              }

              // Picked: one line naming it, and Change.
              if (sel && !fnPickerOpen) {
                return (
                  <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-indigo-200 bg-indigo-50/60">
                    <span className="shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white inline-flex items-center justify-center">
                      <Icon name="check" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-slate-900 truncate">
                        {sel.event_name || 'Event'}{sel.client_name ? ' — ' + sel.client_name : ''}
                      </span>
                      <span className="block text-[12.5px] text-slate-600 truncate">
                        {[formatDate(eventDate)].concat(metaOf(sel)).join(' · ')}
                      </span>
                    </span>
                    <button type="button" onClick={function () { setFnPickerOpen(true) }}
                      className="shrink-0 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                      Change
                    </button>
                  </div>
                )
              }

              var q = fnQuery.trim().toLowerCase()
              var list = !q ? formEvents : formEvents.filter(function (ev) {
                return [ev.event_name, ev.client_name].concat(metaOf(ev)).join(' ').toLowerCase().indexOf(q) !== -1
              })
              return (
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
                  <div>
                    <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">Function date</label>
                    <EventDatePicker value={eventDate}
                      onChange={function (dateStr) { setEventDate(dateStr); setFnQuery(''); loadEventsByDate(dateStr) }} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[13px] font-semibold text-slate-800">Function</label>
                      {eventDate && !eventsLoading && formEvents.length > 0 && (
                        <span className="text-[12px] text-slate-500">{formEvents.length} on {formatDate(eventDate)}</span>
                      )}
                    </div>

                    {!eventDate && (
                      <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-10 rounded-xl border border-dashed border-slate-300">
                        <Icon name="calendar" size={22} className="text-slate-400" />
                        <p className="text-[13px] text-slate-600">Pick a date on the calendar to see its functions</p>
                      </div>
                    )}

                    {eventsLoading && (
                      <div className="space-y-2" aria-busy="true">
                        {[0, 1, 2].map(function (i) { return <div key={i} className="ambria-skeleton h-[62px] rounded-xl" /> })}
                      </div>
                    )}

                    {eventDate && !eventsLoading && formEvents.length === 0 && (
                      <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-10 rounded-xl border border-dashed border-slate-300">
                        <Icon name="calendar" size={22} className="text-slate-400" />
                        <p className="text-[13px] text-slate-600">No functions on {formatDate(eventDate)}</p>
                      </div>
                    )}

                    {!eventsLoading && formEvents.length > 4 && (
                      <div className="relative mb-2">
                        <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input type="text" value={fnQuery} onChange={function (e) { setFnQuery(e.target.value) }}
                          placeholder="Search name, client, venue or contract"
                          style={{ fontSize: '16px' }}
                          className="w-full py-2 pl-9 pr-3 bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                      </div>
                    )}

                    {/* What it is and for whom on the first line; where, which
                        department, the contract and who booked it under it.
                        Picking one folds the picker to a line naming it. */}
                    {!eventsLoading && formEvents.length > 0 && (
                      <div role="radiogroup" aria-label="Function" className="space-y-2 max-h-[300px] overflow-y-auto ambria-thin-scroll pr-0.5">
                        {list.length === 0 && <p className="text-[13px] text-slate-500 py-3 text-center">No function matches “{fnQuery}”</p>}
                        {list.map(function (ev) {
                          var on = String(ev.id) === eventId
                          var meta = metaOf(ev)
                          return (
                            <button key={ev.id} type="button" role="radio" aria-checked={on}
                              onClick={function () { setEventId(String(ev.id)); setFnPickerOpen(false) }}
                              className={"w-full flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors " +
                                (on ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50")}>
                              <span className={"shrink-0 mt-0.5 w-[18px] h-[18px] rounded-full border-2 inline-flex items-center justify-center " +
                                (on ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white")}>
                                {on && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[14px] font-semibold text-slate-900 leading-snug">
                                  {ev.event_name || 'Event'}{ev.client_name ? ' — ' + ev.client_name : ''}
                                </span>
                                {meta.length > 0 && (
                                  <span className="mt-0.5 block text-[12.5px] text-slate-600 leading-snug">{meta.join(' · ')}</span>
                                )}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* 2 · From, then its To rows under it. One From, any number of
              To. The two sides are told apart by structure, not colour: the
              same quiet panel each, From marked with a grey bar down its left
              edge and To with the app's indigo, and a disc with an arrow
              between them so the direction reads before any label does.
              Adding a To row folds the one you were on to a line and opens
              the new one. */}
          <div className="py-5">
            <div className="rounded-2xl border border-slate-200 border-l-4 border-l-slate-400 bg-slate-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-baseline gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-slate-800">
                  From
                  <span className="normal-case tracking-normal font-normal text-[12.5px] text-slate-500">cost leaves</span>
                </span>
                <span className="text-[13px] text-slate-600">
                  <span className="font-bold text-slate-900 tabular-nums">Rs {(toTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span> moving out
                </span>
              </div>
              <ExpenseTypeFields quiet value={form.from} onChange={updFrom}
                expTypes={expTypes} expSubTypes={expSubTypes} vendors={vendors} venues={venues} employees={employees} categories={categories} />
            </div>

            <div className="relative h-4" aria-hidden="true">
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-slate-300 shadow-sm text-slate-600 inline-flex items-center justify-center">
                <Icon name="arrowRight" size={15} strokeWidth={2.4} className="rotate-90" />
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 border-l-4 border-l-indigo-500 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-baseline gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-slate-800">
                  To{form.to_rows.length > 1 ? ' · ' + form.to_rows.length + ' rows' : ''}
                  <span className="normal-case tracking-normal font-normal text-[12.5px] text-slate-500">cost lands</span>
                </span>
                <button type="button" onClick={addToRow}
                  className="inline-flex items-center gap-1 h-8 px-2.5 -mr-1 rounded-lg text-[13px] font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors">
                  <Icon name="plus" size={14} />Add row
                </button>
              </div>
              {form.to_rows.length === 1 ? (
                <ToRowFields row={form.to_rows[0]} idx={0} onChange={updToRow}
                  expTypes={expTypes} expSubTypes={expSubTypes} />
              ) : (
                <div className="space-y-2">
                  {form.to_rows.map(function (row, idx) {
                    if (!isToRowOpen(row, idx)) return toRowSummary(row, idx)
                    return (
                      <div key={row._key} className="rounded-xl border border-indigo-200 bg-slate-50/60 p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold inline-flex items-center justify-center">{idx + 1}</span>
                            Row {idx + 1}
                          </span>
                          <button type="button" onClick={function () { removeToRow(idx) }} aria-label={'Remove row ' + (idx + 1)}
                            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                        <ToRowFields row={row} idx={idx} onChange={updToRow}
                          expTypes={expTypes} expSubTypes={expSubTypes} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 3 · When and why */}
          <div className="py-5 grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">Effective date</label>
              <EventDatePicker value={form.effective_date}
                onChange={function (v) { if (v) updForm({ effective_date: v }) }}
                collapsible includePast plain neutral placeholder="Select date"
                triggerStyle={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">Description <span className="text-red-500">*</span></label>
              <VoiceInput type="text" value={form.description}
                onChange={function (e) { updForm({ description: e.target.value }) }}
                placeholder="e.g. 4 days painter labor for kitchen"
                className={"w-full py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow px-3"} />
            </div>
          </div>

          {/* 4 · Proof */}
          <div className="py-5">
            <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">Proof <span className="font-normal text-slate-500">(optional)</span></label>
            <ProofPicker file={proofFile} setFile={setProofFile} rec={proofRec}
              disabled={saving} onOpenCamera={function () { setShowCamera(true) }} />
          </div>

          <div className="pt-5 space-y-3">
            {error && <p className="text-[13px] text-red-600">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={closeForm}
                className="flex-1 sm:flex-none h-11 px-5 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex-1 sm:flex-none h-11 px-6 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : (form.to_rows.length > 1 ? 'Save ' + form.to_rows.length + ' transfers' : 'Save transfer')}
              </button>
            </div>
          </div>
        </div>
  )

  // Phone: the form as the page.
  if (showForm && formAsPage) {
    return (
      <div className="pb-6">
        <CostBackdrop inAdmin={inAdmin} />
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(15,23,42,0.06)] px-4 pt-4 pb-5">
          <h2 className="mb-4 text-[17px] font-bold text-slate-900">New cost transfer</h2>
          {formBody}
        </div>
        {showCamera && (
          <CameraCapture
            onCapture={function (file) { setProofFile(file); setShowCamera(false) }}
            onClose={function () { setShowCamera(false) }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <CostBackdrop inAdmin={inAdmin} />
      {/* Desktop: one row holding the three things you do here — find,
          narrow, add. */}
      <div className="hidden sm:block mb-4">
        <div className="flex items-center gap-3">
          <SearchField
            value={searchRaw}
            onChange={function (v) { setSearchRaw(v) }}
            placeholder="Search description..."
            className="flex-1 min-w-0"
          />
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
            className={"shrink-0 h-10 inline-flex items-center gap-2 px-4 rounded-xl border text-[13.5px] font-semibold transition-colors " +
              (filtersOpen || activeFilterCount() > 0 ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50")}>
            <Icon name="filter" size={15} />
            Filters{activeFilterCount() > 0 ? ' · ' + activeFilterCount() : ''}
            <Icon name={filtersOpen ? 'chevronUp' : 'chevronDown'} size={14} className="text-slate-400" />
          </button>
          {activeFilterCount() > 0 && (
            <button type="button" onClick={resetFilters}
              className="shrink-0 h-10 px-3 rounded-xl text-[13px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors">
              Reset
            </button>
          )}
          {canCreate && (
            <button type="button" onClick={openNewTransfer}
              className="shrink-0 h-10 inline-flex items-center gap-2 px-5 rounded-xl bg-indigo-600 text-white text-[14px] font-bold shadow-[0_2px_8px_rgba(79,70,229,0.25)] hover:bg-indigo-700 transition-colors">
              <Icon name="plus" size={16} />
              New Transfer
            </button>
          )}
        </div>
      </div>


      {error && !showForm && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {/* ─── FILTERS ─────────────────────────────────── */}
      <div className="mb-3 space-y-2">
        {/* Phone: the three controls on one line — search taking what is
            left, a filter button that carries its count, and add. They were
            three rows, the add button on a line of its own above them. */}
        <div className="sm:hidden flex items-center gap-2">
          <SearchField
            value={searchRaw}
            onChange={function (v) { setSearchRaw(v) }}
            placeholder="Search description..."
            className="flex-1 min-w-0"
          />
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
            aria-label={'Filters' + (activeFilterCount() > 0 ? ', ' + activeFilterCount() + ' on' : '')}
            className={"relative shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl border transition-colors " +
              (filtersOpen || activeFilterCount() > 0 ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-300 text-slate-600")}>
            <Icon name="filter" size={16} />
            {activeFilterCount() > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold inline-flex items-center justify-center">{activeFilterCount()}</span>
            )}
          </button>
          {canCreate && (
            <button type="button" onClick={openNewTransfer} aria-label="New transfer"
              className="shrink-0 h-10 inline-flex items-center gap-1.5 px-3.5 rounded-xl bg-indigo-600 text-white text-[13.5px] font-semibold hover:bg-indigo-700 transition-colors">
              <Icon name="plus" size={16} />
              New
            </button>
          )}
        </div>
        {/* One row on a desktop — status, the two parties, the date range —
            where it was three full-width rows of controls sized for a phone.
            The parties use the same dropdown as the expense filters, and the
            dates the app's own picker: <input type="date"> printed mm/dd/yyyy
            in US order whatever the locale, beside "23 Sept 2026" in the
            table right under it. */}
        {filtersOpen && (
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1.4fr)] lg:items-end lg:gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 mb-1.5">Status</label>
                <div className="flex h-10 p-1 gap-1 bg-slate-100 rounded-xl">
                  {['all', 'active', 'reversed'].map(function (s) {
                    var lbl = s === 'all' ? 'All' : (s === 'active' ? 'Active' : 'Reversed')
                    var on = statusFilter === s
                    return (
                      <button key={s} type="button" onClick={function () { setStatusFilter(s) }} aria-pressed={on}
                        className={"flex-1 lg:flex-none px-3 rounded-lg text-[12.5px] font-semibold transition-colors " +
                          (on ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.10)]" : "text-slate-500 hover:text-slate-900")}>
                        {lbl}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* The two parties are one question — cost moving from one to the
                  other — so they sit together with the arrow between them,
                  the way the date range beside them does. */}
              <div className="sm:col-span-2 lg:col-span-1">
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 mb-1.5">From (party)</label>
                    <FilterDropdown value={fromPartyFilter} compact placeholder="All parties"
                      options={PARTY_TYPES.map(function (p) { return { label: p.label, value: p.key } })}
                      onChange={setFromPartyFilter} />
                  </div>
                  <span aria-hidden="true" className="shrink-0 h-10 inline-flex items-center text-slate-500">
                    <Icon name="arrowRight" size={16} strokeWidth={2.6} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 mb-1.5">To (party)</label>
                    <FilterDropdown value={toPartyFilter} compact placeholder="All parties"
                      options={PARTY_TYPES.map(function (p) { return { label: p.label, value: p.key } })}
                      onChange={setToPartyFilter} />
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="block text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 mb-1.5">Date</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <EventDatePicker value={dateFrom} onChange={function (v) { setDateFrom(v || '') }}
                      collapsible includePast plain neutral placeholder="From" />
                  </div>
                  <Icon name="arrowRight" size={16} strokeWidth={2.6} className="shrink-0 text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <EventDatePicker value={dateTo} onChange={function (v) { setDateTo(v || '') }}
                      collapsible includePast plain neutral placeholder="To" />
                  </div>
                </div>
              </div>
            </div>
            {/* The panel's own way out: Reset clears every filter here, and
                on a phone Done folds the panel away so the list comes back
                into view. Reset used to live only beside the count, which is
                not drawn while a filter has left the list empty. */}
            <div className="mt-4 pt-3 flex items-center justify-between gap-3 border-t border-slate-100">
              <button type="button" onClick={resetFilters} disabled={activeFilterCount() === 0}
                className="inline-flex items-center gap-1.5 h-9 px-3 -ml-3 rounded-lg text-[13px] font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600 transition-colors">
                <Icon name="refresh" size={14} />
                Reset filters{activeFilterCount() > 0 ? ' (' + activeFilterCount() + ')' : ''}
              </button>
              <button type="button" onClick={function () { setFiltersOpen(false) }}
                className="sm:hidden h-9 px-4 rounded-lg bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors">
                Done
              </button>
            </div>
          </div>
        )}
        {!loading && shownTransfers.length > 0 && (
          <div className="sm:hidden flex items-center justify-between gap-3 px-0.5 pt-1">
            <p className="text-[13px] font-medium text-slate-700">
              <span className="font-bold text-slate-900 tabular-nums">{shownTransfers.length}</span> shown
              {activeFilterCount() > 0 && (
                <button type="button" onClick={resetFilters} className="ml-2 text-[12.5px] font-semibold text-indigo-600">Reset</button>
              )}
            </p>
            <label className="relative inline-flex items-center gap-1 text-[12.5px] text-slate-600">
              <span className="font-semibold text-slate-800">{({ date_desc: 'Newest', date_asc: 'Oldest', amount_desc: 'Amount ↓', amount_asc: 'Amount ↑' })[sortBy]}</span>
              <Icon name="chevronDown" size={13} className="text-slate-400" />
              <select value={sortBy} onChange={function (e) { setSortBy(e.target.value) }} aria-label="Sort transfers"
                className="absolute inset-0 w-full h-full opacity-0" style={{ fontSize: '16px' }}>
                <option value="date_desc">Date (Newest)</option>
                <option value="date_asc">Date (Oldest)</option>
                <option value="amount_desc">Amount (High)</option>
                <option value="amount_asc">Amount (Low)</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
      ) : shownTransfers.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">{activeFilterCount() > 0 || searchRaw ? 'No transfers match.' : 'No cost transfers yet.'}</p>
      ) : (
        <>
          <div ref={listTopRef} className="scroll-mt-20" />
          <div aria-busy={refreshing}
            className={"hidden sm:block bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-opacity duration-150 " + (refreshing ? "opacity-60" : "")}>
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <p className="text-[15px] text-slate-900"><span className="font-bold tabular-nums">{shownTransfers.length}</span> shown</p>
              {/* A native select laid over its own label: the label is what
                  shows, the select is what opens. */}
              <label className="relative inline-flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
                <span>Sort by <span className="font-semibold text-slate-900">{({ date_desc: 'Date (Newest)', date_asc: 'Date (Oldest)', amount_desc: 'Amount (High)', amount_asc: 'Amount (Low)' })[sortBy]}</span></span>
                <Icon name="chevronDown" size={14} className="text-slate-400" />
                <select value={sortBy} onChange={function (e) { setSortBy(e.target.value) }} aria-label="Sort transfers"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                  <option value="date_desc">Date (Newest)</option>
                  <option value="date_asc">Date (Oldest)</option>
                  <option value="amount_desc">Amount (High)</option>
                  <option value="amount_asc">Amount (Low)</option>
                </select>
              </label>
            </div>
            <div className="px-2 pb-2 overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                {/* Date is a fixed 220: "Logged 23 Sept 2026, 2:37 pm" does not
                    wrap, and as a share of a narrower window it ran out of its
                    column into From. From is fixed too, at about its longest
                    sub-type: as a share of a wide window it left a wide blank
                    after the text, and the arrow stood far from From and
                    right up against To. Description takes what is left. */}
                <col className="w-[220px]" />
                <col className="w-[240px]" />
                <col className="w-[48px]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col />
                <col className="w-[180px]" />
              </colgroup>
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                  <th className="text-left px-4 py-3 bg-slate-50 rounded-l-xl">Date</th>
                  <th className="text-left px-4 py-3 bg-slate-50">From</th>
                  <th aria-hidden="true" className="bg-slate-50" />
                  <th className="text-left px-4 py-3 bg-slate-50">To</th>
                  <th className="text-left px-4 py-3 bg-slate-50">Amount</th>
                  <th className="text-left px-4 py-3 bg-slate-50">Description</th>
                  <th className="text-center px-4 py-3 bg-slate-50 rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageGroups.map(function (g) {
                  if (g.rows.length === 1) return <React.Fragment key={g.batchId}>{DesktopRow({ r: g.rows[0] })}</React.Fragment>
                  var expanded = !!expandedBatches[g.batchId]
                  return (
                    <React.Fragment key={g.batchId}>
                      <tr className="bg-indigo-50/40 hover:bg-indigo-50/70 cursor-pointer transition-colors" onClick={function () { toggleBatch(g.batchId) }}>
                        <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                          <div className="text-[14px] font-semibold text-slate-900">{formatDate(g.rows[0].effective_date)}</div>
                          <div className="mt-0.5 text-[12px] text-slate-500">Logged {formatDateTime(g.rows[0].created_at)}</div>
                        </td>
                        <td className="px-4 py-3.5 align-middle text-[13.5px]">{partyCell(g.rows[0], 'from')}{partyMeta(g.rows[0], 'from')}</td>
                        <td aria-hidden="true" className="px-0 py-3.5 align-middle text-center text-slate-500"><Icon name="arrowRight" size={18} strokeWidth={2.6} className="inline-block" /></td>
                        <td className="px-4 py-3.5 align-middle text-[13.5px] text-indigo-700 font-semibold">{expanded ? '▾' : '▸'} {g.rows.length} allocations</td>
                        <td className="px-4 py-3.5 align-middle whitespace-nowrap text-[14px] tabular-nums">
                          <span className="font-semibold text-slate-500">Rs</span>{' '}
                          <span className="font-bold text-slate-900">{(g.totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </td>
                        <td className="px-4 py-3.5 align-middle text-[13.5px] text-slate-700">{g.rows[0].description}</td>
                        <td className="px-4 py-3.5 align-middle text-center text-[13px] text-indigo-600 font-semibold">{expanded ? 'Collapse' : 'Expand'}</td>
                      </tr>
                      {expanded && g.rows.map(function (r) { return <React.Fragment key={r.id}>{DesktopRow({ r: r, indent: true })}</React.Fragment> })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
            {pager && <div className="px-4 py-3 border-t border-slate-100">{pager}</div>}
          </div>

          <div aria-busy={refreshing} className={"sm:hidden space-y-2 transition-opacity duration-150 " + (refreshing ? "opacity-60" : "")}>
            {pageGroups.map(function (g) {
              if (g.rows.length === 1) return <React.Fragment key={g.batchId}>{MobileCard({ r: g.rows[0] })}</React.Fragment>
              var expanded = !!expandedBatches[g.batchId]
              return (
                <div key={g.batchId} className="space-y-2">
                  <button type="button" onClick={function () { toggleBatch(g.batchId) }} aria-expanded={expanded}
                    className="w-full text-left bg-white border border-slate-200 border-l-4 border-l-indigo-500 rounded-2xl px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-slate-900">{formatDate(g.rows[0].effective_date)}</p>
                        <p className="text-[11.5px] text-slate-500">Logged {formatDateTime(g.rows[0].created_at)}</p>
                      </div>
                      <p className="shrink-0 text-[16px] tabular-nums">
                        <span className="font-semibold text-slate-500">Rs</span>{' '}
                        <span className="font-bold text-slate-900">{(g.totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </p>
                    </div>
                    <div className="relative mt-3.5 pl-6 text-[13.5px]">
                      <span aria-hidden="true" className="absolute left-0 top-[3px] w-[11px] h-[11px] rounded-full border-2 border-slate-400 bg-white" />
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-500 leading-none mb-1">From</p>
                      {partyCell(g.rows[0], 'from')}
                    </div>
                    {g.rows[0].description && (
                      <p className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 text-[13px] text-slate-700">
                        <Icon name="fileText" size={14} className="shrink-0 mt-0.5 text-slate-400" />
                        <span className="min-w-0">{g.rows[0].description}</span>
                      </p>
                    )}
                    <p className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-600">
                      <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={14} />
                      {g.rows.length} allocations
                    </p>
                  </button>
                  {expanded && (
                    <div className="pl-3 space-y-2 border-l-2 border-indigo-200">
                      {g.rows.map(function (r) { return <React.Fragment key={r.id}>{MobileCard({ r: r })}</React.Fragment> })}
                    </div>
                  )}
                </div>
              )
            })}
            {pager && <div className="pt-2">{pager}</div>}
          </div>
        </>
      )}

      {/* Plain on purpose: labels, fields and a rule between sections —
          no glyph tiles, no card inside a card, no microphone beside every
          dropdown. Four bands read top to bottom: whether it is for a
          function; the move itself, one From on the left and its To rows on
          the right, each To carrying its own amount; when and why; proof.

          With several To rows one is open and the rest fold to a line each. */}
      {!formAsPage && (
        <Modal open={showForm} onClose={closeForm} wide title="New Cost Transfer">
          {formBody}
        </Modal>
      )}
      {showCamera && (
        <CameraCapture
          onCapture={function (file) { setProofFile(file); setShowCamera(false) }}
          onClose={function () { setShowCamera(false) }}
        />
      )}

      <Modal open={!!editTarget} onClose={function () { setEditTarget(null); setEditForm(null) }} title={'Edit Transfer' + (editTarget ? ' #' + editTarget.id : '')}>
        {editForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">From</label>
              <ExpenseTypeFields value={editForm.from}
                onChange={function (patch) { setEditForm(function (p) { return Object.assign({}, p, { from: Object.assign({}, p.from, patch) }) }) }}
                expTypes={expTypes} expSubTypes={expSubTypes} vendors={vendors} venues={venues} employees={employees} categories={categories} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">To</label>
              <ExpenseTypeFields value={editForm.to}
                onChange={function (patch) { setEditForm(function (p) { return Object.assign({}, p, { to: Object.assign({}, p.to, patch) }) }) }}
                expTypes={expTypes} expSubTypes={expSubTypes} vendors={vendors} venues={venues} employees={employees} categories={categories} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Amount (Rs) *</label>
              <input type="number" step="0.01" min="0" inputMode="decimal"
                value={editForm.amount_pts}
                onChange={function (e) { setEditForm(function (p) { return Object.assign({}, p, { amount_pts: e.target.value }) }) }}
                style={{ fontSize: '16px' }}
                className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Effective Date</label>
              <input type="date" value={editForm.effective_date}
                onChange={function (e) { setEditForm(function (p) { return Object.assign({}, p, { effective_date: e.target.value }) }) }}
                style={{ fontSize: '16px' }}
                className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description *</label>
              <VoiceInput type="text" value={editForm.description}
                onChange={function (e) { setEditForm(function (p) { return Object.assign({}, p, { description: e.target.value }) }) }}
                className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Proof (optional)</label>
              <ProofPicker file={editProofFile} setFile={setEditProofFile} rec={editProofRec}
                existingPath={editRemoveReceipt ? null : editForm.receipt_path}
                onRemoveExisting={function () { setEditRemoveReceipt(true) }}
                disabled={editSaving} onOpenCamera={function () { setEditShowCamera(true) }} />
            </div>

            {editError && <p className="text-sm text-red-600">{editError}</p>}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={function () { setEditTarget(null); setEditForm(null) }} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleEditSave} disabled={editSaving}
                className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-300">
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <ReverseDialog
        open={!!reverseTarget}
        busy={reversing === reverseTarget}
        onClose={function () { setReverseTarget(null) }}
        onConfirm={handleReverse}
        title="Reverse this cost transfer"
        description="This posts a new offsetting transfer. The original stays on the record — nothing is deleted."
      />
      {editShowCamera && (
        <CameraCapture
          onCapture={function (file) { setEditProofFile(file); setEditShowCamera(false) }}
          onClose={function () { setEditShowCamera(false) }}
        />
      )}
    </div>
  )
}

// One proof slot — image/PDF capture-or-upload, or a voice note — shared by
// the create and edit forms. Mutually exclusive: picking one clears the
// others, matching the single receipt_path column it feeds.
function ProofPicker({ file, setFile, rec, existingPath, onRemoveExisting, disabled, onOpenCamera }) {
  if (existingPath && !file && !rec.url) {
    var existingUrl = getReceiptUrl(existingPath)
    var existingIsVoice = isVoiceNotePath(existingPath)
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
        {existingIsVoice ? (
          <audio src={existingUrl} controls className="flex-1 min-w-0 h-8" />
        ) : (
          <a href={existingUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-[13px] font-medium text-indigo-700 truncate">📎 View attached proof</a>
        )}
        <button type="button" onClick={onRemoveExisting} disabled={disabled} aria-label="Remove proof"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 disabled:opacity-50">
          <Icon name="trash" size={14} />
        </button>
      </div>
    )
  }
  if (file) {
    var isPdf = file.type === 'application/pdf'
    var url = URL.createObjectURL(file)
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
        {isPdf ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-[13px] font-medium text-slate-800 truncate">📄 {file.name}</a>
        ) : (
          <>
            <img src={url} alt="proof" className="w-9 h-9 rounded object-cover shrink-0" />
            <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-800 truncate">{file.name}</span>
          </>
        )}
        <button type="button" onClick={function () { setFile(null) }} disabled={disabled} aria-label="Remove proof"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 disabled:opacity-50">
          <Icon name="trash" size={14} />
        </button>
      </div>
    )
  }
  if (rec.url) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
        <audio src={rec.url} controls className="flex-1 min-w-0 h-8" />
        <button type="button" onClick={rec.remove} disabled={disabled} aria-label="Remove voice note"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 disabled:opacity-50">
          <Icon name="trash" size={14} />
        </button>
      </div>
    )
  }
  if (rec.recording) {
    return (
      <button type="button" onClick={rec.stop}
        className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 text-[13px] font-bold text-white hover:bg-red-600 transition-colors">
        <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
        Recording… tap to stop
      </button>
    )
  }
  // Three ways to attach proof, sharing the row equally.
  var TILE = "w-full h-11 inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-slate-700 border border-slate-300 bg-white rounded-xl hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
  function pickFile(e) { if (e.target.files && e.target.files[0]) setFile(e.target.files[0]); e.target.value = '' }
  return (
    <div className="grid grid-cols-3 gap-2.5">
      <button type="button" disabled={disabled} onClick={onOpenCamera} className={TILE}>
        <Icon name="camera" size={16} />
        Capture
      </button>
      <label className={TILE + (disabled ? " opacity-50" : " cursor-pointer")}>
        <Icon name="gallery" size={16} />
        Upload
        <input type="file" accept="image/*,.pdf" className="sr-only" disabled={disabled} onChange={pickFile} />
      </label>
      <button type="button" disabled={disabled} onClick={rec.start} className={TILE}>
        <Icon name="mic" size={16} />
        Record
      </button>
    </div>
  )
}

// Expense type + sub-type picker — shared by the From field and every To row.
// `value` is { expense_type_id, expense_sub_type_id, meta }. A cost transfer just
// reclassifies which department/type bucket an amount sits in, so it deliberately
// does NOT render the sub-type's lookup extra_fields (e.g. "Employee Name" on a
// salary sub-type) the way a real expense entry (ExpenseForm.jsx) does — those
// identify who/what a fresh expense is for, which doesn't apply to a reclassification.
// stacked: type above sub-type, for the two-column New Cost Transfer form.
// quiet: side by side like the default, with each microphone inside its field.
function ExpenseTypeFields({ value, onChange, expTypes, expSubTypes, stacked, quiet }) {
  var etId = Number(value.expense_type_id) || 0
  var subs = expSubTypes.filter(function (s) { return s.expense_type_id === etId })
  var etItems = expTypes.map(function (x) { return { value: String(x.id), label: x.name } })
  var subItems = subs.map(function (x) { return { value: String(x.id), label: x.name } })

  return (
    <div className={stacked ? "space-y-2.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2.5"}>
      <SearchDropdown items={etItems} noVoice={stacked} inlineVoice={quiet}
        value={value.expense_type_id}
        onChange={function (v) { onChange({ expense_type_id: v, expense_sub_type_id: '' }) }}
        placeholder="Search expense type..." />
      <SearchDropdown items={subItems} noVoice={stacked} inlineVoice={quiet}
        value={value.expense_sub_type_id}
        onChange={function (v) { onChange({ expense_sub_type_id: v }) }}
        placeholder={!etId ? 'Pick a type first' : (subs.length === 0 ? 'No sub-types' : 'Sub-type (optional)')} />
    </div>
  )
}

export default CostTransfers

// One To row's fields: where the cost goes, then its amount beside a remark.
function ToRowFields({ row, idx, onChange, expTypes, expSubTypes }) {
  return (
    <div className="space-y-3">
      <ExpenseTypeFields quiet value={row} onChange={function (patch) { onChange(idx, patch) }}
        expTypes={expTypes} expSubTypes={expSubTypes} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="relative">
          <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-slate-500 pointer-events-none">₹</span>
          <input type="number" step="0.01" min="0" inputMode="decimal" value={row.amount_pts}
            onChange={function (e) { onChange(idx, { amount_pts: e.target.value }) }}
            placeholder="Amount *" aria-label="Amount (Rs)" style={{ fontSize: '16px' }}
            className={"w-full py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow pl-8 pr-3 tabular-nums"} />
        </div>
        <VoiceInput type="text" value={row.remarks}
          onChange={function (e) { onChange(idx, { remarks: e.target.value }) }}
          placeholder="Remarks (optional)" maxLength={200} aria-label="Remarks"
          className={"w-full py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow px-3"} />
      </div>
    </div>
  )
}
