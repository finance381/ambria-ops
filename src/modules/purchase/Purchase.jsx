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
function Purchase({ profile, mode }) {
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
  var [vendorData, setVendorData] = useState([])
  var [vendorLoading, setVendorLoading] = useState(false)
  var [vendorCatFilter, setVendorCatFilter] = useState('')

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var hasPurchase = (profile?.permissions || []).indexOf('feature_purchase') !== -1
  var hasReceive = (profile?.permissions || []).indexOf('feature_receive') !== -1
  var isReceiver = !isAdmin && (mode === 'receive' || (hasReceive && !hasPurchase))
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

  // ─── VENDOR ANALYTICS ───
  async function loadVendorAnalytics() {
    if (vendorData.length > 0) return
    setVendorLoading(true)
    var { data, error } = await supabase
      .from('purchase_order_items')
      .select('id, item_name, category_id, vendor_name, vendor_rate_paise, actual_cost_paise, actual_qty, qty_ordered, unit, status, purchased_at, categories(name)')
      .not('vendor_name', 'is', null)
      .in('status', ['purchased', 'received'])
      .order('item_name')
      .limit(1000)
    if (error) { setVendorData([]); setVendorLoading(false); return }

    // Group by item_name
    var grouped = {}
    ;(data || []).forEach(function (row) {
      var key = row.item_name.toLowerCase().trim()
      if (!grouped[key]) grouped[key] = { item_name: row.item_name, category: row.categories?.name || '—', category_id: row.category_id, vendors: [] }
      grouped[key].vendors.push({
        vendor: row.vendor_name,
        rate_paise: row.vendor_rate_paise || 0,
        actual_paise: row.actual_cost_paise || 0,
        qty: row.actual_qty || row.qty_ordered,
        unit: row.unit,
        date: row.purchased_at,
      })
    })

    // Sort vendors within each item by rate (lowest first)
    var result = Object.keys(grouped).sort().map(function (key) {
      var item = grouped[key]
      item.vendors.sort(function (a, b) { return a.rate_paise - b.rate_paise })
      item.bestRate = item.vendors[0]?.rate_paise || 0
      return item
    })

    setVendorData(result)
    setVendorLoading(false)
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
        <button onClick={function () { setTab('vendors'); loadVendorAnalytics() }}
          className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (tab === 'vendors' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
          Vendors
        </button>
      </div>

      {/* ═══ QUEUE TAB ═══ */}
      {tab === 'queue' && (
        <div className="flex gap-5">
          {/* Left: Queue table */}
          <div className="flex-1 min-w-0 space-y-3">
            {queueItems.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-sm font-semibold text-gray-700">Procurement queue empty</p>
                <p className="text-xs text-gray-400 mt-1">Approved requisition items will appear here</p>
              </div>
            )}
            {queueItems.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Table header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={selectedQueue.length === queueItems.length && queueItems.length > 0}
                      onChange={selectAllQueue}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Select All</span>
                  </label>
                  <span className="text-[11px] text-gray-400 ml-auto">{queueItems.length} items in queue</span>
                </div>
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  <div className="col-span-1"></div>
                  <div className="col-span-3">Item</div>
                  <div className="col-span-2">Category / Source</div>
                  <div className="col-span-1">Qty</div>
                  <div className="col-span-3">Requisition</div>
                  <div className="col-span-2 text-right">Est. Cost</div>
                </div>
                {/* Rows */}
                <div className="max-h-[60vh] overflow-y-auto">
                  {queueItems.map(function (q, qi) {
                    var isSelected = selectedQueue.indexOf(q.id) !== -1
                    var req = q.requisitions || {}
                    return (
                      <div key={q.id}
                        onClick={function () { toggleQueueItem(q.id) }}
                        className={"grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer transition-colors border-b border-gray-50 " +
                          (isSelected ? "bg-indigo-50/60" : "hover:bg-gray-50")}>
                        <div className="col-span-1">
                          <input type="checkbox" checked={isSelected} readOnly
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none" />
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{titleCase(q.item_name)}</p>
                        </div>
                        <div className="col-span-2 min-w-0">
                          <p className="text-xs text-gray-500 truncate">{q.categories?.name || '—'}</p>
                          <span className={"text-[10px] font-bold " + (q._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                            {q._source === 'new' ? 'New' : q._source === 'catering_store' ? 'CS' : 'INV'}
                          </span>
                        </div>
                        <div className="col-span-1">
                          <span className="text-sm font-medium text-gray-700">{q.qty}</span>
                          <span className="text-[10px] text-gray-400 ml-0.5">{q.unit || 'Pcs'}</span>
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="text-xs text-gray-600 truncate">{req.purpose || '—'}</p>
                          <p className="text-[10px] text-gray-400 truncate">
                            {req.profiles?.name || '—'} · {req.department || '—'}
                            {req.needed_by ? ' · ' + formatDate(req.needed_by) : ''}
                          </p>
                        </div>
                        <div className="col-span-2 text-right">
                          {q.estimated_cost_paise > 0 ? (
                            <span className="text-sm font-medium text-gray-700">{formatPaise(q.estimated_cost_paise)}</span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: Cart sidebar */}
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-[120px] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gray-900 text-white">
                <p className="text-xs font-bold uppercase tracking-wider">PO Cart</p>
                <p className="text-lg font-bold mt-0.5">{selectedQueue.length} item{selectedQueue.length !== 1 ? 's' : ''}</p>
              </div>
              {selectedQueue.length > 0 && (
                <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-50">
                  {queueItems.filter(function (q) { return selectedQueue.indexOf(q.id) !== -1 }).map(function (q) {
                    return (
                      <div key={q.id} className="px-4 py-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-700 truncate">{titleCase(q.item_name)}</p>
                          <p className="text-[10px] text-gray-400">{q.qty} {q.unit || 'Pcs'}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-semibold text-gray-700">{q.estimated_cost_paise > 0 ? formatPaise(q.estimated_cost_paise) : '—'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {selectedQueue.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-gray-400">Select items from queue to create a PO</p>
                </div>
              )}
              {/* Total + Create */}
              <div className="border-t border-gray-200 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase">Est. Total</span>
                  <span className="text-base font-bold text-gray-900">{formatPaise(
                    queueItems.filter(function (q) { return selectedQueue.indexOf(q.id) !== -1 })
                      .reduce(function (sum, q) { return sum + (q.estimated_cost_paise || 0) }, 0)
                  )}</span>
                </div>
                <button onClick={createPo} disabled={saving || selectedQueue.length === 0}
                  className="w-full py-3 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
                  {saving ? 'Creating...' : 'Create Purchase Order →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ POs TAB ═══ */}
      {tab === 'pos' && (
        <div className="space-y-3">
          {/* Status filters */}
          <div className="flex gap-2 flex-wrap">
            {['', 'draft', 'confirmed', 'completed', 'closed'].map(function (s) {
              var label = s ? PO_STATUS_LABELS[s] : 'All'
              return (
                <button key={s} onClick={function () { setPoStatusFilter(s === poStatusFilter ? '' : s) }}
                  className={"px-4 py-2 text-xs font-bold rounded-lg border transition-colors " +
                    (poStatusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                  {label}
                </button>
              )
            })}
          </div>

          {poList.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
              <div className="text-3xl mb-2">📦</div>
              <p className="text-sm font-semibold text-gray-700">No purchase orders</p>
              <p className="text-xs text-gray-400 mt-1">Create POs from the Procurement Queue tab</p>
            </div>
          )}

          {poList.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <div className="col-span-2">PO #</div>
                <div className="col-span-2">Created</div>
                <div className="col-span-2">Created By</div>
                <div className="col-span-2">Assigned To</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-3 text-right">Notes</div>
              </div>
              {/* Rows */}
              {poList.map(function (po, pi) {
                var assigneeName = po.assignee?.name || null
                return (
                  <div key={po.id}
                    onClick={function () { openPoDetail(po) }}
                    className={"grid grid-cols-12 gap-3 px-5 py-4 items-center cursor-pointer transition-colors " +
                      (pi < poList.length - 1 ? "border-b border-gray-50 " : "") +
                      "hover:bg-indigo-50/40"}>
                    <div className="col-span-2">
                      <p className="text-sm font-bold text-indigo-600">#{po.id.slice(0, 8)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-600">{formatDate(po.created_at)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-600">{po.profiles?.name || '—'}</p>
                    </div>
                    <div className="col-span-2">
                      {assigneeName ? (
                        <span className="text-xs font-medium text-gray-700">🛒 {assigneeName}</span>
                      ) : (
                        <span className="text-[11px] text-amber-500 font-medium">Unassigned</span>
                      )}
                    </div>
                    <div className="col-span-1">
                      <span className={"text-[10px] font-bold uppercase px-2 py-1 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
                        {PO_STATUS_LABELS[po.status] || po.status}
                      </span>
                    </div>
                    <div className="col-span-3 text-right">
                      <p className="text-xs text-gray-400 truncate">{po.notes || '—'}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
      {/* ═══ VENDORS TAB (Admin) ═══ */}
      {tab === 'vendors' && (
        <div className="space-y-3">
          {vendorLoading && <p className="text-gray-400 text-sm text-center py-8">Loading vendor data...</p>}
          {!vendorLoading && vendorData.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">No vendor data yet — purchase items to build history</p>
            </div>
          )}
          {!vendorLoading && vendorData.length > 0 && (
            <>
              {/* Category filter */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={function () { setVendorCatFilter('') }}
                  className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                    (!vendorCatFilter ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                  All
                </button>
                {(function () {
                  var cats = []
                  vendorData.forEach(function (item) { if (cats.indexOf(item.category) === -1) cats.push(item.category) })
                  return cats.sort().map(function (cat) {
                    return (
                      <button key={cat} onClick={function () { setVendorCatFilter(cat === vendorCatFilter ? '' : cat) }}
                        className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                          (vendorCatFilter === cat ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                        {cat}
                      </button>
                    )
                  })
                })()}
              </div>

              {/* Items with vendor comparison */}
              {vendorData
                .filter(function (item) { return !vendorCatFilter || item.category === vendorCatFilter })
                .map(function (item, idx) {
                  return (
                    <div key={idx} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{titleCase(item.item_name)}</p>
                          <p className="text-[11px] text-gray-400">{item.category} · {item.vendors.length} purchase{item.vendors.length !== 1 ? 's' : ''}</p>
                        </div>
                        {item.bestRate > 0 && (
                          <span className="text-[11px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                            Best: {formatPaise(item.bestRate)}/{item.vendors[0]?.unit || 'unit'}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {item.vendors.map(function (v, vi) {
                          var isBest = v.rate_paise === item.bestRate && item.vendors.length > 1
                          return (
                            <div key={vi} className={"flex items-center justify-between py-1.5 px-2 rounded text-[11px] " + (isBest ? "bg-green-50" : "bg-gray-50")}>
                              <div className="flex-1 min-w-0">
                                <span className={"font-medium " + (isBest ? "text-green-700" : "text-gray-700")}>{v.vendor}</span>
                                {v.date && <span className="text-gray-400 ml-2">{formatDate(v.date)}</span>}
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-gray-500">{v.qty} {v.unit}</span>
                                <span className={"font-bold " + (isBest ? "text-green-700" : "text-gray-700")}>
                                  {v.rate_paise > 0 ? formatPaise(v.rate_paise) + '/' + v.unit : v.actual_paise > 0 ? formatPaise(v.actual_paise) + ' total' : '—'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </>
          )}
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
  var [rateHistory, setRateHistory] = useState([])
  var [rateLoading, setRateLoading] = useState(false)

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
    // Fetch last 3 purchases for this item
    setRateHistory([])
    setRateLoading(true)
    supabase.from('purchase_order_items')
      .select('vendor_name, vendor_rate_paise, actual_cost_paise, actual_qty, qty_ordered, unit, purchased_at')
      .ilike('item_name', it.item_name)
      .not('vendor_name', 'is', null)
      .in('status', ['purchased', 'received'])
      .order('purchased_at', { ascending: false })
      .limit(3)
      .then(function (res) {
        setRateHistory(res.data || [])
        setRateLoading(false)
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

  // Variance calc
  var variancePaise = totalActualPaise - totalEstPaise
  var variancePct = totalEstPaise > 0 ? Math.round((variancePaise / totalEstPaise) * 100) : 0
  var receivedCount = 0
  items.forEach(function (it) { if (it.status === 'received') receivedCount++ })

  // Vendor summary
  var vendorSummary = {}
  items.forEach(function (it) {
    if (!it.vendor_name) return
    if (!vendorSummary[it.vendor_name]) vendorSummary[it.vendor_name] = { count: 0, estPaise: 0, actualPaise: 0 }
    vendorSummary[it.vendor_name].count++
    vendorSummary[it.vendor_name].estPaise += it.estimated_cost_paise || 0
    vendorSummary[it.vendor_name].actualPaise += it.actual_cost_paise || 0
  })
  var vendorKeys = Object.keys(vendorSummary).sort()
  var unassignedCount = items.filter(function (it) { return !it.vendor_name && it.status === 'pending' }).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">← Back</button>
          <h2 className="text-lg font-bold text-gray-900">PO #{po.id.slice(0, 8)}</h2>
          <span className={"text-[10px] font-bold uppercase px-2.5 py-1 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
            {PO_STATUS_LABELS[po.status] || po.status}
          </span>
        </div>
        <div className="text-xs text-gray-400">
          {po.profiles?.name || '—'} · {formatDate(po.created_at)}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ═══ LEFT: Items ═══ */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Assign purchaser — admin only, draft/confirmed */}
          {canEdit && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <SearchDropdown
                label="Assign Purchaser"
                items={staffItems}
                value={po.assigned_to || ''}
                onChange={function (val) { onAssign(po.id, val) }}
                placeholder="Select staff member..."
              />
            </div>
          )}

          {/* Items table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length + ' Item' + (items.length !== 1 ? 's' : '')}</span>
              <span className="text-xs text-gray-400">{purchasedCount + receivedCount} of {items.length} done</span>
            </div>

            <div className="divide-y divide-gray-50">
              {items.map(function (it) {
                var isEditingVendor = editingVendor === it.id
                var isPurchasing = purchasingItem === it.id
                var itemVariance = (it.actual_cost_paise || 0) - (it.estimated_cost_paise || 0)

                return (
                  <div key={it.id} className="px-4 py-4 space-y-2">
                    {/* Item row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800">{titleCase(it.item_name)}</p>
                          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (ITEM_STATUS_COLORS[it.status] || '')}>
                            {it.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {it.categories?.name || '—'} · {it.qty_ordered} {it.unit} · <span className={"font-medium " + (it._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                            {it._source === 'new' ? 'New' : it._source === 'catering_store' ? 'CS' : 'INV'}
                          </span>
                        </p>
                      </div>
                      {/* Cost columns */}
                      <div className="flex gap-4 flex-shrink-0 text-right">
                        <div>
                          <p className="text-[10px] text-gray-400">Estimated</p>
                          <p className="text-xs font-medium text-gray-600">{it.estimated_cost_paise > 0 ? formatPaise(it.estimated_cost_paise) : '—'}</p>
                        </div>
                        {it.actual_cost_paise > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400">Actual</p>
                            <p className={"text-xs font-bold " + (itemVariance > 0 ? "text-red-600" : itemVariance < 0 ? "text-green-600" : "text-gray-700")}>
                              {formatPaise(it.actual_cost_paise)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Vendor info display */}
                    {it.vendor_name && !isEditingVendor && (
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">{it.vendor_name}</span>
                        {it.vendor_contact && <span>· {it.vendor_contact}</span>}
                        {it.vendor_rate_paise > 0 && <span>· {formatPaise(it.vendor_rate_paise)}/{it.unit}</span>}
                      </div>
                    )}

                    {/* Receipt link */}
                    {it.receipt_path && (
                      <a href={supabase.storage.from('receipts').getPublicUrl(it.receipt_path).data.publicUrl}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-block text-[11px] text-indigo-600 font-medium hover:underline">
                        📎 View Bill
                      </a>
                    )}

                    {/* Vendor edit form */}
                    {isEditingVendor && (
                      <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 space-y-2">
                        <p className="text-[11px] font-bold text-blue-700 uppercase">Assign Vendor</p>
                        {/* Rate history */}
                        {rateLoading && <p className="text-[10px] text-gray-400">Checking history...</p>}
                        {!rateLoading && rateHistory.length > 0 && (
                          <div className="bg-white rounded border border-blue-100 p-2 space-y-1">
                            <p className="text-[10px] font-bold text-gray-500 uppercase">Last {rateHistory.length} Purchase{rateHistory.length !== 1 ? 's' : ''}</p>
                            {rateHistory.map(function (h, hi) {
                              return (
                                <div key={hi}
                                  onClick={function () {
                                    setVendorForm(function (prev) {
                                      return Object.assign({}, prev, {
                                        name: h.vendor_name || prev.name,
                                        rate: h.vendor_rate_paise ? String(h.vendor_rate_paise / 100) : prev.rate,
                                      })
                                    })
                                  }}
                                  className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-50 hover:bg-blue-100 cursor-pointer transition-colors">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-[11px] font-medium text-gray-700">{h.vendor_name}</span>
                                    {h.purchased_at && <span className="text-[10px] text-gray-400 ml-1.5">{formatDate(h.purchased_at)}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-[10px] text-gray-500">{h.actual_qty || h.qty_ordered} {h.unit}</span>
                                    <span className="text-[11px] font-bold text-gray-800">
                                      {h.vendor_rate_paise ? formatPaise(h.vendor_rate_paise) + '/' + h.unit : h.actual_cost_paise ? formatPaise(h.actual_cost_paise) + ' total' : '—'}
                                    </span>
                                    <span className="text-[10px] text-blue-500">↗</span>
                                  </div>
                                </div>
                              )
                            })}
                            <p className="text-[9px] text-gray-400 text-center">Tap to auto-fill vendor & rate</p>
                          </div>
                        )}
                        {!rateLoading && rateHistory.length === 0 && (
                          <p className="text-[10px] text-gray-400 italic">No purchase history for this item</p>
                        )}
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

                    {/* Purchase form */}
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
                      <div className="flex gap-3">
                        {canEdit && (
                          <button onClick={function (e) { e.stopPropagation(); startVendorEdit(it) }}
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                            {it.vendor_name ? '✎ Edit Vendor' : '+ Assign Vendor'}
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={function (e) { e.stopPropagation(); if (confirm('Remove this item from PO?')) onRemoveItem(po.id, it.id) }}
                            className="text-[11px] font-semibold text-red-500 hover:text-red-700 transition-colors">
                            ✕ Remove
                          </button>
                        )}
                        {canPurchase && (
                          <button onClick={function (e) { e.stopPropagation(); startPurchase(it) }}
                            className="text-[11px] font-semibold text-green-600 hover:text-green-800 transition-colors">
                            🛒 Mark Purchased
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Summary sidebar ═══ */}
        <div className="w-full lg:w-80 lg:flex-shrink-0">
          <div className="sticky top-[120px] space-y-4">
            {/* Financial summary */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gray-900 text-white">
                <p className="text-[10px] font-bold uppercase tracking-wider">Order Summary</p>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Estimated Total</span>
                  <span className="text-sm font-bold text-gray-700">{formatPaise(totalEstPaise)}</span>
                </div>
                {totalActualPaise > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Actual Total</span>
                      <span className="text-sm font-bold text-gray-900">{formatPaise(totalActualPaise)}</span>
                    </div>
                    <div className="border-t border-gray-100 pt-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-500">Variance</span>
                      <div className="text-right">
                        <span className={"text-sm font-bold " + (variancePaise > 0 ? "text-red-600" : variancePaise < 0 ? "text-green-600" : "text-gray-700")}>
                          {variancePaise > 0 ? '+' : ''}{formatPaise(Math.abs(variancePaise))}
                        </span>
                        <span className={"text-[10px] ml-1.5 font-bold px-1.5 py-0.5 rounded " +
                          (variancePaise > 0 ? "bg-red-50 text-red-600" : variancePaise < 0 ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-500")}>
                          {variancePaise > 0 ? '▲' : variancePaise < 0 ? '▼' : '='} {Math.abs(variancePct)}%
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* Progress bar */}
              <div className="px-4 pb-4">
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                  <span>Progress</span>
                  <span>{purchasedCount + receivedCount}/{items.length}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: (items.length > 0 ? Math.round(((purchasedCount + receivedCount) / items.length) * 100) : 0) + '%' }} />
                </div>
              </div>
            </div>

            {/* Vendor breakdown */}
            {vendorKeys.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Vendors</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {vendorKeys.map(function (vk) {
                    var vs = vendorSummary[vk]
                    var vVariance = vs.actualPaise - vs.estPaise
                    return (
                      <div key={vk} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">{vk}</span>
                          <span className="text-[10px] text-gray-400">{vs.count} item{vs.count !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[11px] text-gray-400">Est: {formatPaise(vs.estPaise)}</span>
                          {vs.actualPaise > 0 && (
                            <span className={"text-[11px] font-semibold " + (vVariance > 0 ? "text-red-600" : "text-green-600")}>
                              Act: {formatPaise(vs.actualPaise)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {unassignedCount > 0 && (
                    <div className="px-4 py-3">
                      <span className="text-xs text-amber-500 font-medium">{unassignedCount} item{unassignedCount !== 1 ? 's' : ''} unassigned</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {po.notes && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-xs text-gray-600">{po.notes}</p>
              </div>
            )}
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

            {/* Actions */}
            <div className="space-y-2">
              {canConfirm && (
                <button onClick={function () {
                  if (!po.assigned_to) { alert('Assign a purchaser before confirming'); return }
                  onStatusChange(po.id, 'confirmed')
                }} disabled={saving}
                  className="w-full py-3 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
                  {saving ? 'Confirming...' : 'Confirm & Send to Purchaser'}
                </button>
              )}
              {canClose && (
                <button onClick={function () { onStatusChange(po.id, 'closed') }} disabled={saving}
                  className="w-full py-3 text-sm font-bold text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors shadow-sm">
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
        </div>
      </div>
    </div>
  )
}

export default Purchase
