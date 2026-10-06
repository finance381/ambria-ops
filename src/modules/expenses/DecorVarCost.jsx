import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { pushBack, goBack } from '../../lib/backNav'
import EventDatePicker from '../../components/ui/EventDatePicker'
import SearchDropdown from '../../components/ui/SearchDropdown'
import Icon from '../../components/ui/Icon'
import Modal from '../../components/ui/Modal'
import { appConfirm } from '../../components/ui/AppDialog'
import { buildDecorVarCostXlsx, deliverFile, exportFileName } from '../../lib/decorVarCostExport'
import { deptCls, deptOrder } from '../../lib/ui'
import {
  SHEETS, getSheet, rowGroups, rowCalc, formulaHint, entryAmountPaise,
  sheetTotals, validateEntry, filledCount, num, toPaise, cleanSheetData, cleanLines,
} from '../../lib/decorVarCost'

// Decor Var Cost — the decor team's per-function cost sheets, moved off Excel
// (see src/lib/decorVarCost.js for the sheets and their formulas, and
// migration 00087 for the tables).
//
// The flow, one screen at a time:
//   list    → your sheets, newest first; + New
//   setup   → For a function? (date → function → venue → sub venue), then
//             the department, which picks the sheet
//   entry   → one date's sheet, Excel-like: the rows, a quantity per row,
//             Rate and Amount worked out as the sheet does. Save keeps it.
//   record  → the saved dates, + Add date, the whole sheet, Final Submit
//
// Save and Final Submit are different acts. Save writes one date and leaves
// the sheet a draft, so the 3rd can be saved on the 3rd and the 4th on the
// 4th; Final Submit locks the lot once every date is in.

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

// ISO date string a number of days from another.
function shiftDate(iso, days) {
  var d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  var m = String(d.getMonth() + 1).padStart(2, '0')
  var dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + m + '-' + dd
}

function todayIso() { return shiftDate(new Date().toISOString().slice(0, 10), 0) }

// "3 Oct · Fri" — a date as the entry cards say it.
function shortDate(iso) {
  if (!iso) return ''
  var d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleDateString('en-IN', { weekday: 'short' })
}

// Same grouping as the Expense form's function picker: one evening at one
// venue can be up to four contracts (one per department), listed once with
// its departments as chips.
function funcKeyOf(r) {
  return [r.client_name || '', r.venue_name || '', r.session || '', (r.event_name || '').trim().toLowerCase()].join('|')
}
function groupFunctions(rows) {
  var byKey = {}
  var order = []
  rows.forEach(function (r) {
    var k = funcKeyOf(r)
    if (!byKey[k]) { byKey[k] = { key: k, contracts: [] }; order.push(k) }
    byKey[k].contracts.push(r)
  })
  order.forEach(function (k) {
    byKey[k].contracts.sort(function (a, b) { return deptOrder(a.department) - deptOrder(b.department) })
  })
  return order.map(function (k) { return byKey[k] })
}

function emptyHeader() {
  return { is_function: false, function_date: '', event_id: '', venue_id: '', sub_venue_id: '', sheet_code: '' }
}

var STATUS_CHIP = {
  draft: 'bg-amber-50 text-amber-800 border-amber-200',
  submitted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
var CHIP = 'inline-flex items-center gap-1 h-[22px] px-2 rounded-full border text-[10.5px] font-bold whitespace-nowrap '
// 16px type in every input: anything smaller makes iOS zoom the page on focus.
var INPUT = 'w-full min-w-0 h-11 px-3 rounded-xl border bg-white text-[16px] text-slate-900 tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-shadow '
var INPUT_OK = 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/20'
var INPUT_BAD = 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
var CARD = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
// The small chips under a row's name: unit, rate, remark.
var META_CHIP = 'inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11.5px] font-bold leading-none transition-colors '
// "Rate" / "Amount" beside the cells they label, right-aligned against them.
// The bar at the foot of each step (Continue / Save / Final Submit).
// On the phone it is fixed to the bottom of the screen, not sticky: a
// sticky bar stops where its column ends, and the shell puts its own
// padding and the "Ambria ● Ops" footer under the column — so on a short
// sheet the bar floated half way up with empty page beneath it. Fixed, it
// sits on the screen's edge whatever the page's length, and BAR_SPACE
// keeps the last card from hiding behind it. The bottom padding grows on
// phones with a home-indicator bar. In the admin shell it stays sticky.
var BAR_GLASS = 'ambria-glass z-30 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] '
var ROW_LABEL = 'text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-slate-400 text-right pr-1'

function DecorVarCost({ profile, inAdmin }) {
  var wide = !!inAdmin
  var BAR = BAR_GLASS + (wide ? 'sticky bottom-0 -mx-4' : 'fixed bottom-0 inset-x-0 mx-auto w-full max-w-[540px]')
  var permsNew = profile?.permsNew || []
  var canApprove = hasPerm(permsNew, 'finance.expenses.approve')
  var refData = useReferenceData()
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)

  var [view, setView] = useState('list')
  var viewRef = useRef('list')
  useEffect(function () { viewRef.current = view }, [view])

  // ── list ──
  var [scope, setScope] = useState('mine')
  var [records, setRecords] = useState(null)
  var [listErr, setListErr] = useState('')

  // ── reference rows ──
  var [subVenues, setSubVenues] = useState([])
  var [decorSubDepts, setDecorSubDepts] = useState([])

  // ── the sheet being worked on ──
  // { id|null, serial_no, sheet_code, is_function, function_date, event_id,
  //   venue_id, sub_venue_id, sheet: {rates, remarks, particulars}, status,
  //   total_paise, entries: [{ id, entry_date, lines, amount_paise }], … }
  var [cur, setCur] = useState(null)
  var curRef = useRef(null)
  useEffect(function () { curRef.current = cur }, [cur])
  var [recordLoading, setRecordLoading] = useState(false)

  // ── setup ──
  var [hdr, setHdr] = useState(emptyHeader())
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var [setupErr, setSetupErr] = useState('')
  var [setupSaving, setSetupSaving] = useState(false)

  // ── entry editor ──
  // { id|null, entry_date, lines: {rowKey: typed}, sheet: {rates, remarks, particulars} }
  var [ed, setEd] = useState(null)
  var dirtyRef = useRef(false)
  var [edErrors, setEdErrors] = useState({})
  var [edErr, setEdErr] = useState('')
  var [edSaving, setEdSaving] = useState(false)
  var [query, setQuery] = useState('')
  var [filledOnly, setFilledOnly] = useState(false)
  var [openRemarks, setOpenRemarks] = useState({})
  // The row group whose rate is being set, in its own small sheet — set
  // inline it pushed the rows below down by three lines.
  var [rateFor, setRateFor] = useState(null)

  // ── record ──
  var [busy, setBusy] = useState('')
  var [recordErr, setRecordErr] = useState('')
  var [flash, setFlash] = useState('')
  // Saved entries opened to show that day's rows: { entryId: true }.
  var [openDays, setOpenDays] = useState({})

  useEffect(function () {
    Promise.all([
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, code, department_id, departments!inner(name)').eq('departments.name', 'Decor'),
    ]).then(function (res) {
      setSubVenues(res[0].data || [])
      setDecorSubDepts(res[1].data || [])
    })
  }, [])

  useEffect(function () { if (view === 'list') loadList() }, [view, scope])

  useEffect(function () {
    if (!flash) return
    var t = setTimeout(function () { setFlash('') }, 2600)
    return function () { clearTimeout(t) }
  }, [flash])

  // ═══ navigation ═══════════════════════════════════════════════════════
  // One history entry stands for the whole time spent away from the list.
  // The phone's back walks up a level at a time — entry → record (or setup,
  // before the first save) → list — re-arming itself until it reaches the
  // list. The on-screen back buttons do the same through parentOf.
  function parentOf(v) {
    var c = curRef.current
    if (v === 'entry') return c && c.id ? 'record' : 'setup'
    if (v === 'setup') return c && c.id ? 'record' : 'list'
    return 'list'
  }

  async function confirmLeaveEntry() {
    if (viewRef.current !== 'entry' || !dirtyRef.current) return true
    return appConfirm('Leave this date without saving? What you typed here will be lost.')
  }

  async function onHardwareBack() {
    if (!(await confirmLeaveEntry())) { pushBack(onHardwareBack); return }
    var target = parentOf(viewRef.current)
    if (target !== 'list') pushBack(onHardwareBack)
    moveTo(target)
  }

  function moveTo(target) {
    if (target !== 'entry') { dirtyRef.current = false; setEd(null) }
    if (target === 'list') { setCur(null) }
    setView(target)
    window.scrollTo(0, 0)
  }

  // From the list into the sheet area.
  function enterArea(target) {
    pushBack(onHardwareBack)
    setView(target)
    window.scrollTo(0, 0)
  }

  async function backButton() {
    if (!(await confirmLeaveEntry())) return
    var target = parentOf(view)
    if (target === 'list') { dirtyRef.current = false; goBack() }
    else moveTo(target)
  }

  // ═══ data ═════════════════════════════════════════════════════════════
  async function loadList() {
    setListErr('')
    var q = supabase.from('decor_var_costs')
      .select('id, serial_no, sheet_code, is_function, function_date, venue_id, sub_venue_id, status, total_paise, created_at, submitted_at, created_by, profiles:created_by(name), decor_var_cost_entries(entry_date, amount_paise)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (scope === 'mine' || !canApprove) q = q.eq('created_by', profile.id)
    var { data, error } = await q
    if (error) { setListErr(error.message); setRecords([]); return }
    setRecords(data || [])
  }

  async function loadRecord(id) {
    setRecordLoading(true)
    var { data, error } = await supabase.from('decor_var_costs')
      .select('*, creator:created_by(name), submitter:submitted_by(name), decor_var_cost_entries(id, entry_date, lines, amount_paise, updated_at)')
      .eq('id', id).maybeSingle()
    setRecordLoading(false)
    if (error || !data) { setRecordErr(error ? error.message : 'This sheet could not be found'); return null }
    var rec = Object.assign({}, data, {
      sheet: Object.assign({ rates: {}, remarks: {}, particulars: {} }, data.sheet || {}),
      entries: (data.decor_var_cost_entries || []).slice().sort(function (a, b) { return a.entry_date < b.entry_date ? -1 : 1 }),
    })
    setCur(rec)
    return rec
  }

  async function openRecord(id) {
    setRecordErr('')
    enterArea('record')
    await loadRecord(id)
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, session, client_name, department')
      .eq('function_date', dateStr)
      .order('event_name')
    setEvents(data || [])
    setEventsLoading(false)
  }

  // ═══ setup ════════════════════════════════════════════════════════════
  function startNew() {
    setCur(null)
    setHdr(emptyHeader())
    setEvents([])
    setSetupErr('')
    enterArea('setup')
  }

  function editDetails() {
    var c = cur
    setHdr({
      is_function: !!c.is_function,
      function_date: c.function_date || '',
      event_id: c.event_id ? String(c.event_id) : '',
      venue_id: c.venue_id ? String(c.venue_id) : '',
      sub_venue_id: c.sub_venue_id ? String(c.sub_venue_id) : '',
      sheet_code: c.sheet_code,
    })
    setSetupErr('')
    if (c.function_date) loadEventsByDate(c.function_date)
    moveTo('setup')
  }

  function setH(patch) { setHdr(function (h) { return Object.assign({}, h, patch) }) }

  function venueSubs(venueId) {
    return subVenues.filter(function (s) { return String(s.venue_id) === String(venueId) })
  }

  // The booking picked on the function date fills in its venue when the
  // venue's name can be matched; the venue stays a choice either way.
  function pickFunction(head) {
    var patch = { event_id: String(head.id) }
    var vn = String(head.venue_name || '').trim().toLowerCase()
    if (vn) {
      var hit = venues.find(function (v) { return String(v.name || '').trim().toLowerCase() === vn }) ||
        venues.find(function (v) { var n = String(v.name || '').trim().toLowerCase(); return n && (vn.indexOf(n) !== -1 || n.indexOf(vn) !== -1) })
      if (hit && String(hit.id) !== String(hdr.venue_id)) { patch.venue_id = String(hit.id); patch.sub_venue_id = '' }
    }
    setH(patch)
  }

  function setupProblem(h) {
    if (h.is_function) {
      if (!h.function_date) return 'Pick the function date'
      if (!h.venue_id) return 'Pick the venue'
      if (venueSubs(h.venue_id).length > 0 && !h.sub_venue_id) return 'Pick the sub venue'
    }
    if (!h.sheet_code) return 'Pick the department'
    return ''
  }

  function subDeptIdFor(code) {
    var sh = getSheet(code)
    if (!sh || !sh.subDeptCode) return null
    var want = sh.subDeptCode.toUpperCase()
    var hit = decorSubDepts.find(function (s) { return String(s.code || '').toUpperCase() === want }) ||
      decorSubDepts.find(function (s) { return String(s.name || '').toUpperCase().indexOf(want) === 0 })
    return hit ? hit.id : null
  }

  // The header as the save functions take it.
  function headerPayload(h, sheetData) {
    return {
      sheet_code: h.sheet_code,
      sub_department_id: subDeptIdFor(h.sheet_code),
      is_function: !!h.is_function,
      function_date: h.is_function ? (h.function_date || null) : null,
      event_id: h.is_function && h.event_id ? Number(h.event_id) : null,
      venue_id: h.is_function && h.venue_id ? Number(h.venue_id) : null,
      sub_venue_id: h.is_function && h.sub_venue_id ? Number(h.sub_venue_id) : null,
      sheet: sheetData,
    }
  }

  async function continueSetup() {
    var p = setupProblem(hdr)
    if (p) { setSetupErr(p); return }
    setSetupErr('')
    if (cur && cur.id) {
      // Details of a saved sheet: written straight away, back to the record.
      setSetupSaving(true)
      var { error } = await supabase.rpc('fn_dvc_update_header', { p_cost_id: cur.id, p_header: headerPayload(hdr, cur.sheet) })
      setSetupSaving(false)
      if (error) { setSetupErr(error.message); return }
      await loadRecord(cur.id)
      setFlash('Details saved')
      moveTo('record')
      return
    }
    // A new sheet is not written until its first date is saved, so walking
    // away from here leaves no empty draft behind.
    var fresh = Object.assign({ id: null, serial_no: '', status: 'draft', total_paise: 0, entries: [], sheet: { rates: {}, remarks: {}, particulars: {} } }, hdr)
    setCur(fresh)
    curRef.current = fresh
    openEntry(null, fresh)
  }

  // ═══ entry editor ═════════════════════════════════════════════════════
  // A date nobody has used yet, nearest the function: the function date
  // itself if free, else the days before it, else today.
  function suggestDate(c) {
    var used = (c.entries || []).map(function (e) { return e.entry_date })
    if (c.is_function && c.function_date) {
      for (var i = 0; i <= 6; i++) {
        var d = shiftDate(c.function_date, -i)
        if (used.indexOf(d) === -1) return d
      }
    }
    var t = todayIso()
    return used.indexOf(t) === -1 ? t : ''
  }

  function openEntry(entry, c) {
    c = c || cur
    setEd({
      id: entry ? entry.id : null,
      entry_date: entry ? entry.entry_date : suggestDate(c),
      lines: entry ? Object.assign({}, entry.lines) : {},
      sheet: {
        rates: Object.assign({}, c.sheet.rates),
        remarks: Object.assign({}, c.sheet.remarks),
        particulars: Object.assign({}, c.sheet.particulars),
      },
    })
    dirtyRef.current = false
    setEdErrors({}); setEdErr(''); setQuery(''); setFilledOnly(false); setOpenRemarks({}); setRateFor(null)
    if (viewRef.current === 'list') enterArea('entry')
    else moveTo('entry')
  }

  function setLine(key, v) {
    dirtyRef.current = true
    setEd(function (e) { var l = Object.assign({}, e.lines); l[key] = v; return Object.assign({}, e, { lines: l }) })
    if (edErrors[key]) setEdErrors(function (m) { var n = Object.assign({}, m); delete n[key]; return n })
  }
  function setSheetField(field, key, v) {
    dirtyRef.current = true
    setEd(function (e) {
      var part = Object.assign({}, e.sheet[field]); part[key] = v
      var sh = Object.assign({}, e.sheet); sh[field] = part
      return Object.assign({}, e, { sheet: sh })
    })
    if (edErrors[key]) setEdErrors(function (m) { var n = Object.assign({}, m); delete n[key]; return n })
  }

  async function saveEntry() {
    if (edSaving) return
    var sheet = getSheet(cur.sheet_code)
    setEdErr('')
    if (!ed.entry_date) { setEdErr('Pick the date for this entry'); return }
    var clash = (cur.entries || []).some(function (e) { return e.entry_date === ed.entry_date && e.id !== ed.id })
    if (clash) { setEdErr('There is already an entry for ' + formatDate(ed.entry_date) + ' — edit that one instead'); return }
    var v = validateEntry(sheet, ed.lines, ed.sheet)
    setEdErrors(v.rows)
    if (v.message) {
      setEdErr(v.message)
      var firstKey = Object.keys(v.rows)[0]
      if (firstKey) {
        setFilledOnly(false); setQuery('')
        setTimeout(function () {
          var el = document.getElementById('dvc-row-' + firstKey)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
      }
      return
    }
    var sheetData = cleanSheetData(sheet, ed.sheet)
    var lines = cleanLines(sheet, ed.lines)
    setEdSaving(true)
    var { data, error } = await supabase.rpc('fn_dvc_save_entry', {
      p_cost_id: cur.id,
      p_header: headerPayload(cur, sheetData),
      p_entry_id: ed.id,
      p_entry_date: ed.entry_date,
      p_lines: lines,
      p_amount_paise: entryAmountPaise(sheet, lines, sheetData.rates),
    })
    setEdSaving(false)
    if (error) { setEdErr(error.message); return }
    var savedDate = ed.entry_date
    dirtyRef.current = false
    await loadRecord(data.cost_id)
    setFlash('Saved ' + formatDate(savedDate))
    moveTo('record')
  }

  // ═══ record actions ═══════════════════════════════════════════════════
  async function deleteEntry(entry) {
    if (!(await appConfirm('Delete the entry for ' + formatDate(entry.entry_date) + '?'))) return
    setBusy('del-' + entry.id); setRecordErr('')
    var { error } = await supabase.rpc('fn_dvc_delete_entry', { p_entry_id: entry.id })
    setBusy('')
    if (error) { setRecordErr(error.message); return }
    await loadRecord(cur.id)
    setFlash('Entry deleted')
  }

  async function deleteSheet() {
    var msg = cur.status === 'submitted'
      ? 'Delete submitted sheet ' + cur.serial_no + ' and every date on it?\n\nThis cannot be undone. The sheets after it move up a number.'
      : 'Delete draft ' + cur.serial_no + ' and every date saved on it?\n\nThe sheets after it move up a number.'
    if (!(await appConfirm(msg))) return
    setBusy('delete'); setRecordErr('')
    var { error } = await supabase.rpc('fn_dvc_delete', { p_cost_id: cur.id })
    setBusy('')
    if (error) { setRecordErr(error.message); return }
    goBack()
  }

  // Everything Final Submit needs, checked here so the person sees which
  // date to fix rather than a database error.
  function submitProblem(c) {
    var sheet = getSheet(c.sheet_code)
    var p = setupProblem({
      is_function: c.is_function, function_date: c.function_date || '', venue_id: c.venue_id ? String(c.venue_id) : '',
      sub_venue_id: c.sub_venue_id ? String(c.sub_venue_id) : '', sheet_code: c.sheet_code,
    })
    if (p) return { message: p + ' — tap Edit details' }
    if (!c.entries || c.entries.length === 0) return { message: 'Save at least one date before submitting' }
    for (var i = 0; i < c.entries.length; i++) {
      var e = c.entries[i]
      var v = validateEntry(sheet, e.lines, c.sheet)
      if (v.message) return { message: formatDate(e.entry_date) + ' — ' + v.message, entry: e }
    }
    return null
  }

  async function finalSubmit() {
    var prob = submitProblem(cur)
    if (prob) { setRecordErr(prob.message); return }
    var sheet = getSheet(cur.sheet_code)
    var totals = sheetTotals(sheet, cur.entries, cur.sheet.rates)
    var n = cur.entries.length
    if (!(await appConfirm('Submit ' + cur.serial_no + ' with ' + n + (n === 1 ? ' date' : ' dates') + ', ' + formatPoints(totals.totalPaise) + '?\n\nOnce submitted it can no longer be changed.'))) return
    setBusy('submit'); setRecordErr('')
    var { error } = await supabase.rpc('fn_dvc_submit', { p_cost_id: cur.id, p_total_paise: totals.totalPaise })
    setBusy('')
    if (error) { setRecordErr(error.message); return }
    logActivity('decor_var_cost_submit', { id: cur.id, serial_no: cur.serial_no, total_paise: totals.totalPaise, dates: n })
    await loadRecord(cur.id)
    setFlash('Submitted ' + cur.serial_no)
  }

  async function exportXlsx() {
    if (busy) return
    setBusy('export'); setRecordErr('')
    try {
      var v = venues.find(function (x) { return String(x.id) === String(cur.venue_id) }) ||
        refData.venues.find(function (x) { return String(x.id) === String(cur.venue_id) })
      var sv = subVenues.find(function (x) { return String(x.id) === String(cur.sub_venue_id) })
      var blob = await buildDecorVarCostXlsx(cur, v ? v.name : '', sv ? sv.name : '')
      await deliverFile(blob, exportFileName(cur, v ? v.name : '', cur.creator && cur.creator.name))
    } catch (err) {
      setRecordErr('Could not make the Excel file: ' + (err && err.message ? err.message : err))
    }
    setBusy('')
  }

  // ═══ shared bits ══════════════════════════════════════════════════════
  function venueLabel(venueId, subId) {
    var v = venues.find(function (x) { return String(x.id) === String(venueId) }) ||
      refData.venues.find(function (x) { return String(x.id) === String(venueId) })
    var s = subVenues.find(function (x) { return String(x.id) === String(subId) })
    if (!v) return ''
    return v.name + (s ? ' · ' + s.name : '')
  }

  function header(title, sub, right) {
    return (
      <div className="flex items-center gap-2.5">
        {view !== 'list' && (
          <button type="button" onClick={backButton} aria-label="Back"
            className="shrink-0 w-10 h-10 rounded-xl border border-slate-200 bg-white inline-flex items-center justify-center text-slate-700 hover:bg-slate-50 active:scale-95 transition-all">
            <Icon name="arrowLeft" size={17} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[21px] font-extrabold text-slate-900 tracking-[-0.025em] leading-[1.15] truncate">{title}</h2>
          {sub && <p className="mt-0.5 text-[12.5px] font-medium text-slate-500 leading-snug truncate">{sub}</p>}
        </div>
        {right}
      </div>
    )
  }

  function flashBar() {
    if (!flash) return null
    return (
      <div className="ambria-rise flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] font-bold text-emerald-800">
        <Icon name="checkCircle" size={15} />{flash}
      </div>
    )
  }

  function errorBar(msg) {
    if (!msg) return null
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] font-semibold text-red-700">
        <Icon name="alert" size={15} className="shrink-0 mt-px" /><span className="min-w-0">{msg}</span>
      </div>
    )
  }

  function toggle(on, onChange, label) {
    return (
      <button type="button" onClick={function () { onChange(!on) }} aria-pressed={on} aria-label={label}
        className="shrink-0 flex items-center">
        <span className={'relative block w-11 h-6 rounded-full transition-colors ' + (on ? 'bg-indigo-600' : 'bg-slate-300')}>
          <span className={'absolute block top-0.5 w-5 h-5 bg-white rounded-full shadow transition-[left] duration-200 ' + (on ? 'left-[22px]' : 'left-0.5')} />
        </span>
      </button>
    )
  }

  function stepLabel(n, text, done) {
    return (
      <div className="flex items-center gap-2 mb-2">
        <span className={'shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11.5px] font-extrabold ' +
          (done ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white')}>
          {done ? <Icon name="check" size={12} strokeWidth={3} /> : n}
        </span>
        <span className="font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900">{text}</span>
      </div>
    )
  }

  // ═══ views ════════════════════════════════════════════════════════════
  if (view === 'list') return renderList()
  if (view === 'setup') return renderSetup()
  if (view === 'entry' && ed && cur) return renderEntry()
  return renderRecord()

  // ── list ───────────────────────────────────────────────────────────────
  function renderList() {
    return (
      <div className="space-y-3">
        {header('Decor Var Cost', 'Decor cost sheets, date by date', (
          <button type="button" onClick={startNew}
            className="shrink-0 h-10 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-[13.5px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all shadow-[0_2px_8px_rgba(79,70,229,0.25)]">
            <Icon name="plus" size={15} strokeWidth={2.4} />New
          </button>
        ))}
        {canApprove && (
          <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200">
            {[['mine', 'Mine'], ['all', 'Everyone']].map(function (o) {
              var on = scope === o[0]
              return (
                <button key={o[0]} type="button" onClick={function () { setScope(o[0]) }} aria-pressed={on}
                  className={'h-8 px-3.5 rounded-lg text-[12.5px] font-bold transition-colors ' + (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                  {o[1]}
                </button>
              )
            })}
          </div>
        )}
        {errorBar(listErr)}
        {records === null && <p className="text-[13.5px] text-slate-500 text-center py-10">Loading…</p>}
        {records && records.length === 0 && !listErr && (
          <div className={CARD + ' px-6 py-10 text-center'}>
            <span className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center mb-3">
              <Icon name="fileText" size={26} />
            </span>
            <p className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-slate-900">No cost sheets yet</p>
            <p className="text-[12.5px] text-slate-500 mt-1">Start one for a function, or for a department on its own.</p>
            <button type="button" onClick={startNew}
              className="mt-4 h-10 px-4 inline-flex items-center gap-1.5 rounded-xl text-[13.5px] font-bold text-white bg-indigo-600 hover:bg-indigo-700">
              <Icon name="plus" size={15} strokeWidth={2.4} />New cost sheet
            </button>
          </div>
        )}
        {records && records.length > 0 && (
          <div className={'grid gap-2.5 grid-cols-1' + (wide ? ' lg:grid-cols-2 xl:grid-cols-3' : '')}>
            {records.map(function (r) {
              var sh = getSheet(r.sheet_code)
              var ents = r.decor_var_cost_entries || []
              var soFar = ents.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0)
              var dates = ents.map(function (e) { return e.entry_date }).sort()
              return (
                <button key={r.id} type="button" onClick={function () { openRecord(r.id) }}
                  className={CARD + ' text-left p-3.5 hover:border-indigo-300 active:bg-indigo-50/40 transition-colors'}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                      <span data-notranslate className="font-mono text-[12.5px] font-bold tracking-[0.02em] text-slate-900 bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5">{r.serial_no}</span>
                      <span className={CHIP + 'border-transparent ' + deptCls('Decor')}>{sh ? sh.name : r.sheet_code}</span>
                      <span className={CHIP + STATUS_CHIP[r.status]}>{r.status === 'draft' ? 'Draft' : 'Submitted'}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p data-notranslate className="font-display text-[16px] font-extrabold tabular-nums tracking-[-0.02em] text-slate-900">{formatPoints(r.status === 'submitted' ? r.total_paise : soFar)}</p>
                      {r.status === 'draft' && ents.length > 0 && <p className="text-[10.5px] font-semibold text-slate-500">so far</p>}
                    </div>
                  </div>
                  <p className="mt-2 text-[13.5px] font-semibold text-slate-800 leading-snug break-words">
                    {r.is_function
                      ? <>Function {formatDate(r.function_date)}{venueLabel(r.venue_id, r.sub_venue_id) ? ' · ' + venueLabel(r.venue_id, r.sub_venue_id) : ''}</>
                      : 'Not for a function'}
                  </p>
                  <p className="mt-1 text-[12.5px] font-medium text-slate-500 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} className="text-slate-400" />
                      {dates.length === 0 ? 'No dates yet' : dates.length === 1 ? formatDate(dates[0]) : dates.length + ' dates · ' + formatDate(dates[0]) + ' – ' + formatDate(dates[dates.length - 1])}
                    </span>
                    {scope === 'all' && r.profiles && <span className="inline-flex items-center gap-1"><Icon name="user" size={12} className="text-slate-400" />{r.profiles.name}</span>}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── setup ──────────────────────────────────────────────────────────────
  function renderSetup() {
    var editing = !!(cur && cur.id)
    var subs = hdr.venue_id ? venueSubs(hdr.venue_id) : []
    var fnDone = hdr.is_function ? !!(hdr.function_date && hdr.venue_id && (subs.length === 0 || hdr.sub_venue_id)) : true
    var groups = groupFunctions(events)
    var picked = hdr.event_id ? groups.filter(function (g) { return g.contracts.some(function (c) { return String(c.id) === hdr.event_id }) }) : []
    var shown = picked.length === 1 ? picked : groups
    var problem = setupProblem(hdr)
    return (
      <div className="space-y-3">
        {header(editing ? 'Edit details' : 'New cost sheet', editing ? cur.serial_no : 'Decor Var Cost')}

        {/* For a function? — the same switch the Expense form opens with. */}
        <div className={CARD + ' p-3.5 space-y-3'}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={'shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center transition-colors ' +
                (hdr.is_function ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400')}>
                <Icon name="calendar" size={17} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-bold tracking-[-0.01em] text-slate-900">For a function?</span>
                <span className="block text-[11.5px] text-slate-500 leading-snug">{hdr.is_function ? 'Date, venue and sub venue, then the department' : 'Straight to the department'}</span>
              </span>
            </div>
            {toggle(hdr.is_function, function (v) {
              setSetupErr('')
              if (v) setH({ is_function: true })
              else { setH({ is_function: false, function_date: '', event_id: '', venue_id: '', sub_venue_id: '' }); setEvents([]) }
            }, 'For a function?')}
          </div>

          {hdr.is_function && (
            <div className="pt-3 border-t border-slate-100 space-y-4">
              <div>
                {stepLabel(1, 'Function date', !!hdr.function_date)}
                <EventDatePicker value={hdr.function_date} collapsible includePast placeholder="Pick the function date"
                  onChange={function (d) { setH({ function_date: d, event_id: '' }); loadEventsByDate(d) }} />
                {eventsLoading && <p className="mt-2 text-[12.5px] text-slate-500">Loading functions…</p>}
                {hdr.function_date && !eventsLoading && events.length > 0 && (
                  <div className="mt-2.5">
                    <p className="text-[11.5px] font-semibold text-slate-500 mb-1.5">Functions on this date — tap one to fill its venue (optional)</p>
                    <div className={'grid gap-2 grid-cols-1 sm:grid-cols-2' + (wide ? ' lg:grid-cols-3' : '')}>
                      {shown.map(function (g) {
                        var head = g.contracts[0]
                        var sel = g.contracts.some(function (c) { return String(c.id) === hdr.event_id })
                        return (
                          <button key={g.key} type="button" onClick={function () { if (sel) setH({ event_id: '' }); else pickFunction(head) }}
                            className={'text-left rounded-xl border px-2.5 py-2 transition-all ' +
                              (sel ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300')}>
                            <span className="flex items-start justify-between gap-1.5">
                              <span className={'min-w-0 flex-1 block text-[11.5px] font-bold uppercase tracking-[0.03em] leading-snug truncate ' + (sel ? 'text-indigo-900' : 'text-slate-900')}>{head.event_name}</span>
                              <span className="shrink-0 flex items-center gap-1">
                                {g.contracts.map(function (c) {
                                  return <span key={c.id} className={'text-[10.5px] font-bold uppercase leading-none px-1.5 py-[3px] rounded ' + deptCls(c.department)}>{c.department}</span>
                                })}
                              </span>
                            </span>
                            {head.client_name && <span className={'block text-[11.5px] leading-snug truncate ' + (sel ? 'text-indigo-800' : 'text-slate-700')}>{head.client_name}</span>}
                            <span className={'block text-[10.5px] leading-snug truncate ' + (sel ? 'text-indigo-600' : 'text-slate-500')}>{(head.venue_name || '') + (head.session ? ' · ' + head.session : '')}</span>
                          </button>
                        )
                      })}
                    </div>
                    {shown !== groups && groups.length > 1 && (
                      <button type="button" onClick={function () { setH({ event_id: '' }) }} className="mt-1.5 text-[11.5px] font-bold text-indigo-600 px-1">Change function</button>
                    )}
                  </div>
                )}
              </div>

              <div className={'grid gap-4' + (wide ? ' lg:grid-cols-2' : '')}>
                <div>
                  {stepLabel(2, 'Venue', !!hdr.venue_id)}
                  <SearchDropdown noVoice
                    items={venues.map(function (v) { return { label: (v.code ? v.code + ' — ' : '') + v.name, value: String(v.id) } })}
                    value={hdr.venue_id}
                    onChange={function (val) { setH({ venue_id: val || '', sub_venue_id: '' }) }}
                    placeholder="Search or select venue…" />
                </div>
                <div>
                  {stepLabel(3, 'Sub venue', !!hdr.sub_venue_id || (!!hdr.venue_id && subs.length === 0))}
                  {!hdr.venue_id && <p className="h-11 flex items-center px-3 rounded-xl border border-dashed border-slate-300 text-[12.5px] text-slate-500">Pick the venue first</p>}
                  {hdr.venue_id && subs.length === 0 && <p className="h-11 flex items-center px-3 rounded-xl bg-slate-50 border border-slate-200 text-[12.5px] text-slate-500">This venue has no sub venues</p>}
                  {hdr.venue_id && subs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {subs.map(function (s) {
                        var on = String(s.id) === hdr.sub_venue_id
                        return (
                          <button key={s.id} type="button" onClick={function () { setH({ sub_venue_id: on ? '' : String(s.id) }) }} aria-pressed={on}
                            className={'h-10 px-3.5 rounded-xl border text-[13.5px] font-bold transition-colors ' +
                              (on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')}>
                            {s.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Department — which of the workbook's sheets this is. */}
        <div className={CARD + ' p-3.5 ' + (hdr.is_function && !fnDone ? 'opacity-60' : '')}>
          {stepLabel(hdr.is_function ? 4 : 1, 'Department', !!hdr.sheet_code)}
          {editing && <p className="-mt-1 mb-2 text-[11.5px] text-slate-500">The department of a saved sheet stays as it is.</p>}
          <div className={'grid gap-2 grid-cols-3' + (wide ? ' lg:grid-cols-5' : '')}>
            {SHEETS.map(function (s) {
              var on = hdr.sheet_code === s.code
              var locked = editing && !on
              return (
                <button key={s.code} type="button" disabled={locked}
                  onClick={function () { setSetupErr(''); setH({ sheet_code: s.code }) }} aria-pressed={on}
                  className={'min-w-0 rounded-xl border px-2 py-2.5 text-center transition-all ' +
                    (on ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                      : locked ? 'border-slate-200 bg-slate-50 opacity-50'
                        : 'border-slate-200 bg-white hover:border-indigo-300 active:scale-[0.98]')}>
                  <span className={'block font-mono text-[10.5px] font-bold tracking-[0.04em] ' + (on ? 'text-indigo-600' : 'text-slate-400')}>{s.code === 'COMMISSION' ? 'COM' : s.code}</span>
                  <span className={'block text-[13.5px] font-bold leading-tight truncate ' + (on ? 'text-indigo-900' : 'text-slate-800')}>{s.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {errorBar(setupErr)}

        {!wide && <div aria-hidden="true" className="h-24" />}
        <div className={BAR}>
          <button type="button" onClick={continueSetup} disabled={setupSaving}
            className={'w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-bold text-white transition-all ' +
              (problem || setupSaving ? 'bg-slate-400' : 'bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] active:scale-[0.98]')}>
            {setupSaving ? 'Saving…' : editing ? 'Save details' : 'Continue to the sheet'}
            {!setupSaving && <Icon name="arrowRight" size={15} />}
          </button>
          {problem && <p className="mt-1.5 text-center text-[11.5px] font-semibold text-slate-500">{problem}</p>}
        </div>
      </div>
    )
  }

  // ── entry editor ───────────────────────────────────────────────────────
  function renderEntry() {
    var sheet = getSheet(cur.sheet_code)
    var rates = ed.sheet.rates
    var dayPaise = entryAmountPaise(sheet, cleanLines(sheet, ed.lines), rates)
    var q = query.trim().toLowerCase()
    var groups = rowGroups(sheet).filter(function (g) {
      if (filledOnly && !g.rows.some(function (r) { return num(ed.lines[r.key]) })) return false
      if (!q) return true
      var text = g.name + ' ' + g.rows.map(function (r) { return ed.sheet.particulars[r.key] || '' }).join(' ')
      return text.toLowerCase().indexOf(q) !== -1
    })
    var filled = filledCount(sheet, ed.lines)

    return (
      <div className="space-y-3">
        {header(ed.id ? 'Edit entry' : 'New entry',
          (cur.serial_no ? cur.serial_no + ' · ' : '') + sheet.title)}

        {/* Which date this entry is for. */}
        <div className={CARD + ' p-3.5'}>
          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="dvc-date" className="text-[13.5px] font-bold text-slate-800 inline-flex items-center gap-1.5">
              <Icon name="calendar" size={15} className="text-slate-400" />Entry date <span className="text-red-500">*</span>
            </label>
            <input id="dvc-date" type="date" value={ed.entry_date}
              onChange={function (e) { dirtyRef.current = true; var v = e.target.value; setEd(function (x) { return Object.assign({}, x, { entry_date: v }) }); setEdErr('') }}
              className={INPUT + INPUT_OK + ' !w-auto flex-1 min-w-[160px]'} />
          </div>
          {cur.is_function && (
            <p className="mt-2 text-[11.5px] text-slate-500">
              Function {formatDate(cur.function_date)}{venueLabel(cur.venue_id, cur.sub_venue_id) ? ' · ' + venueLabel(cur.venue_id, cur.sub_venue_id) : ''}
            </p>
          )}
        </div>

        {/* Find a row in a 38-row sheet without scrolling it end to end. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="search" value={query} onChange={function (e) { setQuery(e.target.value) }} placeholder="Find a row…"
              className="w-full h-10 pl-9 pr-3 bg-white border border-slate-300 rounded-xl text-[16px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <button type="button" onClick={function () { setFilledOnly(!filledOnly) }} aria-pressed={filledOnly}
            className={'shrink-0 h-10 px-3 rounded-xl border text-[12.5px] font-bold transition-colors ' +
              (filledOnly ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600')}>
            Filled<span data-notranslate className="tabular-nums">{' · ' + filled}</span>
          </button>
        </div>

        {/* The sheet. On a laptop the columns line up as the workbook's do;
            on a phone each row is a card, a Day/Night pair side by side. */}
        <div className={CARD}>
          <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/70 rounded-t-2xl flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-extrabold uppercase tracking-[0.1em] text-slate-600">{sheet.title}</span>
            <span className="text-[11.5px] font-semibold text-slate-500">{sheet.rows.length} rows</span>
          </div>
          {/* Column heads that stay under the app bar while the rows scroll,
              so a box half way down the sheet still says Day or Night. */}
          {!wide && (
            <div className="sticky top-14 z-20 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-1.5 px-3 py-1.5 bg-white/95 backdrop-blur border-b border-slate-200 text-[10.5px] font-extrabold uppercase tracking-[0.08em]">
              <span className="text-slate-500">Particulars</span>
              <span className="text-center text-amber-600">Day</span>
              <span className="text-center text-indigo-600">Night</span>
            </div>
          )}
          {wide && (
            <div className="grid grid-cols-[minmax(0,2.4fr)_64px_86px_120px_120px_120px_minmax(0,1.6fr)] gap-2 px-3.5 py-2 border-b border-slate-200 bg-slate-50 text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">
              <span>Particulars</span><span>Unit</span><span>Timing</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span>Remarks</span>
            </div>
          )}
          {groups.length === 0 && <p className="px-4 py-8 text-center text-[13.5px] text-slate-500">{filledOnly ? 'Nothing filled in yet' : 'No row matches'}</p>}
          <div className="divide-y divide-slate-100">
            {groups.map(function (g) { return wide ? renderGroupWide(sheet, g) : renderGroupPhone(sheet, g) })}
          </div>
        </div>

        {errorBar(edErr)}

        {renderRateSheet(sheet)}

        {!wide && <div aria-hidden="true" className="h-24" />}
        <div className={BAR}>
          <div className={'flex items-center gap-3' + (wide ? ' lg:justify-end' : '')}>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">{ed.entry_date ? shortDate(ed.entry_date) : 'This date'}</p>
              <p data-notranslate className="font-display text-[20px] font-extrabold tabular-nums tracking-[-0.025em] text-slate-900 leading-tight">{formatPoints(dayPaise)}</p>
            </div>
            <button type="button" onClick={saveEntry} disabled={edSaving}
              className={'shrink-0 h-12 px-6 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-bold text-white transition-all ' +
                (edSaving ? 'bg-slate-400' : 'bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] active:scale-[0.98]')}>
              <Icon name={edSaving ? 'refresh' : 'save'} size={16} />
              {edSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // What the Rate cell holds for a row: an editable rate, or the formula's
  // own figure.
  // A sheet rate of 0 is a cell the person is meant to fill, so the box
  // starts empty (placeholder "Rate") rather than holding a 0 that typing
  // lands after ("034").
  function rateValue(r) {
    var t = ed.sheet.rates[r.key]
    if (t !== undefined && t !== null) return t
    return r.rate == null || r.rate === 0 ? '' : String(r.rate)
  }

  // What a number box keeps of what was typed: digits and one point, with
  // no zero in front of a digit — typing 3 into a box holding 0 gives 3,
  // not 03. "0" alone and "0.5" stay as they are.
  function cleanNum(v) {
    var t = String(v).replace(/[^0-9.]/g, '')
    var dot = t.indexOf('.')
    if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '')
    return t.replace(/^0+(?=\d)/, '')
  }

  // Tapping into a box that already holds a rate selects it, so typing
  // replaces the sheet's 700 instead of adding to it.
  function selectAll(e) { e.target.select() }

  // Which field a row's error is about, so only that one turns red.
  function errOn(r, field) {
    var m = edErrors[r.key]
    if (!m) return false
    if (field === 'rate') return m.indexOf('ate') !== -1
    if (field === 'part') return m.indexOf('particulars') !== -1
    return m.indexOf('number') !== -1 && m.indexOf('Rate') === -1
  }

  function qtyPlaceholder(r) {
    if (r.kind === 'value' || (r.kind === 'factor' && r.unit === 'Rs.')) return '₹ value'
    return 'Qty'
  }

  // ── one group, phone ──
  // One line per row, the way the sheet reads: the name on the left, a
  // small box per timing on the right (Day | Night under the sticky column
  // heads), and under each box its own Amount — Day and Night are two rows
  // of the sheet with an Amount each, so they are not added together here. Rate and Remark fold away
  // behind a tap — the sheet's rates are right nine times in ten, and a card
  // per row with both always open ran the 38 rows to five screens.
  function renderGroupPhone(sheet, g) {
    var pair = g.rows.length > 1
    var head = g.rows[0]
    var rateRows = g.rows.filter(function (r) { return r.kind === 'rate' })
    var rateErr = rateRows.some(function (r) { return errOn(r, 'rate') })
    // A remark has three looks: none (a "Remark" link on the meta line),
    // being written (a box with Done and Remove), and written (one quiet line
    // under the row — tap to change it). Leaving the box, or Done, puts it
    // away; a box left empty simply goes.
    var remarkText = String(ed.sheet.remarks[g.key] || '')
    var remarkEditing = !!openRemarks[g.key]
    var amounts = g.rows.map(function (r) { return rowCalc(r, ed.lines[r.key], ed.sheet.rates).amount })
    var anyAmount = amounts.some(function (a) { return a > 0 })
    var hasErr = g.rows.some(function (r) { return edErrors[r.key] })

    // "@ 750", "@ 750 / 700" when Day and Night differ, "Set rate" when the
    // sheet left it blank.
    var rateText = ''
    if (rateRows.length) {
      var vals = rateRows.map(function (r) { return rateValue(r) })
      var uniq = vals.filter(function (v, i) { return vals.indexOf(v) === i })
      rateText = uniq.every(function (v) { return v === '' }) ? ''
        : uniq.map(function (v) { return v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN') }).join(' / ')
    }
    var hint = ''
    if (!rateRows.length) {
      if (head.kind === 'value') hint = 'Amount = value'
      else if (head.kind === 'factor') hint = '× ' + head.expr
      else if (head.kind === 'factorSq') hint = 'Qty × Qty × ' + head.factor
    }

    function box(r, label) {
      var qty = ed.lines[r.key] == null ? '' : ed.lines[r.key]
      return (
        <input key={r.key} type="text" inputMode="decimal" value={qty}
          aria-label={(r.name || 'Value') + (r.timing ? ' ' + r.timing : '') + ' quantity'}
          onChange={function (e) { setLine(r.key, cleanNum(e.target.value)) }}
          placeholder={label}
          className={'w-full min-w-0 h-10 px-2 rounded-lg border bg-white text-[16px] text-center text-slate-900 tabular-nums placeholder:text-[12.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-shadow ' +
            (errOn(r, 'qty') ? INPUT_BAD : num(qty) ? 'border-indigo-300 bg-indigo-50/40 focus:border-indigo-500 focus:ring-indigo-500/20' : INPUT_OK) +
            (pair ? '' : ' col-span-2')} />
      )
    }

    return (
      <div key={g.key} id={'dvc-row-' + head.key} className={'px-3 py-2 ' + (hasErr ? 'bg-red-50/60' : '')}>
        <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-1.5 items-center">
          <div className="min-w-0">
            {head.free ? (
              <input type="text" value={ed.sheet.particulars[head.key] || ''} maxLength={120}
                onChange={function (e) { setSheetField('particulars', head.key, e.target.value) }}
                placeholder={sheet.code === 'COMMISSION' ? 'Commission details' : 'Mics. details'}
                className={'w-full min-w-0 h-10 px-2.5 rounded-lg border bg-white text-[16px] text-slate-900 placeholder:text-[13.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 ' + (errOn(head, 'part') ? INPUT_BAD : INPUT_OK)} />
            ) : (
              <p className="text-[13.5px] font-semibold text-slate-800 leading-snug tracking-[-0.005em] break-words">{g.name}</p>
            )}
            {/* Unit, rate and remark as small chips. The rate chip is a
                control — a pencil says it opens — and turns amber when the
                sheet left the rate for the person to set. */}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {g.unit && <span className={META_CHIP + 'bg-slate-100 border-transparent text-slate-600'}>{g.unit}</span>}
              {rateRows.length > 0 ? (
                <button type="button" onClick={function () { setRateFor(g.key) }} aria-haspopup="dialog"
                  aria-label={rateText ? 'Rate ' + rateText + ', change' : 'Set the rate'}
                  className={META_CHIP + (rateText && !rateErr
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                    : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100')}>
                  {rateText ? (
                    <><span data-notranslate className="tabular-nums">{rateText}</span><Icon name="edit" size={10} className="opacity-70" /></>
                  ) : (
                    <><Icon name="alert" size={10} />Set rate</>
                  )}
                </button>
              ) : hint ? <span className={META_CHIP + 'bg-white border-slate-200 text-slate-500 font-semibold'}>{hint}</span> : null}
              {!remarkEditing && !remarkText.trim() && (
                <button type="button" onClick={function () { setRemarkEditing(g.key, true) }}
                  className={META_CHIP + 'bg-white border-dashed border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-300'}>
                  <Icon name="plus" size={10} strokeWidth={2.6} />Remark
                </button>
              )}
            </div>
          </div>
          {pair ? g.rows.map(function (r) { return box(r, r.timing) }) : box(head, head.timing === 'Day/Night' ? 'Day/Night' : qtyPlaceholder(head))}
        </div>

        {/* Each box's Amount, straight under it — the sheet's Amount column,
            one figure per row. Only once something is typed, so an empty
            row stays one line. */}
        {anyAmount && (
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-1.5 items-center">
            <span className={ROW_LABEL}>Amount</span>
            {g.rows.map(function (r, i) {
              return (
                <span key={r.key} data-notranslate
                  className={'h-7 px-1 rounded-md inline-flex items-center justify-center font-extrabold ' + (formatPoints(toPaise(amounts[i])).length > 12 ? 'text-[10.5px]' : 'text-[12.5px]') + ' tabular-nums leading-none whitespace-nowrap overflow-hidden ' +
                    (amounts[i] > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-50 text-slate-300 border border-slate-100') + (pair ? '' : ' col-span-2')}>
                  {amounts[i] > 0 ? formatPoints(toPaise(amounts[i])).replace(' pts', '') : '—'}
                </span>
              )
            })}
          </div>
        )}

        {remarkEditing && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input type="text" value={remarkText} maxLength={200} autoFocus
              onChange={function (e) { setSheetField('remarks', g.key, e.target.value) }}
              onBlur={function () { setRemarkEditing(g.key, false) }}
              onKeyDown={function (e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() } }}
              placeholder="Remark for this row"
              className={'min-w-0 flex-1 h-9 px-2.5 rounded-lg border bg-white text-[16px] text-slate-900 placeholder:text-[13.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 ' + INPUT_OK} />
            {remarkText && (
              <button type="button" aria-label="Remove remark"
                onMouseDown={function (e) { e.preventDefault() }}
                onClick={function () { setSheetField('remarks', g.key, ''); setRemarkEditing(g.key, false) }}
                className="shrink-0 h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-red-600 hover:border-red-200 inline-flex items-center justify-center">
                <Icon name="trash" size={14} />
              </button>
            )}
            <button type="button"
              onMouseDown={function (e) { e.preventDefault() }}
              onClick={function () { setRemarkEditing(g.key, false) }}
              className="shrink-0 h-9 px-3 rounded-lg bg-slate-900 text-white text-[12.5px] font-bold inline-flex items-center gap-1">
              <Icon name="check" size={13} strokeWidth={2.6} />Done
            </button>
          </div>
        )}
        {!remarkEditing && remarkText.trim() && (
          <button type="button" onClick={function () { setRemarkEditing(g.key, true) }}
            className="mt-1.5 w-full flex items-start gap-1.5 rounded-lg bg-amber-50/70 border border-amber-200/70 px-2.5 py-1.5 text-left">
            <Icon name="fileText" size={12} className="shrink-0 mt-[2px] text-amber-600" />
            <span className="min-w-0 flex-1 text-[12.5px] text-slate-700 leading-snug break-words">{remarkText}</span>
            <Icon name="edit" size={12} className="shrink-0 mt-[2px] text-slate-400" />
          </button>
        )}

        {g.rows.map(function (r) {
          return edErrors[r.key] ? <p key={r.key} className="mt-1 text-[11.5px] font-semibold text-red-600">{(r.timing && pair ? r.timing + ': ' : '') + edErrors[r.key]}</p> : null
        })}
      </div>
    )
  }

  // Setting a row's rate: a small sheet over the form, a box per timing,
  // what the sheet's own rate was, and the amount it comes to as you type.
  function renderRateSheet(sheet) {
    var g = rateFor ? rowGroups(sheet).find(function (x) { return x.key === rateFor }) : null
    var rows = g ? g.rows.filter(function (r) { return r.kind === 'rate' }) : []
    return (
      <Modal open={!!g} onClose={function () { setRateFor(null) }} title="Rate" subtitle={g ? g.name + (g.unit ? ' · per ' + g.unit.replace(/\.$/, '') : '') : ''}>
        {g && (
          <div className="space-y-3">
            <div className={'grid gap-2.5 ' + (rows.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
              {rows.map(function (r, i) {
                var qty = num(ed.lines[r.key])
                var c = rowCalc(r, qty, ed.sheet.rates)
                return (
                  <div key={r.key} className="min-w-0">
                    <label htmlFor={'dvc-rate-' + r.key} className={'block text-[11.5px] font-extrabold uppercase tracking-[0.08em] mb-1 ' +
                      (r.timing === 'Night' ? 'text-indigo-600' : r.timing === 'Day' ? 'text-amber-600' : 'text-slate-500')}>
                      {r.timing && rows.length > 1 ? r.timing + ' rate' : 'Rate'}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-slate-400 pointer-events-none">₹</span>
                      <input id={'dvc-rate-' + r.key} type="text" inputMode="decimal" autoFocus={i === 0}
                        value={rateValue(r)} placeholder="0"
                        onFocus={selectAll}
                        onChange={function (e) { setSheetField('rates', r.key, cleanNum(e.target.value)) }}
                        onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); setRateFor(null) } }}
                        className={'w-full h-12 pl-8 pr-3 rounded-xl border bg-white text-[18px] font-bold text-slate-900 tabular-nums placeholder:text-slate-300 focus:outline-none focus:ring-2 ' +
                          (errOn(r, 'rate') ? INPUT_BAD : INPUT_OK)} />
                    </div>
                    <p data-notranslate className="mt-1 text-[11.5px] text-slate-500 tabular-nums">
                      {qty ? qty + ' × ₹' + (c.rate || 0).toLocaleString('en-IN') + ' = ' : ''}
                      {qty ? <span className="font-bold text-slate-800">{formatPoints(toPaise(c.amount))}</span> : 'No quantity yet'}
                    </p>
                    {r.rate ? <p className="text-[11.5px] text-slate-400">Sheet rate ₹{r.rate.toLocaleString('en-IN')}</p> : <p className="text-[11.5px] text-amber-600">No rate on the sheet — set one</p>}
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 pt-1">
              {rows.some(function (r) { return r.rate && ed.sheet.rates[r.key] !== undefined && num(ed.sheet.rates[r.key]) !== r.rate }) && (
                <button type="button"
                  onClick={function () { rows.forEach(function (r) { setSheetField('rates', r.key, undefined) }) }}
                  className="h-11 px-4 rounded-xl border border-slate-300 bg-white text-[13.5px] font-bold text-slate-700 hover:bg-slate-50">
                  Use sheet rate
                </button>
              )}
              <button type="button" onClick={function () { setRateFor(null) }}
                className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-bold inline-flex items-center justify-center gap-1.5">
                <Icon name="check" size={15} strokeWidth={2.6} />Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    )
  }

  function setRemarkEditing(key, on) {
    setOpenRemarks(function (m) { var n = Object.assign({}, m); n[key] = on; return n })
  }

  // ── one group, laptop: the workbook's columns ──
  function renderGroupWide(sheet, g) {
    var head = g.rows[0]
    return (
      <div key={g.key} id={'dvc-row-' + head.key} className="px-3.5 py-2">
        {g.rows.map(function (r, ri) {
          var qty = ed.lines[r.key] == null ? '' : ed.lines[r.key]
          var calc = rowCalc(r, qty, ed.sheet.rates)
          var bad = !!edErrors[r.key]
          return (
            <div key={r.key} className="grid grid-cols-[minmax(0,2.4fr)_64px_86px_120px_120px_120px_minmax(0,1.6fr)] gap-2 items-center py-1">
              <div className="min-w-0">
                {ri === 0 && (head.free ? (
                  <input type="text" value={ed.sheet.particulars[head.key] || ''} maxLength={120}
                    onChange={function (e) { setSheetField('particulars', head.key, e.target.value) }}
                    placeholder={sheet.code === 'COMMISSION' ? 'Commission details' : 'Mics. details'}
                    className={INPUT + (errOn(head, 'part') ? INPUT_BAD : INPUT_OK) + ' !h-9 !text-[13.5px]'} />
                ) : (
                  <p className="text-[13.5px] font-bold text-slate-900 leading-snug">{g.name}</p>
                ))}
                {bad && <p className="text-[11.5px] font-semibold text-red-600">{edErrors[r.key]}</p>}
                {!bad && r.kind !== 'rate' && <p className="text-[10.5px] text-slate-500">{formulaHint(r)}</p>}
              </div>
              <span className="text-[12.5px] font-semibold text-slate-600">{ri === 0 ? g.unit : ''}</span>
              <span className={'text-[11.5px] font-bold ' + (r.timing === 'Night' ? 'text-indigo-600' : 'text-amber-600')}>{r.timing || ''}</span>
              <input type="text" inputMode="decimal" value={qty} aria-label={(r.name || 'Value') + ' quantity'}
                onChange={function (e) { setLine(r.key, cleanNum(e.target.value)) }}
                placeholder={qtyPlaceholder(r)}
                className={INPUT + (errOn(r, 'qty') ? INPUT_BAD : INPUT_OK) + ' !h-9 !text-[13.5px] text-right'} />
              {r.kind === 'rate' ? (
                <input type="text" inputMode="decimal" value={rateValue(r)} aria-label={(r.name || '') + ' rate'}
                  onFocus={selectAll}
                onChange={function (e) { setSheetField('rates', r.key, cleanNum(e.target.value)) }}
                  placeholder="Rate"
                  className={INPUT + (errOn(r, 'rate') ? INPUT_BAD : INPUT_OK) + ' !h-9 !text-[13.5px] text-right'} />
              ) : (
                <span data-notranslate className="text-right text-[12.5px] font-semibold tabular-nums text-slate-500">{num(qty) ? formatPoints(toPaise(calc.rate)).replace(' pts', '') : '—'}</span>
              )}
              <span data-notranslate className={'text-right text-[13.5px] font-extrabold tabular-nums ' + (calc.amount ? 'text-slate-900' : 'text-slate-400')}>{formatPoints(toPaise(calc.amount))}</span>
              {ri === 0 ? (
                <input type="text" value={ed.sheet.remarks[g.key] || ''} maxLength={200}
                  onChange={function (e) { setSheetField('remarks', g.key, e.target.value) }}
                  placeholder="Remarks"
                  className={INPUT + INPUT_OK + ' !h-9 !text-[13.5px]'} />
              ) : <span />}
            </div>
          )
        })}
      </div>
    )
  }

  // ── record ─────────────────────────────────────────────────────────────
  function renderRecord() {
    if (!cur) {
      return (
        <div className="space-y-3">
          {header('Decor Var Cost', '')}
          {errorBar(recordErr)}
          {(recordLoading || !recordErr) && <p className="text-[13.5px] text-slate-500 text-center py-10">Loading…</p>}
        </div>
      )
    }
    var sheet = getSheet(cur.sheet_code)
    var draft = cur.status === 'draft'
    var canEdit = draft && (cur.created_by === profile.id || canApprove)
    // Same rule as fn_dvc_delete: a draft is its creator's to delete; a
    // submitted sheet only an expense approver's.
    var canDelete = draft ? canEdit : canApprove
    var totals = sheetTotals(sheet, cur.entries, cur.sheet.rates)
    var prob = draft ? submitProblem(cur) : null
    var sortedEntries = cur.entries
    return (
      <div className="space-y-3">
        {header(cur.serial_no, sheet.title, (
          <span className={CHIP + STATUS_CHIP[cur.status] + ' !h-7 !px-2.5 !text-[11.5px]'}>{draft ? 'Draft' : 'Submitted'}</span>
        ))}
        {flashBar()}

        {/* The sheet's heading block: Function Date, Venue, Sub Venue. */}
        <div className={CARD + ' p-3.5'}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
                <Icon name="tag" size={14} className="shrink-0 text-slate-400" />
                <span className="min-w-0">{sheet.name}<span className="text-slate-500 font-medium">{' · Decor'}</span></span>
              </p>
              {cur.is_function ? (
                <>
                  <p className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
                    <Icon name="calendar" size={14} className="shrink-0 text-slate-400" />Function {formatDate(cur.function_date)}
                  </p>
                  <p className="flex items-start gap-2 text-[13.5px] font-semibold text-slate-800">
                    <Icon name="mapPin" size={14} className="shrink-0 mt-0.5 text-slate-400" /><span className="min-w-0 break-words">{venueLabel(cur.venue_id, cur.sub_venue_id) || '—'}</span>
                  </p>
                </>
              ) : (
                <p className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-500">
                  <Icon name="calendar" size={14} className="shrink-0 text-slate-400" />Not for a function
                </p>
              )}
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-slate-500">
                <Icon name="user" size={13} className="shrink-0 text-slate-400" />
                {(cur.creator && cur.creator.name) || '—'} · {formatDateTime(cur.created_at)}
              </p>
            </div>
            {canEdit && (
              <button type="button" onClick={editDetails}
                className="shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50">
                <Icon name="edit" size={13} />Edit details
              </button>
            )}
          </div>
          {!draft && (
            <p className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center gap-2 text-[12.5px] font-semibold text-emerald-700">
              <Icon name="checkCircle" size={14} />Submitted by {(cur.submitter && cur.submitter.name) || '—'} · {formatDateTime(cur.submitted_at)}
            </p>
          )}
        </div>

        {/* The saved dates. */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
            <h3 className="text-[11.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Saved entries<span data-notranslate className="text-slate-400">{' · ' + sortedEntries.length}</span></h3>
          </div>
          <div className={'grid gap-2 grid-cols-1' + (wide ? ' lg:grid-cols-2 xl:grid-cols-3' : '')}>
            {sortedEntries.map(function (e) {
              var n = filledCount(sheet, e.lines)
              var isFn = cur.is_function && e.entry_date === cur.function_date
              var dayOpen = !!openDays[e.id]
              return (
                <div key={e.id} className={CARD + ' overflow-hidden'}>
                <div className="p-3 flex items-center gap-3">
                  <button type="button" onClick={function () { toggleDay(e.id) }} aria-expanded={dayOpen}
                    aria-label={(dayOpen ? 'Hide ' : 'Show ') + formatDate(e.entry_date) + ' rows'}
                    className="min-w-0 flex-1 flex items-center gap-3 text-left">
                  <span className={'shrink-0 w-11 h-11 rounded-xl inline-flex flex-col items-center justify-center leading-none ' + (isFn ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800')}>
                    <span className="text-[16px] font-extrabold tabular-nums">{new Date(e.entry_date + 'T00:00:00').getDate()}</span>
                    <span className="text-[10.5px] font-bold uppercase mt-0.5">{new Date(e.entry_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900">{shortDate(e.entry_date)}{isFn ? ' · Function' : ''}</p>
                    <p className="text-[12.5px] font-medium text-slate-500">{n + (n === 1 ? ' row' : ' rows')} · <span data-notranslate className="font-bold text-slate-800 tabular-nums">{formatPoints(e.amount_paise)}</span></p>
                  </div>
                  <Icon name={dayOpen ? 'chevronUp' : 'chevronDown'} size={16} className="shrink-0 text-slate-400" />
                  </button>
                  {canEdit ? (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button type="button" onClick={function () { openEntry(e) }} aria-label={'Edit ' + formatDate(e.entry_date)}
                        className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1">
                        <Icon name="edit" size={13} />Edit
                      </button>
                      <button type="button" onClick={function () { deleteEntry(e) }} disabled={busy === 'del-' + e.id} aria-label={'Delete ' + formatDate(e.entry_date)}
                        className="h-9 w-9 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 inline-flex items-center justify-center disabled:opacity-50">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {dayOpen && renderDayRows(sheet, e)}
                </div>
              )
            })}
            {canEdit && (
              <button type="button" onClick={function () { openEntry(null) }}
                className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 text-indigo-700 hover:bg-indigo-50 h-[70px] inline-flex items-center justify-center gap-2 text-[14px] font-bold transition-colors">
                <Icon name="plus" size={16} strokeWidth={2.6} />Add date
              </button>
            )}
          </div>
          {sortedEntries.length === 0 && !canEdit && <p className="text-[13.5px] text-slate-500 px-1">No dates saved.</p>}
        </div>

        {/* The whole sheet goes out as an .xlsx laid out like the workbook,
            formulas and all — reading it on a phone was never going to beat
            opening it in Excel. */}
        {sortedEntries.length > 0 && (
          <button type="button" onClick={exportXlsx} disabled={busy === 'export'}
            className={CARD + ' w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:border-emerald-300 active:bg-emerald-50/40 transition-colors disabled:opacity-60'}>
            <span className="shrink-0 w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
              <Icon name={busy === 'export' ? 'refresh' : 'download'} size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[15px] font-bold tracking-[-0.01em] text-slate-900">{busy === 'export' ? 'Preparing the file…' : 'Export to Excel'}</span>
              <span className="block text-[11.5px] text-slate-500">The full sheet as .xlsx — every date, Qty, Rate, Amount and Grand Total</span>
            </span>
            <span className="shrink-0 h-[22px] px-2 rounded-md bg-emerald-600 text-white text-[10.5px] font-extrabold tracking-[0.04em] inline-flex items-center">XLSX</span>
          </button>
        )}

        {errorBar(recordErr)}

        {canDelete && (
          <button type="button" onClick={deleteSheet} disabled={busy === 'delete'}
            className="w-full h-10 rounded-xl text-[12.5px] font-bold text-red-600 hover:bg-red-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Icon name="trash" size={13} />{draft ? 'Delete this draft' : 'Delete this sheet'}
          </button>
        )}

        {/* Grand Total, and the one act that locks the sheet. */}
        {!wide && <div aria-hidden="true" className="h-24" />}
        <div className={BAR}>
          <div className={'flex items-center gap-3' + (wide ? ' lg:justify-end' : '')}>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">Grand total</p>
              <p data-notranslate className="font-display text-[20px] font-extrabold tabular-nums tracking-[-0.025em] text-slate-900 leading-tight">{formatPoints(draft ? totals.totalPaise : cur.total_paise)}</p>
            </div>
            {canEdit && (
              <button type="button" onClick={finalSubmit} disabled={busy === 'submit'}
                className={'shrink-0 h-12 px-5 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-bold text-white transition-all ' +
                  (busy === 'submit' || prob ? 'bg-slate-400' : 'bg-gradient-to-b from-emerald-500 to-emerald-600 shadow-[0_2px_8px_rgba(16,185,129,0.30)] active:scale-[0.98]')}>
                <Icon name={busy === 'submit' ? 'refresh' : 'send'} size={15} />
                {busy === 'submit' ? 'Submitting…' : 'Final Submit'}
              </button>
            )}
          </div>
          {canEdit && prob && <p className="mt-1.5 text-[11.5px] font-semibold text-slate-500">{prob.message}</p>}
        </div>
      </div>
    )
  }

  function toggleDay(id) {
    setOpenDays(function (m) { var n = Object.assign({}, m); n[id] = !m[id]; return n })
  }

  // One saved day, row by row: what was entered, at what rate, for how
  // much — each row's formula on that day's quantity alone.
  function renderDayRows(sheet, e) {
    var rows = sheet.rows.filter(function (r) { return num((e.lines || {})[r.key]) })
    return (
      <div className="border-t border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-3.5 py-3 text-[12.5px] text-slate-500">Nothing entered on this day</p>}
        {rows.map(function (r) {
          var q = num(e.lines[r.key])
          var c = rowCalc(r, q, cur.sheet.rates)
          var name = r.free ? (cur.sheet.particulars[r.key] || '—') : r.name
          var how = r.kind === 'rate'
            ? q + ' ' + (r.unit || '') + ' × ' + formatPoints(toPaise(c.rate)).replace(' pts', '')
            : r.kind === 'value' ? (r.unit === 'Rs.' ? 'Value' : q + ' ' + r.unit)
              : q + ' ' + (r.unit || '') + ' · ' + formulaHint(r).replace('Amount = ', '')
          return (
            <div key={r.key} className="px-3.5 py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-slate-800 leading-snug break-words">
                  {name}
                  {r.timing && <span className={'ml-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ' + (r.timing === 'Night' ? 'text-indigo-600' : 'text-amber-600')}>{r.timing}</span>}
                </p>
                <p data-notranslate className="text-[11.5px] text-slate-500 tabular-nums">{how}</p>
              </div>
              <span data-notranslate className="shrink-0 text-[12.5px] font-bold tabular-nums text-slate-900">{formatPoints(toPaise(c.amount))}</span>
            </div>
          )
        })}
      </div>
    )
  }

}

export default DecorVarCost
