import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate, formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import { generatePoPdf, generateComparisonPdf, generateReceivingPdf, generateReceivingListPdf } from '../../lib/pdf'
import SearchDropdown from '../../components/ui/SearchDropdown'
import InventoryForm from '../inventory/InventoryForm'
import BottomSheet from '../../components/ui/BottomSheet'
import { pushBack, goBack as navBack } from '../../lib/backNav'
import VoiceInput from '../../components/ui/VoiceInput'
import { prepUpload } from '../../lib/uploadHelper'
import { hasPerm } from '../../lib/permissions'
import { filterVisibleVendors } from '../../lib/vendorGating'

var PO_STATUS_LABELS = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  completed: 'Completed',
  closed: 'Closed',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
}

var PO_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  closed: 'bg-gray-200 text-gray-500',
  cancelling: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100 text-red-600',
}

var ITEM_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  purchased: 'bg-green-100 text-green-700',
  received: 'bg-indigo-100 text-indigo-700',
  cancelled: 'bg-red-100 text-red-600',
  pending_return: 'bg-orange-100 text-orange-700',
  returned: 'bg-teal-100 text-teal-700',
}

var ITEM_STATUS_LABELS = {
  pending: 'Pending',
  purchased: 'Purchased',
  received: 'Received',
  cancelled: 'Cancelled',
  pending_return: 'Pending Return',
  returned: 'Returned',
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
  var [queueLoading, setQueueLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  useRealtime(['purchase_orders', 'purchase_order_items'], function () { if (!saving) { loadQueue(); loadPos() } })
  var [vendorList, setVendorList] = useState([])
  var [staffList, setStaffList] = useState([])
  var [receivingItems, setReceivingItems] = useState([])
  var [receivingLoading, setReceivingLoading] = useState(false)
  var [receivingItem, setReceivingItem] = useState(null)
  var [receiveQty, setReceiveQty] = useState('')
  var [showInvForm, setShowInvForm] = useState(null)
  var [receivingStatusFilter, setReceivingStatusFilter] = useState('purchased')

  var assignLockRef = useRef(false)
  var isAdmin = hasPerm(profile?.permsNew, 'procurement.purchase_orders')
  var hasPurchase = hasPerm(profile?.permsNew, 'procurement.purchase_orders')
  var hasReceive = hasPerm(profile?.permsNew, 'inventory.receive')
  // mode === 'receive' forces receiver-only view for everyone (incl. admin) — Shell routes here from Receive Items tile
  var isReceiver = mode === 'receive' || (!isAdmin && hasReceive && !hasPurchase)
  var isPurchaser = !isAdmin && !isReceiver

  useEffect(function () {
    if (isReceiver) return
    if (isAdmin) {
      loadQueue()
      loadStaff()
      supabase.from('vendors').select('id, name, contact, phone, category_ids, active, expense_sub_type_ids').eq('active', true).order('name')
        .then(function (r) { setVendorList(filterVisibleVendors(r.data || [], profile)) })
        .catch(function () { setVendorList([]) })
    }
  }, [])

  // Load receiving on mount + on filter change (both receiver and admin).
  // Receiver ignores filter — always sees 'purchased'.
  useEffect(function () { if (isReceiver || isAdmin) loadReceiving() }, [receivingStatusFilter])

  useEffect(function () { if (!isReceiver) loadPos() }, [poStatusFilter])

  // ─── QUEUE: approved requisition items not yet in any PO ───
  async function loadQueue() {
    // Do NOT set queueLoading=true on refetches — it caused the whole component
    // to blank via the top-level gate. Refetches are silent; the queue tab uses
    // its existing data until the new set arrives.
    var { data: itemsRaw, error } = await supabase
      .from('requisition_items')
      .select('id, item_id, item_name, category_id, qty, unit, notes, _source, estimated_cost_paise, po_item_id, item_status, requisition_id, categories(name)')
      .is('po_item_id', null)
      .eq('item_status', 'po_queued')
      .order('id', { ascending: false })
      .limit(200)

    if (error) { setQueueItems([]); setQueueLoading(false); return }

    var items = itemsRaw || []
    if (items.length === 0) { setQueueItems([]); setQueueLoading(false); return }

    var reqIds = []
    items.forEach(function (it) {
      if (reqIds.indexOf(it.requisition_id) === -1) reqIds.push(it.requisition_id)
    })

    var { data: reqs } = await supabase
      .from('requisitions')
      .select('id, purpose, department, urgency, needed_by, status, requested_by')
      .in('id', reqIds)
      .eq('status', 'approved')

    var reqUserIds = []
    ;(reqs || []).forEach(function (r) {
      if (r.requested_by && reqUserIds.indexOf(r.requested_by) === -1) reqUserIds.push(r.requested_by)
    })
    var reqNameMap = {}
    if (reqUserIds.length > 0) {
      var { data: reqNames } = await supabase.rpc('get_profile_names', { p_ids: reqUserIds })
      ;(reqNames || []).forEach(function (n) { reqNameMap[n.id] = n.name })
    }
    reqs = (reqs || []).map(function (r) {
      return Object.assign({}, r, { profiles: { name: reqNameMap[r.requested_by] || null } })
    })

    var reqMap = {}
    ;(reqs || []).forEach(function (r) { reqMap[r.id] = r })

    var filtered = items
      .filter(function (it) { return !!reqMap[it.requisition_id] })
      .map(function (it) { return Object.assign({}, it, { requisitions: reqMap[it.requisition_id] }) })

    setQueueItems(filtered)
    setQueueLoading(false)
  }

  // ─── PO LIST ───
  var PO_BASE_COLS = 'id, status, notes, assigned_to, created_by, created_at, updated_at'

  async function loadPos() {
    var q = supabase.from('purchase_orders').select(PO_BASE_COLS).order('created_at', { ascending: false }).limit(100)
    if (poStatusFilter) q = q.eq('status', poStatusFilter)
    if (isPurchaser) q = q.eq('assigned_to', profile.id)

    var { data } = await q
    var rows = data || []
    // Resolve names
    var userIds = []
    rows.forEach(function (r) {
      if (r.created_by && userIds.indexOf(r.created_by) === -1) userIds.push(r.created_by)
      if (r.assigned_to && userIds.indexOf(r.assigned_to) === -1) userIds.push(r.assigned_to)
    })
    var nameMap = {}
    if (userIds.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: userIds })
      ;(names || []).forEach(function (n) { nameMap[n.id] = n.name })
    }
    rows = rows.map(function (r) {
      return Object.assign({}, r, {
        profiles: { name: nameMap[r.created_by] || null },
        assignee: { name: nameMap[r.assigned_to] || null },
      })
    })
    setPoList(rows)
    setLoading(false)
  }

  // ─── STAFF LIST for assigning purchaser ───
  async function loadStaff() {
    var { data } = await supabase.rpc('get_all_profile_names')
    setStaffList(data || [])
  }
  // ─── RECEIVING: load purchased items awaiting receive ───
  async function loadReceiving() {
    setReceivingLoading(true)
    // Receivers always see 'purchased' (action queue). Admin filters via chips; '' = all statuses.
    var effStatus = isReceiver ? 'purchased' : receivingStatusFilter
    var q1 = supabase
      .from('purchase_order_items')
      .select('id, po_id, item_id, item_name, category_id, _source, qty_ordered, actual_qty, unit, vendor_name, vendor_rate_paise, actual_cost_paise, status, purchased_by, purchased_at, received_by, received_at, expense_id, categories(name)')
      .order('purchased_at', { ascending: true })
      .limit(200)
    if (effStatus) q1 = q1.eq('status', effStatus)
    var { data, error } = await q1
    if (error) {
      // FK hint fallback — retry without categories join
      var q2 = supabase
        .from('purchase_order_items')
        .select('id, po_id, item_id, item_name, category_id, _source, qty_ordered, actual_qty, unit, vendor_name, vendor_rate_paise, actual_cost_paise, status, purchased_by, purchased_at, received_by, received_at, expense_id, expense_type_id, expense_sub_type_id')
        .order('purchased_at', { ascending: true })
        .limit(200)
      if (effStatus) q2 = q2.eq('status', effStatus)
      var { data: fb } = await q2
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
        .select('id, notes, created_at, created_by')
        .in('id', poIds)
      var poUserIds = []
      ;(pos || []).forEach(function (p) {
        if (p.created_by && poUserIds.indexOf(p.created_by) === -1) poUserIds.push(p.created_by)
      })
      var poNameMap = {}
      if (poUserIds.length > 0) {
        var { data: poNames } = await supabase.rpc('get_profile_names', { p_ids: poUserIds })
        ;(poNames || []).forEach(function (n) { poNameMap[n.id] = n.name })
      }
      ;(pos || []).forEach(function (p) {
        poMap[p.id] = Object.assign({}, p, { profiles: { name: poNameMap[p.created_by] || null } })
      })
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
    await loadReceiving()
    setSaving(false)
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
    await loadReceiving()
  }

  // ─── OPEN PO DETAIL ───
  async function openPoDetail(po) {
    if (saving) return
    setSaving(true)
    var { data } = await supabase
      .from('purchase_order_items')
      .select('id, requisition_item_id, item_id, item_name, category_id, _source, qty_ordered, unit, vendor_name, vendor_contact, vendor_rate_paise, estimated_cost_paise, actual_cost_paise, actual_qty, purchased_by, purchased_at, received_by, received_at, inventory_item_id, cs_item_id, status, notes, receipt_path, expense_id, expense_type_id, expense_sub_type_id, categories(name, default_expense_type_id, default_expense_sub_type_id)')
      .eq('po_id', po.id)
      .order('created_at')

    pushBack(function () { setView('list'); setActivePo(null); setActivePoItems([]); if (isAdmin) loadQueue(); loadPos() })
    setActivePo(po)
    setActivePoItems(data || [])
    setView('detail')
    setSaving(false)
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

  // ─── CANCEL PO (admin only — handles purchased item returns) ───
  async function cancelPo(poId) {
    if (saving) return
    var hasReceived = activePoItems.some(function (it) { return it.status === 'received' })
    if (hasReceived) { alert('Cannot cancel — some items already received into inventory. Close PO instead.'); return }
    var hasPurchased = activePoItems.some(function (it) { return it.status === 'purchased' })
    var msg = hasPurchased
      ? 'Cancel this PO? Items already purchased will need to be returned before wallet refund.'
      : 'Cancel this PO? All pending items will be cancelled.'
    if (!confirm(msg)) return
    setSaving(true)
    // Split items by status
    var pendingIds = []
    var purchasedIds = []
    activePoItems.forEach(function (it) {
      if (it.status === 'pending') pendingIds.push(it.id)
      if (it.status === 'purchased') purchasedIds.push(it.id)
    })
    // Cancel pending items + unlink from requisitions so they return to queue
    if (pendingIds.length > 0) {
      await supabase.from('purchase_order_items').update({ status: 'cancelled' }).in('id', pendingIds)
      await supabase.from('requisition_items').update({ po_item_id: null }).in('po_item_id', pendingIds)
    }
    // Move purchased → pending_return
    if (purchasedIds.length > 0) {
      await supabase.from('purchase_order_items').update({ status: 'pending_return' }).in('id', purchasedIds)
    }
    // PO status
    var newPoStatus = purchasedIds.length > 0 ? 'cancelling' : 'cancelled'
    await supabase.from('purchase_orders').update({ status: newPoStatus }).eq('id', poId)
    // Update local state
    setActivePoItems(activePoItems.map(function (it) {
      if (it.status === 'pending') return Object.assign({}, it, { status: 'cancelled' })
      if (it.status === 'purchased') return Object.assign({}, it, { status: 'pending_return' })
      return it
    }))
    setActivePo(function (prev) { return prev ? Object.assign({}, prev, { status: newPoStatus }) : prev })
    try { await logActivity('PO_CANCEL', 'PO ' + poId.slice(0, 8) + ' → ' + newPoStatus + ' | ' + purchasedIds.length + ' items pending return') } catch (_) {}
    setSaving(false)
    loadPos()
  }

  // ─── CONFIRM ITEM RETURN (admin only — credits wallet) ───
  async function confirmReturn(poItemId) {
    if (saving) return
    var item = activePoItems.find(function (it) { return it.id === poItemId })
    if (!item || item.status !== 'pending_return') return
    if (!confirm('Confirm this item has been returned? Wallet will be credited ' + formatPaise(item.actual_cost_paise) + '.')) return
    setSaving(true)
    // Update item status
    var { error } = await supabase.from('purchase_order_items').update({ status: 'returned' }).eq('id', poItemId)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    // Credit purchaser wallet
    if (item.actual_cost_paise > 0 && item.purchased_by) {
      try {
        await supabase.rpc('wallet_admin_credit', {
          p_user_id: item.purchased_by,
          p_amount_paise: item.actual_cost_paise,
          p_description: 'PO Return: ' + titleCase(item.item_name),
          p_ref_type: 'po_return',
          p_ref_id: String(poItemId),
        })
      } catch (_) {}
    }

    // ─── Reversal expense (negative amount + deduction_type='return') ───
    if (item.expense_id) {
      try {
        var { data: origExp } = await supabase.from('expenses')
          .select('id, expense_type_id, expense_sub_type_id, category_id, batch_id, receipt_path')
          .eq('id', item.expense_id)
          .single()
        if (origExp) {
          var { data: origAllocs } = await supabase.from('expense_allocations')
            .select('department, sub_department_id, venue_id, amount_paise')
            .eq('expense_id', origExp.id)

          var { data: revExp, error: revErr } = await supabase.from('expenses').insert({
            user_id: item.purchased_by,
            expense_type_id: origExp.expense_type_id,
            expense_sub_type_id: origExp.expense_sub_type_id,
            category_id: origExp.category_id,
            amount_paise: -item.actual_cost_paise,
            deduction_type: 'return',
            description: 'PO Return: ' + titleCase(item.item_name) + ' | reversal of expense #' + origExp.id,
            expense_date: new Date().toISOString().split('T')[0],
            status: 'recorded',
            receipt_path: origExp.receipt_path,
            batch_id: origExp.batch_id,
          }).select('id').single()

          if (!revErr && revExp && (origAllocs || []).length > 0) {
            var revAllocs = origAllocs.map(function (a) {
              return {
                expense_id: revExp.id,
                department: a.department,
                sub_department_id: a.sub_department_id,
                venue_id: a.venue_id,
                amount_paise: -a.amount_paise,
              }
            })
            await supabase.from('expense_allocations').insert(revAllocs)
          } else if (revErr) {
            console.warn('Reversal insert failed:', revErr.message)
          }
        }
      } catch (err) {
        console.warn('Return reversal error:', err.message || err)
      }
    }

    // Unlink requisition item so it can be re-ordered if needed
    await supabase.from('requisition_items').update({ po_item_id: null }).match({ po_item_id: poItemId })
    // Update local state
    var updatedItems = activePoItems.map(function (it) {
      if (it.id === poItemId) return Object.assign({}, it, { status: 'returned' })
      return it
    })
    setActivePoItems(updatedItems)
    // Check if all items resolved → PO fully cancelled
    var allResolved = updatedItems.every(function (it) { return it.status === 'returned' || it.status === 'cancelled' })
    if (allResolved && activePo) {
      await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', activePo.id)
      setActivePo(function (prev) { return prev ? Object.assign({}, prev, { status: 'cancelled' }) : prev })
    }
    try { await logActivity('PO_ITEM_RETURNED', titleCase(item.item_name) + ' returned | ' + formatPaise(item.actual_cost_paise) + ' credited') } catch (_) {}
    setSaving(false)
    loadPos()
  }

  // ─── ASSIGN PURCHASER (admin only) — ref-locked, no saving toggle ───
  async function assignPurchaser(poId, userId) {
    if (assignLockRef.current) return
    var newAssignee = userId || null
    var currentAssignee = (activePo && activePo.id === poId) ? (activePo.assigned_to || null) : null
    if (newAssignee === currentAssignee) return
    assignLockRef.current = true
    try {
      var { error } = await supabase.from('purchase_orders').update({ assigned_to: newAssignee }).eq('id', poId)
      if (error) { alert('Assign failed: ' + error.message); return }
      var staff = newAssignee ? staffList.find(function (s) { return s.id === newAssignee }) : null
      try { await logActivity('PO_ASSIGN', 'PO ' + poId.slice(0, 8) + ' → ' + (staff?.name || 'unassigned')) } catch (_) {}
      // Both setState calls in the same tick — React 18 batches → single re-render
      setActivePo(function (prev) { return prev ? Object.assign({}, prev, { assigned_to: newAssignee }) : prev })
      setPoList(function (prev) {
        return prev.map(function (p) {
          if (p.id !== poId) return p
          return Object.assign({}, p, { assigned_to: newAssignee, assignee: { name: staff?.name || null } })
        })
      })
    } finally {
      assignLockRef.current = false
    }
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

  // ─── MARK ITEM PURCHASED (purchaser) — atomic via RPC ───
  async function markPurchased(poItemId, actualQty, actualCostPaise, receiptFile) {
    if (saving) return
    setSaving(true)

    // Upload receipt first (storage upload is not txn-safe; keep it client-side)
    var receiptPath = null
    if (receiptFile) {
      var rF = await prepUpload(receiptFile, 100)
      var ext = rF.name.split('.').pop()
      var fileName = profile.id + '/po-' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(fileName, rF)
      if (!upErr) receiptPath = fileName
    }

    // Atomic: PO item update + wallet debit + expense + allocations + link
    var { data: expenseId, error } = await supabase.rpc('record_po_purchase', {
      p_po_item_id: poItemId,
      p_actual_qty: actualQty,
      p_actual_cost_paise: actualCostPaise,
      p_receipt_path: receiptPath,
    })
    if (error) { alert('Purchase failed: ' + error.message); setSaving(false); return }

    // Update local state — mirror what the RPC wrote
    var poItemName = (activePoItems.find(function (p) { return p.id === poItemId }) || {}).item_name || ''
    var updatedItems = activePoItems.map(function (p) {
      if (p.id !== poItemId) return p
      var patch = {
        actual_qty: actualQty,
        actual_cost_paise: actualCostPaise,
        purchased_by: profile.id,
        purchased_at: new Date().toISOString(),
        status: 'purchased',
      }
      if (receiptPath) patch.receipt_path = receiptPath
      if (expenseId) patch.expense_id = expenseId
      return Object.assign({}, p, patch)
    })
    setActivePoItems(updatedItems)

    // DB trigger auto-completes PO; mirror locally
    if (activePo) {
      var allDone = updatedItems.every(function (p) { return p.status === 'purchased' || p.status === 'cancelled' })
      if (allDone) {
        setActivePo(function (prev) { return prev ? Object.assign({}, prev, { status: 'completed' }) : prev })
        try { await logActivity('PO_COMPLETE', 'PO ' + (activePo?.id || '').slice(0, 8) + ' auto-completed') } catch (_) {}
      }
    }

    try { await logActivity('PO_ITEM_PURCHASED', titleCase(poItemName) + ' | ₹' + (actualCostPaise / 100)) } catch (_) {}
    setSaving(false)
  }

  // Only block on initial mount when there's nothing to show yet.
  // `loading` only goes from true → false (never back), so this shows once.
  // Never block on `queueLoading` — it fires on every refetch and would blank
  // the detail view. The queue tab has its own local indicator further down.
  // Never block when a detail view is already open — its data is already loaded.
  // PO list split: when no status filter is applied, cancelled POs get their own
  // section below the active list so admins don't lose them in the mix.
  var activePos = poList.filter(function (p) { return p.status !== 'cancelled' })
  var cancelledPos = poList.filter(function (p) { return p.status === 'cancelled' })
  var showSplit = !poStatusFilter && cancelledPos.length > 0
  var visiblePos = showSplit ? activePos : poList

  if (!isReceiver && loading && view !== 'detail') {
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
        vendorList={vendorList}
        onBack={function () { navBack() }}
        onStatusChange={updatePoStatus}
        onAssign={assignPurchaser}
        onSaveVendor={savePoItemVendor}
        onMarkPurchased={markPurchased}
        onDeletePo={deletePo}
        onRemoveItem={removePoItem}
        onCancelPo={cancelPo}
        onConfirmReturn={confirmReturn}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // RECEIVER VIEW — only Receiving tab
  // ═══════════════════════════════════════════════
  if (isReceiver) {
    return (
      <ReceivingContent
        items={receivingItems} loading={receivingLoading}
        receivingItem={receivingItem} setReceivingItem={setReceivingItem}
        receiveQty={receiveQty} setReceiveQty={setReceiveQty}
        saving={saving} showInvForm={showInvForm} setShowInvForm={setShowInvForm}
        onReceiveExisting={receiveExistingItem} onReceiveNewDone={receiveNewDone}
        profile={profile} title="Receive Items"
      />
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
        <div className="flex flex-col lg:flex-row gap-5">
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
                <div className="hidden lg:grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  <div className="col-span-1"></div>
                  <div className="col-span-3">Item</div>
                  <div className="col-span-2">Category / Source</div>
                  <div className="col-span-1">Qty</div>
                  <div className="col-span-3">Requisition</div>
                  <div className="col-span-2 text-right">Est. Cost</div>
                </div>
                {/* Rows */}
                <div className="max-h-[60vh] overflow-y-auto">
                  {/* Mobile cards */}
                  {queueItems.map(function (q, qi) {
                    var isSelected = selectedQueue.indexOf(q.id) !== -1
                    var req = q.requisitions || {}
                    return (
                      <div key={q.id}
                        onClick={function () { toggleQueueItem(q.id) }}
                        className={"px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 lg:hidden " +
                          (isSelected ? "bg-indigo-50/60" : "hover:bg-gray-50")}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={isSelected} readOnly
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-gray-800 truncate">{titleCase(q.item_name)}</p>
                              <span className={"text-[10px] font-bold flex-shrink-0 " + (q._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                                {q._source === 'new' ? 'New' : q._source === 'catering_store' ? 'CS' : 'INV'}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {q.categories?.name || '—'} · {q.qty} {q.unit || 'Pcs'}
                              {q.estimated_cost_paise > 0 ? ' · ' + formatPaise(q.estimated_cost_paise) : ''}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate">{req.purpose || '—'} · {req.profiles?.name || '—'}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {/* Desktop grid */}
                  {queueItems.map(function (q, qi) {
                    var isSelected = selectedQueue.indexOf(q.id) !== -1
                    var req = q.requisitions || {}
                    return (
                      <div key={q.id}
                        onClick={function () { toggleQueueItem(q.id) }}
                        className={"hidden lg:grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer transition-colors border-b border-gray-50 " +
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

          {/* Mobile cart bar */}
          {selectedQueue.length > 0 && (
            <div className="lg:hidden sticky bottom-0 bg-white border-t border-gray-200 rounded-xl p-3 shadow-lg flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{selectedQueue.length} item{selectedQueue.length !== 1 ? 's' : ''}</p>
                <p className="text-[11px] text-gray-400 truncate">Est: {formatPaise(
                  queueItems.filter(function (q) { return selectedQueue.indexOf(q.id) !== -1 })
                    .reduce(function (sum, q) { return sum + (q.estimated_cost_paise || 0) }, 0)
                )}</p>
              </div>
              <button onClick={createPo} disabled={saving}
                className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex-shrink-0">
                {saving ? '...' : 'Create PO →'}
              </button>
            </div>
          )}

          {/* Right: Cart sidebar */}
          <div className="hidden lg:block w-72 flex-shrink-0">
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
            {['', 'draft', 'confirmed', 'completed', 'closed', 'cancelling', 'cancelled'].map(function (s) {
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

          {visiblePos.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <div className="col-span-2">PO #</div>
                <div className="col-span-2">Created</div>
                <div className="col-span-2">Created By</div>
                <div className="col-span-2">Assigned To</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-3 text-right">Notes</div>
              </div>
              {/* Mobile cards */}
              {visiblePos.map(function (po, pi) {
                var assigneeName = po.assignee?.name || null
                return (
                  <div key={po.id}
                    onClick={function () { openPoDetail(po) }}
                    className={"px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 hover:bg-indigo-50/40 lg:hidden"}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-indigo-600">#{po.id.slice(0, 8)}</p>
                        <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
                          {PO_STATUS_LABELS[po.status] || po.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">{formatDate(po.created_at)}</p>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {po.profiles?.name || '—'}
                      {assigneeName ? ' · 🛒 ' + assigneeName : ' · Unassigned'}
                    </p>
                    {po.notes && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{po.notes}</p>}
                  </div>
                )
              })}
              {/* Desktop grid */}
              {visiblePos.map(function (po, pi) {
                var assigneeName = po.assignee?.name || null
                return (
                  <div key={po.id}
                    onClick={function () { openPoDetail(po) }}
                    className={"hidden lg:grid grid-cols-12 gap-3 px-5 py-4 items-center cursor-pointer transition-colors " +
                      (pi < visiblePos.length - 1 ? "border-b border-gray-50 " : "") +
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

          {/* ═══ CANCELLED POs — surfaced as a peer section when no filter is applied ═══ */}
          {showSplit && (
            <div className="bg-white rounded-xl border-2 border-red-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">🚫 Cancelled Purchase Orders</span>
                <span className="text-[11px] font-bold text-red-700 bg-white px-2 py-0.5 rounded-full border border-red-200">{cancelledPos.length}</span>
              </div>
              <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <div className="col-span-2">PO #</div>
                <div className="col-span-2">Created</div>
                <div className="col-span-2">Created By</div>
                <div className="col-span-2">Assigned To</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-3 text-right">Notes</div>
              </div>
              {/* Mobile cards */}
              {cancelledPos.map(function (po, pi) {
                var assigneeName = po.assignee?.name || null
                return (
                  <div key={po.id}
                    onClick={function () { openPoDetail(po) }}
                    className={"px-4 py-3 cursor-pointer transition-colors border-b border-red-50 hover:bg-red-50/40 lg:hidden opacity-75"}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-red-600">#{po.id.slice(0, 8)}</p>
                        <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (PO_STATUS_COLORS[po.status] || '')}>
                          {PO_STATUS_LABELS[po.status] || po.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">{formatDate(po.created_at)}</p>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {po.profiles?.name || '—'}
                      {assigneeName ? ' · 🛒 ' + assigneeName : ' · Unassigned'}
                    </p>
                    {po.notes && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{po.notes}</p>}
                  </div>
                )
              })}
              {/* Desktop grid */}
              {cancelledPos.map(function (po, pi) {
                var assigneeName = po.assignee?.name || null
                return (
                  <div key={po.id}
                    onClick={function () { openPoDetail(po) }}
                    className={"hidden lg:grid grid-cols-12 gap-3 px-5 py-4 items-center cursor-pointer transition-colors opacity-75 " +
                      (pi < cancelledPos.length - 1 ? "border-b border-red-50 " : "") +
                      "hover:bg-red-50/40"}>
                    <div className="col-span-2">
                      <p className="text-sm font-bold text-red-600">#{po.id.slice(0, 8)}</p>
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
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {['purchased', 'received', 'pending_return', 'returned', ''].map(function (s) {
              var label = s ? ITEM_STATUS_LABELS[s] : 'All'
              return (
                <button key={s || 'all'} onClick={function () { setReceivingStatusFilter(s) }}
                  className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                    (receivingStatusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                  {label}
                </button>
              )
            })}
          </div>
          {receivingItems.length > 0 && (
            <button onClick={function () { generateReceivingListPdf(receivingItems) }}
              className="px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              🖨️ Export PDF
            </button>
          )}
        </div>
      )}
      {tab === 'receiving' && (
        <ReceivingContent
          items={receivingItems} loading={receivingLoading}
          receivingItem={receivingItem} setReceivingItem={setReceivingItem}
          receiveQty={receiveQty} setReceiveQty={setReceiveQty}
          saving={saving} showInvForm={showInvForm} setShowInvForm={setShowInvForm}
          onReceiveExisting={receiveExistingItem} onReceiveNewDone={receiveNewDone}
          profile={profile}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RECEIVING CONTENT — shared by receiver view + admin tab
// ═══════════════════════════════════════════════════════════════
function ReceivingContent({ items, loading, receivingItem, setReceivingItem, receiveQty, setReceiveQty, saving, showInvForm, setShowInvForm, onReceiveExisting, onReceiveNewDone, profile, title }) {
  if (showInvForm) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={function () { setShowInvForm(null) }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
          <h3 className="text-sm font-bold text-gray-900">Add New Item to Inventory</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <p className="text-[11px] text-amber-700">Receiving <strong>{titleCase(showInvForm.item_name)}</strong> — fill details below. Pre-filled from PO.</p>
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
          onSaved={function (savedItem, tableName) { onReceiveNewDone(savedItem, tableName) }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {title && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {items.length > 0 && (
            <button onClick={function () { generateReceivingListPdf(items) }}
              className="px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              🖨️ PDF
            </button>
          )}
        </div>
      )}
      {loading && <p className="text-gray-400 text-sm text-center py-8">Loading...</p>}
      {!loading && items.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-400 text-sm">No items awaiting receiving</p>
        </div>
      )}
      {!loading && items.map(function (it) {
        var isActive = receivingItem === it.id
        return (
          <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800">{titleCase(it.item_name)}</p>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (ITEM_STATUS_COLORS[it.status] || '')}>
                    {ITEM_STATUS_LABELS[it.status] || it.status}
                  </span>
                </div>
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
            {it._source !== 'new' && !isActive && it.status === 'purchased' && (
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
                  <button onClick={function () { onReceiveExisting(it) }} disabled={saving}
                    className="flex-1 py-2 text-xs text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving...' : '✓ Confirm'}
                  </button>
                </div>
              </div>
            )}
            {it._source === 'new' && it.status === 'purchased' && (
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

// ═══════════════════════════════════════════════════════════════
// PO DETAIL
// ═══════════════════════════════════════════════════════════════
function PoDetail({ po, items, setItems, profile, isAdmin, staffList, saving, vendorList, onBack, onStatusChange, onAssign, onSaveVendor, onMarkPurchased, onDeletePo, onRemoveItem, onCancelPo, onConfirmReturn }) {
  var [editingVendor, setEditingVendor] = useState(null)
  var [vendorForm, setVendorForm] = useState({ name: '', contact: '', rate: '' })
  var [vendorSearch, setVendorSearch] = useState('')
  var [vendorMode, setVendorMode] = useState('select')
  var [purchasingItem, setPurchasingItem] = useState(null)
  var [purchaseForm, setPurchaseForm] = useState({ qty: '', cost: '', receipt: null, vendorName: '', vendorRate: '' })
  var [selectedForPurchase, setSelectedForPurchase] = useState([])
  var [selectedForBulk, setSelectedForBulk] = useState([])
  var [multiOpen, setMultiOpen] = useState(false)
  var [multiForm, setMultiForm] = useState({ vendor: '', vendorContact: '', receipt: null, items: {} })
  var [multiProcessing, setMultiProcessing] = useState(false)
  var [multiProgress, setMultiProgress] = useState(null)
  var [rateHistory, setRateHistory] = useState([])
  var [rateLoading, setRateLoading] = useState(false)
  var [showAddVendor, setShowAddVendor] = useState(null)
  var [editingNotes, setEditingNotes] = useState(false)
  var [notesText, setNotesText] = useState(po.notes || '')
  var [notesSaving, setNotesSaving] = useState(false)

  var isPurchaser = po.assigned_to === profile?.id
  var canEdit = isAdmin && (po.status === 'draft' || po.status === 'confirmed')
  var canConfirm = isAdmin && po.status === 'draft' && items.length > 0
  var allReceived = items.length > 0 && items.every(function (it) { return it.status === 'received' || it.status === 'cancelled' || it.status === 'returned' })
  var canClose = isAdmin && (po.status === 'completed' || po.status === 'confirmed') && allReceived
  var canDelete = isAdmin && po.status === 'draft'
  var canPurchase = isPurchaser && po.status === 'confirmed'
  var canCancel = isAdmin && (po.status === 'confirmed' || po.status === 'completed')
  var isCancelling = po.status === 'cancelling'

  var totalEstPaise = 0
  var totalActualPaise = 0
  var pendingCount = 0
  var purchasedCount = 0
  var pendingReturnCount = 0
  var returnedCount = 0
  items.forEach(function (it) {
    if (it.estimated_cost_paise) totalEstPaise += it.estimated_cost_paise
    if (it.actual_cost_paise) totalActualPaise += it.actual_cost_paise
    if (it.status === 'pending') pendingCount++
    if (it.status === 'purchased') purchasedCount++
    if (it.status === 'received') purchasedCount++
    if (it.status === 'pending_return') pendingReturnCount++
    if (it.status === 'returned') returnedCount++
  })

  var [expenseTypes, setExpenseTypes] = useState([])
  var [expenseSubTypes, setExpenseSubTypes] = useState([])
  var [bulkVendor, setBulkVendor] = useState('')
  var [bulkVendorRate, setBulkVendorRate] = useState('')
  var [expDepartments, setExpDepartments] = useState([])
  var [expSubDepartments, setExpSubDepartments] = useState([])
  var [expTypeDeptFilter, setExpTypeDeptFilter] = useState('')
  var [expTypeSubDeptFilter, setExpTypeSubDeptFilter] = useState('')
  var [bulkExpType, setBulkExpType] = useState('')
  var [bulkExpSubType, setBulkExpSubType] = useState('')
  var [editingItemExp, setEditingItemExp] = useState(null)
  var [itemExpForm, setItemExpForm] = useState({ typeId: '', subTypeId: '' })

  useEffect(function () {
    Promise.all([
      supabase.from('expense_types').select('id, name, icon, sort_order, department_id, sub_department_id').eq('active', true).order('sort_order').order('name'),
      supabase.from('expense_sub_types').select('id, expense_type_id, name, active, sort_order').eq('active', true).order('sort_order').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
    ]).then(function (res) {
      setExpenseTypes(res[0].data || [])
      setExpenseSubTypes(res[1].data || [])
      setExpDepartments(res[2].data || [])
      setExpSubDepartments(res[3].data || [])
    })
  }, [])

  // Filtered expense types (dept + sub-dept scoping — globals with null scope always show)
  var filteredExpenseTypes = expenseTypes.filter(function (et) {
    if (expTypeDeptFilter) {
      var deptId = Number(expTypeDeptFilter)
      if (et.department_id !== null && et.department_id !== deptId) return false
    }
    if (expTypeSubDeptFilter) {
      var sdId = Number(expTypeSubDeptFilter)
      if (et.sub_department_id !== null && et.sub_department_id !== sdId) return false
    }
    return true
  })

  async function applyVendorToAll() {
    var vendorName = bulkVendor.trim()
    if (!vendorName) { alert('Select or enter vendor'); return }
    var allPending = items.filter(function (it) { return it.status === 'pending' })
    if (allPending.length === 0) { alert('No pending items to update'); return }
    var targetItems = selectedForBulk.length > 0
      ? allPending.filter(function (it) { return selectedForBulk.indexOf(it.id) !== -1 })
      : allPending
    if (targetItems.length === 0) { alert('No pending items in selection'); return }
    var existing = targetItems.filter(function (it) { return it.vendor_name })
    if (existing.length > 0 && !confirm('Overwrite vendor on ' + existing.length + ' item(s) that already has one?')) return
    var ratePaise = bulkVendorRate ? Math.round(Number(bulkVendorRate) * 100) : null
    var vendorRow = (vendorList || []).find(function (v) { return v.name === vendorName })
    var vendorContact = vendorRow ? (vendorRow.phone || vendorRow.contact || null) : null
    for (var i = 0; i < targetItems.length; i++) {
      var it = targetItems[i]
      var patch = { vendor_name: vendorName, vendor_contact: vendorContact }
      if (ratePaise) { patch.vendor_rate_paise = ratePaise; patch.estimated_cost_paise = ratePaise * it.qty_ordered }
      var { error } = await supabase.from('purchase_order_items').update(patch).eq('id', it.id)
      if (error) { alert('Failed on ' + it.item_name + ': ' + error.message); return }
    }
    var itemIds = targetItems.map(function (it) { return it.id })
    setItems(function (prev) {
      return prev.map(function (it) {
        if (itemIds.indexOf(it.id) === -1) return it
        var patch = { vendor_name: vendorName, vendor_contact: vendorContact }
        if (ratePaise) { patch.vendor_rate_paise = ratePaise; patch.estimated_cost_paise = ratePaise * it.qty_ordered }
        return Object.assign({}, it, patch)
      })
    })
    try { await logActivity('PO_BULK_VENDOR', vendorName + ' → ' + targetItems.length + ' items') } catch (_) {}
    setBulkVendor('')
    setBulkVendorRate('')
    setSelectedForBulk([])
  }

  async function applyExpTypeToAll() {
    if (!bulkExpType) { alert('Select expense type'); return }
    var typeId = Number(bulkExpType)
    var subTypeId = bulkExpSubType ? Number(bulkExpSubType) : null
    var allPending = items.filter(function (it) { return it.status === 'pending' })
    if (allPending.length === 0) { alert('No pending items to update'); return }
    var targetItems = selectedForBulk.length > 0
      ? allPending.filter(function (it) { return selectedForBulk.indexOf(it.id) !== -1 })
      : allPending
    if (targetItems.length === 0) { alert('No pending items in selection'); return }
    var existing = targetItems.filter(function (it) { return it.expense_type_id })
    if (existing.length > 0 && !confirm('Overwrite expense type on ' + existing.length + ' item(s) that already has one?')) return
    var itemIds = targetItems.map(function (it) { return it.id })
    var { error } = await supabase.from('purchase_order_items')
      .update({ expense_type_id: typeId, expense_sub_type_id: subTypeId })
      .in('id', itemIds)
    if (error) { alert('Failed: ' + error.message); return }
    setItems(function (prev) {
      return prev.map(function (it) {
        if (itemIds.indexOf(it.id) === -1) return it
        return Object.assign({}, it, { expense_type_id: typeId, expense_sub_type_id: subTypeId })
      })
    })
    try { await logActivity('PO_BULK_EXPTYPE', targetItems.length + ' items') } catch (_) {}
    setBulkExpType('')
    setBulkExpSubType('')
    setSelectedForBulk([])
  }

  async function saveItemExpType(itemId) {
    if (!itemExpForm.typeId) { alert('Select expense type'); return }
    var typeId = Number(itemExpForm.typeId)
    var subTypeId = itemExpForm.subTypeId ? Number(itemExpForm.subTypeId) : null
    var { error } = await supabase.from('purchase_order_items')
      .update({ expense_type_id: typeId, expense_sub_type_id: subTypeId })
      .eq('id', itemId)
    if (error) { alert('Failed: ' + error.message); return }
    setItems(function (prev) {
      return prev.map(function (it) { return it.id === itemId ? Object.assign({}, it, { expense_type_id: typeId, expense_sub_type_id: subTypeId }) : it })
    })
    setEditingItemExp(null)
  }

  function startEditItemExp(it) {
    setEditingItemExp(it.id)
    setItemExpForm({
      typeId: it.expense_type_id ? String(it.expense_type_id) : '',
      subTypeId: it.expense_sub_type_id ? String(it.expense_sub_type_id) : '',
    })
  }

  var staffItems = useMemo(function () {
    return staffList.map(function (s) { return { label: s.name + (s.role === 'admin' ? ' (Admin)' : ''), value: s.id } })
  }, [staffList])

  function startVendorEdit(it) {
    setEditingVendor(it.id)
    setVendorSearch('')
    setVendorMode(it.vendor_name ? 'custom' : 'select')
    setVendorForm({
      name: it.vendor_name || '',
      contact: it.vendor_contact || '',
      rate: it.vendor_rate_paise ? String(it.vendor_rate_paise / 100) : '',
    })
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

  function selectVendorFromList(vendor) {
    setVendorForm(function (p) { return Object.assign({}, p, { name: vendor.name, contact: vendor.phone || vendor.contact || '' }) })
    setVendorMode('custom')
    setVendorSearch('')
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
      vendorName: it.vendor_name || '',
      vendorRate: it.vendor_rate_paise ? String(it.vendor_rate_paise / 100) : '',
    })
  }

  function toggleSelectPurchase(id) {
    setSelectedForPurchase(function (prev) {
      if (prev.indexOf(id) === -1) return prev.concat([id])
      return prev.filter(function (x) { return x !== id })
    })
  }

  function openMultiPurchase() {
    var selectedItems = items.filter(function (it) { return selectedForPurchase.indexOf(it.id) !== -1 && it.status === 'pending' })
    if (selectedItems.length === 0) { alert('Select at least one pending item'); return }
    // Guard: all items need resolvable expense type
    var missing = selectedItems.filter(function (it) { return !it.expense_type_id && !it.categories?.default_expense_type_id })
    if (missing.length > 0) {
      alert('These items have no expense type set: ' + missing.map(function (m) { return m.item_name }).join(', ') + '. Ask admin to set one before bulk purchase.')
      return
    }
    // Prefill shared vendor if all selected match
    var vendors = selectedItems.map(function (it) { return it.vendor_name || '' }).filter(Boolean)
    var uniq = vendors.filter(function (v, i, a) { return a.indexOf(v) === i })
    var sharedVendor = uniq.length === 1 ? uniq[0] : ''
    var sharedContact = ''
    if (sharedVendor) {
      var vRow = (vendorList || []).find(function (v) { return v.name === sharedVendor })
      sharedContact = vRow ? (vRow.phone || vRow.contact || '') : (selectedItems[0].vendor_contact || '')
    }
    var itemForms = {}
    selectedItems.forEach(function (it) {
      itemForms[it.id] = {
        qty: String(it.qty_ordered || ''),
        cost: it.estimated_cost_paise ? String(it.estimated_cost_paise / 100) : '',
      }
    })
    setMultiForm({ vendor: sharedVendor, vendorContact: sharedContact, receipt: null, items: itemForms })
    setMultiProgress(null)
    setMultiOpen(true)
  }

  async function confirmMultiPurchase() {
    if (multiProcessing) return
    var selectedItems = items.filter(function (it) { return selectedForPurchase.indexOf(it.id) !== -1 && it.status === 'pending' })
    if (selectedItems.length === 0) { alert('No selected items still pending'); return }
    for (var i = 0; i < selectedItems.length; i++) {
      var f = multiForm.items[selectedItems[i].id] || {}
      if (!Number(f.qty) || Number(f.qty) <= 0) { alert('Enter qty for all items'); return }
      if (!Number(f.cost) || Number(f.cost) <= 0) { alert('Enter cost for all items'); return }
    }
    setMultiProcessing(true)
    setMultiProgress({ done: 0, failed: 0, total: selectedItems.length, failedRows: [] })

    // Upload receipt ONCE
    var receiptPath = null
    if (multiForm.receipt) {
      var mF = await prepUpload(multiForm.receipt, 100)
      var ext = mF.name.split('.').pop()
      var fileName = profile.id + '/po-multi-' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(fileName, mF)
      if (upErr) { alert('Receipt upload failed: ' + upErr.message); setMultiProcessing(false); return }
      receiptPath = fileName
    }

    // Update vendor per item (only if changed) — one round-trip each
    var vendorName = (multiForm.vendor || '').trim()
    if (vendorName) {
      var vendorContact = (multiForm.vendorContact || '').trim() || null
      for (var i = 0; i < selectedItems.length; i++) {
        var it = selectedItems[i]
        if (it.vendor_name !== vendorName) {
          await supabase.from('purchase_order_items').update({ vendor_name: vendorName, vendor_contact: vendorContact }).eq('id', it.id)
        }
      }
    }

    // Call record_po_purchase per item with shared receipt path
    var done = 0, failed = 0, failedRows = []
    for (var i = 0; i < selectedItems.length; i++) {
      var it = selectedItems[i]
      var f = multiForm.items[it.id]
      try {
        var { error } = await supabase.rpc('record_po_purchase', {
          p_po_item_id: it.id,
          p_actual_qty: Number(f.qty),
          p_actual_cost_paise: Math.round(Number(f.cost) * 100),
          p_receipt_path: receiptPath,
        })
        if (error) throw error
        done++
      } catch (err) {
        failed++
        failedRows.push({ name: it.item_name, reason: err?.message || 'Failed' })
      }
      setMultiProgress({ done: done, failed: failed, total: selectedItems.length, failedRows: failedRows })
    }

    // Refresh purchased items from DB
    var { data: refreshed } = await supabase.from('purchase_order_items')
      .select('id, status, actual_qty, actual_cost_paise, purchased_by, purchased_at, receipt_path, expense_id, vendor_name, vendor_contact')
      .in('id', selectedItems.map(function (it) { return it.id }))
    if (refreshed) {
      setItems(function (prev) {
        return prev.map(function (p) {
          var upd = refreshed.find(function (r) { return r.id === p.id })
          return upd ? Object.assign({}, p, upd) : p
        })
      })
    }
    try { await logActivity('PO_MULTI_PURCHASED', done + ' items | 1 bill') } catch (_) {}
    setSelectedForPurchase([])
    setMultiProcessing(false)
  }

  async function confirmPurchase(poItemId) {
    var actualQty = Number(purchaseForm.qty)
    var actualCostPaise = Math.round(Number(purchaseForm.cost) * 100)
    if (!actualQty || actualQty <= 0) { alert('Enter qty purchased'); return }
    if (!actualCostPaise || actualCostPaise <= 0) { alert('Enter actual cost'); return }

    // Guard: expense will fail to create if no expense type resolvable (POI or category default)
    var checkItem = items.find(function (it) { return it.id === poItemId })
    if (checkItem && !checkItem.expense_type_id && !checkItem.categories?.default_expense_type_id) {
      alert('This item has no expense type set. Either click the Type link on the item to set one, or set a default on the Category via Masters → Categories.')
      return
    }

    var vendorChanged = false
    var item = items.find(function (it) { return it.id === poItemId })
    var newVendorName = purchaseForm.vendorName.trim()
    var newRatePaise = purchaseForm.vendorRate ? Math.round(Number(purchaseForm.vendorRate) * 100) : null

    if (item && newVendorName && newVendorName !== (item.vendor_name || '')) {
      vendorChanged = true
      await onSaveVendor(poItemId, newVendorName, '', newRatePaise, null)
    } else if (item && newRatePaise && newRatePaise !== item.vendor_rate_paise) {
      await onSaveVendor(poItemId, newVendorName || item.vendor_name, '', newRatePaise, null)
    }

    await onMarkPurchased(poItemId, actualQty, actualCostPaise, purchaseForm.receipt)
    setPurchasingItem(null)

    if (vendorChanged && newVendorName) {
      var isInMaster = (vendorList || []).some(function (v) { return v.name.toLowerCase() === newVendorName.toLowerCase() })
      if (!isInMaster) {
        setShowAddVendor({ name: newVendorName, contact: '' })
      }
    }
  }

  async function addVendorToMaster() {
    if (!showAddVendor) return
    var { error } = await supabase.from('vendors').insert({
      name: showAddVendor.name,
      contact: showAddVendor.contact || null,
      phone: showAddVendor.contact || null,
      active: true,
      vendor_type: 'Supplier',
    })
    if (error) { alert('Failed: ' + error.message) }
    setShowAddVendor(null)
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

      {/* Cancelling banner */}
      {isCancelling && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-orange-500 text-lg">⚠</span>
          <div>
            <p className="text-sm font-bold text-orange-700">Cancellation in progress</p>
            <p className="text-xs text-orange-600">{pendingReturnCount} item{pendingReturnCount !== 1 ? 's' : ''} pending return — confirm returns to credit purchaser wallet</p>
          </div>
        </div>
      )}

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

          {/* Bulk expense type — admin, draft/confirmed */}
          {canEdit && (function () {
            var subForBulk = bulkExpType ? expenseSubTypes.filter(function (st) { return st.expense_type_id === Number(bulkExpType) }) : []
            return (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Expense Type — {selectedForBulk.length > 0 ? 'Apply to ' + selectedForBulk.length + ' selected' : 'Apply to all pending items'}</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select value={expTypeDeptFilter}
                    onChange={function (e) { setExpTypeDeptFilter(e.target.value); setExpTypeSubDeptFilter(''); setBulkExpType(''); setBulkExpSubType('') }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ fontSize: '16px' }}>
                    <option value="">🔎 All Depts</option>
                    {expDepartments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                  </select>
                  <select value={expTypeSubDeptFilter}
                    onChange={function (e) { setExpTypeSubDeptFilter(e.target.value); setBulkExpType(''); setBulkExpSubType('') }}
                    disabled={!expTypeDeptFilter}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                    style={{ fontSize: '16px' }}>
                    <option value="">All Sub-depts</option>
                    {expSubDepartments.filter(function (sd) { return !expTypeDeptFilter || sd.department_id === Number(expTypeDeptFilter) }).map(function (sd) {
                      return <option key={sd.id} value={String(sd.id)}>{sd.name}</option>
                    })}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select value={bulkExpType}
                    onChange={function (e) { setBulkExpType(e.target.value); setBulkExpSubType('') }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ fontSize: '16px' }}>
                    <option value="">Select type... ({filteredExpenseTypes.length})</option>
                    {filteredExpenseTypes.map(function (et) {
                      return <option key={et.id} value={String(et.id)}>{(et.icon ? et.icon + ' ' : '') + et.name}</option>
                    })}
                  </select>
                  {subForBulk.length > 0 && (
                    <select value={bulkExpSubType}
                      onChange={function (e) { setBulkExpSubType(e.target.value) }}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ fontSize: '16px' }}>
                      <option value="">Sub-type...</option>
                      {subForBulk.map(function (st) {
                        return <option key={st.id} value={String(st.id)}>{st.name}</option>
                      })}
                    </select>
                  )}
                </div>
                <button onClick={applyExpTypeToAll} disabled={!bulkExpType || saving}
                  className="w-full py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors">
                  {selectedForBulk.length > 0 ? 'Apply to ' + selectedForBulk.length + ' selected' : 'Apply to all pending'}
                </button>
              </div>
            )
          })()}

          {/* Vendor — Apply to all pending items */}
          {canEdit && items.some(function (it) { return it.status === 'pending' }) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Vendor — {selectedForBulk.length > 0 ? 'Apply to ' + selectedForBulk.length + ' selected' : 'Apply to all pending items'}</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <select value={bulkVendor}
                  onChange={function (e) { setBulkVendor(e.target.value) }}
                  className="col-span-2 w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ fontSize: '16px' }}>
                  <option value="">Select vendor...</option>
                  {(vendorList || []).map(function (v) {
                    return <option key={v.id} value={v.name}>{v.name}{v.phone ? ' · ' + v.phone : ''}</option>
                  })}
                </select>
                <input type="number" min="0" step="any" inputMode="decimal" value={bulkVendorRate}
                  onChange={function (e) { setBulkVendorRate(e.target.value) }}
                  placeholder="Rate ₹ (opt)"
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <button onClick={applyVendorToAll} disabled={!bulkVendor || saving}
                className="w-full py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors">
                {selectedForBulk.length > 0 ? 'Apply to ' + selectedForBulk.length + ' selected' : 'Apply to all pending'}
              </button>
            </div>
          )}

          {/* Items table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length + ' Item' + (items.length !== 1 ? 's' : '')}</span>
              <span className="text-xs text-gray-400">{purchasedCount + receivedCount} of {items.length} done</span>
            </div>
            {canEdit && pendingCount > 0 && (
              <div className="px-4 py-2 bg-blue-50/40 border-b border-gray-100 flex items-center gap-2 text-xs">
                <span className="text-gray-500">{selectedForBulk.length > 0 ? selectedForBulk.length + ' of ' + pendingCount + ' selected' : 'Bulk select:'}</span>
                <button onClick={function () {
                  var pendingIds = items.filter(function (it) { return it.status === 'pending' }).map(function (it) { return it.id })
                  setSelectedForBulk(selectedForBulk.length === pendingIds.length ? [] : pendingIds)
                }} className="font-semibold text-blue-700 hover:underline">
                  {selectedForBulk.length === pendingCount ? 'Clear all' : 'Select all pending'}
                </button>
                {selectedForBulk.length > 0 && selectedForBulk.length !== pendingCount && (
                  <button onClick={function () { setSelectedForBulk([]) }} className="font-semibold text-gray-500 hover:underline ml-auto">
                    Clear
                  </button>
                )}
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {items.map(function (it) {
                var isEditingVendor = editingVendor === it.id
                var isPurchasing = purchasingItem === it.id
                var itemVariance = (it.actual_cost_paise || 0) - (it.estimated_cost_paise || 0)

                return (
                  <div key={it.id} className="px-4 py-4 space-y-2">
                    {/* Item row */}
                    <div className="flex items-start justify-between gap-3">
                      {canEdit && it.status === 'pending' && (
                        <input type="checkbox" checked={selectedForBulk.indexOf(it.id) !== -1}
                          onChange={function (e) {
                            e.stopPropagation()
                            setSelectedForBulk(function (prev) {
                              if (prev.indexOf(it.id) !== -1) return prev.filter(function (x) { return x !== it.id })
                              return prev.concat([it.id])
                            })
                          }}
                          onClick={function (e) { e.stopPropagation() }}
                          className="mt-1 w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0"
                          title="Select for bulk apply" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800">{titleCase(it.item_name)}</p>
                          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (ITEM_STATUS_COLORS[it.status] || '')}>
                            {ITEM_STATUS_LABELS[it.status] || it.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {it.categories?.name || '—'} · {it.qty_ordered} {it.unit} · <span className={"font-medium " + (it._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                            {it._source === 'new' ? 'New' : it._source === 'catering_store' ? 'CS' : 'INV'}
                          </span>
                        </p>
                        {(function () {
                          var et = it.expense_type_id ? expenseTypes.find(function (x) { return x.id === it.expense_type_id }) : null
                          var st = it.expense_sub_type_id ? expenseSubTypes.find(function (x) { return x.id === it.expense_sub_type_id }) : null
                          var canEditExp = canEdit && it.status === 'pending'
                          var isEditingExp = editingItemExp === it.id
                          if (isEditingExp) {
                            var subForItem = itemExpForm.typeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(itemExpForm.typeId) }) : []
                            return (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5" onClick={function (e) { e.stopPropagation() }}>
                                <select value={expTypeDeptFilter}
                                  onChange={function (e) { setExpTypeDeptFilter(e.target.value); setExpTypeSubDeptFilter(''); setItemExpForm({ typeId: '', subTypeId: '' }) }}
                                  className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  style={{ fontSize: '16px' }}>
                                  <option value="">🔎 All Depts</option>
                                  {expDepartments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                                </select>
                                <select value={expTypeSubDeptFilter}
                                  onChange={function (e) { setExpTypeSubDeptFilter(e.target.value); setItemExpForm({ typeId: '', subTypeId: '' }) }}
                                  disabled={!expTypeDeptFilter}
                                  className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                                  style={{ fontSize: '16px' }}>
                                  <option value="">All Sub-depts</option>
                                  {expSubDepartments.filter(function (sd) { return !expTypeDeptFilter || sd.department_id === Number(expTypeDeptFilter) }).map(function (sd) {
                                    return <option key={sd.id} value={String(sd.id)}>{sd.name}</option>
                                  })}
                                </select>
                                <select value={itemExpForm.typeId}
                                  onChange={function (e) { setItemExpForm({ typeId: e.target.value, subTypeId: '' }) }}
                                  className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  style={{ fontSize: '16px' }}>
                                  <option value="">Type... ({filteredExpenseTypes.length})</option>
                                  {filteredExpenseTypes.map(function (x) { return <option key={x.id} value={String(x.id)}>{x.name}</option> })}
                                </select>
                                {subForItem.length > 0 && (
                                  <select value={itemExpForm.subTypeId}
                                    onChange={function (e) { setItemExpForm(function (p) { return Object.assign({}, p, { subTypeId: e.target.value }) }) }}
                                    className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    style={{ fontSize: '16px' }}>
                                    <option value="">Sub...</option>
                                    {subForItem.map(function (x) { return <option key={x.id} value={String(x.id)}>{x.name}</option> })}
                                  </select>
                                )}
                                <button onClick={function () { saveItemExpType(it.id) }} className="text-[10px] font-bold text-blue-600 px-1.5 py-1 hover:bg-blue-50 rounded">Save</button>
                                <button onClick={function () { setEditingItemExp(null) }} className="text-[10px] text-gray-500 px-1.5 py-1 hover:bg-gray-50 rounded">Cancel</button>
                              </div>
                            )
                          }
                          return (
                            <div className="mt-1 flex items-center gap-1.5">
                              {et ? (
                                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
                                  {(et.icon ? et.icon + ' ' : '') + et.name}{st ? ' · ' + st.name : ''}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                                  ⚠ No expense type
                                </span>
                              )}
                              {canEditExp && (
                                <button onClick={function (e) { e.stopPropagation(); startEditItemExp(it) }} className="text-[10px] text-blue-600 hover:underline">
                                  {et ? 'Change' : 'Set'}
                                </button>
                              )}
                            </div>
                          )
                        })()}
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
                        {vendorMode === 'select' && (
                          <div className="space-y-1">
                            <input type="text" value={vendorSearch}
                              onChange={function (e) { setVendorSearch(e.target.value) }}
                              placeholder="Search vendors..." autoFocus
                              className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              style={{ fontSize: '16px' }} />
                            <div className="max-h-32 overflow-y-auto rounded border border-gray-100">
                              {(vendorList || []).filter(function (v) {
                                return !vendorSearch || v.name.toLowerCase().indexOf(vendorSearch.toLowerCase()) !== -1
                              }).slice(0, 8).map(function (v) {
                                return (
                                  <div key={v.id} onClick={function () { selectVendorFromList(v) }}
                                    className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                    <span className="font-medium text-gray-700">{v.name}</span>
                                    {v.phone && <span className="text-[10px] text-gray-400 ml-2">{v.phone}</span>}
                                  </div>
                                )
                              })}
                            </div>
                            <button onClick={function () { setVendorMode('custom') }}
                              className="w-full py-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-md font-semibold hover:bg-amber-100 transition-colors">
                              ✏ Type custom vendor name
                            </button>
                          </div>
                        )}
                        {vendorMode === 'custom' && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input type="text" value={vendorForm.name}
                                onChange={function (e) { setVendorForm(function (p) { return Object.assign({}, p, { name: e.target.value }) }) }}
                                placeholder="Vendor name" maxLength="200"
                                className="flex-1 px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ fontSize: '16px' }} />
                              <button onClick={function () { setVendorMode('select'); setVendorSearch('') }}
                                className="px-2 py-1.5 text-[10px] text-blue-600 bg-blue-50 rounded-md font-semibold hover:bg-blue-100 transition-colors whitespace-nowrap">
                                📋 Pick
                              </button>
                            </div>
                            <input type="text" value={vendorForm.contact}
                              onChange={function (e) { setVendorForm(function (p) { return Object.assign({}, p, { contact: e.target.value }) }) }}
                              placeholder="Contact / phone" maxLength="100"
                              className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              style={{ fontSize: '16px' }} />
                          </div>
                        )}
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
                            <label className="block text-[11px] text-gray-500 mb-0.5">Vendor</label>
                            <input type="text" value={purchaseForm.vendorName}
                              onChange={function (e) { setPurchaseForm(function (p) { return Object.assign({}, p, { vendorName: e.target.value }) }) }}
                              placeholder="Vendor name"
                              className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                              style={{ fontSize: '16px' }} />
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500 mb-0.5">Rate/unit (₹)</label>
                            <input type="number" min="0" step="0.01" inputMode="decimal" value={purchaseForm.vendorRate}
                              onChange={function (e) { setPurchaseForm(function (p) { return Object.assign({}, p, { vendorRate: e.target.value }) }) }}
                              placeholder="Rate"
                              className="w-full px-2 py-1.5 border border-green-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                          </div>
                        </div>
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
                    {it.status === 'pending_return' && isAdmin && (
                      <div className="flex gap-2">
                        <button onClick={function (e) { e.stopPropagation(); onConfirmReturn(it.id) }} disabled={saving}
                          className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          {saving ? '...' : '↩ Confirm Return'}
                        </button>
                      </div>
                    )}

                    {it.status === 'pending' && !isEditingVendor && !isPurchasing && (
                      <div className="flex gap-2 flex-wrap">
                        {canEdit && (
                          <button onClick={function (e) { e.stopPropagation(); startVendorEdit(it) }}
                            className="text-[11px] font-semibold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
                            {it.vendor_name ? '✎ Edit Vendor' : '+ Assign Vendor'}
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={function (e) { e.stopPropagation(); if (confirm('Remove this item from PO?')) onRemoveItem(po.id, it.id) }}
                            className="text-[11px] font-semibold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                            ✕ Remove
                          </button>
                        )}
                        {canPurchase && it.status === 'pending' && (
                          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 px-2 py-1.5 rounded-lg cursor-pointer transition-colors" onClick={function (e) { e.stopPropagation() }}>
                            <input type="checkbox" checked={selectedForPurchase.indexOf(it.id) !== -1}
                              onChange={function () { toggleSelectPurchase(it.id) }}
                              className="w-3.5 h-3.5 accent-indigo-600" />
                            Select
                          </label>
                        )}
                        {canPurchase && selectedForPurchase.indexOf(it.id) === -1 && (
                          <button onClick={function (e) { e.stopPropagation(); startPurchase(it) }}
                            className="text-[11px] font-semibold text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg transition-colors">
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

        {/* Multi-purchase floating bar (purchaser bulk mode) */}
        {canPurchase && selectedForPurchase.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-indigo-500 shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-900">{selectedForPurchase.length} item{selectedForPurchase.length !== 1 ? 's' : ''} selected</p>
              <p className="text-[11px] text-gray-500">Same vendor · single bill · single upload</p>
            </div>
            <div className="flex gap-2">
              <button onClick={function () { setSelectedForPurchase([]) }}
                className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Clear</button>
              <button onClick={openMultiPurchase}
                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
                🛒 Mark {selectedForPurchase.length} Purchased Together
              </button>
            </div>
          </div>
        )}

        {/* Multi-purchase modal */}
        {multiOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={function () { if (!multiProcessing) setMultiOpen(false) }}>
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={function (e) { e.stopPropagation() }}>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Mark {selectedForPurchase.length} Items Purchased</h3>
                <button onClick={function () { if (!multiProcessing) setMultiOpen(false) }} disabled={multiProcessing}
                  className="text-2xl text-gray-400 hover:text-gray-600 disabled:opacity-30">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Shared Vendor</label>
                    <input type="text" list="multi-vendor-list" value={multiForm.vendor}
                      onChange={function (e) {
                        var name = e.target.value
                        var vRow = (vendorList || []).find(function (v) { return v.name === name })
                        setMultiForm(function (p) { return Object.assign({}, p, { vendor: name, vendorContact: vRow ? (vRow.phone || vRow.contact || '') : p.vendorContact }) })
                      }}
                      placeholder="Type or pick vendor..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      style={{ fontSize: '16px' }} />
                    <datalist id="multi-vendor-list">
                      {(vendorList || []).map(function (v) { return <option key={v.id} value={v.name}>{v.phone ? v.phone : ''}</option> })}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Vendor Contact</label>
                    <input type="text" value={multiForm.vendorContact}
                      onChange={function (e) { setMultiForm(function (p) { return Object.assign({}, p, { vendorContact: e.target.value }) }) }}
                      placeholder="Phone / contact"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      style={{ fontSize: '16px' }} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Shared Bill / Receipt (one upload for all items)</label>
                  <input type="file" accept="image/*,application/pdf"
                    onChange={function (e) { setMultiForm(function (p) { return Object.assign({}, p, { receipt: e.target.files?.[0] || null }) }) }}
                    className="w-full text-xs" />
                  {multiForm.receipt && <p className="text-[11px] text-green-700 mt-1">✓ {multiForm.receipt.name}</p>}
                </div>
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Items</p>
                  <div className="space-y-2">
                    {items.filter(function (it) { return selectedForPurchase.indexOf(it.id) !== -1 }).map(function (it) {
                      var f = multiForm.items[it.id] || { qty: '', cost: '' }
                      return (
                        <div key={it.id} className="grid grid-cols-6 gap-2 items-center bg-gray-50 rounded-lg px-3 py-2">
                          <div className="col-span-3">
                            <p className="text-sm font-semibold text-gray-800 truncate">{it.item_name}</p>
                            <p className="text-[10px] text-gray-500">Ordered: {it.qty_ordered} {it.unit}</p>
                          </div>
                          <input type="number" min="0" step="any" inputMode="numeric" value={f.qty}
                            onChange={function (e) {
                              var v = e.target.value
                              setMultiForm(function (p) { var next = Object.assign({}, p.items); next[it.id] = Object.assign({}, next[it.id] || {}, { qty: v }); return Object.assign({}, p, { items: next }) })
                            }}
                            placeholder="Qty"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            style={{ fontSize: '16px' }} />
                          <input type="number" min="0" step="any" inputMode="decimal" value={f.cost}
                            onChange={function (e) {
                              var v = e.target.value
                              setMultiForm(function (p) { var next = Object.assign({}, p.items); next[it.id] = Object.assign({}, next[it.id] || {}, { cost: v }); return Object.assign({}, p, { items: next }) })
                            }}
                            placeholder="₹ Cost"
                            className="col-span-2 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            style={{ fontSize: '16px' }} />
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Total</span>
                    <span className="text-lg font-bold text-indigo-900">₹{(items.filter(function (it) { return selectedForPurchase.indexOf(it.id) !== -1 }).reduce(function (s, it) { var f = multiForm.items[it.id] || {}; return s + (Number(f.cost) || 0) }, 0)).toFixed(2)}</span>
                  </div>
                </div>
                {multiProgress && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{multiProgress.done + multiProgress.failed} / {multiProgress.total}</span>
                      <span className="text-gray-500">{multiProgress.done} ok · {multiProgress.failed} failed</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: (multiProgress.total ? (((multiProgress.done + multiProgress.failed) / multiProgress.total) * 100) : 0) + '%' }}></div>
                    </div>
                    {multiProgress.failedRows && multiProgress.failedRows.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-red-700 font-medium">Failed ({multiProgress.failedRows.length})</summary>
                        <div className="mt-1 max-h-32 overflow-y-auto">
                          {multiProgress.failedRows.map(function (f, i) {
                            return <div key={i} className="text-[10px] text-red-800">{f.name} — {f.reason}</div>
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
                <button onClick={function () { setMultiOpen(false) }} disabled={multiProcessing}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                  {multiProgress && !multiProcessing ? 'Close' : 'Cancel'}</button>
                <button onClick={multiProgress && !multiProcessing ? function () { setMultiOpen(false) } : confirmMultiPurchase} disabled={multiProcessing}
                  className="px-6 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {multiProcessing ? 'Processing...' : multiProgress ? 'Done' : 'Confirm Purchase'}</button>
              </div>
            </div>
          </div>
        )}

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
            {!editingNotes && po.notes && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-xs text-gray-600 whitespace-pre-wrap">{notesText}</p>
              </div>
            )}
            {editingNotes && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Notes</p>
                <VoiceInput as="textarea" value={notesText} onChange={function (e) { setNotesText(e.target.value) }}
                  rows={3} autoFocus placeholder="Add notes for this PO..."
                  className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
                <div className="flex gap-2">
                  <button disabled={notesSaving} onClick={async function () {
                    var trimmed = notesText.trim()
                    setNotesSaving(true)
                    var { error } = await supabase.from('purchase_orders').update({ notes: trimmed || null }).eq('id', po.id)
                    setNotesSaving(false)
                    if (!error) { po.notes = trimmed || null; setEditingNotes(false) }
                  }} className="px-3 py-1.5 text-[11px] font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {notesSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={function () { setNotesText(po.notes || ''); setEditingNotes(false) }}
                    className="px-3 py-1.5 text-[11px] font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {!editingNotes && canEdit && (
              <button onClick={function () { setEditingNotes(true) }} className="text-[11px] font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
                {notesText ? '✎ Edit Notes' : '+ Add Notes'}
              </button>
            )}

            {/* PDF Downloads */}
            <div className="flex gap-2">
              <button onClick={function () { generatePoPdf(po, items, po.profiles?.name) }}
                className="flex-1 py-2 text-xs font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                🖨️ PO PDF
              </button>
              {totalActualPaise > 0 && (
                <button onClick={function () { generateComparisonPdf(po, items, po.profiles?.name) }}
                  className="flex-1 py-2 text-xs font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  📊 Comparison
                </button>
              )}
              {receivedCount > 0 && (
                <button onClick={function () { generateReceivingPdf(po, items, po.profiles?.name) }}
                  className="flex-1 py-2 text-xs font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  📥 Receiving
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {canConfirm && (
                <button onClick={function () {
                  if (!po.assigned_to) { alert('Assign a purchaser before confirming'); return }
                  var missing = items.filter(function (it) { return !it.expense_type_id })
                  if (missing.length > 0) { alert('Set expense type on ' + missing.length + ' item(s) before confirming'); return }
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
              {canCancel && (
                <button onClick={function () { onCancelPo(po.id) }} disabled={saving}
                  className="w-full py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
                  {saving ? 'Cancelling...' : '✕ Cancel PO'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add vendor to master prompt */}
      {showAddVendor && (
        <BottomSheet open={true} onClose={function () { setShowAddVendor(null) }} title="Add to Vendor Master?">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              "<span className="font-semibold text-gray-700">{showAddVendor.name}</span>" is not in your vendor list. Save for future use?
            </p>
            <div className="flex gap-3">
              <button onClick={function () { setShowAddVendor(null) }}
                className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">
                Skip
              </button>
              <button onClick={addVendorToMaster}
                className="flex-1 py-3 text-sm text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors font-semibold">
                + Add Vendor
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

export default Purchase
