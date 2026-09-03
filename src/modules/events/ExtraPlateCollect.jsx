import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload } from '../../lib/uploadHelper'
import EventDatePicker from '../../components/ui/EventDatePicker'
import VoiceInput from '../../components/ui/VoiceInput'
import { hasPerm } from '../../lib/permissions'

var BANK_SUB_MODES = [
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'paytm_card_machine', label: 'Paytm Card Machine' },
  { value: 'hdfc_card_machine', label: 'HDFC Card Machine' }
]
var SUB_MODE_LABEL = {
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  paytm_card_machine: 'Paytm Card',
  hdfc_card_machine: 'HDFC Card'
}

function ExtraPlateCollect({ profile, onBalanceChange }) {

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor' || hasPerm(profile?.permsNew, 'events.extra_plate_collect')
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

  // ─── RENDER ──────────────────────────────────────

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button type="button" onClick={function () { setView('manage') }}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (view === 'manage' ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500")}>
          Manage
        </button>
        <button type="button" onClick={function () { setView('recent') }}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (view === 'recent' ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500")}>
          Recent
        </button>
      </div>

      {/* ─── MANAGE VIEW ───────────────────────────── */}
      {view === 'manage' && (
        <div className="space-y-4">
          <EventDatePicker label="1. Event Date" value={date}
            onChange={function (d) { loadFunctionsForDate(d) }} />

          {date && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">2. Select Function</label>
              {eventsLoading && <p className="text-xs text-gray-400">Loading...</p>}
              {!eventsLoading && events.length === 0 && (
                <p className="text-xs text-gray-400">No functions on this date</p>
              )}
              {events.length > 0 && (
                <div className="space-y-1.5">
                  {events.map(function (ev) {
                    var selected = String(ev.id) === eventId
                    return (
                      <button key={ev.id} type="button" onClick={function () { selectFunction(String(ev.id), ev) }}
                        className={"w-full text-left px-3 py-2 rounded-lg border transition-colors " +
                          (selected ? "border-blue-600 bg-blue-50 border-2" : "border-gray-200 bg-white hover:border-gray-300")}>
                        <div className={"text-sm font-medium " + (selected ? "text-blue-900" : "text-gray-900")}>
                          {ev.event_name + (ev.client_name ? ' — ' + ev.client_name : '')}
                        </div>
                        <div className={"text-xs " + (selected ? "text-blue-700" : "text-gray-500")}>
                          {(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : '')}
                        </div>
                        {(ev.department || ev.contract_no) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {ev.department && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">{ev.department}</span>
                            )}
                            {ev.contract_no && (
                              <span className="text-[10px] font-mono text-gray-500">#{ev.contract_no}</span>
                            )}
                          </div>
                        )}
                        {ev.created_user_name && (
                          <div className={"text-[11px] mt-0.5 " + (selected ? "text-blue-600" : "text-gray-400")}>
                            Contract by {ev.created_user_name}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {eventDetail && (
            <div className="rounded-lg p-4 border-2 border-amber-300 bg-amber-50 space-y-3">
              <div>
                <div className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide">Quota</div>
                <div className="text-base font-bold text-amber-900">
                  {paidPax} pax + {complementary} complementary = {quota} plates
                </div>
              </div>
              <div className="border-t border-amber-200 pt-2">
                <div className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide">Rate</div>
                <div className="text-base font-bold text-amber-900">
                  {ratePaise > 0
                    ? '₹' + (ratePaise / 100).toLocaleString('en-IN') + ' per plate'
                    : <span className="text-red-700">No rate on contract</span>}
                </div>
              </div>
              <div className="border-t border-amber-200 pt-2 grid grid-cols-4 gap-2 text-center">
                <div>
                  <div className="text-[10px] font-semibold text-amber-700 uppercase">Issued</div>
                  <div className="text-base font-bold text-amber-900">{stateLoading ? '…' : totalIssued}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-amber-700 uppercase">Extras</div>
                  <div className="text-base font-bold text-amber-900">{stateLoading ? '…' : extras}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-amber-700 uppercase">Collected</div>
                  <div className="text-base font-bold text-amber-900">{stateLoading ? '…' : totalCollectedExtras}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-amber-700 uppercase">Due</div>
                  <div className={"text-base font-bold " + (remaining > 0 ? "text-red-700" : "text-green-700")}>
                    {stateLoading ? '…' : (remaining > 0 ? remaining : '✓')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Issue section */}
          {eventDetail && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div className="text-sm font-bold text-gray-900">📥 Issue Plates</div>
              <div className="text-xs text-gray-500">
                Log plates handed out. Use negative for corrections.
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Plates to Issue</label>
                <input type="number" step="1" inputMode="numeric" value={issuePlates}
                  onChange={function (e) { setIssuePlates(e.target.value) }}
                  placeholder={quota > 0 && totalIssued === 0 ? 'e.g. ' + quota : 'e.g. 50'}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Photo Proof</label>
                {issueImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {issueImage.name}</span>
                    <button type="button" onClick={function () { setIssueImage(null) }}
                      className="text-xs text-red-500 font-bold">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-2 text-center text-sm text-blue-700 border-2 border-dashed border-blue-300 rounded-lg cursor-pointer font-medium">
                    📷 Take photo of plates
                    <input type="file" accept="image/*" capture="environment" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setIssueImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes (optional)</label>
                <input type="text" value={issueNotes} onChange={function (e) { setIssueNotes(e.target.value) }}
                  placeholder="e.g. initial batch, top-up"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
                  style={{ fontSize: '16px' }} />
              </div>
              {issueMsg && (
                <div className="rounded-lg p-2 border border-green-300 bg-green-50 text-xs text-green-800 font-semibold">✓ {issueMsg}</div>
              )}
              <button type="button" onClick={submitIssue} disabled={!canIssue}
                className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold text-sm disabled:opacity-40">
                {issueSaving ? 'Saving...' : 'Log Issue'}
              </button>
            </div>
          )}

          {/* Collect / Waste-log section — visible whenever any issues exist */}
          {eventDetail && ratePaise > 0 && totalIssued > 0 && (
            <div className={"rounded-lg border-2 p-4 space-y-3 " + (isWasteOnly ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50")}>
              <div className={"text-sm font-bold " + (isWasteOnly ? "text-amber-900" : "text-red-900")}>
                {isWasteOnly ? '📋 Log Returned Plates' : '💰 Collect Extras'}
              </div>

              {/* Reconciliation panel */}
              <div className="rounded-lg bg-white/70 p-2 text-[11px] space-y-0.5">
                <div className="flex justify-between"><span className="text-gray-500">Quota</span><span className="font-semibold text-gray-800">{quota}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Issued</span><span className="font-semibold text-gray-800">{totalIssued}</span></div>
                {priorReturned > 0 && <div className="flex justify-between"><span className="text-gray-500">Already Returned</span><span className="font-semibold text-gray-800">{priorReturned}</span></div>}
                {totalCollectedExtras > 0 && <div className="flex justify-between"><span className="text-gray-500">Already Charged</span><span className="font-semibold text-gray-800">{totalCollectedExtras}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Consumed</span><span className="font-semibold text-gray-800">{consumed}</span></div>
                <div className="flex justify-between border-t border-gray-200 pt-0.5 mt-0.5">
                  <span className="text-gray-600 font-medium">Chargeable now</span>
                  <span className={"font-bold " + (thisChargeable > 0 ? "text-red-700" : "text-gray-500")}>{thisChargeable}</span>
                </div>
                {waste > 0 && <div className="flex justify-between"><span className="text-amber-700">Waste (quota unused)</span><span className="font-semibold text-amber-700">{waste}</span></div>}
              </div>

              <div>
                <label className={"block text-xs font-semibold uppercase tracking-wide mb-2 " + (isWasteOnly ? "text-amber-800" : "text-red-800")}>Plates Returned (unused)</label>
                <input type="number" min="0" step="1" inputMode="numeric" value={collectReturned}
                  onChange={function (e) { setCollectReturned(e.target.value) }}
                  placeholder="0"
                  className={"w-full px-3 py-2.5 border rounded-lg text-sm bg-white " + (isWasteOnly ? "border-amber-300" : "border-red-300")}
                  style={{ fontSize: '16px' }} />
                <p className="text-[10px] text-gray-500 mt-1">Plates handed out but not consumed.</p>
              </div>

              {isCollection && (
                <div>
                  <label className="block text-xs font-semibold text-red-800 uppercase tracking-wide mb-2">Discount ₹ (optional)</label>
                  <input type="number" min="0" step="1" inputMode="numeric" value={collectDiscount}
                    onChange={function (e) { setCollectDiscount(e.target.value) }}
                    placeholder="0"
                    className="w-full px-3 py-2.5 border border-red-300 rounded-lg text-sm bg-white"
                    style={{ fontSize: '16px' }} />
                </div>
              )}
              {isCollection && collectPreviewTotal > 0 && (
                <div className="rounded-lg bg-white border border-red-200 p-2 text-xs space-y-0.5">
                  <div className="flex justify-between text-red-800">
                    <span>Gross ({thisChargeable} × ₹{(ratePaise / 100).toLocaleString('en-IN')})</span>
                    <span>₹{(collectPreviewTotal / 100).toLocaleString('en-IN')}</span>
                  </div>
                  {Number(collectDiscount) > 0 && (
                    <div className="flex justify-between text-red-800">
                      <span>Discount</span>
                      <span>− ₹{Number(collectDiscount).toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-red-900 font-bold border-t border-red-100 pt-0.5 mt-0.5">
                    <span>Net to collect</span>
                    <span>₹{(collectNetPreview / 100).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
              {isCollection && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-red-800 uppercase tracking-wide mb-2">Payment Mode</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={function () { setCollectMode('cash'); setCollectSubMode('') }}
                        className={"py-2.5 rounded-lg border-2 text-sm font-semibold " +
                          (collectMode === 'cash' ? "border-red-600 bg-red-100 text-red-900" : "border-gray-200 bg-white text-gray-600")}>
                        💵 Cash
                      </button>
                      <button type="button" onClick={function () { setCollectMode('bank') }}
                        className={"py-2.5 rounded-lg border-2 text-sm font-semibold " +
                          (collectMode === 'bank' ? "border-red-600 bg-red-100 text-red-900" : "border-gray-200 bg-white text-gray-600")}>
                        🏦 Bank
                      </button>
                    </div>
                    {collectMode === 'bank' && (
                      <div className="mt-2">
                        <label className="block text-xs font-semibold text-red-800 uppercase tracking-wide mb-2">Bank Method <span className="text-red-500">*</span></label>
                        <select value={collectSubMode} onChange={function (e) { setCollectSubMode(e.target.value) }}
                          className="w-full px-3 py-2.5 border border-red-300 rounded-lg text-sm bg-white"
                          style={{ fontSize: '16px' }}>
                          <option value="">Select…</option>
                          {BANK_SUB_MODES.map(function (m) {
                            return <option key={m.value} value={m.value}>{m.label}</option>
                          })}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-red-800 uppercase tracking-wide mb-2">Payment Proof</label>
                    {collectImage ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {collectImage.name}</span>
                        <button type="button" onClick={function () { setCollectImage(null) }}
                          className="text-xs text-red-500 font-bold">✕</button>
                      </div>
                    ) : (
                      <label className="block w-full py-2 text-center text-sm text-red-700 border-2 border-dashed border-red-300 rounded-lg cursor-pointer font-medium bg-white">
                        📷 Photo of money received
                        <input type="file" accept="image/*" capture="environment" className="sr-only"
                          onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                      </label>
                    )}
                  </div>
                </>
              )}
              <div>
                <label className={"block text-xs font-semibold uppercase tracking-wide mb-2 " + (isWasteOnly ? "text-amber-800" : "text-red-800")}>Notes (optional)</label>
                <input type="text" value={collectNotes} onChange={function (e) { setCollectNotes(e.target.value) }}
                  className={"w-full px-3 py-2.5 border rounded-lg text-sm bg-white " + (isWasteOnly ? "border-amber-300" : "border-red-300")}
                  style={{ fontSize: '16px' }} />
              </div>
              {collectMsg && (
                <div className="rounded-lg p-2 border border-green-300 bg-green-50 text-xs text-green-800 font-semibold">✓ {collectMsg}</div>
              )}
              <button type="button" onClick={submitCollect} disabled={!canCollect}
                className={"w-full py-3 rounded-lg text-white font-semibold text-sm disabled:opacity-40 " + (isWasteOnly ? "bg-amber-600" : "bg-red-600")}>
                {collectSaving ? 'Saving...'
                  : isWasteOnly ? 'Log ' + thisReturned + ' Returned Plates'
                  : isCollection ? 'Collect ' + (collectNetPreview > 0 ? '₹' + (collectNetPreview / 100).toLocaleString('en-IN') : '')
                  : 'Enter returned plates to continue'}
              </button>
            </div>
          )}

          {eventDetail && ratePaise > 0 && remaining === 0 && totalIssued > quota && (
            <div className="rounded-lg p-3 border border-green-300 bg-green-50 text-sm text-green-800 font-semibold">
              ✓ All extras collected for this event
            </div>
          )}

          {/* Event history (this event only) */}
          {eventDetail && (issues.length > 0 || collections.length > 0) && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">Event History</div>
              {[].concat(issues.map(function (r) { return Object.assign({}, r, { _kind: 'issue' }) }))
                 .concat(collections.map(function (r) { return Object.assign({}, r, { _kind: 'collection' }) }))
                 .sort(function (a, b) { return b.created_at.localeCompare(a.created_at) })
                 .map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel) })}
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
            doc.save('extra_plates_' + new Date().toISOString().slice(0,10) + '.pdf')
          } catch (e) {
            alert('PDF export failed: ' + (e.message || e))
          }
          setExporting(false)
        }
        return (
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1"><span className="text-gray-500">From</span>
                <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value) }}
                  style={{ fontSize: '16px' }} className="px-2 py-1 border border-gray-300 rounded" /></label>
              <label className="flex items-center gap-1"><span className="text-gray-500">To</span>
                <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value) }}
                  style={{ fontSize: '16px' }} className="px-2 py-1 border border-gray-300 rounded" /></label>
              {(filterFrom || filterTo) && (
                <button type="button" onClick={function () { setFilterFrom(''); setFilterTo('') }}
                  className="text-blue-600 underline">Reset dates</button>
              )}
              <button type="button" onClick={exportCSV} disabled={exporting}
                className="ml-auto px-2.5 py-1 font-bold bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 disabled:opacity-50">📊 CSV</button>
              <button type="button" onClick={exportPDF} disabled={exporting}
                className="px-2.5 py-1 font-bold bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50">📄 {exporting ? 'PDF...' : 'PDF'}</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-gray-500">Kind:</span>
              {['both','issue','collection'].map(function (k) {
                return <button key={k} type="button" onClick={function () { setFilterKind(k) }}
                  className={"px-2 py-0.5 rounded border font-semibold capitalize " +
                    (filterKind === k ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300")}>{k}</button>
              })}
              <span className="text-gray-500 ml-2">Payment:</span>
              {[['all','All'],['cash','Cash'],['bank','Bank']].map(function (p) {
                return <button key={p[0]} type="button" onClick={function () { setFilterPaymentMode(p[0]) }}
                  className={"px-2 py-0.5 rounded border font-semibold " +
                    (filterPaymentMode === p[0] ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300")}>{p[1]}</button>
              })}
            </div>
            {venueOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-gray-500">Venue:</span>
                {venueOptions.map(function (v) {
                  var active = filterVenues.indexOf(v) !== -1
                  return <button key={v} type="button"
                    onClick={function () {
                      setFilterVenues(function (prev) {
                        if (prev.indexOf(v) === -1) return prev.concat([v])
                        return prev.filter(function (x) { return x !== v })
                      })
                    }}
                    className={"px-2 py-0.5 rounded border font-semibold " +
                      (active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300")}>{v}</button>
                })}
                {filterVenues.length > 0 && (
                  <button type="button" onClick={function () { setFilterVenues([]) }}
                    className="text-blue-600 underline">Clear</button>
                )}
              </div>
            )}
          </div>
          {isAdmin && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={showAll} onChange={function (e) { setShowAll(e.target.checked) }} />
              Show all users
            </label>
          )}
          {listLoading && <p className="text-xs text-gray-400">Loading...</p>}
          {!listLoading && recentGroups.length === 0 && (
            <p className="text-xs text-gray-400">No activity in this date range</p>
          )}
          {!listLoading && recentGroups.length > 0 && filteredGroups.length === 0 && (
            <p className="text-xs text-gray-400">No rows match current filters</p>
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
              <div key={g.event_id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {g.event?.event_name || 'Event ' + g.event_id}
                    {g.event?.client_name ? ' — ' + g.event.client_name : ''}
                  </div>
                  <div className="text-xs text-gray-500">
                    {(g.event?.venue_name || '') + ' · ' + formatDate(g.event?.function_date || g.items[0].created_at)}
                  </div>
                  <div className="text-[11px] text-gray-700 mt-1">
                    Quota <span className="font-semibold">{evQuota}</span> ({evPaid}+{evComp}) ·
                    Issued <span className="font-semibold">{evIssuedTotal}</span>
                    {(evReturnedTotal > 0 || evWasteTotal > 0) && (
                      <span> · Returned <span className="font-semibold">{evReturnedTotal + evWasteTotal}</span>
                        {evWasteTotal > 0 && <span className="text-amber-700"> ({evWasteTotal} waste)</span>}
                      </span>
                    )}
                    <span> · Extras <span className="font-semibold">{evExtras}</span> ·
                    Charged <span className="font-semibold">{evChargedTotal}</span></span>
                    {evDue > 0 && <span className="text-red-700 font-semibold"> · Due {evDue}</span>}
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-gray-100 pt-2">
                  {g._filtered.map(function (r) { return renderHistoryRow(r, profile, isAdmin, openCancel) })}
                </div>
              </div>
            )
          })}
        </div>
        )
      })()}

      {/* ─── CANCEL MODAL ──────────────────────────── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={function () { if (!cancelSaving) setCancelTarget(null) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={function (ev) { ev.stopPropagation() }}>
            <h3 className="text-base font-bold text-gray-900">
              Cancel {cancelTarget.type === 'issue' ? 'Issue' : 'Collection'}
            </h3>
            <div className="text-sm text-gray-600">
              {cancelTarget.type === 'issue'
                ? cancelTarget.row.plates_count + ' plates'
                : (cancelTarget.row.extras_charged === 0
                    ? (cancelTarget.row.plates_returned || 0) + ' returned (waste — no charge)'
                    : cancelTarget.row.extras_charged + ' extras · ₹' + ((cancelTarget.row.total_paise - (cancelTarget.row.discount_paise || 0)) / 100).toLocaleString('en-IN') + ' · ' + (cancelTarget.row.payment_mode || '—'))}
            </div>
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {cancelTarget.type === 'issue'
                ? 'Marks issue cancelled. If a collection exists for this event, log a correction issue with negative plates instead.'
                : (cancelTarget.row.extras_charged === 0
                    ? 'Marks this waste-only entry cancelled. No wallet or ledger changes (nothing was charged).'
                    : 'Wallet debited and event ledger reversed. This cannot be undone.')}
            </div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</label>
            <VoiceInput type="text" value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
              placeholder="Why?"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={function () { setCancelTarget(null) }} disabled={cancelSaving}
                className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl font-semibold">Keep</button>
              <button type="button" onClick={confirmCancel} disabled={cancelSaving || !cancelReason.trim()}
                className="flex-1 py-3 text-sm text-white bg-red-600 rounded-xl disabled:opacity-40 font-semibold">
                {cancelSaving ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}  


// Shared row renderer for both issue and collection history entries
function renderHistoryRow(r, profile, isAdmin, openCancel) {
  var isCancelled = r.status === 'cancelled'
  var isIssue = r._kind === 'issue'
  var ownerId = isIssue ? r.issued_by : r.collected_by
  var canCancel = !isCancelled && (
    isAdmin ||
    (ownerId === profile.id && r.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10))
  )
  var receiptUrl = r.receipt_path
    ? supabase.storage.from('receipts').getPublicUrl(r.receipt_path).data?.publicUrl
    : null
  return (
    <div key={r._kind + '_' + r.id}
      className={"flex items-start justify-between gap-2 text-xs " + (isCancelled ? "opacity-50" : "")}>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-800">
          {isIssue
            ? '📥 ' + (r.plates_count > 0 ? '+' : '') + r.plates_count + ' plates'
            : (r.extras_charged === 0
                ? '📋 ' + r.plates_returned + ' returned (waste)'
                : '💰 ' + r.extras_charged + ' × ₹' + (r.rate_paise / 100).toLocaleString('en-IN')
                    + (r.plates_returned > 0 ? ' · ' + r.plates_returned + ' returned' : '')
                    + (r.discount_paise > 0 ? ' − ₹' + (r.discount_paise / 100).toLocaleString('en-IN') + ' disc' : '')
                    + ' = ₹' + ((r.total_paise - (r.discount_paise || 0)) / 100).toLocaleString('en-IN')
                    + ' ' + (r.payment_mode === 'cash' ? '💵' : ('🏦 ' + (SUB_MODE_LABEL[r.payment_sub_mode] || ''))))}
          {isCancelled && <span className="ml-2 text-red-600">— cancelled</span>}
        </div>
        {r.notes && <div className="text-gray-500 italic mt-0.5">"{r.notes}"</div>}
        {isCancelled && r.cancelled_reason && <div className="text-red-600 mt-0.5">Reason: {r.cancelled_reason}</div>}
        <div className="text-[10px] text-gray-400 mt-0.5">
          {formatDate(r.created_at)}
          {r._creatorName && ' · by ' + r._creatorName}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {receiptUrl && (
          <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600">📷</a>
        )}
        {canCancel && (
          <button type="button" onClick={function () { openCancel(isIssue ? 'issue' : 'collection', r) }}
            className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700 font-medium">Cancel</button>
        )}
      </div>
    </div>
  )
}

export default ExtraPlateCollect