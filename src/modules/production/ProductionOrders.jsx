import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import EventDatePicker from '../../components/ui/EventDatePicker'

var STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

var STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

var NEXT_STATUS = {
  pending: 'in_progress',
  in_progress: 'completed',
}

function RefImage({ path }) {
  var [url, setUrl] = useState('')
  useEffect(function () {
    supabase.storage.from('production-images')
      .createSignedUrl(path, 3600)
      .then(function (r) { if (r.data?.signedUrl) setUrl(r.data.signedUrl) })
  }, [path])
  if (!url) return <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm">Loading...</div>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Reference" className="max-h-64 rounded-lg border border-gray-200 object-contain hover:border-indigo-400 transition-colors" />
    </a>
  )
}

function ProductionOrders({ profile }) {
  var [view, setView] = useState('list')
  var [orders, setOrders] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)

  // Refs
  var [events, setEvents] = useState([])
  var [profiles, setProfiles] = useState([])
  var [departments, setDepartments] = useState([])

  // Event selection flow
  var [orderMode, setOrderMode] = useState('') // 'event' | 'general'
  var [fEventDate, setFEventDate] = useState('')
  var [dateEvents, setDateEvents] = useState([])
  var [dateEventsLoading, setDateEventsLoading] = useState(false)

  // Filters
  var [statusFilter, setStatusFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [search, setSearch] = useState('')

  // Form
  var [editOrder, setEditOrder] = useState(null)
  var [fEvent, setFEvent] = useState('')
  var [fItemSearch, setFItemSearch] = useState('')
  var [fItem, setFItem] = useState(null)
  var [fSearchResults, setFSearchResults] = useState([])
  var [fQty, setFQty] = useState('')
  var [fDesc, setFDesc] = useState('')
  var [fDept, setFDept] = useState('')
  var [fAssigned, setFAssigned] = useState('')
  var [fDeadline, setFDeadline] = useState('')
  var [fCost, setFCost] = useState('')
  var [fNotes, setFNotes] = useState('')
  var [fCat, setFCat] = useState('')
  var [fSubCat, setFSubCat] = useState('')
  var [fRefImage, setFRefImage] = useState(null) // File object
  var [fRefPreview, setFRefPreview] = useState('') // preview URL or existing signed URL
  var [refUploading, setRefUploading] = useState(false)

  // Detail
  var [activeOrder, setActiveOrder] = useState(null)
  var [qtyInput, setQtyInput] = useState('')

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  useEffect(function () {
    loadOrders()
    loadRefs()
  }, [])

  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])

  async function loadRefs() {
    var results = await Promise.allSettled([
      supabase.from('events_safe').select('id, contract_date, function_date, client_name, venue_name, event_name')
        .or('function_date.gte.' + new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0] + ',function_date.is.null')
        .order('function_date', { ascending: false, nullsFirst: false }).limit(200),
      supabase.rpc('get_profiles_with_dept'),
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false).order('name'),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
    ])
    setEvents(results[0].value?.data || [])
    setProfiles(results[1].value?.data || [])
    setDepartments(results[2].value?.data || [])
    setCategories(results[3].value?.data || [])
    setSubCategories(results[4].value?.data || [])
  }

  async function loadEventsByDate(date) {
    if (!date) { setDateEvents([]); return }
    setDateEventsLoading(true)
    var { data } = await supabase.from('events_safe')
      .select('id, contract_date, function_date, client_name, venue_name, event_name')
      .eq('function_date', date)
      .order('event_name')
    setDateEvents(data || [])
    setDateEventsLoading(false)
  }

  async function loadOrders() {
    setLoading(true)
    var { data } = await supabase
      .from('production_orders')
      .select('id, event_id, item_id, item_source, qty_ordered, qty_completed, description, department, assigned_to, deadline, status, cost_paise, completed_at, notes, reference_image, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (!data || data.length === 0) { setOrders([]); setLoading(false); return }

    // Enrich with item names
    var invIds = data.filter(function (o) { return o.item_source === 'inventory' }).map(function (o) { return o.item_id })
    var csIds = data.filter(function (o) { return o.item_source === 'catering_store' }).map(function (o) { return o.item_id })
    var invMap = {}; var csMap = {}

    var fetches = []
    if (invIds.length > 0) {
      fetches.push(supabase.from('inventory_items').select('id, name, unit').in('id', invIds)
        .then(function (r) { (r.data || []).forEach(function (i) { invMap[i.id] = i }) }))
    }
    if (csIds.length > 0) {
      fetches.push(supabase.from('catering_store_items').select('id, name, unit').in('id', csIds)
        .then(function (r) { (r.data || []).forEach(function (i) { csMap[i.id] = i }) }))
    }
    await Promise.allSettled(fetches)

    var enriched = data.map(function (o) {
      var item = o.item_source === 'inventory' ? invMap[o.item_id] : csMap[o.item_id]
      return Object.assign({}, o, {
        item_name: item?.name || '—',
        item_unit: item?.unit || '',
      })
    })
    setOrders(enriched)
    setLoading(false)
  }

  // ── SEARCH ITEMS ──

  async function searchItems(q) {
    if (!q || q.length < 2) { setFSearchResults([]); return }
    var results = []

    var invQ = supabase.from('inventory_items')
      .select('id, name, unit, category_id, sub_category_id, image_path, categories(name), sub_categories(name)')
      .eq('status', 'approved').ilike('name', '%' + q + '%').limit(15)
    if (fCat) invQ = invQ.eq('category_id', Number(fCat))
    if (fSubCat) invQ = invQ.eq('sub_category_id', Number(fSubCat))

    var csQ = supabase.from('catering_store_items')
      .select('id, name, unit, category_id, sub_category_id, image_path, categories(name), sub_categories(name)')
      .eq('status', 'approved').ilike('name', '%' + q + '%').limit(15)
    if (fCat) csQ = csQ.eq('category_id', Number(fCat))
    if (fSubCat) csQ = csQ.eq('sub_category_id', Number(fSubCat))

    var [invRes, csRes] = await Promise.all([invQ, csQ])
    ;(invRes.data || []).forEach(function (it) { results.push(Object.assign({}, it, { _source: 'inventory' })) })
    ;(csRes.data || []).forEach(function (it) { results.push(Object.assign({}, it, { _source: 'catering_store' })) })
    setFSearchResults(results)
  }

  function pickItem(item) {
    setFItem(item)
    setFItemSearch(item.name)
    setFSearchResults([])
  }

  // ── FORM ──

  function openForm(order) {
    setEditOrder(order || null)
    setOrderMode(order?.event_id ? 'event' : (order ? 'general' : ''))
    setFEventDate('')
    setDateEvents([])
    setFEvent(order?.event_id ? String(order.event_id) : '')
    setFItem(order ? { id: order.item_id, name: order.item_name, unit: order.item_unit, _source: order.item_source } : null)
    setFItemSearch(order?.item_name || '')
    setFQty(order ? String(order.qty_ordered) : '')
    setFDesc(order?.description || '')
    setFDept(order?.department || '')
    setFAssigned(order?.assigned_to || '')
    setFDeadline(order?.deadline || '')
    setFCost(order?.cost_paise ? String(order.cost_paise / 100) : '')
    setFNotes(order?.notes || '')
    setFSearchResults([])
    setFCat(order?.item_cat_id ? String(order.item_cat_id) : '')
    setFSubCat('')
    setFRefImage(null)
    setFRefPreview('')
    if (order?.reference_image) {
      supabase.storage.from('production-images')
        .createSignedUrl(order.reference_image, 3600)
        .then(function (r) { if (r.data?.signedUrl) setFRefPreview(r.data.signedUrl) })
    }
    setView('form')
  }

  async function uploadRefImage(file) {
    if (!file) return null
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
    var path = 'ref/' + Date.now() + '.' + ext
    var { error } = await supabase.storage.from('production-images').upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
    if (error) { alert('Upload failed: ' + error.message); return null }
    return path
  }

  async function saveOrder() {
    if (!orderMode || !fItem || !fQty || Number(fQty) <= 0 || saving) return
    setSaving(true)

    var payload = {
      event_id: fEvent ? Number(fEvent) : null,
      item_id: fItem.id,
      item_source: fItem._source,
      qty_ordered: Number(fQty),
      description: fDesc.trim() || null,
      department: fDept || null,
      assigned_to: fAssigned || null,
      deadline: fDeadline || null,
      cost_paise: fCost ? Math.round(Number(fCost) * 100) : 0,
      notes: fNotes.trim() || null,
    }

    // Upload reference image if new file selected
    if (fRefImage) {
      var imgPath = await uploadRefImage(fRefImage)
      if (imgPath) payload.reference_image = imgPath
    }

    if (editOrder) {
      var { error } = await supabase.from('production_orders').update(payload).eq('id', editOrder.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('PROD_UPDATE', titleCase(fItem.name) + ' × ' + fQty) } catch (_) {}
    } else {
      payload.created_by = profile.id
      var { data: newOrder, error } = await supabase.from('production_orders').insert(payload).select().single()
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('PROD_CREATE', titleCase(fItem.name) + ' × ' + fQty) } catch (_) {}
    }

    setSaving(false)
    setView('list')
    loadOrders()
  }

  // ── DETAIL ──

  function openDetail(order) {
    setActiveOrder(order)
    setQtyInput(String(order.qty_completed || 0))
    setView('detail')
  }

  async function advanceStatus() {
    if (!activeOrder || saving) return
    var next = NEXT_STATUS[activeOrder.status]
    if (!next) return
    setSaving(true)
    var update = { status: next }
    if (next === 'completed') {
      update.completed_at = new Date().toISOString()
      update.qty_completed = activeOrder.qty_ordered
    }
    var { error } = await supabase.from('production_orders').update(update).eq('id', activeOrder.id)
    if (error) { alert('Status update failed: ' + error.message); setSaving(false); return }
    setActiveOrder(Object.assign({}, activeOrder, update))
    try { await logActivity('PROD_STATUS', activeOrder.item_name + ' → ' + STATUS_LABELS[next]) } catch (_) {}
    setSaving(false)
    loadOrders()
  }

  async function updateQtyCompleted() {
    if (!activeOrder || saving) return
    var val = Number(qtyInput) || 0
    if (val < 0 || val > activeOrder.qty_ordered) return
    setSaving(true)
    var update = { qty_completed: val }
    if (val >= activeOrder.qty_ordered) {
      update.status = 'completed'
      update.completed_at = new Date().toISOString()
    }
    var { error } = await supabase.from('production_orders').update(update).eq('id', activeOrder.id)
    if (error) { alert('Update failed: ' + error.message); setSaving(false); return }
    setActiveOrder(Object.assign({}, activeOrder, update))
    setSaving(false)
    loadOrders()
  }

  async function cancelOrder() {
    if (!activeOrder || saving) return
    if (!confirm('Cancel this production order?')) return
    setSaving(true)
    var { error } = await supabase.from('production_orders').update({ status: 'cancelled' }).eq('id', activeOrder.id)
    if (error) { alert('Cancel failed: ' + error.message); setSaving(false); return }
    setActiveOrder(Object.assign({}, activeOrder, { status: 'cancelled' }))
    try { await logActivity('PROD_CANCEL', activeOrder.item_name) } catch (_) {}
    setSaving(false)
    loadOrders()
  }

  // ── FILTER ──

  var filtered = orders.filter(function (o) {
    if (statusFilter && o.status !== statusFilter) return false
    if (deptFilter && o.department !== deptFilter) return false
    if (search) {
      var q = search.toLowerCase()
      var match = (o.item_name || '').toLowerCase().indexOf(q) !== -1 ||
        (o.description || '').toLowerCase().indexOf(q) !== -1 ||
        (o.notes || '').toLowerCase().indexOf(q) !== -1
      if (!match) return false
    }
    return true
  })

  function eventLabel(eventId) {
    if (!eventId) return null
    var ev = events.find(function (e) { return e.id === eventId })
    return ev ? (ev.client_name || '') + ' — ' + (ev.event_name || '') : 'Event #' + eventId
  }

  function profileName(id) {
    if (!id) return null
    var p = profiles.find(function (pr) { return pr.id === id })
    return p ? p.name : null
  }

  // Filtered profiles by selected department
  var filteredProfiles = profiles
  if (fDept) {
    var deptObj = departments.find(function (d) { return d.name === fDept })
    if (deptObj) {
      filteredProfiles = profiles.filter(function (p) {
        return (p.event_dept_ids || []).indexOf(deptObj.id) !== -1
      })
    }
  }

  // ═══ RENDER ═══

  if (loading && view === 'list') {
    return <div className="text-center py-8 text-sm text-gray-400">Loading production orders...</div>
  }

  // ── FORM ──
  if (view === 'form') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={function () { setView('list') }}
            className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
          <h3 className="text-base font-bold text-gray-800">
            {editOrder ? 'Edit Production Order' : 'New Production Order'}
          </h3>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {/* Event or General */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Production For *</label>
              <div className="flex gap-2">
                <button type="button" onClick={function () { setOrderMode('event'); setFEvent('') }}
                  className={"px-4 py-2 text-sm font-semibold rounded-lg transition-colors " +
                    (orderMode === 'event' ? "bg-indigo-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50")}>
                  📅 Event
                </button>
                <button type="button" onClick={function () { setOrderMode('general'); setFEvent(''); setFEventDate(''); setDateEvents([]) }}
                  className={"px-4 py-2 text-sm font-semibold rounded-lg transition-colors " +
                    (orderMode === 'general' ? "bg-indigo-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50")}>
                  🔧 General Production
                </button>
              </div>
            </div>
            {orderMode === 'event' && (
              <div className="space-y-3">
                <EventDatePicker label="Event Date" value={fEventDate}
                  onChange={function (dateStr) { setFEventDate(dateStr); setFEvent(''); loadEventsByDate(dateStr) }} />
                {dateEventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
                {fEventDate && !dateEventsLoading && dateEvents.length === 0 && (
                  <p className="text-xs text-amber-600">No events on this date</p>
                )}
                {dateEvents.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Event ({dateEvents.length} found)</label>
                    <select value={fEvent} onChange={function (e) { setFEvent(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select event...</option>
                      {dateEvents.map(function (ev) {
                        return <option key={ev.id} value={ev.id}>
                          {(ev.client_name || '') + ' — ' + (ev.venue_name || '') + ' — ' + (ev.event_name || '')}
                        </option>
                      })}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Category → Sub-category → Item */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
              <select value={fCat} onChange={function (e) { setFCat(e.target.value); setFSubCat(''); setFItem(null); setFItemSearch(''); setFSearchResults([]) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All categories</option>
                {categories.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Sub-category</label>
              <select value={fSubCat} onChange={function (e) { setFSubCat(e.target.value); setFItem(null); setFItemSearch(''); setFSearchResults([]) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All sub-categories</option>
                {subCategories.filter(function (sc) { return !fCat || sc.category_id === Number(fCat) }).map(function (sc) {
                  return <option key={sc.id} value={sc.id}>{sc.name}</option>
                })}
              </select>
            </div>
          </div>

          {/* Item search */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Item *{fCat ? '' : ' (select category to narrow results)'}</label>
            <div className="relative">
              <input type="text" value={fItemSearch}
                onChange={function (e) {
                  setFItemSearch(e.target.value)
                  setFItem(null)
                  searchItems(e.target.value)
                }}
                placeholder="Search inventory item..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {fSearchResults.length > 0 && !fItem && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                  {fSearchResults.map(function (item) {
                    var catName = item.categories?.name || '—'
                    var subCatName = item.sub_categories?.name || ''
                    var imgUrl = getImageUrl(item.image_path)
                    return (
                      <button key={item._source + '-' + item.id}
                        onClick={function () { pickItem(item) }}
                        className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-gray-100 last:border-0 flex items-center gap-3">
                        {imgUrl ? (
                          <img src={imgUrl} alt="" className="w-10 h-10 rounded object-cover border border-gray-200 flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs flex-shrink-0">📷</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                          <p className="text-[10px] text-gray-400">{catName}{subCatName ? ' > ' + subCatName : ''} · {item.unit} · {item._source === 'catering_store' ? 'CS' : 'INV'}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {fItem && (
              <div className="flex items-center gap-3 mt-2 bg-indigo-50 rounded-lg p-2.5">
                {(function () {
                  var imgUrl = getImageUrl(fItem.image_path)
                  return imgUrl ? (
                    <img src={imgUrl} alt="" className="w-14 h-14 rounded object-cover border border-indigo-200 flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded bg-white flex items-center justify-center text-gray-300 text-lg flex-shrink-0">📷</div>
                  )
                })()}
                <div>
                  <p className="text-sm font-semibold text-indigo-800">{titleCase(fItem.name)}</p>
                  <p className="text-[11px] text-indigo-600">
                    {fItem.categories?.name || '—'}{fItem.sub_categories?.name ? ' > ' + fItem.sub_categories.name : ''} · {fItem.unit} · {fItem._source === 'catering_store' ? 'Catering Store' : 'Inventory'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Qty + Cost + Deadline */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Qty to Produce *</label>
              <input type="number" min="1" value={fQty}
                onChange={function (e) { setFQty(e.target.value) }}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Est. Cost (₹)</label>
              <input type="number" min="0" step="1" value={fCost}
                onChange={function (e) { setFCost(e.target.value) }}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Deadline</label>
              <input type="date" value={fDeadline}
                onChange={function (e) { setFDeadline(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* Dept + Assigned */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Department</label>
              <select value={fDept} onChange={function (e) { setFDept(e.target.value); setFAssigned('') }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">—</option>
                {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Assigned To
                {fDept && filteredProfiles.length === 0 && <span className="text-[10px] text-amber-600 ml-1">(no users in this dept)</span>}
                {fDept && filteredProfiles.length > 0 && <span className="text-[10px] text-gray-400 ml-1">({filteredProfiles.length} in dept)</span>}
              </label>
              <select value={fAssigned} onChange={function (e) { setFAssigned(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Unassigned</option>
                {filteredProfiles.map(function (p) { return <option key={p.id} value={p.id}>{p.name}</option> })}
              </select>
            </div>
          </div>

          {/* Description + Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Description</label>
            <input type="text" value={fDesc}
              onChange={function (e) { setFDesc(e.target.value) }}
              placeholder="What needs to be fabricated/assembled..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {/* Reference Image */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Reference Image</label>
            <p className="text-[10px] text-gray-400 mb-2">Upload a photo of what needs to be produced — visible to production team</p>
            {fRefPreview && (
              <div className="relative inline-block mb-2">
                <img src={fRefPreview} alt="Reference" className="h-40 rounded-lg border border-gray-200 object-cover" />
                <button type="button" onClick={function () { setFRefImage(null); setFRefPreview('') }}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600">✕</button>
              </div>
            )}
            {!fRefPreview && (
              <label className={"inline-block text-xs px-4 py-2 rounded-lg font-semibold cursor-pointer transition-colors " +
                "border border-gray-300 text-gray-600 hover:bg-gray-50"}>
                📷 Choose Image
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={function (e) {
                    var file = e.target.files?.[0]
                    if (file) {
                      setFRefImage(file)
                      setFRefPreview(URL.createObjectURL(file))
                    }
                    e.target.value = ''
                  }} />
              </label>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
            <textarea value={fNotes} onChange={function (e) { setFNotes(e.target.value) }}
              rows={2} placeholder="Optional..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={saveOrder} disabled={saving || !orderMode || !fItem || !fQty}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editOrder ? 'Update' : 'Create Order')}
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

  // ── DETAIL ──
  if (view === 'detail' && activeOrder) {
    var isActive = activeOrder.status === 'pending' || activeOrder.status === 'in_progress'
    var pct = activeOrder.qty_ordered > 0 ? Math.round((activeOrder.qty_completed / activeOrder.qty_ordered) * 100) : 0

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button onClick={function () { setView('list'); setActiveOrder(null) }}
              className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <h3 className="text-base font-bold text-gray-800">{titleCase(activeOrder.item_name)}</h3>
            <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[activeOrder.status] || '')}>
              {STATUS_LABELS[activeOrder.status]}
            </span>
          </div>
          {isActive && (
            <button onClick={function () { openForm(activeOrder) }}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Edit</button>
          )}
        </div>

        {/* Info card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600">
            {activeOrder.event_id && (
              <div className="col-span-2"><strong className="text-gray-500">Event:</strong> {eventLabel(activeOrder.event_id)}</div>
            )}
            <div><strong className="text-gray-500">Item:</strong> {titleCase(activeOrder.item_name)} ({activeOrder.item_unit})</div>
            <div><strong className="text-gray-500">Source:</strong> {activeOrder.item_source === 'catering_store' ? 'Catering Store' : 'Inventory'}</div>
            {activeOrder.department && <div><strong className="text-gray-500">Department:</strong> {activeOrder.department}</div>}
            {activeOrder.assigned_to && <div><strong className="text-gray-500">Assigned:</strong> {profileName(activeOrder.assigned_to) || '—'}</div>}
            {activeOrder.deadline && <div><strong className="text-gray-500">Deadline:</strong> {formatDate(activeOrder.deadline)}</div>}
            {activeOrder.cost_paise > 0 && <div><strong className="text-gray-500">Cost:</strong> {formatPaise(activeOrder.cost_paise)}</div>}
          </div>
          {activeOrder.description && <p className="text-xs text-gray-500">{activeOrder.description}</p>}
          {activeOrder.notes && <p className="text-xs text-gray-400 italic">{activeOrder.notes}</p>}
        </div>

        {/* Reference image */}
        {activeOrder.reference_image && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Reference Image</p>
            <RefImage path={activeOrder.reference_image} />
          </div>
        )}

        {/* Progress */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase">Progress</p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className={"h-3 rounded-full transition-all " + (pct >= 100 ? "bg-green-500" : "bg-indigo-500")}
                  style={{ width: pct + '%' }} />
              </div>
            </div>
            <span className="text-sm font-bold text-gray-700 flex-shrink-0">
              {activeOrder.qty_completed} / {activeOrder.qty_ordered} {activeOrder.item_unit}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">{pct}%</span>
          </div>

          {/* Update qty completed */}
          {isActive && (
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <label className="text-xs text-gray-500">Completed:</label>
              <input type="number" min="0" max={activeOrder.qty_ordered}
                value={qtyInput}
                onChange={function (e) { setQtyInput(e.target.value) }}
                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={updateQtyCompleted} disabled={saving}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? '...' : 'Update'}
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        {isActive && (
          <div className="flex gap-2 flex-wrap">
            {NEXT_STATUS[activeOrder.status] && (
              <button onClick={advanceStatus} disabled={saving}
                className={"px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 " +
                  (activeOrder.status === 'pending'
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "bg-green-600 text-white hover:bg-green-700")}>
                {saving ? '...' : (activeOrder.status === 'pending' ? '🔧 Start Production' : '✓ Mark Completed')}
              </button>
            )}
            <button onClick={cancelOrder} disabled={saving}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
              {saving ? '...' : '✕ Cancel'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── LIST ──
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search item, description..."
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <div className="flex gap-2 flex-wrap items-center">
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            className="flex-1 min-w-[100px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Status</option>
            {Object.keys(STATUS_LABELS).map(function (k) { return <option key={k} value={k}>{STATUS_LABELS[k]}</option> })}
          </select>
          <select value={deptFilter} onChange={function (e) { setDeptFilter(e.target.value) }}
            className="flex-1 min-w-[100px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Depts</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          <button onClick={function () { openForm(null) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap">
            + New Order
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">No production orders found</div>
      )}

      <div className="space-y-2">
        {filtered.map(function (o) {
          var pct = o.qty_ordered > 0 ? Math.round((o.qty_completed / o.qty_ordered) * 100) : 0
          var overdue = o.deadline && o.deadline < new Date().toISOString().split('T')[0] && o.status !== 'completed' && o.status !== 'cancelled'
          return (
            <div key={o.id}
              onClick={function () { openDetail(o) }}
              className={"bg-white rounded-xl border p-4 hover:shadow-md cursor-pointer transition-all " +
                (overdue ? "border-red-200" : "border-gray-200 hover:border-gray-300")}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-gray-800">{titleCase(o.item_name)}</p>
                  {o.description && <p className="text-xs text-gray-500 mt-0.5">{o.description}</p>}
                </div>
                <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[o.status] || '')}>
                  {STATUS_LABELS[o.status]}
                </span>
              </div>
              <div className="flex items-center gap-4 mb-2">
                <div className="flex-1">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className={"h-2 rounded-full transition-all " + (pct >= 100 ? "bg-green-500" : "bg-indigo-500")}
                      style={{ width: pct + '%' }} />
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-600 flex-shrink-0">{o.qty_completed}/{o.qty_ordered} {o.item_unit}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                {o.event_id && <span>📅 {eventLabel(o.event_id)}</span>}
                {o.department && <span>🏢 {o.department}</span>}
                {o.deadline && (
                  <span className={overdue ? "text-red-600 font-bold" : ""}>
                    ⏰ {formatDate(o.deadline)}{overdue ? ' OVERDUE' : ''}
                  </span>
                )}
                {o.cost_paise > 0 && <span>💰 {formatPaise(o.cost_paise)}</span>}
                {profileName(o.assigned_to) && <span>👤 {profileName(o.assigned_to)}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ProductionOrders
