import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload } from '../../lib/uploadHelper'
import EventDatePicker from '../../components/ui/EventDatePicker'

function ExtraPlateCollect({ profile, onBalanceChange }) {
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  // View toggle
  var [view, setView] = useState('collect') // 'collect' | 'recent'

  // ─── Collect form state ───────────────────────────────────
  var [date, setDate] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var [eventId, setEventId] = useState('')
  var [eventDetail, setEventDetail] = useState(null)
  var [plates, setPlates] = useState('')
  var [mode, setMode] = useState('')
  var [image, setImage] = useState(null)
  var [notes, setNotes] = useState('')
  var [saving, setSaving] = useState(false)
  var [okMsg, setOkMsg] = useState('')

  // ─── Recent list state ────────────────────────────────────
  var [list, setList] = useState([])
  var [listLoading, setListLoading] = useState(false)
  var [showAll, setShowAll] = useState(false)

  // ─── Cancel modal state ───────────────────────────────────
  var [cancelRow, setCancelRow] = useState(null)
  var [cancelReason, setCancelReason] = useState('')
  var [cancelSaving, setCancelSaving] = useState(false)

  // ─── Edit modal state ─────────────────────────────────────
  var [editRow, setEditRow] = useState(null)
  var [editNotes, setEditNotes] = useState('')
  var [editImage, setEditImage] = useState(null)
  var [editSaving, setEditSaving] = useState(false)

  useEffect(function () { loadRecent() }, [showAll])

  // ─────────────────────────────────────────────────────────
  //  DATA LOADERS
  // ─────────────────────────────────────────────────────────

  async function loadFunctionsForDate(dateStr) {
    setDate(dateStr)
    setEventId('')
    setEventDetail(null)
    if (!dateStr) { setEvents([]); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, client_name, session, extra_plates_charge')
      .eq('function_date', dateStr)
      .order('event_name')
    setEvents(data || [])
    setEventsLoading(false)
    if (data && data.length === 1) { selectFunction(String(data[0].id)) }
  }

  function selectFunction(fid) {
    setEventId(fid)
    var row = events.find(function (e) { return String(e.id) === String(fid) })
    setEventDetail(row || null)
    setOkMsg('')
  }

  async function loadRecent() {
    setListLoading(true)
    var since = new Date()
    since.setDate(since.getDate() - 30)
    var query = supabase.from('extra_plate_collections')
      .select('id, event_id, plates_issued, rate_paise, total_paise, payment_mode, receipt_path, notes, status, cancelled_reason, created_at, collected_by, cancelled_at, events(event_name, venue_name, client_name, function_date)')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(200)
    if (!isAdmin || !showAll) query = query.eq('collected_by', profile.id)
    var { data } = await query
    setList(data || [])
    setListLoading(false)
  }

  // ─────────────────────────────────────────────────────────
  //  SUBMIT NEW COLLECTION
  // ─────────────────────────────────────────────────────────

  async function submitCollection() {
    if (saving) return
    if (!eventId) { alert('Select a function'); return }
    if (!eventDetail || !eventDetail.extra_plates_charge || eventDetail.extra_plates_charge <= 0) {
      alert('This event has no extra plate rate on the contract')
      return
    }
    var n = Number(plates)
    if (!n || n <= 0 || Math.floor(n) !== n) { alert('Enter a whole number of plates > 0'); return }
    if (!mode) { alert('Select Cash or Bank'); return }
    if (!image) { alert('Receipt photo is required'); return }

    setSaving(true)
    setOkMsg('')

    // Upload receipt first
    var cF
    try { cF = await prepUpload(image, 100) } catch (e) { alert('Image prep failed'); setSaving(false); return }
    var ext = (cF.name && cF.name.indexOf('.') !== -1) ? cF.name.split('.').pop() : 'jpg'
    var imagePath = profile.id + '/extra_plate_' + Date.now() + '.' + ext
    var { error: upErr } = await supabase.storage.from('receipts').upload(imagePath, cF, { upsert: true })
    if (upErr) { alert('Receipt upload failed: ' + upErr.message); setSaving(false); return }

    var { data, error } = await supabase.rpc('fn_extra_plate_collect', {
      p_event_id: Number(eventId),
      p_plates: n,
      p_payment_mode: mode,
      p_receipt_path: imagePath,
      p_notes: notes.trim() || null
    })
    if (error) {
      alert('Collection failed: ' + error.message)
      try { await supabase.storage.from('receipts').remove([imagePath]) } catch (_) {}
      setSaving(false)
      return
    }

    try {
      await logActivity('EXTRA_PLATE_COLLECT',
        (eventDetail.event_name || '') + ' | ' + n + ' plates | ' + mode + ' | ' + formatPoints(data.total_paise))
    } catch (_) {}

    setOkMsg('Collected ' + formatPoints(data.total_paise) + ' — ' + n + ' plates')
    setPlates('')
    setMode('')
    setImage(null)
    setNotes('')
    setSaving(false)
    if (onBalanceChange) onBalanceChange()
    loadRecent()
  }

  // ─────────────────────────────────────────────────────────
  //  CANCEL
  // ─────────────────────────────────────────────────────────

  function openCancel(row) {
    setCancelRow(row)
    setCancelReason('')
  }

  async function confirmCancel() {
    if (cancelSaving) return
    if (!cancelReason.trim()) { alert('Reason required'); return }
    setCancelSaving(true)
    var { error } = await supabase.rpc('fn_extra_plate_cancel', {
      p_collection_id: cancelRow.id,
      p_reason: cancelReason.trim()
    })
    if (error) { alert('Cancel failed: ' + error.message); setCancelSaving(false); return }
    try {
      await logActivity('EXTRA_PLATE_CANCEL',
        (cancelRow.events?.event_name || '') + ' | ' + cancelRow.plates_issued + ' plates | ' + formatPoints(cancelRow.total_paise) + ' | ' + cancelReason.trim())
    } catch (_) {}
    setCancelRow(null)
    setCancelSaving(false)
    if (onBalanceChange) onBalanceChange()
    loadRecent()
  }

  // ─────────────────────────────────────────────────────────
  //  EDIT (notes + optional new receipt image)
  // ─────────────────────────────────────────────────────────

  function openEdit(row) {
    setEditRow(row)
    setEditNotes(row.notes || '')
    setEditImage(null)
  }

  async function saveEdit() {
    if (editSaving) return
    setEditSaving(true)
    var newPath = null
    if (editImage) {
      var eF
      try { eF = await prepUpload(editImage, 100) } catch (e) { alert('Image prep failed'); setEditSaving(false); return }
      var ext = (eF.name && eF.name.indexOf('.') !== -1) ? eF.name.split('.').pop() : 'jpg'
      newPath = profile.id + '/extra_plate_' + Date.now() + '_edit.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(newPath, eF, { upsert: true })
      if (upErr) { alert('Receipt upload failed: ' + upErr.message); setEditSaving(false); return }
    }
    var { error } = await supabase.rpc('fn_extra_plate_edit_notes', {
      p_collection_id: editRow.id,
      p_notes: editNotes.trim() || null,
      p_receipt_path: newPath
    })
    if (error) { alert('Edit failed: ' + error.message); setEditSaving(false); return }
    try {
      await logActivity('EXTRA_PLATE_EDIT',
        (editRow.events?.event_name || '') + ' | notes' + (newPath ? ' + receipt' : ''))
    } catch (_) {}
    setEditRow(null)
    setEditSaving(false)
    loadRecent()
  }

  // ─────────────────────────────────────────────────────────
  //  DERIVED
  // ─────────────────────────────────────────────────────────

  var ratePaise = eventDetail ? Number(eventDetail.extra_plates_charge || 0) * 2 : 0
  var previewTotal = ratePaise > 0 && Number(plates) > 0 ? ratePaise * Math.floor(Number(plates)) : 0
  var canSubmit = eventId && Number(plates) > 0 && mode && image && ratePaise > 0 && !saving

  // ─────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* View toggle */}
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button type="button" onClick={function () { setView('collect'); setOkMsg('') }}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (view === 'collect' ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500")}>
          Collect
        </button>
        <button type="button" onClick={function () { setView('recent') }}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (view === 'recent' ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500")}>
          Recent
        </button>
      </div>

      {/* ─── COLLECT VIEW ─────────────────────────────────── */}
      {view === 'collect' && (
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
                      <button key={ev.id} type="button" onClick={function () { selectFunction(String(ev.id)) }}
                        className={"w-full text-left px-3 py-2 rounded-lg border transition-colors " +
                          (selected ? "border-blue-600 bg-blue-50 border-2" : "border-gray-200 bg-white hover:border-gray-300")}>
                        <div className={"text-sm font-medium " + (selected ? "text-blue-900" : "text-gray-900")}>
                          {ev.event_name + (ev.client_name ? ' — ' + ev.client_name : '')}
                        </div>
                        <div className={"text-xs " + (selected ? "text-blue-700" : "text-gray-500")}>
                          {(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : '')}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {eventDetail && (
            <div className={"rounded-lg p-4 border-2 " +
              (ratePaise > 0 ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50")}>
              {ratePaise > 0 ? (
                <>
                  <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Extra Plate Rate</div>
                  <div className="text-2xl font-bold text-amber-900 mt-0.5">₹{(ratePaise / 100).toLocaleString('en-IN')} <span className="text-sm font-medium text-amber-700">per plate</span></div>
                </>
              ) : (
                <div className="text-sm font-semibold text-red-800">⚠ No extra plate rate set on this contract. Cannot collect.</div>
              )}
            </div>
          )}

          {eventDetail && ratePaise > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">3. Plates Issued</label>
              <input type="number" min="1" step="1" inputMode="numeric" value={plates}
                onChange={function (e) { setPlates(e.target.value) }}
                placeholder="e.g. 25"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }} />
              {previewTotal > 0 && (
                <div className="mt-2 text-sm text-gray-700">
                  {Math.floor(Number(plates))} × ₹{(ratePaise / 100).toLocaleString('en-IN')} = <span className="font-bold text-blue-700">₹{(previewTotal / 100).toLocaleString('en-IN')}</span>
                </div>
              )}
            </div>
          )}

          {eventDetail && ratePaise > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">4. Payment Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={function () { setMode('cash') }}
                  className={"py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors " +
                    (mode === 'cash' ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-600")}>
                  💵 Cash
                </button>
                <button type="button" onClick={function () { setMode('bank') }}
                  className={"py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors " +
                    (mode === 'bank' ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-600")}>
                  🏦 Bank
                </button>
              </div>
            </div>
          )}

          {eventDetail && ratePaise > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">5. Payment Proof</label>
              {image ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {image.name}</span>
                  <button type="button" onClick={function () { setImage(null) }}
                    className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                </div>
              ) : (
                <label className="block w-full py-3 text-center text-sm text-blue-700 border-2 border-dashed border-blue-300 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors font-medium">
                  📷 Take photo of money received
                  <input type="file" accept="image/*" capture="environment" className="sr-only"
                    onChange={function (e) { if (e.target.files?.[0]) setImage(e.target.files[0]); e.target.value = '' }} />
                </label>
              )}
            </div>
          )}

          {eventDetail && ratePaise > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">6. Notes (optional)</label>
              <input type="text" value={notes} onChange={function (e) { setNotes(e.target.value) }}
                placeholder="e.g. late guests, main course"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }} />
            </div>
          )}

          {okMsg && (
            <div className="rounded-lg p-3 border border-green-300 bg-green-50 text-sm text-green-800 font-semibold">✓ {okMsg}</div>
          )}

          <button type="button" onClick={submitCollection} disabled={!canSubmit}
            className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold text-sm disabled:opacity-40 hover:bg-blue-700 transition-colors">
            {saving ? 'Saving...' : 'Collect ' + (previewTotal > 0 ? '₹' + (previewTotal / 100).toLocaleString('en-IN') : '')}
          </button>
        </div>
      )}

      {/* ─── RECENT LIST VIEW ─────────────────────────────── */}
      {view === 'recent' && (
        <div className="space-y-3">
          {isAdmin && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={showAll} onChange={function (e) { setShowAll(e.target.checked) }} />
              Show all users' collections (admin)
            </label>
          )}
          {listLoading && <p className="text-xs text-gray-400">Loading...</p>}
          {!listLoading && list.length === 0 && (
            <p className="text-xs text-gray-400">No collections in the last 30 days</p>
          )}
          {list.map(function (row) {
            var isCancelled = row.status === 'cancelled'
            var canCancel = !isCancelled && (isAdmin || (row.collected_by === profile.id && row.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)))
            var canEdit = !isCancelled && (isAdmin || row.collected_by === profile.id)
            var receiptUrl = row.receipt_path ? supabase.storage.from('receipts').getPublicUrl(row.receipt_path).data?.publicUrl : null
            return (
              <div key={row.id} className={"rounded-lg border p-3 " + (isCancelled ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200 bg-white")}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
                      {row.events?.event_name || 'Event ' + row.event_id}
                      {row.events?.client_name ? ' — ' + row.events.client_name : ''}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(row.events?.venue_name || '') + ' · ' + formatDate(row.events?.function_date || row.created_at)}
                    </div>
                    <div className="text-sm mt-1">
                      <span className="font-semibold">{row.plates_issued}</span> plates × ₹{(row.rate_paise / 100).toLocaleString('en-IN')} =
                      <span className={"font-bold ml-1 " + (isCancelled ? "text-gray-500 line-through" : "text-blue-700")}>
                        ₹{(row.total_paise / 100).toLocaleString('en-IN')}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        {row.payment_mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                      </span>
                    </div>
                    {row.notes && <div className="text-xs text-gray-600 mt-1 italic">"{row.notes}"</div>}
                    {isCancelled && (
                      <div className="text-xs text-red-600 mt-1 font-semibold">Cancelled: {row.cancelled_reason || '—'}</div>
                    )}
                    <div className="text-[10px] text-gray-400 mt-1">
                      {formatDate(row.created_at)} · #{row.id.slice(0, 8)}
                    </div>
                  </div>
                  {receiptUrl && (
                    <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-600 font-medium flex-shrink-0">📷</a>
                  )}
                </div>
                {(canEdit || canCancel) && (
                  <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
                    {canEdit && (
                      <button type="button" onClick={function () { openEdit(row) }}
                        className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">Edit</button>
                    )}
                    {canCancel && (
                      <button type="button" onClick={function () { openCancel(row) }}
                        className="text-xs px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 font-medium">Cancel</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ─── CANCEL MODAL ─────────────────────────────────── */}
      {cancelRow && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={function () { if (!cancelSaving) setCancelRow(null) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={function (ev) { ev.stopPropagation() }}>
            <h3 className="text-base font-bold text-gray-900">Cancel Collection</h3>
            <div className="text-sm text-gray-600">
              {cancelRow.plates_issued} plates · ₹{(cancelRow.total_paise / 100).toLocaleString('en-IN')} · {cancelRow.payment_mode}
            </div>
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              Wallet will be debited and event ledger reversed. This cannot be undone.
            </div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</label>
            <input type="text" value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
              placeholder="Why is this being cancelled?"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              style={{ fontSize: '16px' }} />
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={function () { setCancelRow(null) }} disabled={cancelSaving}
                className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl font-semibold">Keep</button>
              <button type="button" onClick={confirmCancel} disabled={cancelSaving || !cancelReason.trim()}
                className="flex-1 py-3 text-sm text-white bg-red-600 rounded-xl disabled:opacity-40 font-semibold">
                {cancelSaving ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── EDIT MODAL ───────────────────────────────────── */}
      {editRow && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={function () { if (!editSaving) setEditRow(null) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={function (ev) { ev.stopPropagation() }}>
            <h3 className="text-base font-bold text-gray-900">Edit Collection</h3>
            <div className="text-xs text-gray-500">
              Only notes and receipt can be edited. To change plates or amount, cancel and re-enter.
            </div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</label>
            <input type="text" value={editNotes} onChange={function (e) { setEditNotes(e.target.value) }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              style={{ fontSize: '16px' }} />
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Replace Receipt (optional)</label>
            {editImage ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {editImage.name}</span>
                <button type="button" onClick={function () { setEditImage(null) }}
                  className="text-xs text-red-500 font-bold">✕</button>
              </div>
            ) : (
              <label className="block w-full py-2 text-center text-xs text-blue-700 border-2 border-dashed border-blue-300 rounded-lg cursor-pointer font-medium">
                📷 Choose new receipt
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={function (e) { if (e.target.files?.[0]) setEditImage(e.target.files[0]); e.target.value = '' }} />
              </label>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={function () { setEditRow(null) }} disabled={editSaving}
                className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl font-semibold">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={editSaving}
                className="flex-1 py-3 text-sm text-white bg-blue-600 rounded-xl disabled:opacity-40 font-semibold">
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExtraPlateCollect