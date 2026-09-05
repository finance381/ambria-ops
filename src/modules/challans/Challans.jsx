import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { isPrivilegedRole } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { generateChallanPdf } from '../../lib/pdf'
import EventDatePicker from '../../components/ui/EventDatePicker'

var TYPE_LABELS = {
  event_dispatch: 'Event Dispatch',
  event_return: 'Event Return',
  inter_store: 'Inter-Store Transfer',
  repair: 'Repair / Maintenance',
  asset_transfer: 'Asset Transfer',
}

var TYPE_COLORS = {
  event_dispatch: 'bg-blue-100 text-blue-700',
  event_return: 'bg-indigo-100 text-indigo-700',
  inter_store: 'bg-amber-100 text-amber-700',
  repair: 'bg-orange-100 text-orange-700',
  asset_transfer: 'bg-purple-100 text-purple-700',
}

var STATUS_LABELS = {
  draft: 'Draft',
  dispatched: 'Dispatched',
  received: 'Received',
  closed: 'Closed',
}

var STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  dispatched: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  closed: 'bg-gray-200 text-gray-500',
}

var PAGE_SIZE = 50

var REPAIR_STATUS_LABELS = {
  sent: 'Sent',
  in_progress: 'In Progress',
  ready: 'Ready for Pickup',
  returned: 'Returned',
  write_off: 'Written Off',
}

var REPAIR_STATUS_COLORS = {
  sent: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  ready: 'bg-green-100 text-green-700',
  returned: 'bg-gray-200 text-gray-600',
  write_off: 'bg-red-100 text-red-600',
}

function PhotoThumb({ photo, onDelete }) {
  var [url, setUrl] = useState('')

  useEffect(function () {
    supabase.storage.from('challan-photos')
      .createSignedUrl(photo.storage_path, 3600)
      .then(function (r) { if (r.data?.signedUrl) setUrl(r.data.signedUrl) })
  }, [photo.storage_path])

  return (
    <div className="relative group">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={photo.stage}
            className="w-24 h-24 object-cover rounded-lg border border-gray-200 hover:border-indigo-400 transition-colors" />
        </a>
      ) : (
        <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs">...</div>
      )}
      <p className="text-[9px] text-gray-400 mt-0.5 text-center truncate w-24">
        {photo.profiles?.name || ''}
      </p>
      {onDelete && (
        <button onClick={onDelete}
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-bold hidden group-hover:flex items-center justify-center">
          ×
        </button>
      )}
    </div>
  )
}

function Challans({ profile }) {
  var [view, setView] = useState('list')
  var [challans, setChallans] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var venues = useReferenceData().venues.filter(function (v) { return v.active })
  var [events, setEvents] = useState([])
  var [boxes, setBoxes] = useState([])

  // Filters
  var [typeFilter, setTypeFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [search, setSearch] = useState('')

  // Form state
  var [editChallan, setEditChallan] = useState(null)
  var [formType, setFormType] = useState('event_dispatch')
  var [formSourceVenue, setFormSourceVenue] = useState('')
  var [formDestVenue, setFormDestVenue] = useState('')
  var [formDestText, setFormDestText] = useState('')
  var [formEvent, setFormEvent] = useState('')
  var [formReturnFor, setFormReturnFor] = useState('')
  var [formVehicle, setFormVehicle] = useState('')
  var [formDriver, setFormDriver] = useState('')
  var [formDriverPhone, setFormDriverPhone] = useState('')
  var [formNotes, setFormNotes] = useState('')
  var [formEventDate, setFormEventDate] = useState('')
  var [formDispatchDate, setFormDispatchDate] = useState('')
  var [dateEvents, setDateEvents] = useState([])
  var [dateEventsLoading, setDateEventsLoading] = useState(false)

  // Detail state
  var [activeChallan, setActiveChallan] = useState(null)
  var [challanItems, setChallanItems] = useState([])
  var [itemsLoading, setItemsLoading] = useState(false)

  // Add items
  var [addMode, setAddMode] = useState('') // 'item' | 'box'
  var [addItemSearch, setAddItemSearch] = useState('')
  var [searchResults, setSearchResults] = useState([])
  var [selectedItem, setSelectedItem] = useState(null)
  var [addQty, setAddQty] = useState('')

  // Receive mode
  var [receiveMode, setReceiveMode] = useState(false)
  var [receiveQtys, setReceiveQtys] = useState({})
  var [receiveConditions, setReceiveConditions] = useState({})
  var [receiveDamageNotes, setReceiveDamageNotes] = useState({})

  // Photos
  var [photos, setPhotos] = useState([])
  var [photosLoading, setPhotosLoading] = useState(false)
  var [uploading, setUploading] = useState(false)

  // Repair tracking
  var [repairDetail, setRepairDetail] = useState(null)
  var [repairSaving, setRepairSaving] = useState(false)

  // Dispatch challans for return linking
  var [dispatchChallans, setDispatchChallans] = useState([])

  var isAdmin = isPrivilegedRole(profile)

  useEffect(function () {
    loadChallans()
    loadRefs()
  }, [])

  async function loadRefs() {
    var results = await Promise.allSettled([
      supabase.from('events_safe').select('id, contract_date, function_date, client_name, venue_name, event_name, contract_no')
        .or('function_date.gte.' + new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0] + ',function_date.is.null')
        .order('function_date', { ascending: false, nullsFirst: false }).limit(200),
      supabase.from('boxes').select('id, code, label, venue_id, department, status')
        .in('status', ['stored', 'packed']).order('code'),
    ])
    setEvents(results[0].value?.data || [])
    setBoxes(results[1].value?.data || [])
  }

  async function loadEventsByDate(date) {
    if (!date) { setDateEvents([]); return }
    setDateEventsLoading(true)
    var { data } = await supabase.from('events_safe')
      .select('id, contract_date, function_date, client_name, venue_name, event_name, contract_no')
      .eq('function_date', date)
      .order('event_name')
    setDateEvents(data || [])
    setDateEventsLoading(false)
  }

  function onDispatchEventChange(eventId) {
    setFormEvent(eventId)
    if (!eventId) return
    var ev = dateEvents.find(function (e) { return String(e.id) === eventId })
    if (!ev || !ev.venue_name) return
    // Match venue_name to venues list for auto-fill
    var match = venues.find(function (v) {
      return v.name === ev.venue_name || ev.venue_name.indexOf(v.name) !== -1 || ev.venue_name.indexOf(v.code) !== -1
    })
    if (match) setFormDestVenue(String(match.id))
  }

  async function loadChallans() {
    setLoading(true)
    var { data, error } = await supabase
      .from('challans')
      .select('id, challan_no, type, source_venue_id, destination_venue_id, destination_text, event_id, return_for_challan_id, vehicle_no, driver_name, driver_phone, status, dispatch_date, dispatched_at, received_at, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    setChallans(data || [])
    setLoading(false)
  }

  // ── FORM ──

  function openForm(challan) {
    setEditChallan(challan || null)
    setFormType(challan?.type || 'event_dispatch')
    setFormSourceVenue(challan?.source_venue_id ? String(challan.source_venue_id) : '')
    setFormDestVenue(challan?.destination_venue_id ? String(challan.destination_venue_id) : '')
    setFormDestText(challan?.destination_text || '')
    setFormEvent(challan?.event_id ? String(challan.event_id) : '')
    setFormReturnFor(challan?.return_for_challan_id ? String(challan.return_for_challan_id) : '')
    setFormVehicle(challan?.vehicle_no || '')
    setFormDriver(challan?.driver_name || '')
    setFormDriverPhone(challan?.driver_phone || '')
    setFormNotes(challan?.notes || '')
    setView('form')

    // Pre-fill dates for dispatch challan edit
    if ((challan?.type === 'event_dispatch') && challan?.event_id) {
      var linkedEv = events.find(function (e) { return e.id === challan.event_id })
      if (linkedEv) {
        setFormEventDate(linkedEv.function_date || linkedEv.contract_date)
        loadEventsByDate(linkedEv.function_date || linkedEv.contract_date)
      } else {
        setFormEventDate('')
        setDateEvents([])
      }
    } else {
      setFormEventDate('')
      setDateEvents([])
    }
    setFormDispatchDate(challan?.dispatch_date || '')
    // Load dispatch challans for return linking
    if (!challan || challan.type === 'event_return') {
      supabase.from('challans')
        .select('id, challan_no, event_id, source_venue_id, destination_venue_id')
        .eq('type', 'event_dispatch')
        .in('status', ['dispatched', 'received'])
        .order('created_at', { ascending: false })
        .limit(50)
        .then(function (r) { setDispatchChallans(r.data || []) })
    }
  }

  var showDestText = formType === 'repair'
  var showReturnFor = formType === 'event_return'

  function onReturnForChange(challanId) {
    setFormReturnFor(challanId)
    if (!challanId) return
    var dc = dispatchChallans.find(function (c) { return String(c.id) === challanId })
    if (!dc) return
    // Return: source = dispatch destination, dest = dispatch source
    if (dc.destination_venue_id) setFormSourceVenue(String(dc.destination_venue_id))
    if (dc.source_venue_id) setFormDestVenue(String(dc.source_venue_id))
    if (dc.event_id) setFormEvent(String(dc.event_id))
  }

  async function saveChallan() {
    if (!formSourceVenue) return
    if (saving) return
    setSaving(true)

    var payload = {
      type: formType,
      source_venue_id: Number(formSourceVenue),
      destination_venue_id: formDestVenue ? Number(formDestVenue) : null,
      destination_text: formDestText.trim() || null,
      event_id: formEvent ? Number(formEvent) : null,
      return_for_challan_id: formReturnFor ? Number(formReturnFor) : null,
      vehicle_no: formVehicle.trim() || null,
      driver_name: formDriver.trim() || null,
      driver_phone: formDriverPhone.trim() || null,
      notes: formNotes.trim() || null,
      dispatch_date: formDispatchDate || null,
    }

    if (editChallan) {
      var { error } = await supabase.from('challans').update(payload).eq('id', editChallan.id)
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
      await logActivity('CHALLAN_EDIT', 'Updated ' + editChallan.challan_no)
    } else {
      payload.created_by = profile.id
      payload.challan_no = ''
      var { data: newChallan, error } = await supabase.from('challans').insert(payload).select().single()
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
      await logActivity('CHALLAN_CREATE', 'Created ' + newChallan.challan_no + ' (' + TYPE_LABELS[formType] + ')')

      // Auto-create repair_details row for repair challans
      if (formType === 'repair' && newChallan) {
        await supabase.from('repair_details').insert({
          challan_id: newChallan.id,
          vendor_name: formDestText.trim() || null,
        })
      }

      // Auto-copy items from dispatch challan into return challan
      if (formType === 'event_return' && formReturnFor) {
        var { data: dispatchItems } = await supabase
          .from('challan_items')
          .select('inventory_item_id, cs_item_id, event_item_id, box_id, qty_sent, qty_received')
          .eq('challan_id', Number(formReturnFor))
        if (dispatchItems && dispatchItems.length > 0) {
          var returnRows = dispatchItems.map(function (di) {
            var row = {
              challan_id: newChallan.id,
              qty_sent: di.qty_received != null ? di.qty_received : di.qty_sent,
            }
            if (di.inventory_item_id) row.inventory_item_id = di.inventory_item_id
            if (di.cs_item_id) row.cs_item_id = di.cs_item_id
            if (di.event_item_id) row.event_item_id = di.event_item_id
            if (di.box_id) row.box_id = di.box_id
            return row
          })
          await supabase.from('challan_items').insert(returnRows)
        }
      }

      setSaving(false)
      openDetail(newChallan)
      loadChallans()
      return
    }

    setSaving(false)
    setView('list')
    loadChallans()
  }

  // ── DETAIL ──

  async function openDetail(challan) {
    setActiveChallan(challan)
    setView('detail')
    setAddMode('')
    setReceiveMode(false)
    setReceiveQtys({})
    setReceiveConditions({})
    setReceiveDamageNotes({})
    setPhotos([])
    loadChallanItems(challan.id)
    loadPhotos(challan.id)
    setRepairDetail(null)
    if (challan.type === 'repair') loadRepairDetail(challan.id)
  }

  async function loadRepairDetail(challanId) {
    var { data } = await supabase.from('repair_details')
      .select('*').eq('challan_id', challanId).maybeSingle()
    setRepairDetail(data || null)
  }

  async function saveRepairField(field, value) {
    if (!repairDetail) return
    setRepairSaving(true)
    var update = {}
    update[field] = value
    var { error } = await supabase.from('repair_details').update(update).eq('id', repairDetail.id)
    if (!error) {
      setRepairDetail(Object.assign({}, repairDetail, update))
    }
    setRepairSaving(false)
  }

  async function advanceRepairStatus(newStatus) {
    if (!repairDetail || repairSaving) return
    setRepairSaving(true)
    var update = { repair_status: newStatus }
    if (newStatus === 'returned') update.actual_return_date = new Date().toISOString().split('T')[0]
    var { error } = await supabase.from('repair_details').update(update).eq('id', repairDetail.id)
    if (!error) {
      setRepairDetail(Object.assign({}, repairDetail, update))
      try { await logActivity('REPAIR_STATUS', activeChallan.challan_no + ' → ' + REPAIR_STATUS_LABELS[newStatus]) } catch (_) {}
    }
    setRepairSaving(false)
  }

  async function loadChallanItems(challanId) {
    setItemsLoading(true)
    var { data } = await supabase
      .from('challan_items')
      .select('id, challan_id, inventory_item_id, cs_item_id, event_item_id, box_id, qty_sent, qty_received, qty_returned, condition, damage_note')
      .eq('challan_id', challanId)

    var items = data || []
    if (items.length === 0) { setChallanItems([]); setItemsLoading(false); return }

    // Fetch names
    var invIds = items.filter(function (i) { return i.inventory_item_id }).map(function (i) { return i.inventory_item_id })
    var csIds = items.filter(function (i) { return i.cs_item_id }).map(function (i) { return i.cs_item_id })
    var boxIds = items.filter(function (i) { return i.box_id }).map(function (i) { return i.box_id })

    var invMap = {}; var csMap = {}; var boxMap = {}

    var fetches = []
    if (invIds.length > 0) {
      fetches.push(supabase.from('inventory_items').select('id, name, unit').in('id', invIds)
        .then(function (r) { (r.data || []).forEach(function (it) { invMap[it.id] = it }) }))
    }
    if (csIds.length > 0) {
      fetches.push(supabase.from('catering_store_items').select('id, name, unit').in('id', csIds)
        .then(function (r) { (r.data || []).forEach(function (it) { csMap[it.id] = it }) }))
    }
    if (boxIds.length > 0) {
      fetches.push(supabase.from('boxes').select('id, code, label').in('id', boxIds)
        .then(function (r) { (r.data || []).forEach(function (b) { boxMap[b.id] = b }) }))
    }
    await Promise.allSettled(fetches)

    var enriched = items.map(function (ci) {
      var source = ci.inventory_item_id ? invMap[ci.inventory_item_id] : csMap[ci.cs_item_id]
      var box = ci.box_id ? boxMap[ci.box_id] : null
      return Object.assign({}, ci, {
        item_name: source?.name || '—',
        item_unit: source?.unit || '',
        box_code: box?.code || null,
        box_label: box?.label || null,
        source_type: ci.inventory_item_id ? 'inventory' : 'catering',
      })
    })

    setChallanItems(enriched)
    setItemsLoading(false)
  }

  // ── ADD ITEMS ──

  async function searchItems(q) {
    if (!q || q.length < 2) { setSearchResults([]); return }
    var results = []
    var { data: inv } = await supabase.from('inventory_items')
      .select('id, name, unit, qty, category_id').eq('status', 'approved')
      .ilike('name', '%' + q + '%').limit(10)
    ;(inv || []).forEach(function (it) { results.push(Object.assign({}, it, { source_type: 'inventory' })) })

    var { data: cs } = await supabase.from('catering_store_items')
      .select('id, name, unit, qty, category_id').eq('status', 'approved')
      .ilike('name', '%' + q + '%').limit(10)
    ;(cs || []).forEach(function (it) { results.push(Object.assign({}, it, { source_type: 'catering' })) })

    setSearchResults(results)
  }

  function pickItem(item) {
    setSelectedItem(item)
    setAddItemSearch(item.name)
    setSearchResults([])
    setAddQty('1')
  }

  async function addItemToChallan() {
    if (!selectedItem || !addQty || Number(addQty) <= 0 || saving) return
    setSaving(true)

    var payload = {
      challan_id: activeChallan.id,
      qty_sent: Number(addQty),
    }
    if (selectedItem.source_type === 'inventory') {
      payload.inventory_item_id = selectedItem.id
    } else {
      payload.cs_item_id = selectedItem.id
    }

    // Merge if same item already on challan
    var existing = challanItems.find(function (ci) {
      if (selectedItem.source_type === 'inventory') return ci.inventory_item_id === selectedItem.id && !ci.box_id
      return ci.cs_item_id === selectedItem.id && !ci.box_id
    })

    if (existing) {
      var newQty = existing.qty_sent + Number(addQty)
      var { error } = await supabase.from('challan_items').update({ qty_sent: newQty }).eq('id', existing.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    } else {
      var { error } = await supabase.from('challan_items').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    }

    setSelectedItem(null)
    setAddItemSearch('')
    setAddQty('')
    await loadChallanItems(activeChallan.id)
    setSaving(false)
  }

  async function addBoxToChallan(box) {
    if (saving) return
    setSaving(true)

    // Fetch box contents
    var { data: contents } = await supabase.from('box_items')
      .select('inventory_item_id, cs_item_id, qty').eq('box_id', box.id)

    if (!contents || contents.length === 0) {
      alert('Box is empty'); setSaving(false); return
    }

    var rows = contents.map(function (bi) {
      var row = {
        challan_id: activeChallan.id,
        box_id: box.id,
        qty_sent: bi.qty,
      }
      if (bi.inventory_item_id) row.inventory_item_id = bi.inventory_item_id
      if (bi.cs_item_id) row.cs_item_id = bi.cs_item_id
      return row
    })

    var { error } = await supabase.from('challan_items').insert(rows)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Update box status
    var { error: boxErr } = await supabase.from('boxes').update({ status: 'packed' }).eq('id', box.id)
    if (boxErr) alert('Box status update failed: ' + boxErr.message)

    setAddMode('')
    await loadChallanItems(activeChallan.id)
    setSaving(false)
  }

  async function removeItem(ciId) {
    if (saving) return
    setSaving(true)
    var { error: delErr } = await supabase.from('challan_items').delete().eq('id', ciId)
    if (delErr) { alert('Delete failed: ' + delErr.message); setSaving(false); return }
    await loadChallanItems(activeChallan.id)
    setSaving(false)
  }

  // ── DISPATCH ──

  async function dispatchChallan() {
    if (saving || challanItems.length === 0) return
    if (!activeChallan.vehicle_no && !activeChallan.driver_name) {
      alert('Add vehicle or driver details before dispatching')
      return
    }
    setSaving(true)

    var { error } = await supabase.from('challans').update({
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
      loaded_by: profile.id,
      loaded_at: new Date().toISOString(),
    }).eq('id', activeChallan.id)

    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Update box statuses
    var boxIds = []
    challanItems.forEach(function (ci) {
      if (ci.box_id && boxIds.indexOf(ci.box_id) === -1) boxIds.push(ci.box_id)
    })
    if (boxIds.length > 0) {
      var { error: bxErr } = await supabase.from('boxes').update({ status: 'dispatched' }).in('id', boxIds)
      if (bxErr) alert('Box status update failed: ' + bxErr.message)
    }

    await logActivity('CHALLAN_DISPATCH', activeChallan.challan_no + ' dispatched')
    setSaving(false)
    var updated = Object.assign({}, activeChallan, { status: 'dispatched', dispatched_at: new Date().toISOString() })
    setActiveChallan(updated)
    loadChallans()
  }

  // ── RECEIVE ──

  function startReceive() {
    var qtys = {}
    var conditions = {}
    var notes = {}
    challanItems.forEach(function (ci) {
      qtys[ci.id] = ci.qty_sent
      conditions[ci.id] = 'good'
      notes[ci.id] = ''
    })
    setReceiveQtys(qtys)
    setReceiveConditions(conditions)
    setReceiveDamageNotes(notes)
    setReceiveMode(true)
  }

  async function confirmReceive() {
    if (saving) return
    setSaving(true)

    var updates = challanItems.map(function (ci) {
      var received = Number(receiveQtys[ci.id]) || 0
      var condition = receiveConditions[ci.id] || 'good'
      if (received === 0) condition = 'missing'
      else if (received < ci.qty_sent && condition === 'good') condition = 'missing'
      var damageNote = condition === 'damaged' ? (receiveDamageNotes[ci.id] || '').trim() : null
      return supabase.from('challan_items').update({
        qty_received: received,
        condition: condition,
        damage_note: damageNote,
      }).eq('id', ci.id)
    })
    await Promise.allSettled(updates)

    var { error } = await supabase.from('challans').update({
      status: 'received',
      received_by: profile.id,
      received_at: new Date().toISOString(),
    }).eq('id', activeChallan.id)

    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Update box statuses
    var boxIds = []
    challanItems.forEach(function (ci) {
      if (ci.box_id && boxIds.indexOf(ci.box_id) === -1) boxIds.push(ci.box_id)
    })
    if (boxIds.length > 0) {
      await supabase.from('boxes').update({ status: 'at_venue' }).in('id', boxIds)
    }

    await logActivity('CHALLAN_RECEIVE', activeChallan.challan_no + ' received')
    setReceiveMode(false)
    setSaving(false)
    var updated = Object.assign({}, activeChallan, { status: 'received', received_at: new Date().toISOString() })
    setActiveChallan(updated)
    await loadChallanItems(activeChallan.id)
    loadChallans()
  }

  // ── CLOSE ──

  async function closeChallan() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('challans').update({ status: 'closed' }).eq('id', activeChallan.id)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Return type: update box statuses back to stored
    if (activeChallan.type === 'event_return' || (activeChallan.type === 'inter_store' && activeChallan.return_for_challan_id)) {
      var boxIds = []
      challanItems.forEach(function (ci) {
        if (ci.box_id && boxIds.indexOf(ci.box_id) === -1) boxIds.push(ci.box_id)
      })
      if (boxIds.length > 0) {
        await supabase.from('boxes').update({ status: 'stored' }).in('id', boxIds)
      }
    }

    await logActivity('CHALLAN_CLOSE', activeChallan.challan_no + ' closed')
    setSaving(false)
    var updated = Object.assign({}, activeChallan, { status: 'closed' })
    setActiveChallan(updated)
    loadChallans()
  }

  // ── CREATE RETURN ──

  async function createReturnChallan() {
    if (saving) return
    setSaving(true)

    var returnType = activeChallan.type === 'inter_store' ? 'inter_store' : 'event_return'

    var payload = {
      type: returnType,
      source_venue_id: activeChallan.destination_venue_id,
      destination_venue_id: activeChallan.source_venue_id,
      event_id: activeChallan.event_id || null,
      return_for_challan_id: activeChallan.id,
      created_by: profile.id,
      challan_no: '',
    }

    var { data: newChallan, error } = await supabase.from('challans').insert(payload).select().single()
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    // Copy items — qty_sent = dispatch qty_received (what actually arrived)
    if (challanItems.length > 0) {
      var rows = challanItems.filter(function (ci) {
        return (ci.qty_received || 0) > 0
      }).map(function (ci) {
        var row = {
          challan_id: newChallan.id,
          qty_sent: ci.qty_received != null ? ci.qty_received : ci.qty_sent,
        }
        if (ci.inventory_item_id) row.inventory_item_id = ci.inventory_item_id
        if (ci.cs_item_id) row.cs_item_id = ci.cs_item_id
        if (ci.event_item_id) row.event_item_id = ci.event_item_id
        if (ci.box_id) row.box_id = ci.box_id
        return row
      })
      if (rows.length > 0) {
        await supabase.from('challan_items').insert(rows)
      }
    }

    await logActivity('CHALLAN_CREATE', 'Return ' + newChallan.challan_no + ' for ' + activeChallan.challan_no)
    setSaving(false)
    openDetail(newChallan)
    loadChallans()
  }

  // ── PHOTOS ──

  async function loadPhotos(challanId) {
    setPhotosLoading(true)
    var { data } = await supabase
      .from('challan_photos')
      .select('id, stage, storage_path, uploaded_by, uploaded_at')
      .eq('challan_id', challanId)
      .order('uploaded_at', { ascending: false })
    var rows = data || []
    var userIds = []
    rows.forEach(function (r) { if (r.uploaded_by && userIds.indexOf(r.uploaded_by) === -1) userIds.push(r.uploaded_by) })
    if (userIds.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: userIds })
      var nameMap = {}
      ;(names || []).forEach(function (n) { nameMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: nameMap[r.uploaded_by] || null } }) })
    }
    setPhotos(rows)
    setPhotosLoading(false)
  }

  function stageForStatus(status) {
    if (status === 'draft') return 'loading'
    if (status === 'dispatched') return 'delivery'
    if (status === 'received') return 'return'
    return 'loading'
  }

  function repairPhotoStage() {
    if (!repairDetail) return 'before_repair'
    if (repairDetail.repair_status === 'returned' || repairDetail.repair_status === 'ready') return 'after_repair'
    return 'before_repair'
  }

  async function uploadPhoto(file, stage) {
    if (uploading || !file) return
    setUploading(true)

    // Compress if needed
    var blob = file
    if (file.size > 2 * 1024 * 1024) {
      blob = await new Promise(function (resolve) {
        var img = new Image()
        img.onload = function () {
          var canvas = document.createElement('canvas')
          var maxDim = 1600; var w = img.width; var h = img.height
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
            else { w = Math.round(w * maxDim / h); h = maxDim }
          }
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          canvas.toBlob(function (b) { resolve(b) }, 'image/jpeg', 0.7)
        }
        img.src = URL.createObjectURL(file)
      })
    }

    var ext = file.name.split('.').pop() || 'jpg'
    var path = activeChallan.challan_no + '/' + stage + '/' + Date.now() + '.' + ext

    var { error: upErr } = await supabase.storage
      .from('challan-photos')
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg' })

    if (upErr) { alert('Upload failed: ' + upErr.message); setUploading(false); return }

    var { error: dbErr } = await supabase.from('challan_photos').insert({
      challan_id: activeChallan.id,
      stage: stage,
      storage_path: path,
      uploaded_by: profile.id,
    })

    if (dbErr) { alert('Save failed: ' + dbErr.message); setUploading(false); return }

    await loadPhotos(activeChallan.id)
    setUploading(false)
  }

  async function deletePhoto(photo) {
    if (!confirm('Delete this photo?')) return
    await supabase.storage.from('challan-photos').remove([photo.storage_path])
    await supabase.from('challan_photos').delete().eq('id', photo.id)
    await loadPhotos(activeChallan.id)
  }

  function getPhotoUrl(path) {
    var { data } = supabase.storage.from('challan-photos').getPublicUrl(path)
    return data?.publicUrl || ''
  }

  function getSignedUrl(path) {
    return supabase.storage.from('challan-photos')
      .createSignedUrl(path, 3600)
      .then(function (r) { return r.data?.signedUrl || '' })
  }

  // ── FILTER ──

  var filtered = challans.filter(function (c) {
    if (typeFilter && c.type !== typeFilter) return false
    if (statusFilter && c.status !== statusFilter) return false
    if (search) {
      var q = search.toLowerCase()
      var match = (c.challan_no || '').toLowerCase().indexOf(q) !== -1 ||
        (c.vehicle_no || '').toLowerCase().indexOf(q) !== -1 ||
        (c.driver_name || '').toLowerCase().indexOf(q) !== -1
      if (!match) return false
    }
    return true
  })

  // Venue lookup helper
  function venueName(id) {
    var v = venues.find(function (v) { return v.id === id })
    return v ? v.code + ' — ' + v.name : '—'
  }

  function venueCode(id) {
    var v = venues.find(function (v) { return v.id === id })
    return v ? v.code : '—'
  }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  if (loading) {
    return <div className="text-center py-8 text-sm text-gray-400">Loading challans...</div>
  }

  // ── FORM VIEW ──
  if (view === 'form') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={function () { setView('list') }}
            className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
          <h3 className="text-base font-bold text-gray-800">
            {editChallan ? 'Edit Challan — ' + editChallan.challan_no : 'New Challan'}
          </h3>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Movement Type *</label>
            <select value={formType} onChange={function (e) { setFormType(e.target.value); setFormEventDate(''); setFormDispatchDate(''); setDateEvents([]); setFormEvent('') }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {Object.keys(TYPE_LABELS).map(function (k) {
                return <option key={k} value={k}>{TYPE_LABELS[k]}</option>
              })}
            </select>
          </div>

          {/* Source / Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Source Venue *</label>
              <select value={formSourceVenue} onChange={function (e) { setFormSourceVenue(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select...</option>
                {venues.map(function (v) {
                  return <option key={v.id} value={v.id}>{v.code + ' — ' + v.name}</option>
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                {showDestText ? 'Destination (vendor/location)' : 'Destination Venue'}
              </label>
              {showDestText ? (
                <input type="text" value={formDestText}
                  onChange={function (e) { setFormDestText(e.target.value) }}
                  placeholder="Vendor name / address"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              ) : (
                <select value={formDestVenue} onChange={function (e) { setFormDestVenue(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Select...</option>
                  {venues.map(function (v) {
                    return <option key={v.id} value={v.id}>{v.code + ' — ' + v.name}</option>
                  })}
                </select>
              )}
            </div>
          </div>

          {/* Event dispatch: event date → event picker → dispatch date */}
          {formType === 'event_dispatch' && (
            <div className="space-y-3">
              <EventDatePicker label="Event Date *" value={formEventDate}
                onChange={function (dateStr) { setFormEventDate(dateStr); setFormEvent(''); loadEventsByDate(dateStr) }} />
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Dispatch Date</label>
                <input type="date" value={formDispatchDate}
                  onChange={function (e) { setFormDispatchDate(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {formEventDate && formDispatchDate && formDispatchDate > formEventDate && (
                  <p className="text-[10px] text-red-500 mt-1">Dispatch date is after event date</p>
                )}
              </div>
              {formEventDate && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    Event {dateEventsLoading ? '(loading...)' : '(' + dateEvents.length + ' on this date)'}
                  </label>
                  {dateEvents.length === 0 && !dateEventsLoading && (
                    <p className="text-xs text-amber-600 py-1">No events on this date. You can still create the challan without linking an event.</p>
                  )}
                  {dateEvents.length > 0 && (
                    <select value={formEvent} onChange={function (e) { onDispatchEventChange(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select event...</option>
                      {dateEvents.map(function (ev) {
                        return <option key={ev.id} value={ev.id}>
                          {(ev.client_name || '') + ' — ' + (ev.venue_name || '') + ' — ' + (ev.event_name || '') + (ev.contract_no ? ' #' + ev.contract_no : '')}
                        </option>
                      })}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}
          {formType === 'event_return' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Event</label>
              <select value={formEvent} onChange={function (e) { setFormEvent(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">None</option>
                {events.map(function (ev) {
                  return <option key={ev.id} value={ev.id}>
                    {formatDate(ev.function_date || ev.contract_date) + ' — ' + (ev.client_name || '') + ' — ' + (ev.venue_name || '') + (ev.contract_no ? ' #' + ev.contract_no : '')}
                  </option>
                })}
              </select>
            </div>
          )}

          {/* Return for */}
          {showReturnFor && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Return for Dispatch Challan</label>
              <select value={formReturnFor} onChange={function (e) { onReturnForChange(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">None</option>
                {dispatchChallans.map(function (dc) {
                  return <option key={dc.id} value={dc.id}>{dc.challan_no}</option>
                })}
              </select>
            </div>
          )}

          {/* Vehicle details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Vehicle No</label>
              <input type="text" value={formVehicle}
                onChange={function (e) { setFormVehicle(e.target.value) }}
                placeholder="DL 01 AB 1234"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Driver Name</label>
              <input type="text" value={formDriver}
                onChange={function (e) { setFormDriver(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Driver Phone</label>
              <input type="text" value={formDriverPhone}
                onChange={function (e) { setFormDriverPhone(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
            <textarea value={formNotes} onChange={function (e) { setFormNotes(e.target.value) }}
              rows={2} placeholder="Optional..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={saveChallan} disabled={saving || !formSourceVenue}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editChallan ? 'Update' : 'Create Challan')}
            </button>
            <button onClick={function () { setView('list') }}
              className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── DETAIL VIEW ──
  if (view === 'detail' && activeChallan) {
    var isDraft = activeChallan.status === 'draft'
    var isDispatched = activeChallan.status === 'dispatched'
    var isReceived = activeChallan.status === 'received'
    var isClosed = activeChallan.status === 'closed'

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button onClick={function () { setView('list'); setActiveChallan(null) }}
              className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <h3 className="text-base font-bold text-gray-800">{activeChallan.challan_no}</h3>
            <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[activeChallan.status] || '')}>
              {STATUS_LABELS[activeChallan.status] || activeChallan.status}
            </span>
            <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold " + (TYPE_COLORS[activeChallan.type] || '')}>
              {TYPE_LABELS[activeChallan.type] || activeChallan.type}
            </span>
          </div>
          {isDraft && (
            <button onClick={function () { openForm(activeChallan) }}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
              Edit
            </button>
          )}
        </div>

        {/* Info card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600">
            <div><strong className="text-gray-500">From:</strong> {venueName(activeChallan.source_venue_id)}</div>
            <div><strong className="text-gray-500">To:</strong> {activeChallan.destination_text || venueName(activeChallan.destination_venue_id)}</div>
            {activeChallan.vehicle_no && <div><strong className="text-gray-500">Vehicle:</strong> {activeChallan.vehicle_no}</div>}
            {activeChallan.driver_name && <div><strong className="text-gray-500">Driver:</strong> {activeChallan.driver_name}{activeChallan.driver_phone ? ' (' + activeChallan.driver_phone + ')' : ''}</div>}
            {activeChallan.dispatch_date && <div><strong className="text-gray-500">Planned Dispatch:</strong> {formatDate(activeChallan.dispatch_date)}</div>}
            {activeChallan.dispatched_at && <div><strong className="text-gray-500">Dispatched:</strong> {formatDate(activeChallan.dispatched_at)}</div>}
            {activeChallan.received_at && <div><strong className="text-gray-500">Received:</strong> {formatDate(activeChallan.received_at)}</div>}
          </div>
          {activeChallan.notes && <p className="text-xs text-gray-400 mt-2">{activeChallan.notes}</p>}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {isDraft && challanItems.length > 0 && (
            <button onClick={dispatchChallan} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '...' : '🚛 Dispatch'}
            </button>
          )}
          {isDispatched && !receiveMode && (
            <button onClick={startReceive}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors">
              📥 Mark Received
            </button>
          )}
          {receiveMode && (
            <button onClick={confirmReceive} disabled={saving}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? '...' : '✓ Confirm Received'}
            </button>
          )}
          {receiveMode && (
            <button onClick={function () { setReceiveMode(false) }}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          )}
          <button onClick={function () {
              var venueMap = {}
              venues.forEach(function (v) { venueMap[v.id] = v.name })
              generateChallanPdf(activeChallan, challanItems, venueMap)
            }}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            🖨️ PDF
          </button>
          {isReceived && (
            <button onClick={closeChallan} disabled={saving}
              className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
              {saving ? '...' : '🔒 Close Challan'}
            </button>
          )}
          {isReceived && (activeChallan.type === 'event_dispatch' || activeChallan.type === 'inter_store') && (
            <button onClick={createReturnChallan} disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? '...' : '🔄 Create Return Challan'}
            </button>
          )}
        </div>

        {/* Repair tracking (repair challans only) */}
        {activeChallan.type === 'repair' && repairDetail && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 uppercase">Repair Tracking</p>
              <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (REPAIR_STATUS_COLORS[repairDetail.repair_status] || '')}>
                {REPAIR_STATUS_LABELS[repairDetail.repair_status] || repairDetail.repair_status}
              </span>
            </div>

            {/* Vendor info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Vendor Name</label>
                <input type="text" value={repairDetail.vendor_name || ''}
                  onChange={function (e) { setRepairDetail(Object.assign({}, repairDetail, { vendor_name: e.target.value })) }}
                  onBlur={function (e) { saveRepairField('vendor_name', e.target.value.trim() || null) }}
                  placeholder="Vendor / workshop"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Vendor Contact</label>
                <input type="text" value={repairDetail.vendor_contact || ''}
                  onChange={function (e) { setRepairDetail(Object.assign({}, repairDetail, { vendor_contact: e.target.value })) }}
                  onBlur={function (e) { saveRepairField('vendor_contact', e.target.value.trim() || null) }}
                  placeholder="Phone / email"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            {/* Cost + dates */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Est. Cost (₹)</label>
                <input type="number" min="0" step="1"
                  value={repairDetail.estimated_cost_paise ? (repairDetail.estimated_cost_paise / 100) : ''}
                  onChange={function (e) { setRepairDetail(Object.assign({}, repairDetail, { estimated_cost_paise: Math.round(Number(e.target.value || 0) * 100) })) }}
                  onBlur={function () { saveRepairField('estimated_cost_paise', repairDetail.estimated_cost_paise || 0) }}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Actual Cost (₹)</label>
                <input type="number" min="0" step="1"
                  value={repairDetail.actual_cost_paise ? (repairDetail.actual_cost_paise / 100) : ''}
                  onChange={function (e) { setRepairDetail(Object.assign({}, repairDetail, { actual_cost_paise: Math.round(Number(e.target.value || 0) * 100) })) }}
                  onBlur={function () { saveRepairField('actual_cost_paise', repairDetail.actual_cost_paise || 0) }}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Expected Return</label>
                <input type="date" value={repairDetail.expected_return_date || ''}
                  onChange={function (e) { saveRepairField('expected_return_date', e.target.value || null) }}
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Actual Return</label>
                <input type="date" value={repairDetail.actual_return_date || ''}
                  onChange={function (e) { saveRepairField('actual_return_date', e.target.value || null) }}
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            {/* Cost variance */}
            {repairDetail.estimated_cost_paise > 0 && repairDetail.actual_cost_paise > 0 && (
              <p className={"text-xs font-medium " +
                (repairDetail.actual_cost_paise > repairDetail.estimated_cost_paise ? "text-red-600" : "text-green-600")}>
                Variance: ₹{((repairDetail.actual_cost_paise - repairDetail.estimated_cost_paise) / 100).toLocaleString('en-IN')}
              </p>
            )}

            {/* Status actions */}
            <div className="flex gap-2 flex-wrap pt-1 border-t border-gray-100">
              {repairDetail.repair_status === 'sent' && (
                <button onClick={function () { advanceRepairStatus('in_progress') }} disabled={repairSaving}
                  className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  🔧 Mark In Progress
                </button>
              )}
              {repairDetail.repair_status === 'in_progress' && (
                <button onClick={function () { advanceRepairStatus('ready') }} disabled={repairSaving}
                  className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                  ✓ Ready for Pickup
                </button>
              )}
              {repairDetail.repair_status === 'ready' && (
                <button onClick={function () { advanceRepairStatus('returned') }} disabled={repairSaving}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  📥 Returned
                </button>
              )}
              {repairDetail.repair_status !== 'returned' && repairDetail.repair_status !== 'write_off' && (
                <button onClick={function () { if (confirm('Write off these items? This marks them as unrecoverable.')) advanceRepairStatus('write_off') }} disabled={repairSaving}
                  className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors">
                  ✕ Write Off
                </button>
              )}
            </div>

            {/* Repair photos */}
            {!isClosed && (
              <div className="flex gap-2 pt-1">
                <label className={"text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors " +
                  (uploading ? 'bg-gray-100 text-gray-400' : 'bg-orange-100 text-orange-700 hover:bg-orange-200')}>
                  {uploading ? '...' : '📷 ' + (repairPhotoStage() === 'before_repair' ? 'Before Repair' : 'After Repair')}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    disabled={uploading}
                    onChange={function (e) {
                      var file = e.target.files?.[0]
                      if (file) uploadPhoto(file, repairPhotoStage())
                      e.target.value = ''
                    }} />
                </label>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Repair Notes</label>
              <textarea value={repairDetail.notes || ''} rows={2}
                onChange={function (e) { setRepairDetail(Object.assign({}, repairDetail, { notes: e.target.value })) }}
                onBlur={function (e) { saveRepairField('notes', e.target.value.trim() || null) }}
                placeholder="Repair details, condition notes..."
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            </div>
          </div>
        )}

        {/* Add items (draft only) */}
        {isDraft && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <p className="text-xs font-bold text-gray-500 uppercase">Add Items</p>
              <div className="flex-1" />
              <button onClick={function () { setAddMode(addMode === 'item' ? '' : 'item'); setAddItemSearch(''); setSelectedItem(null); setSearchResults([]) }}
                className={"text-xs px-4 py-1.5 rounded-lg font-semibold transition-colors " +
                  (addMode === 'item' ? 'bg-indigo-600 text-white shadow-sm' : 'border border-gray-300 text-gray-600 hover:bg-gray-50')}>
                + Item
              </button>
              <button onClick={function () { setAddMode(addMode === 'box' ? '' : 'box') }}
                className={"text-xs px-4 py-1.5 rounded-lg font-semibold transition-colors " +
                  (addMode === 'box' ? 'bg-indigo-600 text-white shadow-sm' : 'border border-gray-300 text-gray-600 hover:bg-gray-50')}>
                + Box
              </button>
            </div>

            {/* Add individual item — single row layout */}
            {addMode === 'item' && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1 min-w-0">
                  <input type="text" value={addItemSearch}
                    onChange={function (e) {
                      setAddItemSearch(e.target.value)
                      setSelectedItem(null)
                      searchItems(e.target.value)
                    }}
                    placeholder="Search inventory..."
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  {searchResults.length > 0 && !selectedItem && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {searchResults.map(function (item) {
                        return (
                          <button key={item.source_type + '-' + item.id}
                            onClick={function () { pickItem(item) }}
                            className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 border-b border-gray-100 last:border-0 flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800">{item.name}</span>
                            <span className="text-[10px] text-gray-400 ml-3 flex-shrink-0">{item.unit} · Stock: {item.qty}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {selectedItem && (
                  <input type="number" value={addQty}
                    onChange={function (e) { setAddQty(e.target.value) }}
                    min="1" placeholder="Qty"
                    className="w-20 px-2 py-2.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-shrink-0" />
                )}
                {selectedItem && (
                  <button onClick={addItemToChallan} disabled={saving}
                    className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex-shrink-0">
                    {saving ? '...' : '✓ Add'}
                  </button>
                )}
              </div>
            )}

            {/* Add box — grid layout */}
            {addMode === 'box' && (
              <div>
                {boxes.length === 0 && (
                  <p className="text-xs text-gray-400 py-2">No boxes available (stored/packed status only)</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {boxes.map(function (box) {
                    var alreadyAdded = challanItems.some(function (ci) { return ci.box_id === box.id })
                    return (
                      <div key={box.id} className={"flex items-center gap-3 py-2.5 px-3 rounded-lg border transition-colors " +
                        (alreadyAdded ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50 hover:border-indigo-300')}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 truncate">{box.code}</p>
                          <p className="text-[10px] text-gray-400 truncate">{box.label || box.department}</p>
                        </div>
                        {alreadyAdded ? (
                          <span className="text-[10px] text-green-600 font-bold flex-shrink-0">✓ Added</span>
                        ) : (
                          <button onClick={function () { addBoxToChallan(box) }} disabled={saving}
                            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0">
                            {saving ? '...' : 'Add'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Items list */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-500 uppercase">
              Items ({challanItems.length})
              {challanItems.length > 0 && ' · Total qty: ' + challanItems.reduce(function (s, ci) { return s + ci.qty_sent }, 0)}
            </p>
          </div>
          {itemsLoading && <div className="text-center py-6 text-sm text-gray-400">Loading...</div>}
          {!itemsLoading && challanItems.length === 0 && (
            <div className="text-center py-6 text-sm text-gray-400">No items added yet</div>
          )}
          {!itemsLoading && challanItems.map(function (ci) {
            return (
              <div key={ci.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{ci.item_name}</p>
                  <div className="flex gap-2 text-[10px] text-gray-400">
                    {ci.item_unit && <span>{ci.item_unit}</span>}
                    {ci.box_code && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">📦 {ci.box_code}</span>}
                    {ci.source_type === 'catering' && <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded font-medium">CS</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-700">× {ci.qty_sent}</p>
                    {ci.qty_received != null && (
                      <p className={"text-[10px] font-medium " + (ci.qty_received < ci.qty_sent ? 'text-red-500' : 'text-green-600')}>
                        Rcvd: {ci.qty_received}
                      </p>
                    )}
                  </div>

                  {/* Receive mode: qty + condition + damage note */}
                  {receiveMode && (
                    <div className="flex items-center gap-2">
                      <input type="number" value={receiveQtys[ci.id] || ''}
                        onChange={function (e) {
                          setReceiveQtys(function (prev) {
                            var updated = Object.assign({}, prev)
                            updated[ci.id] = e.target.value
                            return updated
                          })
                        }}
                        min="0" max={ci.qty_sent}
                        className="w-16 px-2 py-1 border border-green-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <select value={receiveConditions[ci.id] || 'good'}
                        onChange={function (e) {
                          setReceiveConditions(function (prev) {
                            var updated = Object.assign({}, prev)
                            updated[ci.id] = e.target.value
                            return updated
                          })
                        }}
                        className={"text-[11px] px-2 py-1 rounded border font-medium " +
                          (receiveConditions[ci.id] === 'damaged' ? 'border-red-300 text-red-600 bg-red-50' :
                           receiveConditions[ci.id] === 'missing' ? 'border-yellow-300 text-yellow-700 bg-yellow-50' :
                           'border-gray-300 text-gray-600')}>
                        <option value="good">Good</option>
                        <option value="damaged">Damaged</option>
                        <option value="missing">Missing</option>
                      </select>
                      {receiveConditions[ci.id] === 'damaged' && (
                        <input type="text" value={receiveDamageNotes[ci.id] || ''}
                          onChange={function (e) {
                            setReceiveDamageNotes(function (prev) {
                              var updated = Object.assign({}, prev)
                              updated[ci.id] = e.target.value
                              return updated
                            })
                          }}
                          placeholder="Damage note..."
                          className="w-36 px-2 py-1 border border-red-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-red-400" />
                      )}
                    </div>
                  )}

                  {/* Condition badge */}
                  {ci.condition && ci.condition !== 'good' && !isDraft && (
                    <span className={"text-[10px] px-1.5 py-0.5 rounded font-bold " +
                      (ci.condition === 'damaged' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700')}>
                      {ci.condition}
                    </span>
                  )}

                  {/* Remove (draft only) */}
                  {isDraft && (
                    <button onClick={function () { removeItem(ci.id) }}
                      className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 font-medium p-2 rounded-lg transition-colors">✕</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Photos section */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-500 uppercase">
              Photos ({photos.length})
            </p>
            {!isClosed && (
              <label className={"text-xs px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors " +
                (uploading ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
                {uploading ? 'Uploading...' : '📷 Add Photo (' + stageForStatus(activeChallan.status) + ')'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  disabled={uploading}
                  onChange={function (e) {
                    var file = e.target.files?.[0]
                    if (file) uploadPhoto(file, stageForStatus(activeChallan.status))
                    e.target.value = ''
                  }} />
              </label>
            )}
            {!isClosed && (
              <label className={"text-xs px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors ml-2 " +
                (uploading ? 'bg-gray-100 text-gray-400' : 'border border-red-300 text-red-600 hover:bg-red-50')}>
                {uploading ? '...' : '📷 Damage'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  disabled={uploading}
                  onChange={function (e) {
                    var file = e.target.files?.[0]
                    if (file) uploadPhoto(file, 'damage')
                    e.target.value = ''
                  }} />
              </label>
            )}
          </div>

          {photosLoading && <div className="text-center py-4 text-sm text-gray-400">Loading photos...</div>}

          {!photosLoading && photos.length === 0 && (
            <div className="text-center py-6 text-sm text-gray-400">No photos yet</div>
          )}

          {!photosLoading && photos.length > 0 && (
            <div className="p-4">
              {['loading', 'delivery', 'return', 'damage', 'before_repair', 'after_repair'].map(function (stage) {
                var stagePhotos = photos.filter(function (p) { return p.stage === stage })
                if (stagePhotos.length === 0) return null
                return (
                  <div key={stage} className="mb-4 last:mb-0">
                    <p className={"text-[10px] font-bold uppercase mb-2 " +
                      (stage === 'damage' ? 'text-red-500' : 'text-gray-400')}>
                      {stage} ({stagePhotos.length})
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {stagePhotos.map(function (photo) {
                        return (
                          <PhotoThumb key={photo.id} photo={photo}
                            onDelete={isAdmin ? function () { deletePhoto(photo) } : null} />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search challan, vehicle, driver..."
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <div className="flex gap-2 flex-wrap items-center">
          <select value={typeFilter} onChange={function (e) { setTypeFilter(e.target.value) }}
            className="flex-1 min-w-[100px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Types</option>
            {Object.keys(TYPE_LABELS).map(function (k) { return <option key={k} value={k}>{TYPE_LABELS[k]}</option> })}
          </select>
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            className="flex-1 min-w-[100px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Status</option>
            {Object.keys(STATUS_LABELS).map(function (k) { return <option key={k} value={k}>{STATUS_LABELS[k]}</option> })}
          </select>
          <button onClick={function () { openForm(null) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap">
            + New Challan
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">{filtered.length} challan{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">No challans found</div>
      )}

      <div className="space-y-2">
        {filtered.map(function (c) {
          return (
            <div key={c.id}
              onClick={function () { openDetail(c) }}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-gray-300 cursor-pointer transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-800">{c.challan_no}</p>
                  <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold " + (TYPE_COLORS[c.type] || '')}>
                    {TYPE_LABELS[c.type] || c.type}
                  </span>
                </div>
                <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[c.status] || '')}>
                  {STATUS_LABELS[c.status] || c.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{venueCode(c.source_venue_id)} → {c.destination_text || venueCode(c.destination_venue_id)}</span>
                {c.vehicle_no && <span>🚛 {c.vehicle_no}</span>}
                {c.driver_name && <span>👤 {c.driver_name}</span>}
                <span>{formatDate(c.dispatched_at || c.created_at)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Challans
