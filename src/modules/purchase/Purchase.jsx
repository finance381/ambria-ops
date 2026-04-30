import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate, formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import InventoryForm from '../inventory/InventoryForm'

var PO_STATUS_LABELS = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  completed: 'Completed',
  closed: 'Closed',
}

var PO_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  closed: 'bg-gray-200 text-gray-500',
}

var ITEM_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  purchased: 'bg-green-100 text-green-700',
  received: 'bg-indigo-100 text-indigo-700',
  cancelled: 'bg-red-100 text-red-600',
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
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
  var [staffList, setStaffList] = useState([])
  var [receivingItems, setReceivingItems] = useState([])
  var [receivingLoading, setReceivingLoading] = useState(false)
  var [receivingItem, setReceivingItem] = useState(null)
  var [receiveQty, setReceiveQty] = useState('')
  var [showInvForm, setShowInvForm] = useState(null)

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var hasReceive = (profile?.permissions || []).indexOf('feature_receive') !== -1
  var isReceiver = hasReceive && !isAdmin
  var isPurchaser = !isAdmin && !isReceiver

  useEffect(function () {
    if (isAdmin) {
      loadQueue()
      loadStaff()
      loadReceiving()
    }
    if (isReceiver) {
      loadReceiving()
    }
    if (!isReceiver) {
      loadPos()
    }
  }, [])

  useEffect(function () { loadPos() }, [poStatusFilter])

  // ─── QUEUE: approved requisition items not yet in any PO ───
  async function loadQueue() {
    setLoading(true)
    var { data: itemsRaw, error } = await supabase
      .from('requisition_items')
      .select('id, item_id, item_name, category_id, qty, unit, notes, _source, estimated_cost_paise, po_item_id, requisition_id, categories(name)')
      .is('po_item_id', null)
      .order('id', { ascending: false })
      .limit(200)

    if (error) { setQueueItems([]); setLoading(false); return }

    var items = itemsRaw || []
    if (items.length === 0) { setQueueItems([]); setLoading(false); return }

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
      .select('id, status, notes, assigned_to, created_at, updated_at, profiles:created_by(name), assignee:assigned_to(name)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (poStatusFilter) query = query.eq('status', poStatusFilter)

    // Purchaser only sees assigned POs
    if (isPurchaser) {
      query = query.eq('assigned_to', profile.id)
    }

    var { data, error } = await query
    if (error) {
      // FK hint fallback for assigned_to
      var fallbackQuery = supabase
        .from('purchase_orders')
        .select('id, status, notes, assigned_to, created_at, updated_at, profiles:created_by(name)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (poStatusFilter) fallbackQuery = fallbackQuery.eq('status', poStatusFilter)
      if (isPurchaser) fallbackQuery = fallbackQuery.eq('assigned_to', profile.id)
      var { data: fbData } = await fallbackQuery
      setPoList(fbData || [])
    } else {
      setPoList(data || [])
    }
    setLoading(false)
  }

  // ─── STAFF LIST for assigning purchaser ───
  async function loadStaff() {
    var { data } = await supabase
      .from('profiles')
      .select('id, name, role, permissions')
      .eq('active', true)
      .order('name')
    var purchasers = (data || []).filter(function (s) {
      return (s.permissions || []).indexOf('feature_purchase') !== -1
    })
    setStaffList(purchasers)
  }
  // ─── RECEIVING: load purchased items awaiting receive ───
  async function loadReceiving() {
    setReceivingLoading(true)
    var { data, error } = await supabase
      .from('purchase_order_items')
      .select('id, po_id, item_id, item_name, category_id, _source, qty_ordered, actual_qty, unit, vendor_name, vendor_rate_paise, actual_cost_paise, status, purchased_by, purchased_at, categories(name)')
      .eq('status', 'purchased')
      .order('purchased_at', { ascending: true })
      .limit(200)
    if (error) {
      // FK hint fallback — retry without categories join
      var { data: fb } = await supabase
        .from('purchase_order_items')
        .select('id, po_id, item_id, item_name, category_id, _source, qty_ordered, actual_qty, unit, vendor_name, vendor_rate_paise, actual_cost_paise, status, purchased_by, purchased_at')
        .eq('status', 'purchased')
        .order('purchased_at', { ascending: true })
        .limit(200)
      data = fb || []
      if (!fb) { setReceivingItems([]); setReceivingLoading(false); return }
    }
    // Fetch PO info for context
    var poIds = []
    ;(data || []).forEach(function (it) { if (poIds.indexOf(it.po_id) === -1) poIds.push(it.po_id) })
    var poMap = {}
    if (poIds.length > 0) {
      var { data: pos } = await supabase
        .from('purchase_orders')
        .select('id, notes, created_at, profiles:created_by(name)')
        .in('id', poIds)
      ;(pos || []).forEach(function (p) { poMap[p.id] = p })
    }
    setReceivingItems((data || []).map(function (it) { return Object.assign({}, it, { po: poMap[it.po_id] || null }) }))
    setReceivingLoading(false)
  }

  // ─── RECEIVE EXISTING ITEM (qty bump via trigger) ───
  async function receiveExistingItem(poItem) {
    if (saving) return
    var qtyReceived = Number(receiveQty)
    if (!qtyReceived || qtyReceived <= 0) { alert('Enter valid qty'); return }
    setSaving(true)
    var { error } = await supabase.from('purchase_order_items').update({
      actual_qty: qtyReceived,
      received_by: profile.id,
      received_at: new Date().toISOString(),
      status: 'received',
    }).eq('id', poItem.id)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PO_ITEM_RECEIVED', titleCase(poItem.item_name) + ' | qty: ' + qtyReceived + ' | existing ' + poItem._source) } catch (_) {}
    setReceivingItem(null)
    setReceiveQty('')
    setSaving(false)
    loadReceiving()
  }

  // ─── RECEIVE NEW ITEM — callback after InventoryForm saves ───
  async function receiveNewDone(savedItem, tableName) {
    if (!showInvForm || !savedItem?.id) { setShowInvForm(null); return }
    var poItem = showInvForm
    var linkCol = tableName === 'catering_store_items' ? 'cs_item_id' : 'inventory_item_id'
    var { error } = await supabase.from('purchase_order_items').update({
      [linkCol]: savedItem.id,
      received_by: profile.id,
      received_at: new Date().toISOString(),
      status: 'received',
    }).eq('id', poItem.id)
    if (error) { alert('Receive link failed: ' + error.message) }
    try { await logActivity('PO_ITEM_RECEIVED', titleCase(poItem.item_name) + ' | new item → ' + tableName + ' #' + savedItem.id) } catch (_) {}
    setShowInvForm(null)
    loadReceiving()
  }

  // ─── OPEN PO DETAIL ───
  async function openPoDetail(po) {
    var { data } = await supabase
      .from('purchase_order_items')
      .select('id, requisition_item_id, item_id, item_name, category_id, _source, qty_ordered, unit, vendor_name, vendor_contact, vendor_rate_paise, estimated_cost_paise, actual_cost_paise, actual_qty, purchased_by, purchased_at, received_by, received_at, inventory_item_id, cs_item_id, status, notes, receipt_path, categories(name)')
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
          status: 'pending',
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

      openPoDetail(Object.assign({}, po, { status: 'draft', created_at: new Date().toISOString(), profiles: { name: profile.name } }))
    } catch (err) {
      alert('Failed to create PO: ' + err.message)
      setSaving(false)
    }
  }

  // ─── PO STATUS TRANSITIONS (admin only) ───
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

  // ─── ASSIGN PURCHASER (admin only) ───
  async function assignPurchaser(poId, userId) {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('purchase_orders').update({ assigned_to: userId || null }).eq('id', poId)
    if (error) { alert('Assign failed: ' + error.message); setSaving(false); return }
    var staff = staffList.find(function (s) { return s.id === userId })
    try { await logActivity('PO_ASSIGN', 'PO ' + poId.slice(0, 8) + ' → ' + (staff?.name || 'unassigned')) } catch (_) {}
    setActivePo(function (prev) { return prev ? Object.assign({}, prev, { assigned_to: userId }) : prev })
    setSaving(false)
    loadPos()
  }

  // ─── DELETE DRAFT PO (admin only) ───
  async function deletePo(poId) {
    if (saving) return
    setSaving(true)
    // Unlink requisition items first
    var { data: poItems } = await supabase.from('purchase_order_items').select('id').eq('po_id', poId)
    var poItemIds = (poItems || []).map(function (p) { return p.id })
    if (poItemIds.length > 0) {
      await supabase.from('requisition_items').update({ po_item_id: null }).in('po_item_id', poItemIds)
    }
    // Delete PO items then PO
    await supabase.from('purchase_order_items').delete().eq('po_id', poId)
    var { error } = await supabase.from('purchase_orders').delete().eq('id', poId)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PO_DELETE', 'Draft PO ' + poId.slice(0, 8) + ' deleted | ' + poItemIds.length + ' items returned to queue') } catch (_) {}
    setSaving(false)
    setView('list')
    setActivePo(null)
    setActivePoItems([])
    loadQueue()
    loadPos()
  }

  // ─── REMOVE SINGLE ITEM FROM DRAFT PO ───
  async function removePoItem(poId, poItemId) {
    if (saving) return
    setSaving(true)
    // Unlink requisition item
    await supabase.from('requisition_items').update({ po_item_id: null }).match({ po_item_id: poItemId })
    // Delete PO item
    var { error } = await supabase.from('purchase_order_items').delete().eq('id', poItemId)
    if (error) { alert('Remove failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PO_ITEM_REMOVE', 'Item removed from PO ' + poId.slice(0, 8)) } catch (_) {}
    // Update local state
    var remaining = activePoItems.filter(function (it) { return it.id !== poItemId })
    setActivePoItems(remaining)
    setSaving(false)
    // If no items left, delete the PO
    if (remaining.length === 0) { deletePo(poId) }
  }

  // ─── SAVE VENDOR INFO (admin on draft/confirmed) ───
  async function savePoItemVendor(poItemId, vendorName, vendorContact, vendorRatePaise, estTotal) {
    var updateObj = {
      vendor_name: vendorName || null,
      vendor_contact: vendorContact || null,
      vendor_rate_paise: vendorRatePaise || null,
    }
    if (estTotal) updateObj.estimated_cost_paise = estTotal
    var { error } = await supabase.from('purchase_order_items').update(updateObj).eq('id', poItemId)
    if (error) alert('Save failed: ' + error.message)
  }

  // ─── MARK ITEM PURCHASED (purchaser) ───
  async function markPurchased(poItemId, actualQty, actualCostPaise, receiptFile) {
    if (saving) return
    setSaving(true)

    // Upload receipt if provided
    var receiptPath = null
    if (receiptFile) {
      var ext = receiptFile.name.split('.').pop()
      var fileName = profile.id + '/po-' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(fileName, receiptFile)
      if (!upErr) receiptPath = fileName
    }

    var updateObj = {
      actual_qty: actualQty,
      actual_cost_paise: actualCostPaise,
      purchased_by: profile.id,
      purchased_at: new Date().toISOString(),
      status: 'purchased',
    }
    if (receiptPath) updateObj.receipt_path = receiptPath

    var { error } = await supabase.from('purchase_order_items').update(updateObj).eq('id', poItemId)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Update local state
    var updatedItems = activePoItems.map(function (p) {
      if (p.id === poItemId) return Object.assign({}, p, updateObj)
      return p
    })
    setActivePoItems(updatedItems)

    // Check if all items done — trigger auto-completes in DB, just update local state
    if (activePo) {
      var allDone = updatedItems.every(function (p) { return p.status === 'purchased' || p.status === 'cancelled' })
      if (allDone) {
        setActivePo(function (prev) { return prev ? Object.assign({}, prev, { status: 'completed' }) : prev })
        try { await logActivity('PO_COMPLETE', 'PO ' + (activePo?.id || '').slice(0, 8) + ' auto-completed') } catch (_) {}
      }
    }

    try { await logActivity('PO_ITEM_PURCHASED', titleCase(activePoItems.find(function (p) { return p.id === poItemId })?.item_name || '') + ' | ₹' + (actualCostPaise / 100)) } catch (_) {}
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
        isAdmin={isAdmin}
        staffList={staffList}
        saving={saving}
        onBack={function () { setView('list'); setActivePo(null); setActivePoItems([]); if (isAdmin) loadQueue(); loadPos() }}
        onStatusChange={updatePoStatus}
        onAssign={assignPurchaser}
        onSaveVendor={savePoItemVendor}
        onMarkPurchased={markPurchased}
        onDeletePo={deletePo}
        onRemoveItem={removePoItem}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // RECEIVER VIEW — only Receiving tab
  // ═══════════════════════════════════════════════
  if (isReceiver) {
    // InventoryForm overlay for new items
    if (showInvForm) {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={function () { setShowInvForm(null) }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <h2 className="text-lg font-bold text-gray-900">Add New Item to Inventory</h2>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            <p className="text-[11px] text-amber-700">Receiving <strong>{titleCase(showInvForm.item_name)}</strong> — fill item details below. Category, name, qty, unit and rate are pre-filled from PO.</p>
          </div>
          <InventoryForm
            item={null}
            prefill={{
              name: showInvForm.item_name,
              category_id: showInvForm.category_id,
              qty: showInvForm.actual_qty || showInvForm.qty_ordered,
              unit: showInvForm.unit,
              rate_paise: showInvForm.vendor_rate_paise || 0,
            }}
            profile={profile}
            onClose={function () { setShowInvForm(null) }}
            onSaved={function (savedItem, tableName) { receiveNewDone(savedItem, tableName) }}
          />
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Receive Items</h2>
        {receivingLoading && <p className="text-gray-400 text-sm text-center py-8">Loading...</p>}
        {!receivingLoading && receivingItems.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">No items awaiting receiving</p>
          </div>
        )}
        {receivingItems.map(function (it) {
          var isActive = receivingItem === it.id
          return (
            <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{titleCase(it.item_name)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {it.categories?.name || '—'} · Ordered: {it.qty_ordered} {it.unit}
                    {it.actual_qty ? ' · Bought: ' + it.actual_qty : ''}
                    {' · '}<span className={"font-medium " + (it._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                      {it._source === 'new' ? 'New Item' : it._source === 'catering_store' ? 'Catering Store' : 'Inventory'}
                    </span>
                  </p>
                  {it.vendor_name && <p className="text-[11px] text-gray-400">Vendor: {it.vendor_name}</p>}
                  {it.po && <p className="text-[11px] text-gray-400">PO #{it.po_id.slice(0, 8)} · {it.po.profiles?.name || '—'} · {formatDate(it.po.created_at)}</p>}
                </div>
              </div>

              {/* Receive action — existing item */}
              {it._source !== 'new' && !isActive && (
                <button onClick={function () { setReceivingItem(it.id); setReceiveQty(String(it.actual_qty || it.qty_ordered)) }}
                  className="w-full py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                  📦 Receive Item
                </button>
              )}
              {it._source !== 'new' && isActive && (
                <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-3 space-y-2">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-0.5">Qty Received</label>
                    <input type="number" min="0" step="any" inputMode="numeric" value={receiveQty}
                      onChange={function (e) { setReceiveQty(e.target.value) }}
                      className="w-full px-3 py-2 border border-indigo-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function () { setReceivingItem(null); setReceiveQty('') }}
                      className="flex-1 py-2 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                    <button onClick={function () { receiveExistingItem(it) }} disabled={saving}
                      className="flex-1 py-2 text-xs text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {saving ? 'Saving...' : '✓ Confirm Received'}
                    </button>
                  </div>
                </div>
              )}

              {/* Receive action — new item */}
              {it._source === 'new' && (
                <button onClick={function () { setShowInvForm(it) }}
                  className="w-full py-2 text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
                  📋 Receive & Add to Inventory
                </button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // PURCHASER VIEW — only assigned POs
  // ═══════════════════════════════════════════════
  if (isPurchaser) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900">My Purchase Orders</h2>

        {poList.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">No purchase orders assigned to you</p>
          </div>
        )}

        {poList.map(function (po) {
          return (
            <div key={po.id} onClick={function () { openPoDetail(po) }}
              className="bg-white rounded-lg border border-gray-200 p-3 hover:border-gray-300 active:bg-gray-50 transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">PO #{po.id.slice(0, 8)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(po.created_at)}{po.notes ? ' · ' + po.notes : ''}</p>
                </div>
                <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
                  {PO_STATUS_LABELS[po.status] || po.status}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // ADMIN VIEW — QUEUE + POs
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
        <button onClick={function () { setTab('receiving') }}
          className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors relative " + (tab === 'receiving' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
          Receiving
          {receivingItems.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {receivingItems.length > 99 ? '99+' : receivingItems.length}
            </span>
          )}
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
            {['', 'draft', 'confirmed', 'completed', 'closed'].map(function (s) {
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
            var assigneeName = po.assignee?.name || null
            return (
              <div key={po.id} onClick={function () { openPoDetail(po) }}
                className="bg-white rounded-lg border border-gray-200 p-3 hover:border-gray-300 active:bg-gray-50 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">PO #{po.id.slice(0, 8)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {po.profiles?.name || '—'} · {formatDate(po.created_at)}
                      {assigneeName ? ' · 🛒 ' + assigneeName : ''}
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

      {/* ═══ RECEIVING TAB (Admin) ═══ */}
      {tab === 'receiving' && (
        <div className="space-y-3">
          {showInvForm && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={function () { setShowInvForm(null) }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
                <h3 className="text-sm font-bold text-gray-900">Add New Item to Inventory</h3>
              </div>
              <InventoryForm
                item={null}
                prefill={{
                  name: showInvForm.item_name,
                  category_id: showInvForm.category_id,
                  qty: showInvForm.actual_qty || showInvForm.qty_ordered,
                  unit: showInvForm.unit,
                  rate_paise: showInvForm.vendor_rate_paise || 0,
                }}
                profile={profile}
                onClose={function () { setShowInvForm(null) }}
                onSaved={function (savedItem, tableName) { receiveNewDone(savedItem, tableName) }}
              />
            </div>
          )}
          {!showInvForm && receivingLoading && <p className="text-gray-400 text-sm text-center py-8">Loading...</p>}
          {!showInvForm && !receivingLoading && receivingItems.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">No items awaiting receiving</p>
            </div>
          )}
          {!showInvForm && receivingItems.map(function (it) {
            var isActive = receivingItem === it.id
            return (
              <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{titleCase(it.item_name)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {it.categories?.name || '—'} · Ordered: {it.qty_ordered} {it.unit}
                      {it.actual_qty ? ' · Bought: ' + it.actual_qty : ''}
                      {' · '}<span className={"font-medium " + (it._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                        {it._source === 'new' ? 'New Item' : it._source === 'catering_store' ? 'CS' : 'INV'}
                      </span>
                    </p>
                    {it.vendor_name && <p className="text-[11px] text-gray-400">Vendor: {it.vendor_name}</p>}
                    {it.po && <p className="text-[11px] text-gray-400">PO #{it.po_id.slice(0, 8)} · {it.po.profiles?.name || '—'}</p>}
                  </div>
                </div>
                {it._source !== 'new' && !isActive && (
                  <button onClick={function () { setReceivingItem(it.id); setReceiveQty(String(it.actual_qty || it.qty_ordered)) }}
                    className="w-full py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                    📦 Receive
                  </button>
                )}
                {it._source !== 'new' && isActive && (
                  <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-3 space-y-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Qty Received</label>
                      <input type="number" min="0" step="any" inputMode="numeric" value={receiveQty}
                        onChange={function (e) { setReceiveQty(e.target.value) }}
                        className="w-full px-3 py-2 border border-indigo-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={function () { setReceivingItem(null); setReceiveQty('') }}
                        className="flex-1 py-2 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                      <button onClick={function () { receiveExistingItem(it) }} disabled={saving}
                        className="flex-1 py-2 text-xs text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                        {saving ? 'Saving...' : '✓ Confirm'}
                      </button>
                    </div>
                  </div>
                )}
                {it._source === 'new' && (
                  <button onClick={function () { setShowInvForm(it) }}
                    className="w-full py-2 text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
                    📋 Receive & Add to Inventory
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PO DETAIL
// ═══════════════════════════════════════════════════════════════
function PoDetail({ po, items, setItems, profile, isAdmin, staffList, saving, onBack, onStatusChange, onAssign, onSaveVendor, onMarkPurchased, onDeletePo, onRemoveItem }) {
  var [editingVendor, setEditingVendor] = useState(null)
  var [vendorForm, setVendorForm] = useState({ name: '', contact: '', rate: '' })
  var [purchasingItem, setPurchasingItem] = useState(null)
  var [purchaseForm, setPurchaseForm] = useState({ qty: '', cost: '', receipt: null })

  var isPurchaser = po.assigned_to === profile?.id
  var canEdit = isAdmin && (po.status === 'draft' || po.status === 'confirmed')
  var canConfirm = isAdmin && po.status === 'draft' && items.length > 0
  var allReceived = items.length > 0 && items.every(function (it) { return it.status === 'received' || it.status === 'cancelled' })
  var canClose = isAdmin && (po.status === 'completed' || po.status === 'confirmed') && allReceived
  var canDelete = isAdmin && po.status === 'draft'
  var canPurchase = isPurchaser && po.status === 'confirmed'

  var totalEstPaise = 0
  var totalActualPaise = 0
  var pendingCount = 0
  var purchasedCount = 0
  items.forEach(function (it) {
    if (it.estimated_cost_paise) totalEstPaise += it.estimated_cost_paise
    if (it.actual_cost_paise) totalActualPaise += it.actual_cost_paise
    if (it.status === 'pending') pendingCount++
    if (it.status === 'purchased') purchasedCount++
    if (it.status === 'received') purchasedCount++
  })

  var staffItems = staffList.map(function (s) { return { label: s.name + (s.role === 'admin' ? ' (Admin)' : ''), value: s.id } })

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
    var item = items.find(function (it) { return it.id === poItemId })
    var estTotal = ratePaise && item ? ratePaise * item.qty_ordered : null
    await onSaveVendor(poItemId, vendorForm.name.trim(), vendorForm.contact.trim(), ratePaise, estTotal)
    setItems(function (prev) {
      return prev.map(function (it) {
        if (it.id !== poItemId) return it
        return Object.assign({}, it, {
          vendor_name: vendorForm.name.trim() || null,
          vendor_contact: vendorForm.contact.trim() || null,
          vendor_rate_paise: ratePaise,
          estimated_cost_paise: estTotal || it.estimated_cost_paise,
        })
      })
    })
    setEditingVendor(null)
  }

  function startPurchase(it) {
    setPurchasingItem(it.id)
    setPurchaseForm({
      qty: String(it.qty_ordered),
      cost: it.estimated_cost_paise ? String(it.estimated_cost_paise / 100) : '',
      receipt: null,
    })
  }

  async function confirmPurchase(poItemId) {
    var actualQty = Number(purchaseForm.qty)
    var actualCostPaise = Math.round(Number(purchaseForm.cost) * 100)
    if (!actualQty || actualQty <= 0) { alert('Enter qty purchased'); return }
    if (!actualCostPaise || actualCostPaise <= 0) { alert('Enter actual cost'); return }
    await onMarkPurchased(poItemId, actualQty, actualCostPaise, purchaseForm.receipt)
    setPurchasingItem(null)
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
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <p className="text-sm font-bold text-gray-800">PO #{po.id.slice(0, 8)}</p>
        <div className="text-[11px] text-gray-400 space-y-0.5">
          <p>Created by: {po.profiles?.name || '—'} · {formatDate(po.created_at)}</p>
          {po.notes && <p>Notes: {po.notes}</p>}
          {canEdit && (
            <button onClick={function () {
              var newNotes = prompt('PO Notes:', po.notes || '')
              if (newNotes !== null && newNotes !== po.notes) {
                supabase.from('purchase_orders').update({ notes: newNotes.trim() }).eq('id', po.id)
                  .then(function (res) { if (!res.error) { po.notes = newNotes.trim() } })
              }
            }} className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors">
              {po.notes ? '✎ Edit Notes' : '+ Add Notes'}
            </button>
          )}
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
            <p className="text-[10px] text-gray-400 uppercase">Progress</p>
            <p className="text-sm font-bold text-gray-700">{purchasedCount + '/' + items.length}</p>
          </div>
        </div>

        {/* Assign purchaser — admin only, draft/confirmed */}
        {canEdit && (
          <div className="pt-2 border-t border-gray-100">
            <SearchDropdown
              label="Assign Purchaser"
              items={staffItems}
              value={po.assigned_to || ''}
              onChange={function (val) { onAssign(po.id, val) }}
              placeholder="Select staff member..."
            />
          </div>
        )}
      </div>

      {/* Items */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length + ' Item' + (items.length !== 1 ? 's' : '')}</h3>
        {items.map(function (it) {
          var isEditingVendor = editingVendor === it.id
          var isPurchasing = purchasingItem === it.id

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

              {/* Vendor info */}
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
                {it.vendor_rate_paise > 0 && <span className="text-gray-400">Rate: {formatPaise(it.vendor_rate_paise)}/{it.unit}</span>}
                {it.estimated_cost_paise > 0 && <span className="text-gray-500">Est Total: {formatPaise(it.estimated_cost_paise)}</span>}
                {it.actual_cost_paise > 0 && <span className="text-green-600 font-medium">Actual: {formatPaise(it.actual_cost_paise)}</span>}
              </div>

              {/* Receipt link */}
              {it.receipt_path && (
                <a href={supabase.storage.from('receipts').getPublicUrl(it.receipt_path).data.publicUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-block text-[11px] text-indigo-600 font-medium hover:underline">
                  📎 View Bill
                </a>
              )}

              {it.notes && <p className="text-[11px] text-gray-400">{it.notes}</p>}

              {/* Vendor edit form — admin only */}
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

              {/* Purchase form — purchaser marks item as bought */}
              {isPurchasing && (
                <div className="bg-green-50 rounded-lg border border-green-200 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-green-700 uppercase">Mark as Purchased</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Qty Bought</label>
                      <input type="number" min="0" step="any" inputMode="decimal" value={purchaseForm.qty}
                        onChange={function (e) { setPurchaseForm(function (p) { return Object.assign({}, p, { qty: e.target.value }) }) }}
                        className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Actual Cost (₹)</label>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={purchaseForm.cost}
                        onChange={function (e) { setPurchaseForm(function (p) { return Object.assign({}, p, { cost: e.target.value }) }) }}
                        className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-0.5">Upload Bill / Receipt</label>
                    <input type="file" accept="image/*,application/pdf"
                      onChange={function (e) { setPurchaseForm(function (p) { return Object.assign({}, p, { receipt: e.target.files[0] || null }) }) }}
                      className="w-full text-sm text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-green-100 file:text-green-700" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function () { setPurchasingItem(null) }}
                      className="flex-1 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                    <button onClick={function () { confirmPurchase(it.id) }} disabled={saving}
                      className="flex-1 py-1.5 text-xs text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors">
                      {saving ? 'Saving...' : '✓ Purchased'}
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {it.status === 'pending' && !isEditingVendor && !isPurchasing && (
                <div className="flex gap-2">
                  {canEdit && (
                    <button onClick={function (e) { e.stopPropagation(); startVendorEdit(it) }}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors">
                      {it.vendor_name ? '✎ Edit Vendor' : '+ Assign Vendor'}
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={function (e) { e.stopPropagation(); if (confirm('Remove this item from PO?')) onRemoveItem(po.id, it.id) }}
                      className="text-[11px] font-medium text-red-500 hover:text-red-700 transition-colors">
                      ✕ Remove
                    </button>
                  )}
                  {canPurchase && (
                    <button onClick={function (e) { e.stopPropagation(); startPurchase(it) }}
                      className="text-[11px] font-medium text-green-600 hover:text-green-800 transition-colors">
                      🛒 Mark Purchased
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* PO-level actions — admin only */}
      <div className="space-y-2">
        {canConfirm && (
          <button onClick={function () {
            if (!po.assigned_to) { alert('Assign a purchaser before confirming'); return }
            onStatusChange(po.id, 'confirmed')
          }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Confirming...' : 'Confirm & Send to Purchaser'}
          </button>
        )}
        {canClose && (
          <button onClick={function () { onStatusChange(po.id, 'closed') }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {saving ? 'Closing...' : 'Close PO'}
          </button>
        )}
        {canDelete && (
          <button onClick={function () { if (confirm('Delete this draft PO? Items return to procurement queue.')) onDeletePo(po.id) }} disabled={saving}
            className="w-full py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
            {saving ? 'Deleting...' : '🗑 Delete Draft PO'}
          </button>
        )}
      </div>
    </div>
  )
}

export default Purchase
