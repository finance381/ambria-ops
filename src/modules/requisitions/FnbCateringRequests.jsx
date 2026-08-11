import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import { pushBack, goBack as navBack } from '../../lib/backNav'

var STATUS_COLORS = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  purchasing: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-purple-100 text-purple-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

var STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  purchasing: 'Purchasing',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
}

function FnbCateringRequests({ profile }) {
  var [view, setView] = useState('list')
  var [reqs, setReqs] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [statusFilter, setStatusFilter] = useState('pending')
  var [detailReq, setDetailReq] = useState(null)
  var [detailItems, setDetailItems] = useState([])
  var [venueMap, setVenueMap] = useState({})
  var [cancelReason, setCancelReason] = useState('')
  var [showCancel, setShowCancel] = useState(false)
  var [spawnResult, setSpawnResult] = useState(null)

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  useRealtime(['catering_requisitions', 'catering_requisition_items'], function () {
    if (!saving) { loadReqs() }
  })

  useEffect(function () {
    supabase.from('venues').select('id, code, name').eq('active', true)
      .then(function (r) {
        var m = {}
        ;(r.data || []).forEach(function (v) { m[v.id] = v })
        setVenueMap(m)
      })
  }, [])

  useEffect(function () { loadReqs() }, [statusFilter])

  async function loadReqs() {
    setLoading(true)
    var q = supabase.from('catering_requisitions')
      .select('id, venue_id, requested_by, requested_by_name, event_ids, event_summary, needed_by, status, notes, requested_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (statusFilter) { q = q.eq('status', statusFilter) }
    var { data } = await q
    setReqs(data || [])
    setLoading(false)
  }

  async function openDetail(req) {
    if (saving) return
    setSaving(true)
    var { data } = await supabase.from('catering_requisition_items')
      .select('id, ops_inventory_id, item_name, item_name_hindi, category_name, qty_requested, unit, qty_received, status, notes, created_at')
      .eq('requisition_id', req.id)
      .order('created_at')
    pushBack(function () { setView('list'); setDetailReq(null); setDetailItems([]); setSpawnResult(null); loadReqs() })
    setDetailReq(req)
    setDetailItems(data || [])
    setSpawnResult(null)
    setView('detail')
    setSaving(false)
  }

  async function approve(req) {
    if (saving) return
    if (!confirm('Approve this catering requisition? It will be ready to spawn a PO.')) return
    setSaving(true)
    var { error } = await supabase.rpc('catering_requisition_transition', {
      p_req_id: req.id,
      p_new_status: 'approved',
      p_actor: profile.id,
      p_notes: null,
    })
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    try { await logActivity('FNB_REQ_APPROVE', 'Catering req ' + req.id.slice(0, 8) + ' approved') } catch (_) {}
    setDetailReq(Object.assign({}, req, { status: 'approved' }))
    await loadReqs()
    setSaving(false)
  }

  async function spawnPo(req) {
    if (saving) return
    if (!confirm('Spawn PO from this catering requisition? Items will move into the Purchase queue.')) return
    setSaving(true)
    var { data, error } = await supabase.rpc('fn_catering_requisition_spawn_po', {
      p_req_id: req.id,
      p_actor: profile.id,
    })
    if (error) { alert('Spawn failed: ' + error.message); setSaving(false); return }
    try { await logActivity('FNB_REQ_SPAWN_PO', 'Catering req ' + req.id.slice(0, 8) + ' → PO ' + (data?.po_id || '').slice(0, 8)) } catch (_) {}
    setSpawnResult(data || null)
    setDetailReq(Object.assign({}, req, { status: 'purchasing' }))
    await loadReqs()
    setSaving(false)
  }

  async function submitCancel(req) {
    if (saving) return
    if (!cancelReason.trim()) { alert('Reason required'); return }
    setSaving(true)
    var { error } = await supabase.rpc('catering_requisition_transition', {
      p_req_id: req.id,
      p_new_status: 'cancelled',
      p_actor: profile.id,
      p_notes: cancelReason.trim(),
    })
    if (error) { alert('Cancel failed: ' + error.message); setSaving(false); return }
    try { await logActivity('FNB_REQ_CANCEL', 'Catering req ' + req.id.slice(0, 8) + ' cancelled: ' + cancelReason.trim()) } catch (_) {}
    setShowCancel(false)
    setCancelReason('')
    setDetailReq(Object.assign({}, req, { status: 'cancelled' }))
    await loadReqs()
    setSaving(false)
  }

  function renderVenue(vid) {
    var v = venueMap[vid]
    if (!v) return '—'
    return v.code + (v.name && v.name !== 'VENUE' && v.name !== 'VENU' ? ' · ' + v.name : '')
  }

  // ─── DETAIL VIEW ───
  if (view === 'detail' && detailReq) {
    var canApprove = isAdmin && detailReq.status === 'pending'
    var canSpawn = isAdmin && detailReq.status === 'approved'
    var canCancel = isAdmin && (detailReq.status === 'pending' || detailReq.status === 'approved')

    return (
      <div className="space-y-3">
        <button onClick={function () { navBack() }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>

        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold text-gray-900">FnB Req #{detailReq.id.slice(0, 8)}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {renderVenue(detailReq.venue_id)} · Requested by {detailReq.requested_by_name || detailReq.requested_by || '—'}
              </p>
            </div>
            <span className={'px-2 py-0.5 text-[10px] font-bold rounded-full ' + (STATUS_COLORS[detailReq.status] || 'bg-gray-100 text-gray-500')}>
              {STATUS_LABELS[detailReq.status] || detailReq.status}
            </span>
          </div>
          {detailReq.event_summary && (
            <p className="text-xs text-gray-600 mt-1">📌 {detailReq.event_summary}</p>
          )}
          {detailReq.needed_by && (
            <p className="text-xs text-gray-500 mt-1">Needed by: <strong>{formatDate(detailReq.needed_by)}</strong></p>
          )}
          {detailReq.notes && (
            <p className="text-xs text-gray-500 mt-1 italic">"{detailReq.notes}"</p>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Created {formatDate(detailReq.created_at)}</p>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-700">Items ({detailItems.length})</p>
          </div>
          {detailItems.length === 0 && (
            <p className="p-4 text-center text-xs text-gray-400">No items</p>
          )}
          {detailItems.map(function (it) {
            var qtyRec = Number(it.qty_received || 0)
            var qtyReq = Number(it.qty_requested || 0)
            var pctRec = qtyReq > 0 ? Math.min(100, Math.round((qtyRec / qtyReq) * 100)) : 0
            return (
              <div key={it.id} className="px-3 py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{titleCase(it.item_name || '')}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {qtyReq} {it.unit || ''}
                      {qtyRec > 0 && (<span className="ml-2 text-green-600">({qtyRec} received · {pctRec}%)</span>)}
                      {it.ops_inventory_id && (<span className="ml-2 text-gray-400">[{it.ops_inventory_id}]</span>)}
                      {!it.ops_inventory_id && (<span className="ml-2 text-red-500">[unmapped]</span>)}
                    </p>
                    {it.category_name && (<p className="text-[10px] text-gray-400 mt-0.5">{it.category_name}</p>)}
                    {it.notes && (<p className="text-[10px] text-gray-500 italic mt-0.5">"{it.notes}"</p>)}
                  </div>
                  <span className={'px-1.5 py-0.5 text-[9px] font-bold rounded ' + (STATUS_COLORS[it.status] || 'bg-gray-100 text-gray-500')}>
                    {STATUS_LABELS[it.status] || it.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Spawn result */}
        {spawnResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs font-bold text-blue-800">PO Spawned</p>
            <p className="text-[11px] text-blue-700 mt-1">
              PO ID: <span className="font-mono">{(spawnResult.po_id || '').slice(0, 8)}</span> ·
              Items: <strong>{spawnResult.items_created}</strong>
            </p>
            {Array.isArray(spawnResult.items_skipped) && spawnResult.items_skipped.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-bold text-amber-800">Skipped ({spawnResult.items_skipped.length}):</p>
                {spawnResult.items_skipped.map(function (s, idx) {
                  return (
                    <p key={idx} className="text-[10px] text-amber-700 mt-0.5">
                      • {s.item_name || s.ops_inventory_id || '?'} — {s.reason}
                    </p>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {(canApprove || canSpawn || canCancel) && (
          <div className="flex gap-2 sticky bottom-0 bg-gray-50 p-2 -mx-2 border-t border-gray-200">
            {canApprove && (
              <button onClick={function () { approve(detailReq) }} disabled={saving}
                className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {saving ? '...' : '✓ Approve'}
              </button>
            )}
            {canSpawn && (
              <button onClick={function () { spawnPo(detailReq) }} disabled={saving}
                className="flex-1 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40">
                {saving ? '...' : '🛒 Spawn PO'}
              </button>
            )}
            {canCancel && (
              <button onClick={function () { setShowCancel(true) }} disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40">
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Cancel modal */}
        {showCancel && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-4 w-full max-w-sm">
              <p className="text-sm font-bold text-gray-900 mb-2">Cancel Requisition</p>
              <p className="text-xs text-gray-500 mb-3">This notifies FnB. Reason required.</p>
              <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
                placeholder="Reason for cancellation..." rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" style={{ fontSize: '16px' }} />
              <div className="flex gap-2 mt-3">
                <button onClick={function () { setShowCancel(false); setCancelReason('') }} disabled={saving}
                  className="flex-1 py-2 text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg">
                  Back
                </button>
                <button onClick={function () { submitCancel(detailReq) }} disabled={saving || !cancelReason.trim()}
                  className="flex-1 py-2 text-sm font-bold text-white bg-red-600 rounded-lg disabled:opacity-40">
                  {saving ? '...' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── LIST VIEW ───
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">FnB Catering Requests</h2>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {['pending', 'approved', 'purchasing', 'partially_received', 'received', 'cancelled', ''].map(function (s) {
          var label = s ? STATUS_LABELS[s] : 'All'
          return (
            <button key={s || 'all'} onClick={function () { setStatusFilter(s) }}
              className={'px-3 py-1.5 text-[11px] font-bold rounded-full border whitespace-nowrap transition-colors ' +
                (statusFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
              {label}
            </button>
          )
        })}
      </div>

      {loading && (<p className="text-gray-400 text-sm text-center py-8">Loading...</p>)}

      {!loading && reqs.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-400 text-sm">No requisitions{statusFilter ? ' in this status' : ''}</p>
        </div>
      )}

      {!loading && reqs.map(function (req) {
        return (
          <div key={req.id} onClick={function () { openDetail(req) }}
            className="bg-white rounded-lg border border-gray-200 p-3 hover:border-gray-300 active:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  {renderVenue(req.venue_id)} · <span className="text-gray-500 font-normal">#{req.id.slice(0, 8)}</span>
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {req.requested_by_name || req.requested_by || '—'}
                  {req.needed_by && (<span className="ml-2">· need {formatDate(req.needed_by)}</span>)}
                </p>
                {req.event_summary && (
                  <p className="text-[11px] text-gray-600 mt-0.5 truncate">📌 {req.event_summary}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">{formatDate(req.created_at)}</p>
              </div>
              <span className={'px-2 py-0.5 text-[10px] font-bold rounded-full ml-2 shrink-0 ' + (STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500')}>
                {STATUS_LABELS[req.status] || req.status}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default FnbCateringRequests