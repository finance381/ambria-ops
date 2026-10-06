import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateTime, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload } from '../../lib/uploadHelper'
import EventDatePicker from '../../components/ui/EventDatePicker'
import VoiceInput from '../../components/ui/VoiceInput'
import { hasPerm } from '../../lib/permissions'
import { openOrSharePdf } from '../../lib/pdfOutput'
import CameraCapture from '../../components/ui/CameraCapture'
import Icon from '../../components/ui/Icon'
import Modal from '../../components/ui/Modal'

var BANK_SUB_MODES = [
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'paytm_card_machine', label: 'Paytm Card Machine' },
  { value: 'hdfc_card_machine', label: 'HDFC Card Machine' }
]
var CARD = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
// 16px type in every input: anything smaller makes iOS zoom the page on focus.
var INPUT = 'w-full min-w-0 h-11 px-3 rounded-xl border border-slate-300 bg-white text-[16px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow'
var INPUT_BAD = 'w-full min-w-0 h-11 px-3 rounded-xl border border-red-400 bg-white text-[16px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20'

var SUB_MODE_LABEL = {
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  paytm_card_machine: 'Paytm Card',
  hdfc_card_machine: 'HDFC Card'
}

function ExtraPlateCollect({ profile, onBalanceChange }) {

  var isAdmin = hasPerm(profile?.permsNew, 'events.extra_plate_collect')
  var [view, setView] = useState('manage')

  // Event selection
  var [date, setDate] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var [eventId, setEventId] = useState('')
  var [eventDetail, setEventDetail] = useState(null)
  var [issues, setIssues] = useState([])
  var [collections, setCollections] = useState([])
  var [stateLoading, setStateLoading] = useState(false)

  // Issue form
  var [issuePlates, setIssuePlates] = useState('')
  var [issueImage, setIssueImage] = useState(null)
  var [issueNotes, setIssueNotes] = useState('')
  var [issueSaving, setIssueSaving] = useState(false)
  var [issueMsg, setIssueMsg] = useState('')

  // Collect form
  var [collectReturned, setCollectReturned] = useState('')  // plates returned this round
  var [collectMode, setCollectMode] = useState('')
  var [collectSubMode, setCollectSubMode] = useState('')
  var [collectImage, setCollectImage] = useState(null)
  var [collectNotes, setCollectNotes] = useState('')
  var [collectDiscount, setCollectDiscount] = useState('')
  var [collectSaving, setCollectSaving] = useState(false)
  var [collectMsg, setCollectMsg] = useState('')
  var [cameraFor, setCameraFor] = useState(null) // 'issue' | 'collect' | null

  // Recent
  var [recentGroups, setRecentGroups] = useState([])
  var [listLoading, setListLoading] = useState(false)
  var [showAll, setShowAll] = useState(false)
  var [filterFrom, setFilterFrom] = useState('')
  var [filterTo, setFilterTo] = useState('')
  var [filterVenues, setFilterVenues] = useState([])
  var [filterKind, setFilterKind] = useState('both')  // both | issue | collection
  var [filterPaymentMode, setFilterPaymentMode] = useState('all')  // all | cash | bank
  var [exporting, setExporting] = useState(false)

  // Cancel modal (unified for issue + collection)
  var [cancelTarget, setCancelTarget] = useState(null) // { type, row }
  var [cancelReason, setCancelReason] = useState('')
  var [cancelSaving, setCancelSaving] = useState(false)

  useEffect(function () { if (view === 'recent') loadRecent() }, [view, showAll, filterFrom, filterTo])

  // ─── LOADERS ─────────────────────────────────────

  async function loadFunctionsForDate(d) {
    setDate(d)
    setEventId('')
    setEventDetail(null)
    setIssues([])
    setCollections([])
    setIssueMsg('')
    setCollectMsg('')
    setCollectReturned('')
    setCollectMode('')
    setCollectSubMode('')
    setCollectDiscount('')
    if (!d) { setEvents([]); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, client_name, session, extra_plates_charge, total_plates, complementary_plates, created_user_name, department, contract_no')
      .eq('function_date', d)
      .in('department', ['Venue', 'Catering'])
      .order('event_name')
    setEvents(data || [])
    setEventsLoading(false)
    if (data && data.length === 1) selectFunction(String(data[0].id), data[0])
  }

  async function selectFunction(fid, rowMaybe) {
    setEventId(fid)
    var row = rowMaybe || events.find(function (e) { return String(e.id) === String(fid) })
    setEventDetail(row || null)
    setIssueMsg('')
    setCollectMsg('')
    setCollectReturned('')
    setCollectMode('')
    setCollectSubMode('')
    setCollectDiscount('')
    if (row) await loadEventState(Number(fid), row)

  }

  async function loadEventState(eid, evRow) {
    setStateLoading(true)
    var iRes = await supabase.from('extra_plate_issues')
      .select('id, plates_count, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, issued_by')
      .eq('event_id', eid)
      .order('created_at', { ascending: false })
    var cRes = await supabase.from('extra_plate_collections')
      .select('id, extras_charged, plates_returned, rate_paise, total_paise, discount_paise, payment_mode, payment_sub_mode, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, collected_by')
      .eq('event_id', eid)
      .order('created_at', { ascending: false })
    var iData = iRes.data || []
    var cData = cRes.data || []
    setIssues(iData)
    setCollections(cData)

    // Chargeable is derived from live state — no autofill needed
    setStateLoading(false)
  }

  async function loadRecent() {
    setListLoading(true)
    var fromISO
    if (filterFrom) {
      fromISO = filterFrom + 'T00:00:00'
    } else {
      var since = new Date()
      since.setDate(since.getDate() - 30)
      fromISO = since.toISOString()
    }
    var toISO = filterTo ? filterTo + 'T23:59:59' : null

    var iQ = supabase.from('extra_plate_issues')
      .select('id, event_id, plates_count, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, issued_by, events(event_name, venue_name, client_name, function_date, total_plates, complementary_plates, extra_plates_charge)')
      .gte('created_at', fromISO)
      .order('created_at', { ascending: false })
      .limit(1000)
    var cQ = supabase.from('extra_plate_collections')
      .select('id, event_id, extras_charged, plates_returned, rate_paise, total_paise, discount_paise, payment_mode, payment_sub_mode, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, collected_by, events(event_name, venue_name, client_name, function_date, total_plates, complementary_plates, extra_plates_charge)')
      .gte('created_at', fromISO)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (toISO) { iQ = iQ.lte('created_at', toISO); cQ = cQ.lte('created_at', toISO) }
    if (!isAdmin || !showAll) {
      iQ = iQ.eq('issued_by', profile.id)
      cQ = cQ.eq('collected_by', profile.id)
    }
    var iRes = await iQ
    var cRes = await cQ
    var iRows = (iRes.data || []).map(function (r) { return Object.assign({}, r, { _kind: 'issue' }) })
    var cRows = (cRes.data || []).map(function (r) { return Object.assign({}, r, { _kind: 'collection' }) })

    // Creator name resolution
    var userIds = []
    iRows.forEach(function (r) { if (r.issued_by && userIds.indexOf(r.issued_by) === -1) userIds.push(r.issued_by) })
    cRows.forEach(function (r) { if (r.collected_by && userIds.indexOf(r.collected_by) === -1) userIds.push(r.collected_by) })
    var nameById = {}
    if (userIds.length > 0) {
      var { data: profRows } = await supabase.from('profiles').select('id, name').in('id', userIds)
      ;(profRows || []).forEach(function (p) { nameById[p.id] = p.name || null })
    }
    iRows = iRows.map(function (r) { r._creatorName = nameById[r.issued_by] || null; return r })
    cRows = cRows.map(function (r) { r._creatorName = nameById[r.collected_by] || null; return r })
    var all = iRows.concat(cRows)

    var byEvent = {}
    for (var k = 0; k < all.length; k++) {
      var r = all[k]
      var key = String(r.event_id)
      if (!byEvent[key]) byEvent[key] = { event_id: r.event_id, event: r.events, items: [] }
      byEvent[key].items.push(r)
    }
    var groups = Object.keys(byEvent).map(function (kk) { return byEvent[kk] })
    for (var g = 0; g < groups.length; g++) {
      groups[g].items.sort(function (a, b) { return b.created_at.localeCompare(a.created_at) })
    }
    groups.sort(function (a, b) { return b.items[0].created_at.localeCompare(a.items[0].created_at) })

    setRecentGroups(groups)
    setListLoading(false)
  }

  // ─── SUBMIT HANDLERS ─────────────────────────────

  async function submitIssue() {
    if (issueSaving) return
    var n = Number(issuePlates)
    if (!n || Math.floor(n) !== n) { alert('Enter a whole non-zero number'); return }
    if (!issueImage) { alert('Photo required'); return }
    setIssueSaving(true)
    setIssueMsg('')

    var cF
    try { cF = await prepUpload(issueImage, 100) } catch (e) { alert('Image prep failed'); setIssueSaving(false); return }
    var ext = (cF.name && cF.name.indexOf('.') !== -1) ? cF.name.split('.').pop() : 'jpg'
    var path = profile.id + '/extra_plate_issue_' + Date.now() + '.' + ext
    var { error: upErr } = await supabase.storage.from('receipts').upload(path, cF, { upsert: true })
    if (upErr) { alert('Upload failed: ' + upErr.message); setIssueSaving(false); return }

    var { error } = await supabase.rpc('fn_extra_plate_issue_create', {
      p_event_id: Number(eventId),
      p_plates: n,
      p_receipt_path: path,
      p_notes: issueNotes.trim() || null
    })
    if (error) {
      alert('Issue failed: ' + error.message)
      try { await supabase.storage.from('receipts').remove([path]) } catch (_) {}
      setIssueSaving(false)
      return
    }
    try { await logActivity('EXTRA_PLATE_ISSUE', (eventDetail.event_name || '') + ' | ' + n + ' plates') } catch (_) {}
    setIssueMsg('Logged ' + n + ' plates')
    setIssuePlates('')
    setIssueImage(null)
    setIssueNotes('')
    setIssueSaving(false)
    loadEventState(Number(eventId), eventDetail)
  }

  async function submitCollect() {
    if (collectSaving) return
    var n = thisChargeable  // derived, locked
    var r = thisReturned    // derived from input
    var wasteOnly = (n === 0)

    if (wasteOnly) {
      if (r <= 0) { alert('Nothing to log — enter returned plates'); return }
    } else {
      if (!collectMode) { alert('Select Cash or Bank'); return }
      if (collectMode === 'bank' && !collectSubMode) { alert('Select the bank payment method'); return }
      if (!collectImage) { alert('Payment photo required'); return }
    }

    var discRupees = Number(collectDiscount || 0)
    if (!wasteOnly) {
      if (isNaN(discRupees) || discRupees < 0) { alert('Discount must be zero or positive'); return }
    }
    var discPaise = wasteOnly ? 0 : Math.round(discRupees * 100)
    var grossPaise = wasteOnly ? 0 : (ratePaise * n)
    if (!wasteOnly && discPaise > grossPaise) { alert('Discount cannot exceed gross ₹' + (grossPaise / 100).toLocaleString('en-IN')); return }

    setCollectSaving(true)
    setCollectMsg('')

    var path = null
    if (!wasteOnly) {
      var cF
      try { cF = await prepUpload(collectImage, 100) } catch (e) { alert('Image prep failed'); setCollectSaving(false); return }
      var ext = (cF.name && cF.name.indexOf('.') !== -1) ? cF.name.split('.').pop() : 'jpg'
      path = profile.id + '/extra_plate_collect_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, cF, { upsert: true })
      if (upErr) { alert('Upload failed: ' + upErr.message); setCollectSaving(false); return }
    }

    var { data, error } = await supabase.rpc('fn_extra_plate_collect', {
      p_event_id: Number(eventId),
      p_plates: n,
      p_payment_mode: wasteOnly ? null : collectMode,
      p_receipt_path: wasteOnly ? null : path,
      p_notes: collectNotes.trim() || null,
      p_discount_paise: discPaise,
      p_plates_returned: r,
      p_payment_sub_mode: (wasteOnly || collectMode !== 'bank') ? null : collectSubMode
    })
    if (error) {
      alert((wasteOnly ? 'Log returns' : 'Collection') + ' failed: ' + error.message)
      if (path) { try { await supabase.storage.from('receipts').remove([path]) } catch (_) {} }
      setCollectSaving(false)
      return
    }
    try {
      var actMsg = (eventDetail.event_name || '') + ' | ' + n + ' extras | ' + r + ' returned' + (wasteOnly ? '' : ' | ' + collectMode)
        + (discPaise > 0 ? ' | disc ' + formatPoints(discPaise) : '')
        + ' | net ' + formatPoints(data.net_paise)
      await logActivity('EXTRA_PLATE_COLLECT', actMsg)
    } catch (_) {}
    setCollectMsg(n === 0
      ? 'Logged ' + r + ' returned plates (no charge)'
      : 'Collected ' + formatPoints(data.net_paise) + (discPaise > 0 ? ' (after ' + formatPoints(discPaise) + ' disc)' : '') + ' for ' + n + ' extras')
    setCollectReturned('')
    setCollectMode('')
    setCollectSubMode('')
    setCollectImage(null)
    setCollectNotes('')
    setCollectDiscount('')
    setCollectSaving(false)
    if (onBalanceChange) onBalanceChange()
    loadEventState(Number(eventId), eventDetail)
  }

  function openCancel(type, row) {
    setCancelTarget({ type: type, row: row })
    setCancelReason('')
  }

  async function confirmCancel() {
    if (cancelSaving) return
    if (!cancelReason.trim()) { alert('Reason required'); return }
    setCancelSaving(true)
    var rpc = cancelTarget.type === 'issue' ? 'fn_extra_plate_issue_cancel' : 'fn_extra_plate_cancel'
    var params = cancelTarget.type === 'issue'
      ? { p_issue_id: cancelTarget.row.id, p_reason: cancelReason.trim() }
      : { p_collection_id: cancelTarget.row.id, p_reason: cancelReason.trim() }
    var { error } = await supabase.rpc(rpc, params)
    if (error) { alert('Cancel failed: ' + error.message); setCancelSaving(false); return }
    try {
      var actName = cancelTarget.type === 'issue' ? 'EXTRA_PLATE_ISSUE_CANCEL' : 'EXTRA_PLATE_CANCEL'
      var lbl = cancelTarget.type === 'issue'
        ? cancelTarget.row.plates_count + ' plates'
        : cancelTarget.row.extras_charged + ' extras | ' + formatPoints(cancelTarget.row.total_paise)
      var evName = cancelTarget.row.events?.event_name || (eventDetail?.event_name) || ('event ' + cancelTarget.row.event_id)
      await logActivity(actName, evName + ' | ' + lbl + ' | ' + cancelReason.trim())
    } catch (_) {}
    setCancelTarget(null)
    setCancelSaving(false)
    if (onBalanceChange) onBalanceChange()
    if (view === 'manage' && eventId) loadEventState(Number(eventId), eventDetail)
    if (view === 'recent') loadRecent()
  }

  // ─── DERIVED ─────────────────────────────────────

  var totalIssued = 0
  for (var ii = 0; ii < issues.length; ii++) if (issues[ii].status === 'active') totalIssued += issues[ii].plates_count
  var totalCollectedExtras = 0
  var priorReturned = 0
  for (var ci = 0; ci < collections.length; ci++) {
    if (collections[ci].status !== 'active') continue
    totalCollectedExtras += collections[ci].extras_charged
    priorReturned += (collections[ci].plates_returned || 0)
  }

  var quota = eventDetail ? (eventDetail.total_plates || 0) : 0
  var complementary = eventDetail ? (eventDetail.complementary_plates || 0) : 0
  var paidPax = quota - complementary
  var ratePaise = eventDetail ? Number(eventDetail.extra_plates_charge || 0) * 2 : 0

  var thisReturned = Math.max(0, Math.floor(Number(collectReturned) || 0))
  var combinedReturned = priorReturned + thisReturned
  var consumed = Math.max(0, totalIssued - combinedReturned)
  var totalChargeable = Math.max(0, consumed - quota)
  var thisChargeable = Math.max(0, totalChargeable - totalCollectedExtras)
  var waste = Math.max(0, quota - consumed)
  var extras = totalChargeable          // for backward-compat with any downstream refs
  var remaining = thisChargeable        // used by existing "all collected" banner

  var canIssue = eventDetail && Number(issuePlates) !== 0 && !isNaN(Number(issuePlates)) && Math.floor(Number(issuePlates)) === Number(issuePlates) && issueImage && !issueSaving
  var collectPreviewTotal = ratePaise * thisChargeable
  var collectDiscountPaise = Math.max(0, Math.round(Number(collectDiscount || 0) * 100))
  var collectNetPreview = Math.max(0, collectPreviewTotal - collectDiscountPaise)
  var discountValid = collectDiscountPaise <= collectPreviewTotal
  var isCollection = thisChargeable > 0
  var isWasteOnly = thisChargeable === 0 && thisReturned > 0
  var subModeOk = collectMode !== 'bank' || !!collectSubMode
  var canCollect = eventDetail && !collectSaving && (
    (isCollection && ratePaise > 0 && collectMode && subModeOk && collectImage && discountValid) ||
    (isWasteOnly)
  )

  // Photo previews for the two proof tiles, released when the file changes.
  var [issuePreview, setIssuePreview] = useState('')
  var [collectPreview, setCollectPreview] = useState('')
  useEffect(function () {
    if (!issueImage) { setIssuePreview(''); return }
    var u = URL.createObjectURL(issueImage)
    setIssuePreview(u)
    return function () { URL.revokeObjectURL(u) }
  }, [issueImage])
  useEffect(function () {
    if (!collectImage) { setCollectPreview(''); return }
    var u = URL.createObjectURL(collectImage)
    setCollectPreview(u)
    return function () { URL.revokeObjectURL(u) }
  }, [collectImage])

  // ─── RENDER ──────────────────────────────────────
  //
  // One look with the rest of the app: white cards with a titled head, the
  // steps numbered, figures in tiles, icons where there were emoji, and
  // indigo as the one colour for "do the thing". Picking a function folds
  // the list to that one card (with a way back), the way the Expense form's
  // picker does, so the issue and collect cards are not a screen further
  // down behind eight other bookings.

  var rateRs = ratePaise / 100

  function stepHead(n, text, done, right) {
    return (
      <div className="flex items-center gap-2 mb-2.5">
        <span className={'shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11.5px] font-extrabold ' +
          (done ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white')}>
          {done ? <Icon name="check" size={12} strokeWidth={3} /> : n}
        </span>
        <span className="font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900">{text}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
    )
  }

  function cardHead(icon, tint, title, sub, right) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
        <span className={'shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center ' + tint}>
          <Icon name={icon} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-bold tracking-[-0.01em] text-slate-900 leading-snug">{title}</span>
          {sub && <span className="block text-[12px] font-medium text-slate-500 leading-snug">{sub}</span>}
        </span>
        {right}
      </div>
    )
  }

  function fieldLabel(text, opt) {
    return (
      <label className="block text-[12.5px] font-bold text-slate-700 mb-1.5">
        {text}{opt && <span className="ml-1 font-medium text-slate-400">(optional)</span>}
      </label>
    )
  }

  function photoTile(file, preview, onTake, onClear, label) {
    if (file) {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2">
          {preview
            ? <img src={preview} alt="" className="shrink-0 w-14 h-14 rounded-lg object-cover border border-white shadow-sm" />
            : <span className="shrink-0 w-14 h-14 rounded-lg bg-white inline-flex items-center justify-center text-emerald-600"><Icon name="camera" size={20} /></span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[13px] font-bold text-emerald-800"><Icon name="checkCircle" size={14} />Photo added</span>
            <span className="block text-[11.5px] text-emerald-700/80 truncate">{file.name}</span>
          </span>
          <button type="button" onClick={onTake}
            className="shrink-0 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50">Retake</button>
          <button type="button" onClick={onClear} aria-label="Remove photo"
            className="shrink-0 h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-red-600 inline-flex items-center justify-center">
            <Icon name="close" size={13} />
          </button>
        </div>
      )
    }
    return (
      <button type="button" onClick={onTake}
        className="w-full h-[64px] rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 hover:border-indigo-400 hover:bg-indigo-50/40 inline-flex items-center justify-center gap-2.5 text-[13.5px] font-bold text-slate-600 hover:text-indigo-700 transition-colors">
        <span className="w-9 h-9 rounded-full bg-white border border-slate-200 inline-flex items-center justify-center text-indigo-600"><Icon name="camera" size={17} /></span>
        {label}
      </button>
    )
  }

  function successNote(msg) {
    if (!msg) return null
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] font-bold text-emerald-800">
        <Icon name="checkCircle" size={15} />{msg}
      </div>
    )
  }

  function statTile(label, value, tone) {
    return (
      <div className={'min-w-0 rounded-xl px-2 py-2.5 text-center ' + (tone || 'bg-slate-50')}>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <p className="mt-0.5 font-display text-[19px] font-extrabold tabular-nums tracking-[-0.02em] leading-none">{value}</p>
      </div>
    )
  }

  function primaryBtn(onClick, disabled, children, tone) {
    return (
      <button type="button" onClick={onClick} disabled={disabled}
        className={'w-full h-12 rounded-xl text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ' +
          (tone || 'bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.28)]')}>
        {children}
      </button>
    )
  }

  var pickedOnly = eventId && events.some(function (e) { return String(e.id) === eventId })
  var shownEvents = pickedOnly ? events.filter(function (e) { return String(e.id) === eventId }) : events

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {/* Manage | Recent */}
      <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
        {[['manage', 'Manage', 'utensils'], ['recent', 'Recent', 'clock']].map(function (t) {
          var on = view === t[0]
          return (
            <button key={t[0]} type="button" onClick={function () { setView(t[0]) }} aria-pressed={on}
              className={'h-9 rounded-lg text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ' +
                (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              <Icon name={t[2]} size={14} />{t[1]}
            </button>
          )
        })}
      </div>

      {/* ─── MANAGE VIEW ───────────────────────────── */}
      {view === 'manage' && (
        <div className="space-y-3">
          <div className={CARD + ' p-3.5'}>
            {stepHead(1, 'Event date', !!date)}
            <EventDatePicker value={date} collapsible placeholder="Pick the event date"
              onChange={function (d) { loadFunctionsForDate(d) }} />

            {date && (
              <div className="mt-4">
                {stepHead(2, 'Function', !!eventId, pickedOnly && events.length > 1 ? (
                  <button type="button" onClick={function () { setEventId(''); setEventDetail(null) }}
                    className="text-[12px] font-bold text-indigo-600 hover:text-indigo-800">Change</button>
                ) : null)}
                {eventsLoading && <p className="text-[12.5px] text-slate-500">Loading functions…</p>}
                {!eventsLoading && events.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-[12.5px] text-slate-500">No Venue or Catering functions on this date</p>
                )}
                {shownEvents.length > 0 && (
                  <div className="space-y-2">
                    {shownEvents.map(function (ev) {
                      var selected = String(ev.id) === eventId
                      return (
                        <button key={ev.id} type="button" onClick={function () { selectFunction(String(ev.id), ev) }}
                          className={'w-full text-left rounded-xl border px-3 py-2.5 transition-all ' +
                            (selected ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300')}>
                          <div className="flex items-start justify-between gap-2">
                            <p className={'min-w-0 text-[13.5px] font-bold leading-snug ' + (selected ? 'text-indigo-950' : 'text-slate-900')}>
                              {ev.event_name}
                              {ev.client_name && <span className="font-semibold text-slate-600">{' · ' + ev.client_name}</span>}
                            </p>
                            {ev.department && (
                              <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[0.04em] px-1.5 py-[3px] rounded bg-indigo-100 text-indigo-700">{ev.department}</span>
                            )}
                          </div>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] font-medium text-slate-500">
                            {(ev.venue_name || ev.session) && (
                              <span className="inline-flex items-center gap-1"><Icon name="mapPin" size={12} className="text-slate-400" />{(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : '')}</span>
                            )}
                            {ev.contract_no && <span className="font-mono text-slate-500">#{ev.contract_no}</span>}
                            {ev.created_user_name && <span className="inline-flex items-center gap-1"><Icon name="user" size={12} className="text-slate-400" />{ev.created_user_name}</span>}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The booking at a glance: quota, rate, and where the plates stand. */}
          {eventDetail && (
            <div className={CARD + ' overflow-hidden'}>
              {cardHead('utensils', 'bg-amber-50 text-amber-600', 'Plates for this function',
                paidPax + ' pax + ' + complementary + ' complimentary = ' + quota + ' plates',
                <span className={'shrink-0 h-7 px-2.5 rounded-lg inline-flex items-center text-[12.5px] font-extrabold tabular-nums ' +
                  (ratePaise > 0 ? 'bg-slate-900 text-white' : 'bg-red-50 text-red-700 border border-red-200')}>
                  {ratePaise > 0 ? '₹' + rateRs.toLocaleString('en-IN') + ' / plate' : 'No rate'}
                </span>)}
              <div className="p-3 grid grid-cols-4 gap-2">
                {statTile('Issued', stateLoading ? '…' : totalIssued, 'bg-slate-50 text-slate-900')}
                {statTile('Extras', stateLoading ? '…' : extras, 'bg-slate-50 text-slate-900')}
                {statTile('Collected', stateLoading ? '…' : totalCollectedExtras, 'bg-slate-50 text-slate-900')}
                {statTile('Due', stateLoading ? '…' : (remaining > 0 ? remaining : <Icon name="check" size={18} strokeWidth={3} className="inline" />),
                  remaining > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}
              </div>
              {ratePaise <= 0 && (
                <p className="mx-3 mb-3 -mt-1 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[12px] font-semibold text-red-700">
                  <Icon name="alert" size={14} className="shrink-0 mt-px" />The contract has no extra-plate rate, so extras cannot be collected here.
                </p>
              )}
            </div>
          )}

          {eventDetail && ratePaise > 0 && remaining === 0 && totalIssued > quota && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-[13px] font-bold text-emerald-800">
              <Icon name="checkCircle" size={16} />All extras collected for this function
            </div>
          )}

          {/* Issue */}
          {eventDetail && (
            <div className={CARD + ' overflow-hidden'}>
              {cardHead('download', 'bg-indigo-50 text-indigo-600', 'Issue plates', 'Plates handed out — a negative number corrects an earlier count')}
              <div className="p-4 space-y-3.5">
                <div>
                  {fieldLabel('Plates to issue')}
                  <input type="number" step="1" inputMode="numeric" value={issuePlates}
                    onChange={function (e) { setIssuePlates(e.target.value) }}
                    placeholder={quota > 0 && totalIssued === 0 ? 'e.g. ' + quota : 'e.g. 50'}
                    className={INPUT + ' text-[18px] font-bold'} />
                </div>
                <div>
                  {fieldLabel('Photo of the plates')}
                  {photoTile(issueImage, issuePreview, function () { setCameraFor('issue') }, function () { setIssueImage(null) }, 'Take photo')}
                </div>
                <div>
                  {fieldLabel('Notes', true)}
                  <input type="text" value={issueNotes} onChange={function (e) { setIssueNotes(e.target.value) }}
                    placeholder="e.g. first batch, top-up" className={INPUT} />
                </div>
                {successNote(issueMsg)}
                {primaryBtn(submitIssue, !canIssue, issueSaving ? 'Saving…' : <><Icon name="download" size={16} />Log issue</>)}
              </div>
            </div>
          )}

          {/* Collect extras / log returns */}
          {eventDetail && ratePaise > 0 && totalIssued > 0 && (
            <div className={CARD + ' overflow-hidden'}>
              {cardHead(isWasteOnly ? 'undo' : 'rupee', isWasteOnly ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600',
                isWasteOnly ? 'Log returned plates' : 'Collect extras',
                isWasteOnly ? 'Nothing to charge — this records the plates that came back' : 'Plates over the quota, charged at the contract rate')}
              <div className="p-4 space-y-3.5">
                {/* How the chargeable count is reached. */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200/70 text-[12.5px]">
                  {[
                    ['Quota', quota, true],
                    ['Total issued', totalIssued, true],
                    ['Already returned', priorReturned, priorReturned > 0],
                    ['Already charged', totalCollectedExtras, totalCollectedExtras > 0],
                    ['Consumed', consumed, true],
                  ].filter(function (x) { return x[2] }).map(function (x) {
                    return (
                      <div key={x[0]} className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-slate-500 font-medium">{x[0]}</span>
                        <span className="font-bold tabular-nums text-slate-800">{x[1]}</span>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between px-3 py-2 bg-white rounded-b-xl">
                    <span className="font-bold text-slate-800">Chargeable now</span>
                    <span className={'font-display text-[16px] font-extrabold tabular-nums ' + (thisChargeable > 0 ? 'text-red-600' : 'text-slate-400')}>{thisChargeable}</span>
                  </div>
                  {waste > 0 && (
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-amber-700 font-medium">Waste (quota unused)</span>
                      <span className="font-bold tabular-nums text-amber-700">{waste}</span>
                    </div>
                  )}
                </div>

                <div className={'grid gap-3 ' + (isCollection ? 'grid-cols-2' : 'grid-cols-1')}>
                  <div>
                    {fieldLabel('Plates returned')}
                    <input type="number" min="0" step="1" inputMode="numeric" value={collectReturned}
                      onChange={function (e) { setCollectReturned(e.target.value) }}
                      placeholder="0" className={INPUT} />
                  </div>
                  {isCollection && (
                    <div>
                      {fieldLabel('Discount ₹', true)}
                      <input type="number" min="0" step="1" inputMode="numeric" value={collectDiscount}
                        onChange={function (e) { setCollectDiscount(e.target.value) }}
                        placeholder="0" className={discountValid ? INPUT : INPUT_BAD} />
                    </div>
                  )}
                </div>

                {isCollection && collectPreviewTotal > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 space-y-1 text-[13px]">
                    <div className="flex justify-between text-slate-600">
                      <span>{thisChargeable} × ₹{rateRs.toLocaleString('en-IN')}</span>
                      <span className="tabular-nums font-semibold">₹{(collectPreviewTotal / 100).toLocaleString('en-IN')}</span>
                    </div>
                    {Number(collectDiscount) > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Discount</span>
                        <span className="tabular-nums font-semibold">− ₹{Number(collectDiscount).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-baseline pt-1.5 mt-0.5 border-t border-emerald-200">
                      <span className="font-bold text-emerald-900">Net to collect</span>
                      <span className="font-display text-[20px] font-extrabold tabular-nums tracking-[-0.02em] text-emerald-800">₹{(collectNetPreview / 100).toLocaleString('en-IN')}</span>
                    </div>
                    {!discountValid && <p className="text-[12px] font-semibold text-red-600">The discount is more than the amount</p>}
                  </div>
                )}

                {isCollection && (
                  <>
                    <div>
                      {fieldLabel('Payment mode')}
                      <div className="grid grid-cols-2 gap-2">
                        {[['cash', 'Cash', 'banknote'], ['bank', 'Bank', 'bank']].map(function (m) {
                          var on = collectMode === m[0]
                          return (
                            <button key={m[0]} type="button" aria-pressed={on}
                              onClick={function () { setCollectMode(m[0]); if (m[0] === 'cash') setCollectSubMode('') }}
                              className={'h-11 rounded-xl border text-[13.5px] font-bold inline-flex items-center justify-center gap-2 transition-colors ' +
                                (on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')}>
                              <Icon name={m[2]} size={16} />{m[1]}
                            </button>
                          )
                        })}
                      </div>
                      {collectMode === 'bank' && (
                        <div className="mt-2.5">
                          <p className="text-[12px] font-semibold text-slate-500 mb-1.5">Bank method <span className="text-red-500">*</span></p>
                          <div className="flex flex-wrap gap-1.5">
                            {BANK_SUB_MODES.map(function (m) {
                              var on = collectSubMode === m.value
                              return (
                                <button key={m.value} type="button" aria-pressed={on} onClick={function () { setCollectSubMode(m.value) }}
                                  className={'h-9 px-3 rounded-lg border text-[12.5px] font-bold transition-colors ' +
                                    (on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')}>
                                  {m.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      {fieldLabel('Photo of the payment')}
                      {photoTile(collectImage, collectPreview, function () { setCameraFor('collect') }, function () { setCollectImage(null) }, 'Photo of money received')}
                    </div>
                  </>
                )}

                <div>
                  {fieldLabel('Notes', true)}
                  <input type="text" value={collectNotes} onChange={function (e) { setCollectNotes(e.target.value) }} className={INPUT} />
                </div>
                {successNote(collectMsg)}
                {primaryBtn(submitCollect, !canCollect,
                  collectSaving ? 'Saving…'
                    : isWasteOnly ? <><Icon name="undo" size={16} />Log {thisReturned} returned plates</>
                    : isCollection ? <><Icon name="rupee" size={16} />Collect {collectNetPreview > 0 ? '₹' + (collectNetPreview / 100).toLocaleString('en-IN') : ''}</>
                    : 'Enter returned plates to continue',
                  isWasteOnly ? 'bg-amber-600 shadow-[0_2px_8px_rgba(217,119,6,0.28)]' : isCollection ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 shadow-[0_2px_8px_rgba(16,185,129,0.28)]' : 'bg-slate-400')}
              </div>
            </div>
          )}

          {/* This function's history */}
          {eventDetail && (issues.length > 0 || collections.length > 0) && (
            <div className={CARD + ' overflow-hidden'}>
              {cardHead('list', 'bg-slate-100 text-slate-600', 'History', 'Every issue and collection for this function')}
              <div className="divide-y divide-slate-100">
                {[].concat(issues.map(function (r) { return Object.assign({}, r, { _kind: 'issue' }) }))
                  .concat(collections.map(function (r) { return Object.assign({}, r, { _kind: 'collection' }) }))
                  .sort(function (a, b) { return b.created_at.localeCompare(a.created_at) })
                  .map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel) })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── RECENT VIEW ───────────────────────────── */}
      {view === 'recent' && (function () {
        var venueOptions = []
        recentGroups.forEach(function (g) {
          var v = g.event && g.event.venue_name
          if (v && venueOptions.indexOf(v) === -1) venueOptions.push(v)
        })
        venueOptions.sort()
        var filteredGroups = recentGroups.map(function (g) {
          var items = g.items.filter(function (r) {
            if (filterKind === 'issue' && r._kind !== 'issue') return false
            if (filterKind === 'collection' && r._kind !== 'collection') return false
            if (filterPaymentMode !== 'all' && r._kind === 'collection' && r.payment_mode !== filterPaymentMode) return false
            return true
          })
          return Object.assign({}, g, { _filtered: items })
        }).filter(function (g) {
          if (g._filtered.length === 0) return false
          if (filterVenues.length > 0) {
            var v = (g.event && g.event.venue_name) || ''
            if (filterVenues.indexOf(v) === -1) return false
          }
          return true
        })
        function buildExportRows() {
          var out = []
          filteredGroups.forEach(function (g) {
            var evName = (g.event && g.event.event_name) || 'Event ' + g.event_id
            var client = (g.event && g.event.client_name) || ''
            var venue = (g.event && g.event.venue_name) || ''
            var fnDate = g.event && g.event.function_date ? formatDate(g.event.function_date) : ''
            g._filtered.forEach(function (r) {
              var isIss = r._kind === 'issue'
              var totalRs = !isIss && r.total_paise ? (r.total_paise - (r.discount_paise || 0)) / 100 : ''
              out.push({
                event: evName, client: client, venue: venue, function_date: fnDate,
                created_at: r.created_at,
                kind: isIss ? 'Issue' : 'Collection',
                plates: isIss ? r.plates_count : (r.extras_charged || 0),
                returned: !isIss ? (r.plates_returned || 0) : '',
                rate_rs: !isIss && r.rate_paise ? r.rate_paise / 100 : '',
                discount_rs: !isIss && r.discount_paise ? r.discount_paise / 100 : '',
                total_rs: totalRs,
                payment_mode: !isIss ? (r.payment_mode || '') : '',
                sub_mode: !isIss ? (SUB_MODE_LABEL[r.payment_sub_mode] || '') : '',
                creator: r._creatorName || '',
                status: r.status,
                cancel_reason: r.status === 'cancelled' ? (r.cancelled_reason || '') : '',
                notes: r.notes || ''
              })
            })
          })
          return out
        }
        function exportCSV() {
          var rows = buildExportRows()
          if (rows.length === 0) { alert('No rows to export.'); return }
          var headers = ['Event','Client','Venue','Function Date','Created At','Kind','Plates','Returned','Rate (Rs)','Discount (Rs)','Total (Rs)','Payment Mode','Sub-mode','Creator','Status','Cancel Reason','Notes']
          function esc(v) {
            if (v == null || v === '') return ''
            var s = String(v)
            if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'
            return s
          }
          var lines = [headers.join(',')]
          rows.forEach(function (r) {
            lines.push([r.event, r.client, r.venue, r.function_date, r.created_at, r.kind, r.plates, r.returned, r.rate_rs, r.discount_rs, r.total_rs, r.payment_mode, r.sub_mode, r.creator, r.status, r.cancel_reason, r.notes].map(esc).join(','))
          })
          var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
          var url = URL.createObjectURL(blob)
          var a = document.createElement('a')
          a.href = url
          a.download = 'extra_plates_' + new Date().toISOString().slice(0,10) + '.csv'
          a.click()
          URL.revokeObjectURL(url)
        }
        async function exportPDF() {
          if (exporting) return
          var rows = buildExportRows()
          if (rows.length === 0) { alert('No rows to export.'); return }
          setExporting(true)
          try {
            var jsPDFmod = await import('jspdf')
            var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
            var autoTableMod = await import('jspdf-autotable')
            var autoTable = autoTableMod.default || autoTableMod.autoTable
            var pdfFontMod = await import('../../lib/pdfFont')
            var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
            var fontRegistered = false
            try { await pdfFontMod.registerPdfFont(doc); fontRegistered = true } catch (_) {}
            var baseFont = fontRegistered ? 'NotoSans' : 'helvetica'
            doc.setFont(baseFont, 'bold'); doc.setFontSize(14)
            doc.text('EXTRA PLATES REPORT', 10, 12)
            doc.setFont(baseFont, 'normal'); doc.setFontSize(9)
            var rangeText = (filterFrom || '30d default') + ' to ' + (filterTo || 'today')
            doc.text('Range: ' + rangeText + '  |  Generated ' + new Date().toLocaleString('en-IN'), 10, 18)
            var bodyRows = rows.map(function (r) {
              return [
                r.event + (r.client ? '\n' + r.client : ''),
                r.venue, r.function_date, r.kind,
                String(r.plates || ''),
                r.returned !== '' ? String(r.returned) : '',
                r.rate_rs !== '' ? '₹' + r.rate_rs.toLocaleString('en-IN') : '',
                r.discount_rs !== '' ? '₹' + r.discount_rs.toLocaleString('en-IN') : '',
                r.total_rs !== '' ? '₹' + r.total_rs.toLocaleString('en-IN') : '',
                (r.payment_mode || '') + (r.sub_mode ? '\n' + r.sub_mode : ''),
                r.creator,
                r.status + (r.cancel_reason ? '\n' + r.cancel_reason : '')
              ]
            })
            autoTable(doc, {
              startY: 23,
              head: [['Event','Venue','Fn Date','Kind','Plates','Ret','Rate','Disc','Total','Payment','By','Status']],
              body: bodyRows,
              styles: { font: baseFont, fontSize: 8, cellPadding: 1.5 },
              headStyles: { fillColor: [55,65,81], textColor: [255,255,255], font: baseFont, fontStyle: 'bold' },
              columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }
            })
            await openOrSharePdf(doc, 'extra_plates_' + new Date().toISOString().slice(0,10) + '.pdf')
          } catch (e) {
            alert('PDF export failed: ' + (e.message || e))
          }
          setExporting(false)
        }
        function chip(on, onClick, label, key) {
          return (
            <button key={key || label} type="button" onClick={onClick} aria-pressed={on}
              className={'h-8 px-3 rounded-full border text-[12.5px] font-bold whitespace-nowrap transition-colors ' +
                (on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}>
              {label}
            </button>
          )
        }
        return (
        <div className="space-y-3">
          <div className={CARD + ' p-3.5 space-y-3'}>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-500 mb-1">From</span>
                <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value) }} className={INPUT + ' !h-10'} />
              </label>
              <label className="min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-500 mb-1">To</span>
                <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value) }} className={INPUT + ' !h-10'} />
              </label>
            </div>
            <p className="-mt-1 text-[11.5px] text-slate-500">{filterFrom || filterTo ? '' : 'Showing the last 30 days'}
              {(filterFrom || filterTo) && (
                <button type="button" onClick={function () { setFilterFrom(''); setFilterTo('') }} className="font-bold text-indigo-600">Reset dates</button>
              )}
            </p>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-400">Kind</span>
                {[['both', 'All'], ['issue', 'Issues'], ['collection', 'Collections']].map(function (k) {
                  return chip(filterKind === k[0], function () { setFilterKind(k[0]) }, k[1], 'k' + k[0])
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-400">Payment</span>
                {[['all', 'All'], ['cash', 'Cash'], ['bank', 'Bank']].map(function (p) {
                  return chip(filterPaymentMode === p[0], function () { setFilterPaymentMode(p[0]) }, p[1], 'p' + p[0])
                })}
              </div>
              {venueOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-16 shrink-0 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-400">Venue</span>
                  {venueOptions.map(function (v) {
                    var active = filterVenues.indexOf(v) !== -1
                    return chip(active, function () {
                      setFilterVenues(function (prev) {
                        if (prev.indexOf(v) === -1) return prev.concat([v])
                        return prev.filter(function (x) { return x !== v })
                      })
                    }, v, 'v' + v)
                  })}
                  {filterVenues.length > 0 && (
                    <button type="button" onClick={function () { setFilterVenues([]) }} className="text-[12px] font-bold text-indigo-600 px-1">Clear</button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              {isAdmin ? (
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" checked={showAll} onChange={function (e) { setShowAll(e.target.checked) }} className="w-4 h-4 accent-indigo-600" />
                  Everyone's entries
                </label>
              ) : <span />}
              <button type="button" onClick={exportCSV} disabled={exporting}
                className="ml-auto h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                <Icon name="download" size={14} />CSV
              </button>
              <button type="button" onClick={exportPDF} disabled={exporting}
                className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-[12.5px] font-bold hover:bg-indigo-700 inline-flex items-center gap-1.5 disabled:opacity-50">
                <Icon name="fileText" size={14} />{exporting ? 'PDF…' : 'PDF'}
              </button>
            </div>
          </div>

          {listLoading && <p className="text-[13px] text-slate-500 text-center py-6">Loading…</p>}
          {!listLoading && recentGroups.length === 0 && (
            <p className={CARD + ' px-4 py-8 text-center text-[13px] text-slate-500'}>No activity in this date range</p>
          )}
          {!listLoading && recentGroups.length > 0 && filteredGroups.length === 0 && (
            <p className={CARD + ' px-4 py-8 text-center text-[13px] text-slate-500'}>Nothing matches these filters</p>
          )}
          {filteredGroups.map(function (g) {
            var evQuota = g.event?.total_plates || 0
            var evComp = g.event?.complementary_plates || 0
            var evPaid = evQuota - evComp
            var evIssuedTotal = 0, evChargedTotal = 0, evReturnedTotal = 0, evWasteTotal = 0
            for (var x = 0; x < g.items.length; x++) {
              var it = g.items[x]
              if (it.status !== 'active') continue
              if (it._kind === 'issue') {
                evIssuedTotal += it.plates_count
              } else {
                var chg = Number(it.extras_charged || 0)
                var ret = Number(it.plates_returned || 0)
                evChargedTotal += chg
                if (chg === 0) evWasteTotal += ret
                else evReturnedTotal += ret
              }
            }
            var evNetConsumed = evIssuedTotal - evReturnedTotal - evWasteTotal
            var evExtras = Math.max(0, evNetConsumed - evQuota)
            var evDue = Math.max(0, evExtras - evChargedTotal)
            return (
              <div key={g.event_id} className={CARD + ' overflow-hidden'}>
                <div className="px-3.5 pt-3 pb-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-[14px] font-bold text-slate-900 leading-snug">
                      {g.event?.event_name || 'Event ' + g.event_id}
                      {g.event?.client_name && <span className="font-semibold text-slate-600">{' · ' + g.event.client_name}</span>}
                    </p>
                    {evDue > 0
                      ? <span className="shrink-0 h-6 px-2 rounded-full bg-red-50 border border-red-200 text-red-700 text-[11px] font-extrabold inline-flex items-center">Due {evDue}</span>
                      : <span className="shrink-0 h-6 px-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-extrabold inline-flex items-center gap-1"><Icon name="check" size={11} strokeWidth={3} />Settled</span>}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] font-medium text-slate-500">
                    {g.event?.venue_name && <span className="inline-flex items-center gap-1"><Icon name="mapPin" size={12} className="text-slate-400" />{g.event.venue_name}</span>}
                    <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} className="text-slate-400" />{formatDate(g.event?.function_date || g.items[0].created_at)}</span>
                  </p>
                  <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                    {[['Quota', evQuota, evPaid + '+' + evComp], ['Issued', evIssuedTotal, ''], ['Returned', evReturnedTotal + evWasteTotal, evWasteTotal > 0 ? evWasteTotal + ' waste' : ''], ['Extras', evExtras, evChargedTotal + ' charged']].map(function (t) {
                      return (
                        <div key={t[0]} className="min-w-0 rounded-lg bg-slate-50 px-1.5 py-1.5 text-center">
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400">{t[0]}</p>
                          <p className="font-display text-[15px] font-extrabold tabular-nums text-slate-900 leading-tight">{t[1]}</p>
                          {t[2] && <p className="text-[10.5px] font-semibold text-slate-500 truncate">{t[2]}</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {g._filtered.map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel) })}
                </div>
              </div>
            )
          })}
        </div>
        )
      })()}

      {/* ─── CANCEL ────────────────────────────────── */}
      <Modal open={!!cancelTarget} onClose={function () { if (!cancelSaving) setCancelTarget(null) }}
        title={cancelTarget ? 'Cancel ' + (cancelTarget.type === 'issue' ? 'issue' : 'collection') : ''}
        subtitle={cancelTarget ? (cancelTarget.type === 'issue'
          ? cancelTarget.row.plates_count + ' plates'
          : (cancelTarget.row.extras_charged === 0
              ? (cancelTarget.row.plates_returned || 0) + ' returned (waste — no charge)'
              : cancelTarget.row.extras_charged + ' extras · ₹' + ((cancelTarget.row.total_paise - (cancelTarget.row.discount_paise || 0)) / 100).toLocaleString('en-IN') + ' · ' + (cancelTarget.row.payment_mode || '—'))) : ''}>
        {cancelTarget && (
          <div className="space-y-3.5">
            <p className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-[12.5px] font-medium text-red-700 leading-relaxed">
              <Icon name="alert" size={15} className="shrink-0 mt-px" />
              <span>
                {cancelTarget.type === 'issue'
                  ? 'Marks this issue cancelled. If a collection already exists for this function, log a correction issue with negative plates instead.'
                  : (cancelTarget.row.extras_charged === 0
                      ? 'Marks this waste-only entry cancelled. Nothing was charged, so no wallet or ledger changes.'
                      : 'The wallet is debited and the event ledger reversed. This cannot be undone.')}
              </span>
            </p>
            <div>
              {fieldLabel('Reason')}
              <VoiceInput type="text" value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
                placeholder="Why is this being cancelled?" className={INPUT} />
            </div>
            <div className="flex gap-2.5 pt-1">
              <button type="button" onClick={function () { setCancelTarget(null) }} disabled={cancelSaving}
                className="flex-1 h-11 rounded-xl border border-slate-300 bg-white text-[13.5px] font-bold text-slate-700 hover:bg-slate-50">Keep it</button>
              <button type="button" onClick={confirmCancel} disabled={cancelSaving || !cancelReason.trim()}
                className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13.5px] font-bold disabled:opacity-40">
                {cancelSaving ? 'Cancelling…' : 'Cancel entry'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {cameraFor && (
        <CameraCapture
          onCapture={function (file) {
            if (cameraFor === 'issue') setIssueImage(file); else setCollectImage(file)
            setCameraFor(null)
          }}
          onClose={function () { setCameraFor(null) }}
        />
      )}
    </div>
  )
}


// One issue or collection, as a row: an icon for its kind, what it was,
// when and by whom, and its photo and Cancel on the right.
function renderHistoryRow(r, profile, isAdmin, openCancel) {
  var isCancelled = r.status === 'cancelled'
  var isIssue = r._kind === 'issue'
  var isWaste = !isIssue && r.extras_charged === 0
  var ownerId = isIssue ? r.issued_by : r.collected_by
  var canCancel = !isCancelled && (
    isAdmin ||
    (ownerId === profile.id && r.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10))
  )
  var receiptUrl = r.receipt_path
    ? supabase.storage.from('receipts').getPublicUrl(r.receipt_path).data?.publicUrl
    : null
  var icon = isIssue ? 'download' : isWaste ? 'undo' : 'rupee'
  var tint = isIssue ? 'bg-indigo-50 text-indigo-600' : isWaste ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
  var net = !isIssue && !isWaste ? (r.total_paise - (r.discount_paise || 0)) / 100 : 0
  return (
    <div key={r._kind + '_' + r.id} className={'flex items-start gap-3 px-3.5 py-2.5 ' + (isCancelled ? 'opacity-55' : '')}>
      <span className={'shrink-0 mt-0.5 w-8 h-8 rounded-full inline-flex items-center justify-center ' + tint}>
        <Icon name={icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={'min-w-0 text-[13.5px] font-bold text-slate-900 leading-snug ' + (isCancelled ? 'line-through decoration-slate-400' : '')}>
            {isIssue
              ? (r.plates_count > 0 ? '+' : '') + r.plates_count + ' plates issued'
              : isWaste ? r.plates_returned + ' returned (waste)'
                : r.extras_charged + ' extras collected'}
          </p>
          {!isIssue && !isWaste && (
            <span className="shrink-0 font-display text-[14px] font-extrabold tabular-nums text-emerald-700">₹{net.toLocaleString('en-IN')}</span>
          )}
        </div>
        {!isIssue && !isWaste && (
          <p className="text-[12px] font-medium text-slate-600 tabular-nums">
            {r.extras_charged} × ₹{(r.rate_paise / 100).toLocaleString('en-IN')}
            {r.plates_returned > 0 ? ' · ' + r.plates_returned + ' returned' : ''}
            {r.discount_paise > 0 ? ' · −₹' + (r.discount_paise / 100).toLocaleString('en-IN') + ' disc' : ''}
            {' · ' + (r.payment_mode === 'cash' ? 'Cash' : 'Bank' + (SUB_MODE_LABEL[r.payment_sub_mode] ? ' (' + SUB_MODE_LABEL[r.payment_sub_mode] + ')' : ''))}
          </p>
        )}
        {r.notes && <p className="text-[12px] text-slate-500 italic mt-0.5 break-words">"{r.notes}"</p>}
        {isCancelled && (
          <p className="mt-0.5 text-[12px] font-semibold text-red-600">Cancelled{r.cancelled_reason ? ' — ' + r.cancelled_reason : ''}</p>
        )}
        <p className="mt-0.5 text-[11.5px] font-medium text-slate-400">
          {formatDateTime(r.created_at)}{r._creatorName ? ' · ' + r._creatorName : ''}
        </p>
      </div>
      {(receiptUrl || canCancel) && (
        <div className="shrink-0 flex items-center gap-1.5">
          {receiptUrl && (
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer" aria-label="View photo"
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 inline-flex items-center justify-center">
              <Icon name="eye" size={14} />
            </a>
          )}
          {canCancel && (
            <button type="button" onClick={function () { openCancel(isIssue ? 'issue' : 'collection', r) }}
              className="h-8 px-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[12px] font-bold hover:bg-red-100">Cancel</button>
          )}
        </div>
      )}
    </div>
  )
}

export default ExtraPlateCollect
