import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateTime, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload } from '../../lib/uploadHelper'
import EventDatePicker from '../../components/ui/EventDatePicker'
import VoiceInput from '../../components/ui/VoiceInput'
import { hasPerm } from '../../lib/permissions'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { generateCollectionReceiptPdf } from '../../lib/pdfReceipt'
import CameraCapture from '../../components/ui/CameraCapture'
import Icon from '../../components/ui/Icon'
import Modal from '../../components/ui/Modal'
import platesBg from '../../assets/extra-plates-bg.webp'

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

// The ground behind Extra Plates on the phone: the photograph of a laid
// table (dark stone, gold-rimmed plates in the corners, leaves at the edge)
// filling the screen behind the cards, the way the Event ledger and the
// Item List carry theirs. The wall colour is the photo's own mid-tone, so
// an overscroll or a slow load shows the same ground rather than a white
// flash. Phone only; the admin console keeps its plain page.
var PLATES_WALL = '#3F3D30'

function PlatesBackdrop() {
  useEffect(function () {
    var b = document.body
    var h = document.documentElement
    var prevBg = b.style.backgroundColor
    var prevHtmlBg = h.style.backgroundColor
    var prevOver = b.style.overscrollBehaviorY
    b.style.backgroundColor = PLATES_WALL
    h.style.backgroundColor = PLATES_WALL
    b.style.overscrollBehaviorY = 'none'
    return function () {
      b.style.backgroundColor = prevBg
      h.style.backgroundColor = prevHtmlBg
      b.style.overscrollBehaviorY = prevOver
    }
  }, [])
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundColor: PLATES_WALL,
        backgroundImage: 'url(' + platesBg + ')',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        minHeight: '100lvh',
      }} />
  )
}

