import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate, formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'

var PO_STATUS_LABELS = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  procured: 'Procured',
  partial: 'Partial',
  received: 'Received',
  closed: 'Closed',
}

var PO_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  procured: 'bg-purple-100 text-purple-700',
  partial: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  closed: 'bg-gray-200 text-gray-500',
}

var ITEM_STATUS_COLORS = {
  ordered: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Admin-only PO Dashboard
// ═══════════════════════════════════════════════════════════════
function Purchase({ profile }) {
  var [tab, setTab] = useState('queue')
  var [view, setView] = useState('list')
  var [queueItems, setQueueItems] = useState([])
  var [poList, setPoList] = useState([])
  var [poStatusFilter, setPoStatusFilter] = useState('')
  var [selectedQueue, setSelectedQueue] = useState([])
  var [activePo, setActivePo] = useState(null)
  var [activePoItems, setActivePoItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)

  useEffect(function () {
    loadQueue()
    loadPos()
  }, [])

  useEffect(function () { loadPos() }, [poStatusFilter])

  // ─── QUEUE: approved requisition items not yet in any PO ───
  async function loadQueue() {
    setLoading(true)
    // Fetch requisition items without PO link
    var { data: itemsRaw, error } = await supabase
      .from('requisition_items')
      .select('id, item_id, item_name, category_id, qty, unit, notes, _source, estimated_cost_paise, po_item_id, requisition_id, categories(name)')
      .is('po_item_id', null)
      .order('id', { ascending: false })
      .limit(200)

    if (error) { setQueueItems([]); setLoading(false); return }

    var items = itemsRaw || []
    if (items.length === 0) { setQueueItems([]); setLoading(false); return }

    // Fetch parent requisitions separately (avoids FK hint issues)
    var reqIds = []
    items.forEach(function (it) {
      if (reqIds.indexOf(it.requisition_id) === -1) reqIds.push(it.requisition_id)
    })

    var { data: reqs } = await supabase
      .from('requisitions')
      .select('id, purpose, department, urgency, needed_by, status, requested_by, profiles:requested_by(name)')
      .in('id', reqIds)
      .eq('status', 'approved')

    var reqMap = {}
    ;(reqs || []).forEach(function (r) { reqMap[r.id] = r })

    var filtered = items
      .filter(function (it) { return !!reqMap[it.requisition_id] })
      .map(function (it) { return Object.assign({}, it, { requisitions: reqMap[it.requisition_id] }) })

    setQueueItems(filtered)
    setLoading(false)
  }

  // ─── PO LIST ───
  async function loadPos() {
    var query = supabase
      .from('purchase_orders')
      .select('id, status, notes, created_at, updated_at, profiles:created_by(name)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (poStatusFilter) query = query.eq('status', poStatusFilter)

    var { data } = await query
    setPoList(data || [])
  }

  // ─── OPEN PO DETAIL ───
  async function openPoDetail(po) {
    var { data } = await supabase
      .from('purchase_order_items')
      .select('id, requisition_item_id, item_id, item_name, category_id, _source, qty_ordered, unit, vendor_name, vendor_contact, vendor_rate_paise, estimated_cost_paise, actual_cost_paise, actual_qty, received_by, received_at, status, notes, categories(name)')
      .eq('po_id', po.id)
      .order('created_at')

    setActivePo(po)
    setActivePoItems(data || [])
    setView('detail')
  }

  // ─── TOGGLE QUEUE SELECTION ───
  function toggleQueueItem(id) {
    setSelectedQueue(function (prev) {
      if (prev.indexOf(id) !== -1) return prev.filter(function (x) { return x !== id })
      return prev.concat([id])
    })
  }

  function selectAllQueue() {
    if (selectedQueue.length === queueItems.length) {
      setSelectedQueue([])
    } else {
      setSelectedQueue(queueItems.map(function (q) { return q.id }))
    }
  }

  // ─── CREATE PO FROM SELECTED QUEUE ITEMS ───
  async function createPo() {
    if (saving) return
    if (selectedQueue.length === 0) { alert('Select at least one item'); return }
    setSaving(true)

    try {
      var { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
        created_by: profile.id,
        status: 'draft',
      }).select('id').single()
      if (poErr) throw new Error(poErr.message)

      var selected = queueItems.filter(function (q) { return selectedQueue.indexOf(q.id) !== -1 })
      var poItems = selected.map(function (q) {
        return {
          po_id: po.id,
          requisition_item_id: q.id,
          item_id: q.item_id,
          item_name: q.item_name,
          category_id: q.category_id,
          _source: q._source,
          qty_ordered: q.qty,
          unit: q.unit || 'Pieces',
          estimated_cost_paise: q.estimated_cost_paise || 0,
          status: 'ordered',
        }
      })

      var { data: insertedItems, error: itemErr } = await supabase
        .from('purchase_order_items')
        .insert(poItems)
        .select('id, requisition_item_id')
      if (itemErr) throw new Error(itemErr.message)

      // Link back: set po_item_id on requisition_items
      var updates = (insertedItems || []).map(function (pi) {
        return supabase.from('requisition_items')
          .update({ po_item_id: pi.id })
          .eq('id', pi.requisition_item_id)
      })
      await Promise.allSettled(updates)

      try { await logActivity('PO_CREATE', 'PO created | ' + poItems.length + ' items') } catch (_) {}

      setSelectedQueue([])
      setSaving(false)
      loadQueue()
      loadPos()

      // Open the new PO
      openPoDetail(Object.assign({}, po, { status: 'draft', created_at: new Date().toISOString(), profiles: { name: profile.name } }))
    } catch (err) {
      alert('Failed to create PO: ' + err.message)
      setSaving(false)
    }
  }

  // ─── PO STATUS TRANSITIONS ───
  async function updatePoStatus(poId, newStatus) {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', poId)
    if (error) { alert('Update failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PO_STATUS', 'PO ' + poId.slice(0, 8) + ' → ' + newStatus) } catch (_) {}
    setSaving(false)
    setActivePo(function (prev) { return prev ? Object.assign({}, prev, { status: newStatus }) : prev })
    loadPos()
  }

  // ─── SAVE VENDOR INFO ON PO ITEMS ───
  async function savePoItemVendor(poItemId, vendorName, vendorContact, vendorRatePaise) {
    var updateObj = {
      vendor_name: vendorName || null,
      vendor_contact: vendorContact || null,
      vendor_rate_paise: vendorRatePaise || null,
    }
    if (vendorRatePaise) updateObj.estimated_cost_paise = vendorRatePaise
    var { error } = await supabase.from('purchase_order_items').update(updateObj).eq('id', poItemId)
    if (error) alert('Save failed: ' + error.message)
  }

  // ─── RECEIVE ITEM ───
  async function receiveItem(poItemId, actualQty, actualCostPaise) {
    if (saving) return
    setSaving(true)

    var { error } = await supabase.from('purchase_order_items').update({
      actual_qty: actualQty,
      actual_cost_paise: actualCostPaise,
      received_by: profile.id,
      received_at: new Date().toISOString(),
      status: 'received',
    }).eq('id', poItemId)

    if (error) { alert('Receive failed: ' + error.message); setSaving(false); return }

    // Update local state
    var updatedItems = activePoItems.map(function (p) {
      if (p.id === poItemId) return Object.assign({}, p, { status: 'received', actual_qty: actualQty, actual_cost_paise: actualCostPaise })
      return p
    })
    setActivePoItems(updatedItems)

    // Auto-transition PO status
    if (activePo) {
      var allDone = updatedItems.every(function (p) { return p.status === 'received' || p.status === 'cancelled' })
      var someDone = updatedItems.some(function (p) { return p.status === 'received' })

      if (allDone) {
        await updatePoStatus(activePo.id, 'received')
      } else if (someDone && activePo.status !== 'partial') {
        await updatePoStatus(activePo.id, 'partial')
      }
    }

    try { await logActivity('PO_RECEIVE', 'Item received | PO ' + (activePo?.id || '').slice(0, 8)) } catch (_) {}
    setSaving(false)
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  // ═══════════════════════════════════════════════
  // PO DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && activePo) {
    return (
      <PoDetail
        po={activePo}
        items={activePoItems}
        setItems={setActivePoItems}
        profile={profile}
        saving={saving}
        onBack={function () { setView('list'); setActivePo(null); setActivePoItems([]); loadQueue(); loadPos() }}
        onStatusChange={function (s) { updatePoStatus(activePo.id, s) }}
        onSaveVendor={savePoItemVendor}
        onReceive={receiveItem}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // MAIN TABS: QUEUE | POs
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Purchase Orders</h2>
        {tab === 'queue' && selectedQueue.length > 0 && (
          <button onClick={createPo} disabled={saving}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors">
            {saving ? 'Creating...' : 'Create PO (' + selectedQueue.length + ')'}
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex bg-gray-100 rounded-lg p-0.5">
        <button onClick={function () { setTab('queue') }}
          className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors relative " + (tab === 'queue' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
          Procurement Queue
          {queueItems.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {queueItems.length > 99 ? '99+' : queueItems.length}
            </span>
          )}
        </button>
        <button onClick={function () { setTab('pos') }}
          className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (tab === 'pos' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
          Purchase Orders
        </button>
      </div>

      {/* ═══ QUEUE TAB ═══ */}
      {tab === 'queue' && (
        <div className="space-y-2">
          {queueItems.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">No items awaiting procurement</p>
            </div>
          )}

          {queueItems.length > 0 && (
            <div className="flex items-center gap-2 pb-1">
              <button onClick={selectAllQueue}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                {selectedQueue.length === queueItems.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-[11px] text-gray-400">{selectedQueue.length + ' selected'}</span>
            </div>
          )}

          {queueItems.map(function (q) {
            var isSelected = selectedQueue.indexOf(q.id) !== -1
            var req = q.requisitions || {}
            return (
              <div key={q.id}
                onClick={function () { toggleQueueItem(q.id) }}
                className={"rounded-lg border p-3 transition-colors cursor-pointer " +
                  (isSelected ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200 hover:border-gray-300")}>
                <div className="flex items-start gap-3">
                  <div className={"w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors " +
                    (isSelected ? "bg-indigo-600 border-indigo-600" : "border-gray-300 bg-white")}>
                    {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{titleCase(q.item_name)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {q.categories?.name || '—'} · {q.qty} {q.unit || 'Pcs'} · <span className={"font-medium " + (q._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                        {q._source === 'new' ? 'New Item' : q._source === 'catering_store' ? 'CS' : 'Inventory'}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Req: {req.purpose || '—'} · {req.profiles?.name || '—'} · {req.department || '—'}
                      {req.needed_by ? ' · Need by ' + formatDate(req.needed_by) : ''}
                    </p>
                  </div>
                  {q.estimated_cost_paise > 0 && (
                    <span className="text-[11px] text-gray-500 font-medium flex-shrink-0">~{formatPaise(q.estimated_cost_paise)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ POs TAB ═══ */}
      {tab === 'pos' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {['', 'draft', 'confirmed', 'procured', 'partial', 'received', 'closed'].map(function (s) {
              var label = s ? PO_STATUS_LABELS[s] : 'All'
              return (
                <button key={s} onClick={function () { setPoStatusFilter(s === poStatusFilter ? '' : s) }}
                  className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                    (poStatusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                  {label}
                </button>
              )
            })}
          </div>

          {poList.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">No purchase orders</p>
            </div>
          )}

          {poList.map(function (po) {
            return (
              <div key={po.id} onClick={function () { openPoDetail(po) }}
                className="bg-white rounded-lg border border-gray-200 p-3 hover:border-gray-300 active:bg-gray-50 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">PO #{po.id.slice(0, 8)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {po.profiles?.name || '—'} · {formatDate(po.created_at)}
                      {po.notes ? ' · ' + po.notes : ''}
                    </p>
                  </div>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
                    {PO_STATUS_LABELS[po.status] || po.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PO DETAIL — View items, assign vendors, status transitions, receive
// ═══════════════════════════════════════════════════════════════
function PoDetail({ po, items, setItems, profile, saving, onBack, onStatusChange, onSaveVendor, onReceive }) {
  var [editingVendor, setEditingVendor] = useState(null)
  var [vendorForm, setVendorForm] = useState({ name: '', contact: '', rate: '' })
  var [receivingItem, setReceivingItem] = useState(null)
  var [receiveForm, setReceiveForm] = useState({ qty: '', cost: '' })

  var totalEstPaise = 0
  var totalActualPaise = 0
  items.forEach(function (it) {
    if (it.estimated_cost_paise) totalEstPaise += it.estimated_cost_paise
    if (it.actual_cost_paise) totalActualPaise += it.actual_cost_paise
  })

  var canConfirm = po.status === 'draft' && items.length > 0
  var canMarkProcured = po.status === 'confirmed'
  var canClose = po.status === 'received'

  function startVendorEdit(it) {
    setEditingVendor(it.id)
    setVendorForm({
      name: it.vendor_name || '',
      contact: it.vendor_contact || '',
      rate: it.vendor_rate_paise ? String(it.vendor_rate_paise / 100) : '',
    })
  }

  async function saveVendor(poItemId) {
    var ratePaise = vendorForm.rate ? Math.round(Number(vendorForm.rate) * 100) : null
    await onSaveVendor(poItemId, vendorForm.name.trim(), vendorForm.contact.trim(), ratePaise)
    setItems(function (prev) {
      return prev.map(function (it) {
        if (it.id !== poItemId) return it
        return Object.assign({}, it, {
          vendor_name: vendorForm.name.trim() || null,
          vendor_contact: vendorForm.contact.trim() || null,
          vendor_rate_paise: ratePaise,
          estimated_cost_paise: ratePaise || it.estimated_cost_paise,
        })
      })
    })
    setEditingVendor(null)
  }

  function startReceive(it) {
    setReceivingItem(it.id)
    setReceiveForm({
      qty: String(it.qty_ordered),
      cost: it.estimated_cost_paise ? String(it.estimated_cost_paise / 100) : '',
    })
  }

  async function confirmReceive(poItemId) {
    var actualQty = Number(receiveForm.qty)
    var actualCostPaise = Math.round(Number(receiveForm.cost) * 100)
    if (!actualQty || actualQty <= 0) { alert('Enter received qty'); return }
    if (!actualCostPaise || actualCostPaise <= 0) { alert('Enter actual cost'); return }
    await onReceive(poItemId, actualQty, actualCostPaise)
    setReceivingItem(null)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
          {PO_STATUS_LABELS[po.status] || po.status}
        </span>
      </div>

      {/* PO info */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <p className="text-sm font-bold text-gray-800">PO #{po.id.slice(0, 8)}</p>
        <div className="text-[11px] text-gray-400 space-y-0.5">
          <p>Created by: {po.profiles?.name || '—'} · {formatDate(po.created_at)}</p>
          {po.notes && <p>Notes: {po.notes}</p>}
        </div>
        <div className="flex gap-4 pt-1">
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Estimated</p>
            <p className="text-sm font-bold text-gray-700">{formatPaise(totalEstPaise)}</p>
          </div>
          {totalActualPaise > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase">Actual</p>
              <p className="text-sm font-bold text-green-700">{formatPaise(totalActualPaise)}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Items</p>
            <p className="text-sm font-bold text-gray-700">{items.length}</p>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length + ' Item' + (items.length !== 1 ? 's' : '')}</h3>
        {items.map(function (it) {
          var isEditingVendor = editingVendor === it.id
          var isReceiving = receivingItem === it.id

          return (
            <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{titleCase(it.item_name)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {it.categories?.name || '—'} · {it.qty_ordered} {it.unit} · <span className={"font-medium " + (it._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                      {it._source === 'new' ? 'New' : it._source === 'catering_store' ? 'CS' : 'INV'}
                    </span>
                  </p>
                </div>
                <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (ITEM_STATUS_COLORS[it.status] || '')}>
                  {it.status}
                </span>
              </div>

              {/* Vendor info display */}
              {it.vendor_name && !isEditingVendor && (
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-[11px] text-gray-600">
                    <span className="font-medium">Vendor:</span> {it.vendor_name}
                    {it.vendor_contact ? ' · ' + it.vendor_contact : ''}
                    {it.vendor_rate_paise ? ' · Rate: ' + formatPaise(it.vendor_rate_paise) : ''}
                  </p>
                </div>
              )}

              {/* Cost display */}
              <div className="flex gap-3 text-[11px]">
                {it.estimated_cost_paise > 0 && <span className="text-gray-500">Est: {formatPaise(it.estimated_cost_paise)}</span>}
                {it.actual_cost_paise > 0 && <span className="text-green-600 font-medium">Actual: {formatPaise(it.actual_cost_paise)}</span>}
              </div>

              {it.notes && <p className="text-[11px] text-gray-400">{it.notes}</p>}

              {/* Vendor edit form */}
              {isEditingVendor && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-blue-700 uppercase">Assign Vendor</p>
                  <input type="text" value={vendorForm.name}
                    onChange={function (e) { setVendorForm(function (p) { return Object.assign({}, p, { name: e.target.value }) }) }}
                    placeholder="Vendor name" maxLength="200"
                    className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ fontSize: '16px' }} />
                  <input type="text" value={vendorForm.contact}
                    onChange={function (e) { setVendorForm(function (p) { return Object.assign({}, p, { contact: e.target.value }) }) }}
                    placeholder="Contact / phone" maxLength="100"
                    className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ fontSize: '16px' }} />
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={vendorForm.rate}
                    onChange={function (e) { setVendorForm(function (p) { return Object.assign({}, p, { rate: e.target.value }) }) }}
                    placeholder="Rate per unit (₹)"
                    className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <div className="flex gap-2">
                    <button onClick={function () { setEditingVendor(null) }}
                      className="flex-1 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                    <button onClick={function () { saveVendor(it.id) }}
                      className="flex-1 py-1.5 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">Save</button>
                  </div>
                </div>
              )}

              {/* Receive form */}
              {isReceiving && (
                <div className="bg-green-50 rounded-lg border border-green-200 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-green-700 uppercase">Receive Item</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Qty Received</label>
                      <input type="number" min="0" step="any" inputMode="decimal" value={receiveForm.qty}
                        onChange={function (e) { setReceiveForm(function (p) { return Object.assign({}, p, { qty: e.target.value }) }) }}
                        className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Actual Cost (₹)</label>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={receiveForm.cost}
                        onChange={function (e) { setReceiveForm(function (p) { return Object.assign({}, p, { cost: e.target.value }) }) }}
                        className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function () { setReceivingItem(null) }}
                      className="flex-1 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                    <button onClick={function () { confirmReceive(it.id) }} disabled={saving}
                      className="flex-1 py-1.5 text-xs text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors">
                      {saving ? 'Saving...' : 'Confirm Received'}
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons per item */}
              {it.status === 'ordered' && !isEditingVendor && !isReceiving && (
                <div className="flex gap-2">
                  <button onClick={function (e) { e.stopPropagation(); startVendorEdit(it) }}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors">
                    {it.vendor_name ? '✎ Edit Vendor' : '+ Assign Vendor'}
                  </button>
                  {(po.status === 'procured' || po.status === 'partial') && (
                    <button onClick={function (e) { e.stopPropagation(); startReceive(it) }}
                      className="text-[11px] font-medium text-green-600 hover:text-green-800 transition-colors">
                      ✓ Receive
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* PO-level actions */}
      <div className="space-y-2">
        {canConfirm && (
          <button onClick={function () { onStatusChange('confirmed') }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Confirming...' : 'Confirm PO'}
          </button>
        )}
        {canMarkProcured && (
          <button onClick={function () { onStatusChange('procured') }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
            {saving ? 'Updating...' : 'Mark as Procured'}
          </button>
        )}
        {canClose && (
          <button onClick={function () { onStatusChange('closed') }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {saving ? 'Closing...' : 'Close PO'}
          </button>
        )}
      </div>
    </div>
  )
}

export default Purchase