function ExtraPlateCollect({ profile, onBalanceChange, inAdmin }) {

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

  // Manual plate rate (only reachable when LMS never had one on the contract)
  var [editingRate, setEditingRate] = useState(false)
  var [manualRateInput, setManualRateInput] = useState('')
  var [manualRateSaving, setManualRateSaving] = useState(false)
  var [manualRateMsg, setManualRateMsg] = useState('')

  // Recent
  var [recentGroups, setRecentGroups] = useState([])
  var [listLoading, setListLoading] = useState(false)
  var [showAll, setShowAll] = useState(false)
  var [filterFrom, setFilterFrom] = useState('')
  var [filterTo, setFilterTo] = useState('')
  // Recent's two searches: who made the entry, and the venue.
  var [searchBy, setSearchBy] = useState('')
  var [searchVenue, setSearchVenue] = useState('')
  var [byFocus, setByFocus] = useState(false)
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
      .select('id, event_name, function_date, venue_name, client_name, session, extra_plates_charge, manual_plate_rate_paise, total_plates, complementary_plates, created_user_name, department, contract_no')
      .eq('function_date', d)
      .in('department', ['Venue', 'Catering'])
      .is('lms_cancelled_at', null)
      .order('event_name')
    setEvents(data || [])
    setEventsLoading(false)
    if (data && data.length === 1) selectFunction(String(data[0].id), data[0])
  }

  function clearFunctionSelection() {
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
    setEditingRate(false)
    setManualRateInput('')
    setManualRateMsg('')
    if (row) await loadEventState(Number(fid), row)

  }

  async function saveManualRate() {
    if (!eventDetail) return
    var rupees = Number(manualRateInput)
    if (!manualRateInput || isNaN(rupees) || rupees <= 0) { setManualRateMsg('Enter a valid rate.'); return }
    setManualRateSaving(true)
    setManualRateMsg('')
    var { error } = await supabase.rpc('fn_set_event_manual_plate_rate', {
      p_event_id: Number(eventId), p_rate_paise: Math.round(rupees * 100),
    })
    setManualRateSaving(false)
    if (error) { setManualRateMsg(error.message); return }
    setEventDetail(Object.assign({}, eventDetail, { manual_plate_rate_paise: Math.round(rupees * 100) }))
    setEditingRate(false)
    setManualRateInput('')
  }

  async function clearManualRate() {
    if (!eventDetail) return
    setManualRateSaving(true)
    var { error } = await supabase.rpc('fn_set_event_manual_plate_rate', {
      p_event_id: Number(eventId), p_rate_paise: null,
    })
    setManualRateSaving(false)
    if (error) { setManualRateMsg(error.message); return }
    setEventDetail(Object.assign({}, eventDetail, { manual_plate_rate_paise: null }))
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
      .select('id, event_id, plates_count, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, issued_by, events(event_name, venue_name, client_name, function_date, total_plates, complementary_plates, extra_plates_charge, contract_no, created_user_name)')
      .gte('created_at', fromISO)
      .order('created_at', { ascending: false })
      .limit(1000)
    var cQ = supabase.from('extra_plate_collections')
      .select('id, event_id, extras_charged, plates_returned, rate_paise, total_paise, discount_paise, payment_mode, payment_sub_mode, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, collected_by, events(event_name, venue_name, client_name, function_date, total_plates, complementary_plates, extra_plates_charge, contract_no, created_user_name)')
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
      if (r > Math.max(0, totalIssued - priorReturned)) { alert('Only ' + Math.max(0, totalIssued - priorReturned) + ' plates are still out — cannot return ' + r); return }
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

  // A collection's receipt — the same PDF the Event ledger prints for an
  // extra-plates collection (EP-<id>, the collector's name and signature).
  // The contract fields come from the function in hand (Manage) or from the
  // row's own joined event (Recent).
  var [receiptBusy, setReceiptBusy] = useState(null)
  async function printCollectionReceipt(r, ev) {
    if (receiptBusy) return
    setReceiptBusy(r.id)
    try {
      ev = ev || {}
      var receivedByName = ''
      var signatureUrl = null
      if (r.collected_by) {
        var { data: pr } = await supabase.from('profiles').select('name, signature_path').eq('id', r.collected_by).maybeSingle()
        if (pr) {
          receivedByName = pr.name || ''
          if (pr.signature_path) {
            var { data: signed } = await supabase.storage.from('images').createSignedUrl(pr.signature_path, 300)
            signatureUrl = signed?.signedUrl || null
          }
        }
      }
      var disc = r.discount_paise || 0
      await generateCollectionReceiptPdf({
        receiptNo: 'EP-' + r.id,
        paymentMode: r.payment_mode,
        amountRupees: r.total_paise - disc,
        discountPaise: disc,
        description: r.extras_charged + ' extra plates × ' + formatPoints(r.rate_paise) + (r.notes ? ' — ' + r.notes : ''),
        createdAt: r.created_at,
        contractNo: ev.contract_no || null,
        clientName: ev.client_name || '',
        eventDate: ev.function_date || '',
        dealBy: ev.created_user_name || '',
        receivedByName: receivedByName,
        signatureUrl: signatureUrl,
      })
    } catch (e) {
      alert('Receipt failed: ' + (e && e.message ? e.message : e))
    }
    setReceiptBusy(null)
  }

  // Correcting an issue that can no longer be cancelled: open the Issue form
  // with the count reversed (+100 is undone by -100, -100 by +100) and a
  // note naming the entry it corrects by its number, which is how the
  // history knows that entry has been dealt with.
  function correctIssue(row) {
    setActionTab('issue')
    setIssuePlates(String(-row.plates_count))
    setIssueNotes('Correction of #' + row.id + ' (' + (row.plates_count > 0 ? '+' : '') + row.plates_count + ' plates, ' + formatDateTime(row.created_at) + ')')
    setShowIssueNote(true)
    setIssueMsg('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
  // A manual rate (set below, when LMS never got one entered) is already the
  // final per-plate figure an admin typed in — unlike the LMS field, it's not
  // run through the *2 conversion.
  var hasManualRate = !!(eventDetail && eventDetail.manual_plate_rate_paise != null)
  var ratePaise = eventDetail
    ? (hasManualRate ? Number(eventDetail.manual_plate_rate_paise) : Number(eventDetail.extra_plates_charge || 0) * 2)
    : 0

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
  // Plates cannot come back that were never handed out: what is still out
  // is the most that can be returned now.
  var returnable = Math.max(0, totalIssued - priorReturned)
  var overReturned = thisReturned > returnable
  var subModeOk = collectMode !== 'bank' || !!collectSubMode
  var canCollect = eventDetail && !collectSaving && !overReturned && (
    (isCollection && ratePaise > 0 && collectMode && subModeOk && collectImage && discountValid) ||
    (isWasteOnly)
  )

  // Photo previews for the two proof tiles, released when the file changes.
  var [issuePreview, setIssuePreview] = useState('')
  var [collectPreview, setCollectPreview] = useState('')
  // Compact phone layout: which form shows (null = Issue), whether
  // each notes box is open, and whether the history is unfolded.
  var [actionTab, setActionTab] = useState(null)
  var [showIssueNote, setShowIssueNote] = useState(false)
  var [showCollectNote, setShowCollectNote] = useState(false)
  var [historyOpen, setHistoryOpen] = useState(false)
  // Recent: Kind, Payment, Venue and Everyone fold under a Filters button.
  var [recentFiltersOpen, setRecentFiltersOpen] = useState(false)
  // Recent: which functions have their entries unfolded ({ event_id: true }).
  var [openGroups, setOpenGroups] = useState({})
  function toggleGroup(id) {
    setOpenGroups(function (m) { var n = Object.assign({}, m); n[id] = !m[id]; return n })
  }
  useEffect(function () { setActionTab(null); setHistoryOpen(false); setShowIssueNote(false); setShowCollectNote(false) }, [eventId])
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

  function fieldLabel(text, opt) {
    return (
      <label className="block text-[12.5px] font-bold text-slate-700 mb-1.5">
        {text}{opt && <span className="ml-1 font-medium text-slate-400">(optional)</span>}
      </label>
    )
  }

  // A square camera button that sits beside its number; once a photo is
  // taken it shows the photo, with a small × to take it off.
  function photoButton(file, preview, onTake, onClear) {
    if (file) {
      return (
        <div className="relative shrink-0">
          <button type="button" onClick={onTake} aria-label="Retake photo"
            className="w-11 h-11 rounded-xl overflow-hidden border-2 border-emerald-400 bg-emerald-50 inline-flex items-center justify-center">
            {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <Icon name="check" size={18} className="text-emerald-600" />}
          </button>
          <button type="button" onClick={onClear} aria-label="Remove photo"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-900 text-white inline-flex items-center justify-center shadow">
            <Icon name="close" size={9} strokeWidth={3} />
          </button>
        </div>
      )
    }
    return (
      <button type="button" onClick={onTake} aria-label="Take photo"
        className="shrink-0 w-11 h-11 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/60 text-indigo-600 hover:bg-indigo-50 inline-flex items-center justify-center">
        <Icon name="camera" size={18} />
      </button>
    )
  }

  function noteField(value, setValue, open, setOpen, placeholder) {
    if (!open && !value) {
      return (
        <button type="button" onClick={function () { setOpen(true) }}
          className="text-[12px] font-bold text-slate-500 hover:text-indigo-600 inline-flex items-center gap-1">
          <Icon name="plus" size={11} strokeWidth={2.6} />Add a note
        </button>
      )
    }
    return (
      <input type="text" value={value} autoFocus={open && !value}
        onChange={function (e) { setValue(e.target.value) }}
        onBlur={function () { if (!value.trim()) setOpen(false) }}
        placeholder={placeholder} className={INPUT + ' !h-10'} />
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

  function primaryBtn(onClick, disabled, children, tone) {
    return (
      <button type="button" onClick={onClick} disabled={disabled}
        className={'w-full h-12 rounded-xl text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ' +
          (tone || 'bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.28)]')}>
        {children}
      </button>
    )
  }


  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {!inAdmin && <PlatesBackdrop />}
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
      {/* Built to fit a phone with as little scrolling as it can: once a
          function is picked, the date and the function fold into one card
          that also carries the plate figures; Issue and Collect share one
          card behind a toggle instead of standing one under the other; the
          photo is a button beside its number; notes and history open on a
          tap. */}
      {view === 'manage' && (
        <div className="space-y-2.5">
          {!eventDetail && (
            <div className={CARD + ' p-3.5'}>
              {stepHead(1, 'Event date', !!date)}
              <EventDatePicker value={date} collapsible placeholder="Pick the event date"
                onChange={function (d) { loadFunctionsForDate(d) }} />
              {date && (
                <div className="mt-3.5">
                  {stepHead(2, 'Function', false)}
                  {eventsLoading && <p className="text-[12.5px] text-slate-500">Loading functions…</p>}
                  {!eventsLoading && events.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-[12.5px] text-slate-500">No Venue or Catering functions on this date</p>
                  )}
                  {events.length > 0 && (
                    <div className="space-y-1.5">
                      {events.map(function (ev) {
                        return (
                          <button key={ev.id} type="button" onClick={function () { selectFunction(String(ev.id), ev) }}
                            className="w-full text-left rounded-xl border border-slate-200 bg-white hover:border-indigo-300 px-3 py-2 transition-colors">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 text-[13.5px] font-bold leading-snug text-slate-900">
                                {ev.event_name}
                                {ev.client_name && <span className="font-semibold text-slate-600">{' · ' + ev.client_name}</span>}
                              </p>
                              {ev.department && (
                                <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[0.04em] px-1.5 py-[3px] rounded bg-indigo-100 text-indigo-700">{ev.department}</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[12px] font-medium text-slate-500 truncate">
                              {[(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : ''), ev.contract_no ? '#' + ev.contract_no : '', ev.created_user_name || ''].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* The picked function and where its plates stand, in one card. */}
          {eventDetail && (
            <div className={CARD + ' p-3'}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-slate-900 leading-snug">
                    {eventDetail.event_name}
                    {eventDetail.client_name && <span className="font-semibold text-slate-600">{' · ' + eventDetail.client_name}</span>}
                  </p>
                  <p className="text-[11.5px] font-medium text-slate-500 truncate">
                    {[formatDate(date), (eventDetail.venue_name || '') + (eventDetail.session ? ' · ' + eventDetail.session : ''), eventDetail.contract_no ? '#' + eventDetail.contract_no : ''].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button type="button" onClick={clearFunctionSelection}
                  className="shrink-0 h-7 px-2.5 rounded-lg border border-slate-200 text-[12px] font-bold text-indigo-600 hover:bg-indigo-50">Change</button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px]">
                <span className="font-medium text-slate-500 truncate">{paidPax} pax + {complementary} comp = <span className="font-bold text-slate-800">{quota}</span></span>
                <span className="shrink-0 inline-flex items-center gap-1.5">
                  <span className={'h-6 px-2 rounded-md inline-flex items-center font-extrabold tabular-nums ' +
                    (ratePaise > 0 ? 'bg-slate-900 text-white' : 'bg-red-50 text-red-700 border border-red-200')}>
                    {ratePaise > 0 ? '₹' + rateRs.toLocaleString('en-IN') + '/plate' : 'No rate'}
                    {hasManualRate && <span className="ml-1 text-[9.5px] font-bold uppercase opacity-75">manual</span>}
                  </span>
                  {/* A rate typed in by hand, for contracts LMS never priced
                      (manual_plate_rate_paise — survives re-syncs). */}
                  {isAdmin && hasManualRate && (
                    <button type="button" onClick={clearManualRate} disabled={manualRateSaving}
                      className="h-6 px-1.5 rounded-md text-[11px] font-bold text-slate-500 hover:text-red-600">Clear</button>
                  )}
                  {isAdmin && ratePaise <= 0 && !editingRate && (
                    <button type="button" onClick={function () { setEditingRate(true) }}
                      className="h-6 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-[11px] font-bold text-indigo-700">Set rate</button>
                  )}
                </span>
              </div>
              {editingRate && ratePaise <= 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-slate-400 pointer-events-none">₹</span>
                    <input type="number" step="1" inputMode="numeric" autoFocus value={manualRateInput}
                      onChange={function (e) { setManualRateInput(e.target.value) }}
                      onKeyDown={function (e) { if (e.key === 'Enter') saveManualRate() }}
                      placeholder="Rate per plate" aria-label="Manual rate per plate"
                      className={INPUT + ' !h-10 !pl-7'} />
                  </div>
                  <button type="button" onClick={saveManualRate} disabled={manualRateSaving}
                    className="shrink-0 h-10 px-3 rounded-xl bg-indigo-600 text-white text-[12.5px] font-bold disabled:opacity-50">
                    {manualRateSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={function () { setEditingRate(false); setManualRateInput(''); setManualRateMsg('') }}
                    className="shrink-0 h-10 px-2.5 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-600">Cancel</button>
                </div>
              )}
              {manualRateMsg && <p className="mt-1.5 text-[12px] font-semibold text-red-600">{manualRateMsg}</p>}
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[['Issued', totalIssued, 'bg-slate-50 text-slate-900'],
                  ['Extras', extras, 'bg-indigo-50/70 text-indigo-950'],
                  ['Collected', totalCollectedExtras, 'bg-emerald-50/70 text-emerald-900'],
                  ['Due', remaining > 0 ? remaining : '✓', remaining > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700']].map(function (t) {
                  return (
                    <div key={t[0]} className={'min-w-0 rounded-lg px-1 py-1.5 text-center ' + t[2]}>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-500 leading-none">{t[0]}</p>
                      <p className="mt-1 font-display text-[16px] font-extrabold tabular-nums leading-none">{stateLoading ? '…' : t[1]}</p>
                    </div>
                  )
                })}
              </div>
              {ratePaise <= 0 && !editingRate && (
                <p className="mt-2 text-[11.5px] font-semibold text-red-600">No extra-plate rate on the contract — extras cannot be collected{isAdmin ? ' until a rate is set.' : ' here.'}</p>
              )}
            </div>
          )}

          {/* Issue | Collect — one card, one form at a time. */}
          {eventDetail && (function () {
            var canCollectHere = ratePaise > 0 && totalIssued > 0
            // Issue opens first; Collect is one tap away (its tab carries the
            // chargeable count as a badge, so a pending collection still shows).
            var tab = canCollectHere ? (actionTab || 'issue') : 'issue'
            return (
              <div className={CARD + ' p-3'}>
                {canCollectHere && (
                  <div className="grid grid-cols-2 p-1 mb-3 rounded-xl bg-slate-100">
                    {[['issue', 'Issue plates', 'download'], ['collect', isWasteOnly ? 'Log returns' : 'Collect extras', isWasteOnly ? 'undo' : 'rupee']].map(function (t) {
                      var on = tab === t[0]
                      return (
                        <button key={t[0]} type="button" onClick={function () { setActionTab(t[0]) }} aria-pressed={on}
                          className={'h-9 rounded-lg text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ' +
                            (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                          <Icon name={t[2]} size={14} />{t[1]}
                          {t[0] === 'collect' && thisChargeable > 0 && !on && (
                            <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10.5px] font-extrabold inline-flex items-center justify-center">{thisChargeable}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {tab === 'issue' && (
                  <div className="space-y-2.5">
                    {!canCollectHere && <p className="text-[12.5px] font-bold text-slate-800 inline-flex items-center gap-1.5"><Icon name="download" size={14} className="text-indigo-600" />Issue plates</p>}
                    <div className="flex gap-2">
                      <input type="number" step="1" inputMode="numeric" value={issuePlates}
                        onChange={function (e) { setIssuePlates(e.target.value) }}
                        aria-label="Plates to issue"
                        placeholder={'Plates to issue' + (quota > 0 && totalIssued === 0 ? ' (e.g. ' + quota + ')' : '')}
                        className={INPUT + ' flex-1 font-bold'} />
                      {photoButton(issueImage, issuePreview, function () { setCameraFor('issue') }, function () { setIssueImage(null) })}
                    </div>
                    <p className="-mt-1 text-[11px] text-slate-500">A negative number corrects an earlier count. Photo of the plates required.</p>
                    {noteField(issueNotes, setIssueNotes, showIssueNote, setShowIssueNote, 'e.g. first batch, top-up')}
                    {successNote(issueMsg)}
                    {primaryBtn(submitIssue, !canIssue, issueSaving ? 'Saving…' : <><Icon name="download" size={16} />Log issue</>)}
                  </div>
                )}

                {tab === 'collect' && canCollectHere && (
                  <div className="space-y-2.5">
                    {/* How the chargeable count is reached: the four figures
                        in a row, then what is chargeable now. */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
                      <div className="grid grid-cols-4 gap-1 text-center tabular-nums">
                        {[['Quota', quota], ['Issued', totalIssued], ['Returned', priorReturned + thisReturned], ['Used', consumed]].map(function (t) {
                          return (
                            <div key={t[0]} className="min-w-0">
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400 leading-none">{t[0]}</p>
                              <p className={'mt-1 font-display text-[15px] font-extrabold leading-none ' + (t[0] === 'Returned' && overReturned ? 'text-red-600' : 'text-slate-800')}>{t[1]}</p>
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                        <span className="min-w-0 text-[11.5px] font-semibold text-slate-500 truncate">
                          {waste > 0 ? <span className="text-amber-700">{waste} of the quota unused</span>
                            : totalCollectedExtras > 0 ? totalCollectedExtras + ' already charged' : 'Plates over the quota'}
                        </span>
                        <span className={'shrink-0 h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-bold ' +
                          (thisChargeable > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-white text-slate-500 border border-slate-200')}>
                          Chargeable <b className="font-display text-[15px]">{thisChargeable}</b>
                        </span>
                      </div>
                    </div>
                    {priorReturned > totalIssued && (
                      <p className="flex items-start gap-1.5 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[12px] font-semibold text-red-700">
                        <Icon name="alert" size={13} className="shrink-0 mt-px" />
                        {priorReturned} plates are logged as returned but only {totalIssued} were issued — check the history for a wrong entry.
                      </p>
                    )}

                    <div className={'grid gap-2 ' + (isCollection ? 'grid-cols-2' : 'grid-cols-1')}>
                      <input type="number" min="0" step="1" inputMode="numeric" value={collectReturned}
                        onChange={function (e) { setCollectReturned(e.target.value) }}
                        aria-label="Plates returned" placeholder={returnable > 0 ? 'Returned (max ' + returnable + ')' : 'Plates returned'} className={overReturned && thisReturned > 0 ? INPUT_BAD : INPUT} />
                      {isCollection && (
                        <input type="number" min="0" step="1" inputMode="numeric" value={collectDiscount}
                          onChange={function (e) { setCollectDiscount(e.target.value) }}
                          aria-label="Discount in rupees" placeholder="Discount ₹" className={discountValid ? INPUT : INPUT_BAD} />
                      )}
                    </div>

                    {isCollection && (
                      <>
                        <div className="flex gap-2">
                          {[['cash', 'Cash', 'banknote'], ['bank', 'Bank', 'bank']].map(function (m) {
                            var on = collectMode === m[0]
                            return (
                              <button key={m[0]} type="button" aria-pressed={on}
                                onClick={function () { setCollectMode(m[0]); if (m[0] === 'cash') setCollectSubMode('') }}
                                className={'flex-1 h-11 rounded-xl border text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ' +
                                  (on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700')}>
                                <Icon name={m[2]} size={15} />{m[1]}
                              </button>
                            )
                          })}
                          {photoButton(collectImage, collectPreview, function () { setCameraFor('collect') }, function () { setCollectImage(null) })}
                        </div>
                        {collectMode === 'bank' && (
                          <div className="flex flex-wrap gap-1.5">
                            {BANK_SUB_MODES.map(function (m) {
                              var on = collectSubMode === m.value
                              return (
                                <button key={m.value} type="button" aria-pressed={on} onClick={function () { setCollectSubMode(m.value) }}
                                  className={'h-8 px-2.5 rounded-lg border text-[12px] font-bold transition-colors ' +
                                    (on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-700')}>
                                  {m.label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        <p className="-mt-1 text-[11px] text-slate-500">{collectMode === 'bank' && !collectSubMode ? 'Pick the bank method. ' : ''}Photo of the payment required.</p>
                      </>
                    )}

                    {noteField(collectNotes, setCollectNotes, showCollectNote, setShowCollectNote, 'Notes')}
                    {successNote(collectMsg)}
                    {!discountValid && <p className="text-[12px] font-semibold text-red-600">The discount is more than the amount</p>}
                    {primaryBtn(submitCollect, !canCollect,
                      collectSaving ? 'Saving…'
                        : isWasteOnly ? <><Icon name="undo" size={16} />Log {thisReturned} returned plates</>
                        : isCollection ? (
                          <span className="inline-flex items-center gap-2">
                            <Icon name="rupee" size={16} />Collect ₹{(collectNetPreview / 100).toLocaleString('en-IN')}
                            <span className="text-[11.5px] font-semibold opacity-80">
                              {'(' + thisChargeable + ' × ₹' + rateRs.toLocaleString('en-IN') + (collectDiscountPaise > 0 ? ' − ₹' + (collectDiscountPaise / 100).toLocaleString('en-IN') : '') + ')'}
                            </span>
                          </span>
                        )
                        : 'Enter returned plates to continue',
                      isWasteOnly ? 'bg-amber-600' : isCollection ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 shadow-[0_2px_8px_rgba(16,185,129,0.28)]' : 'bg-slate-400')}
                  </div>
                )}
              </div>
            )
          })()}

          {eventDetail && ratePaise > 0 && remaining === 0 && totalIssued > quota && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] font-bold text-emerald-800">
              <Icon name="checkCircle" size={15} />All extras collected for this function
            </p>
          )}

          {/* History, folded to one line until asked for. */}
          {eventDetail && (issues.length > 0 || collections.length > 0) && (
            <div className={CARD + ' overflow-hidden'}>
              <button type="button" onClick={function () { setHistoryOpen(!historyOpen) }} aria-expanded={historyOpen}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
                <Icon name="list" size={15} className="text-slate-400" />
                <span className="flex-1 text-[13px] font-bold text-slate-800">History<span className="text-slate-400 font-semibold">{' · ' + (issues.length + collections.length)}</span></span>
                <Icon name={historyOpen ? 'chevronUp' : 'chevronDown'} size={16} className="text-slate-400" />
              </button>
              {historyOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {[].concat(issues.map(function (r) { return Object.assign({}, r, { _kind: 'issue' }) }))
                    .concat(collections.map(function (r) { return Object.assign({}, r, { _kind: 'collection' }) }))
                    .sort(function (a, b) { return b.created_at.localeCompare(a.created_at) })
                    .map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel, { issueLocked: collections.some(function (x) { return x.status === 'active' }), onCorrect: correctIssue, correctedIds: correctedIssueIds(issues), onReceipt: function (row) { printCollectionReceipt(row, eventDetail) }, receiptBusy: receiptBusy }) })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── RECENT VIEW ───────────────────────────── */}
      {view === 'recent' && (function () {
        var byQ = searchBy.trim().toLowerCase()
        // The properties that appear in the entries loaded, for the Venue list.
        var venueOptions = []
        recentGroups.forEach(function (g) {
          var v = g.event && g.event.venue_name
          if (v && venueOptions.indexOf(v) === -1) venueOptions.push(v)
        })
        venueOptions.sort()
        // Everyone who made an entry in what is loaded, for the Received by
        // suggestions.
        var nameOptions = []
        recentGroups.forEach(function (g) {
          g.items.forEach(function (r) {
            if (r._creatorName && nameOptions.indexOf(r._creatorName) === -1) nameOptions.push(r._creatorName)
          })
        })
        nameOptions.sort()
        var filteredGroups = recentGroups.map(function (g) {
          var items = g.items.filter(function (r) {
            if (filterKind === 'issue' && r._kind !== 'issue') return false
            if (filterKind === 'collection' && r._kind !== 'collection') return false
            if (filterPaymentMode !== 'all' && r._kind === 'collection' && r.payment_mode !== filterPaymentMode) return false
            if (byQ && String(r._creatorName || '').toLowerCase().indexOf(byQ) === -1) return false
            return true
          })
          return Object.assign({}, g, { _filtered: items })
        }).filter(function (g) {
          if (g._filtered.length === 0) return false
          if (searchVenue && ((g.event && g.event.venue_name) || '') !== searchVenue) return false
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
        return (
        <div className="space-y-3">
          {/* Two searches always in view — who made the entry, and the
              venue — with Filters, CSV and PDF under them. The dates, Kind,
              Payment and Everyone open under the Filters button, whose badge
              counts what is narrowing the list while it is closed. */}
          {(function () {
            var nOn = (filterFrom || filterTo ? 1 : 0) + (filterKind !== 'both' ? 1 : 0) + (filterPaymentMode !== 'all' ? 1 : 0) + (showAll ? 1 : 0)
            function searchBox(value, setValue, icon, placeholder, label, onFocus, onBlur) {
              return (
                <div className="relative min-w-0">
                  <Icon name={icon} size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input type="search" value={value} onChange={function (e) { setValue(e.target.value) }}
                    onFocus={onFocus} onBlur={onBlur} autoComplete="off"
                    placeholder={placeholder} aria-label={label}
                    className={INPUT + ' !h-10 !pl-8 !pr-7'} />
                  {value && (
                    <button type="button" onClick={function () { setValue('') }} aria-label={'Clear ' + label}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-slate-400 hover:text-slate-700 inline-flex items-center justify-center">
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </div>
              )
            }
            return (
              <div className={CARD + ' p-3 space-y-2'}>
                <div className="grid grid-cols-2 gap-2">
                  {/* Received by, with the names that match what is typed
                      listed under it — tap one to use it. */}
                  <div className="relative min-w-0">
                    {searchBox(searchBy, setSearchBy, 'user', 'Received by', 'Search by who received', function () { setByFocus(true) }, function () { setTimeout(function () { setByFocus(false) }, 150) })}
                    {byFocus && (function () {
                      var q = searchBy.trim().toLowerCase()
                      var hits = nameOptions.filter(function (n) { return n.toLowerCase().indexOf(q) !== -1 && n !== searchBy }).slice(0, 6)
                      if (hits.length === 0) return null
                      return (
                        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.16)] overflow-hidden">
                          {hits.map(function (n) {
                            return (
                              <button key={n} type="button"
                                onMouseDown={function (e) { e.preventDefault() }}
                                onClick={function () { setSearchBy(n); setByFocus(false) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-slate-800 hover:bg-indigo-50 border-b border-slate-100 last:border-b-0">
                                <Icon name="user" size={13} className="shrink-0 text-slate-400" />
                                <span className="min-w-0 truncate">{n}</span>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Venue: a list of the properties in the entries, not a
                      text box — the names are few and fixed. */}
                  <div className="relative min-w-0">
                    <Icon name="mapPin" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select value={searchVenue} onChange={function (e) { setSearchVenue(e.target.value) }} aria-label="Venue"
                      className={INPUT + ' !h-10 !pl-8 !pr-7 appearance-none truncate ' + (searchVenue ? '' : '!text-slate-400')}>
                      <option value="">All venues</option>
                      {venueOptions.map(function (v) { return <option key={v} value={v}>{v}</option> })}
                    </select>
                    <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={function () { setRecentFiltersOpen(!recentFiltersOpen) }} aria-expanded={recentFiltersOpen}
                    className={'h-8 px-3 rounded-lg border text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors ' +
                      (recentFiltersOpen ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700')}>
                    <Icon name="filter" size={13} />Filters
                    {nOn > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10.5px] font-extrabold inline-flex items-center justify-center">{nOn}</span>}
                    <Icon name={recentFiltersOpen ? 'chevronUp' : 'chevronDown'} size={12} className="opacity-70" />
                  </button>
                  <span className="min-w-0 truncate text-[11px] font-medium text-slate-500">
                    {filterFrom || filterTo ? (filterFrom ? formatDate(filterFrom) : '…') + ' – ' + (filterTo ? formatDate(filterTo) : 'today') : 'Last 30 days'}
                  </span>
                  <button type="button" onClick={exportCSV} disabled={exporting}
                    className="ml-auto shrink-0 h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] font-bold text-slate-700 inline-flex items-center gap-1 disabled:opacity-50">
                    <Icon name="download" size={13} />CSV
                  </button>
                  <button type="button" onClick={exportPDF} disabled={exporting}
                    className="shrink-0 h-8 px-2.5 rounded-lg bg-indigo-600 text-white text-[12px] font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <Icon name="fileText" size={13} />{exporting ? 'PDF…' : 'PDF'}
                  </button>
                </div>
                {recentFiltersOpen && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value) }} aria-label="From date"
                        className={INPUT + ' !h-9 !px-2 flex-1'} />
                      <span className="shrink-0 text-[12px] font-bold text-slate-400">to</span>
                      <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value) }} aria-label="To date"
                        className={INPUT + ' !h-9 !px-2 flex-1'} />
                    </div>
                    {[
                      [[['both', 'All'], ['issue', 'Issues'], ['collection', 'Collections']], filterKind, setFilterKind, 'k'],
                      [[['all', 'Any payment'], ['cash', 'Cash'], ['bank', 'Bank']], filterPaymentMode, setFilterPaymentMode, 'p'],
                    ].map(function (grp) {
                      return (
                        <div key={grp[3]} className="grid grid-cols-3 p-0.5 rounded-lg bg-slate-100">
                          {grp[0].map(function (o) {
                            var on = grp[1] === o[0]
                            return (
                              <button key={o[0]} type="button" onClick={function () { grp[2](o[0]) }} aria-pressed={on}
                                className={'min-w-0 h-7 px-1 rounded-md text-[12px] font-bold truncate transition-colors ' +
                                  (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                                {o[1]}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 cursor-pointer select-none">
                          <input type="checkbox" checked={showAll} onChange={function (e) { setShowAll(e.target.checked) }} className="w-4 h-4 accent-indigo-600" />
                          Everyone's entries
                        </label>
                      )}
                      {nOn > 0 && (
                        <button type="button" onClick={function () { setFilterFrom(''); setFilterTo(''); setFilterKind('both'); setFilterPaymentMode('all'); setShowAll(false) }}
                          className="ml-auto h-7 px-2.5 rounded-lg text-[12px] font-bold text-indigo-600 hover:bg-indigo-50">Reset</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {listLoading && <p className="text-[13px] font-semibold text-white/85 text-center py-6 drop-shadow">Loading…</p>}
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
                {/* The entries stay folded until asked for, so the list reads as
                    one card per function rather than a wall of rows. */}
                <button type="button" onClick={function () { toggleGroup(g.event_id) }} aria-expanded={!!openGroups[g.event_id]}
                  className="w-full flex items-center gap-2 px-3.5 py-2.5 border-t border-slate-100 text-left hover:bg-slate-50">
                  <Icon name="list" size={14} className="text-slate-400" />
                  <span className="flex-1 text-[12.5px] font-bold text-slate-700">
                    {g._filtered.length + (g._filtered.length === 1 ? ' entry' : ' entries')}
                  </span>
                  <span className="text-[12px] font-bold text-indigo-600">{openGroups[g.event_id] ? 'Hide' : 'Show'}</span>
                  <Icon name={openGroups[g.event_id] ? 'chevronUp' : 'chevronDown'} size={15} className="text-slate-400" />
                </button>
                {openGroups[g.event_id] && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {g._filtered.map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel, { issueLocked: g.items.some(function (x) { return x._kind === 'collection' && x.status === 'active' }), correctedIds: correctedIssueIds(g.items.filter(function (x) { return x._kind === 'issue' })), onReceipt: function (row) { printCollectionReceipt(row, g.event) }, receiptBusy: receiptBusy }) })}
                  </div>
                )}
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
// The issues that an active correction points at ("Correction of #123 …").
function correctedIssueIds(issueRows) {
  var out = {}
  ;(issueRows || []).forEach(function (x) {
    if (x.status !== 'active') return
    var m = /^Correction of #(\d+)/.exec(x.notes || '')
    if (m) out[m[1]] = true
  })
  return out
}

// opts.issueLocked: the function has an active collection, which the
// database will not let an issue be cancelled under (the collection was
// worked out on those plates). Such an issue offers Correct — a negative
// issue, pre-filled — where it would have offered a Cancel that can only
// fail. opts.onCorrect is given on the Manage screen, where the issue form is.
function renderHistoryRow(r, profile, isAdmin, openCancel, opts) {
  opts = opts || {}
  var isCancelled = r.status === 'cancelled'
  var isIssue = r._kind === 'issue'
  var isWaste = !isIssue && r.extras_charged === 0
  var ownerId = isIssue ? r.issued_by : r.collected_by
  var allowed = !isCancelled && (
    isAdmin ||
    (ownerId === profile.id && r.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10))
  )
  var locked = allowed && isIssue && !!opts.issueLocked
  var canCancel = allowed && !locked
  // A correction is not itself corrected (issue again instead), and an entry
  // a correction already points at says so rather than offering another.
  var isCorrection = isIssue && /^Correction of /.test(r.notes || '')
  var isCorrected = isIssue && (opts.correctedIds || {})[r.id]
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
      {(receiptUrl || canCancel || locked || (!isIssue && !isWaste && !isCancelled && opts.onReceipt)) && (
        <div className="shrink-0 flex items-center gap-1.5">
          {!isIssue && !isWaste && !isCancelled && opts.onReceipt && (
            <button type="button" onClick={function () { opts.onReceipt(r) }} disabled={opts.receiptBusy === r.id}
              aria-label="Download receipt" title="Download receipt"
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 inline-flex items-center justify-center disabled:opacity-50">
              <Icon name={opts.receiptBusy === r.id ? 'refresh' : 'download'} size={14} className={opts.receiptBusy === r.id ? 'animate-spin' : ''} />
            </button>
          )}
          {receiptUrl && (
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer" aria-label="View photo"
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 inline-flex items-center justify-center">
              <Icon name="eye" size={14} />
            </a>
          )}
          {locked && isCorrected && (
            <span className="h-8 px-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 inline-flex items-center gap-1 text-[11.5px] font-bold">
              <Icon name="check" size={12} strokeWidth={3} />Corrected
            </span>
          )}
          {locked && !isCorrected && !isCorrection && opts.onCorrect && (
            <button type="button" onClick={function () { opts.onCorrect(r) }}
              title="A collection exists for this function, so this issue cannot be cancelled — log a negative issue instead"
              className="h-8 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-[12px] font-bold hover:bg-indigo-100">Correct</button>
          )}
          {locked && !isCorrected && !isCorrection && !opts.onCorrect && (
            <span title="A collection exists for this function, so this issue cannot be cancelled — correct it with a negative issue from Manage"
              className="h-8 px-2 rounded-lg border border-slate-200 text-slate-400 inline-flex items-center gap-1 text-[11.5px] font-bold">
              <Icon name="lock" size={12} />Locked
            </span>
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
