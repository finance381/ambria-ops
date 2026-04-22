import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'

function BlockInventory({ func, profile, onDone }) {
  var [items, setItems] = useState([])
  var [existing, setExisting] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [selections, setSelections] = useState({})
  var [error, setError] = useState('')
  var [checked, setChecked] = useState({})
  var [bulkQty, setBulkQty] = useState('')
  var [bulkRemark, setBulkRemark] = useState('')
  var [bulkStatus, setBulkStatus] = useState('confirmed')
  // Calculate blocking date range from function
  var contractDate = func.contract_date
  var setupDays = func.setup_days ?? 1
  var teardownDays = func.teardown_days ?? 1

  function addDays(dateStr, days) {
    var d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  var blockFrom = contractDate ? addDays(contractDate, -setupDays) : null
  var blockTo = contractDate ? addDays(contractDate, teardownDays) : null
  var defaultExpiry = contractDate ? addDays(contractDate, -1) : '' // day before event

  var [availMap, setAvailMap] = useState({}) // { itemId: available }
  var [venueConflicts, setVenueConflicts] = useState({})
  var [holdMap, setHoldMap] = useState({})

  var myCatIds = profile?.category_ids || []
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  useEffect(function () { loadData() }, [])

  async function loadData() {
    var invQuery = supabase
      .from('inventory_items')
      .select('id, name, name_hindi, qty, unit, type, category_id, image_path, categories(name), sub_categories(name)')
      .eq('status', 'approved')
      .order('name')

    var csQuery = supabase
      .from('catering_store_items')
      .select('id, name, name_hindi, qty, unit, type, category_id, image_path, categories(name), sub_categories(name)')
      .eq('status', 'approved')
      .order('name')

    if (!isAdmin && myCatIds.length > 0) {
      invQuery = invQuery.in('category_id', myCatIds)
      csQuery = csQuery.in('category_id', myCatIds)
    }

    var [itemsRes, csRes, existingRes] = await Promise.all([
      invQuery,
      csQuery,
      supabase.from('event_items').select('*').eq('event_id', func.id),
    ])

    var allItems = (itemsRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
      .concat((csRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) }))
    setItems(allItems)
    setExisting(existingRes.data || [])

    var sel = {}
    ;(existingRes.data || []).forEach(function (ei) {
      sel[ei.item_id] = { qty: String(ei.qty), remark: ei.remark || '', existingId: ei.id, existingQty: ei.qty, block_status: ei.block_status || 'confirmed', tentative_expires_at: ei.tentative_expires_at ? ei.tentative_expires_at.split('T')[0] : '' }
    })
    setSelections(sel)

    // Fetch date-aware availability in one RPC call
    if (blockFrom && blockTo) {
      var { data: avail } = await supabase.rpc('available_qty_batch', {
        p_from: blockFrom,
        p_to: blockTo,
        p_exclude_event_id: func.id,
      })
      var map = {}
      ;(avail || []).forEach(function (r) { map[r.item_id] = { available: r.available, tentative: r.tentative_held || 0 } })
      setAvailMap(map)

      // Fetch venue conflicts — items blocked at different venues in overlapping dates
      var { data: overlapping } = await supabase
        .from('event_items')
        .select('item_id, qty, block_status, events(venue_name, event_name)')
        .neq('event_id', func.id)
        .lte('block_from', blockTo)
        .gte('block_to', blockFrom) 

      var currentVenue = func.venue_name
      var conflicts = {}
      ;(overlapping || []).forEach(function (ei) {
        var otherVenue = ei.events?.venue_name
        if (otherVenue && currentVenue && otherVenue !== currentVenue && ei.block_status === 'confirmed') {
          if (!conflicts[ei.item_id]) conflicts[ei.item_id] = []
          var exists = conflicts[ei.item_id].some(function (c) { return c.venue === otherVenue && c.event_name === (ei.events?.event_name || '') })
          if (!exists) {
            conflicts[ei.item_id].push({ venue: otherVenue, qty: ei.qty, event_name: ei.events?.event_name || '' })
          }
        }
     })
     setVenueConflicts(conflicts)
     // Fetch maintenance holds overlapping this date range
      var { data: holds } = await supabase
        .from('maintenance_holds')
        .select('item_id, qty, reason')
        .lte('hold_from', blockTo)
        .gte('hold_to', blockFrom)
      var hMap = {}
      ;(holds || []).forEach(function (h) {
        if (!hMap[h.item_id]) hMap[h.item_id] = { qty: 0, reasons: [] }
        hMap[h.item_id].qty += h.qty
        if (h.reason) hMap[h.item_id].reasons.push(h.reason)
      })
      setHoldMap(hMap)
    }

    setLoading(false)
  }

  function updateSelection(itemId, field, value) {
    setSelections(function (prev) {
      var current = prev[itemId] || { qty: '', remark: '', block_status: 'confirmed', tentative_expires_at: '' }
      var updated = Object.assign({}, current, { [field]: value })
      // If qty cleared and no existing, remove entry
      if (!updated.qty && !updated.existingId) {
        var copy = Object.assign({}, prev)
        delete copy[itemId]
        return copy
      }
      return Object.assign({}, prev, { [itemId]: updated })
    })
  }

  function getAvailable(item) {
    var entry = availMap[item.id]
    var base = entry ? entry.available : item.qty
    // Add back what's already blocked for THIS event (so user can adjust)
    var existingSel = selections[item.id]
    var alreadyBlocked = existingSel?.existingQty || 0
    return base + alreadyBlocked
  }

  function getTentative(item) {
    var entry = availMap[item.id]
    return entry ? entry.tentative : 0
  }

  function toggleCheck(itemId) {
    setChecked(function (prev) {
      var copy = Object.assign({}, prev)
      if (copy[itemId]) { delete copy[itemId] } else { copy[itemId] = true }
      return copy
    })
  }

  function toggleAllFiltered() {
    var allChecked = sorted.length > 0 && sorted.every(function (i) { return checked[i.id] })
    if (allChecked) {
      setChecked({})
    } else {
      var next = {}
      sorted.forEach(function (i) { next[i.id] = true })
      setChecked(next)
    }
  }

  function applyBulk() {
    var ids = Object.keys(checked).filter(function (id) { return checked[id] })
    if (ids.length === 0) return
    setSelections(function (prev) {
      var next = Object.assign({}, prev)
      ids.forEach(function (id) {
        var current = next[id] || { qty: '', remark: '', block_status: 'confirmed', tentative_expires_at: '' }
        var updated = Object.assign({}, current)
        if (bulkQty) updated.qty = bulkQty
        if (bulkRemark) updated.remark = bulkRemark
        updated.block_status = bulkStatus
        if (bulkStatus === 'tentative' && !updated.tentative_expires_at) updated.tentative_expires_at = defaultExpiry
        next[id] = updated
      })
      return next
    })
    setChecked({})
    setBulkQty('')
    setBulkRemark('')
  }

  function applyMaxQty() {
    var ids = Object.keys(checked).filter(function (id) { return checked[id] })
    if (ids.length === 0) return
    setSelections(function (prev) {
      var next = Object.assign({}, prev)
      ids.forEach(function (id) {
        var item = items.find(function (i) { return String(i.id) === id })
        if (!item) return
        var avail = getAvailable(item)
        if (avail <= 0) return
        var current = next[id] || { qty: '', remark: '', block_status: 'confirmed', tentative_expires_at: '' }
        next[id] = Object.assign({}, current, { qty: String(avail) })
      })
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    try {
      var toInsert = []
      var toUpdate = []
      var toDelete = []
      var blockChanges = {} // itemId → net change in blocked qty

      // Process each selection
      Object.keys(selections).forEach(function (itemId) {
        var sel = selections[itemId]
        var newQty = Number(sel.qty) || 0
        var oldQty = sel.existingQty || 0

        if (sel.existingId) {
          if (newQty === 0) {
            // Remove blocking
            toDelete.push(sel.existingId)
            blockChanges[itemId] = -oldQty
          } else {
            var existingRow = existing.find(function (e) { return e.id === sel.existingId })
            var changed = newQty !== oldQty || sel.remark !== (existingRow?.remark || '') || sel.block_status !== (existingRow?.block_status || 'confirmed')
            if (changed) {
              toUpdate.push({ id: sel.existingId, qty: newQty, remark: sel.remark || null, block_status: sel.block_status || 'confirmed', tentative_expires_at: sel.block_status === 'tentative' && sel.tentative_expires_at ? new Date(sel.tentative_expires_at).toISOString() : null })
            }
            blockChanges[itemId] = newQty - oldQty
          }
        } else if (newQty > 0) {
          // New blocking
          toInsert.push({
            event_id: func.id,
            item_id: Number(itemId),
            qty: newQty,
            department: func.department || null,
            remark: sel.remark || null,
            blocked_by: profile.id,
            blocked_at: new Date().toISOString(),
            block_from: blockFrom,
            block_to: blockTo,
            block_status: sel.block_status || 'confirmed',
            tentative_expires_at: sel.block_status === 'tentative' && sel.tentative_expires_at ? new Date(sel.tentative_expires_at).toISOString() : null,
          })
          blockChanges[itemId] = newQty
        }
      })

      // Check for removed existing items (user cleared qty on previously blocked items)
      existing.forEach(function (ei) {
        if (!selections[ei.item_id]) {
          toDelete.push(ei.id)
          blockChanges[ei.item_id] = -(ei.qty || 0)
        }
      })

      // Validate available qty
      for (var itemId in blockChanges) {
        if (blockChanges[itemId] > 0) {
          var item = items.find(function (i) { return i.id === Number(itemId) })
          if (item) {
            var available = getAvailable(item)
            var sel = selections[itemId]
            var newQty = Number(sel?.qty) || 0
            if (newQty > available) {
              setError(titleCase(item.name) + ': only ' + available + ' available, trying to block ' + newQty)
              setSaving(false)
              return
            }
          }
        }
      }

      // Execute deletes
      if (toDelete.length > 0) {
        var { error: delErr } = await supabase.from('event_items').delete().in('id', toDelete)
        if (delErr) throw new Error('Delete failed: ' + delErr.message)
      }

      // Execute updates (parallelized)
      if (toUpdate.length > 0) {
        var updateResults = await Promise.all(toUpdate.map(function (u) {
          return supabase.from('event_items').update({
            qty: u.qty,
            remark: u.remark,
            block_status: u.block_status,
            tentative_expires_at: u.tentative_expires_at,
          }).eq('id', u.id)
        }))
        var updateErr = updateResults.find(function (r) { return r.error })
        if (updateErr) throw new Error('Update failed: ' + updateErr.error.message)
      }

      // Execute inserts
      if (toInsert.length > 0) {
        var { error: insErr } = await supabase.from('event_items').insert(toInsert)
        if (insErr) throw new Error('Insert failed: ' + insErr.message)
      }

      // Update blocked counts on inventory_items
      

      var totalBlocked = Object.keys(selections).filter(function (id) { return Number(selections[id]?.qty) > 0 }).length
      try { await logActivity('BLOCK_ITEMS', func.event_name + ' | ' + totalBlocked + ' items') } catch (_) {}
      onDone()
    } catch (err) {
      setError(err.message || 'Failed to save')
    }
    setSaving(false)
  }

  // Filter items
  var categories = [...new Set(items.map(function (i) { return i.categories?.name }).filter(Boolean))].sort()
  var searchLower = search.toLowerCase()
  var filtered = items.filter(function (item) {
    var matchSearch = !search ||
      item.name.toLowerCase().includes(searchLower) ||
      (item.name_hindi || '').toLowerCase().includes(searchLower) ||
      (item.categories?.name || '').toLowerCase().includes(searchLower) ||
      (item.sub_categories?.name || '').toLowerCase().includes(searchLower)
    var matchCat = !catFilter || item.categories?.name === catFilter
    return matchSearch && matchCat
  })

  // Sort: selected items first, then by name
  var sorted = filtered.slice().sort(function (a, b) {
    var aSelected = selections[a.id] && Number(selections[a.id].qty) > 0 ? 1 : 0
    var bSelected = selections[b.id] && Number(selections[b.id].qty) > 0 ? 1 : 0
    if (aSelected !== bSelected) return bSelected - aSelected
    return a.name.localeCompare(b.name)
  })

  var selectedCount = Object.keys(selections).filter(function (id) { return Number(selections[id]?.qty) > 0 }).length
  var checkedCount = Object.keys(checked).filter(function (id) { return checked[id] }).length
  var allFilteredChecked = filtered.length > 0 && filtered.every(function (i) { return checked[i.id] })

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading inventory...</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-gray-800">{func.event_name || func.contract_type || '—'}</h3>
        <p className="text-xs text-gray-400 mb-3">{selectedCount} items selected</p>
        {blockFrom && blockTo && (
          <p className="text-xs text-indigo-600 font-medium mt-1">
            🔒 {new Date(blockFrom).toLocaleDateString('en-IN', {day:'numeric',month:'short'})} → {new Date(blockTo).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}
            <span className="text-gray-400 font-normal ml-1">({setupDays}d setup + {teardownDays}d teardown)</span>
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onDone}
            className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Saving...' : 'Save Blocking'}</button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search items..."
          className="flex-1 min-w-[180px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <select value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Categories</option>
          {categories.map(function (c) { return <option key={c} value={c}>{c}</option> })}
        </select>
      </div>

      {/* Bulk action bar */}
      {checkedCount > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700">{checkedCount} items checked</span>
            <button onClick={function () { setChecked({}) }}
              className="text-[11px] text-gray-500 hover:text-gray-700">✕ Clear</button>
          </div>
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Qty</label>
              <input type="number" min="0" inputMode="numeric" value={bulkQty}
                onChange={function (e) { setBulkQty(e.target.value) }}
                placeholder="—" className="w-20 px-2 py-1.5 border border-indigo-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-[10px] text-gray-500 mb-0.5">Remark</label>
              <input type="text" value={bulkRemark}
                onChange={function (e) { setBulkRemark(e.target.value) }}
                placeholder="—" maxLength="200" className="w-full px-2 py-1.5 border border-indigo-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex bg-white border border-indigo-300 rounded overflow-hidden">
              <button type="button" onClick={function () { setBulkStatus('confirmed') }}
                className={"px-2 py-1.5 text-[11px] font-bold transition-colors " + (bulkStatus === 'confirmed' ? "bg-green-600 text-white" : "text-gray-400 hover:bg-gray-50")}>
                ✓ Conf</button>
              <button type="button" onClick={function () { setBulkStatus('tentative') }}
                className={"px-2 py-1.5 text-[11px] font-bold transition-colors " + (bulkStatus === 'tentative' ? "bg-amber-500 text-white" : "text-gray-400 hover:bg-gray-50")}>
                ⏳ Tent</button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={function () { applyBulk(filtered) }} disabled={!bulkQty && !bulkRemark}
              className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              Apply to {checkedCount} items</button>
            <button onClick={applyMaxQty}
              className="py-2 px-3 text-xs font-bold text-indigo-600 bg-white border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors">
              Qty = Max</button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Items checklist */}
      <div className="flex items-center gap-2 mb-1">
        <input type="checkbox" checked={allFilteredChecked}
          onChange={function () {
            if (allFilteredChecked) { setChecked({}) }
            else {
              var next = {}
              filtered.forEach(function (i) { next[i.id] = true })
              setChecked(next)
            }
          }}
          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        <span className="text-[11px] text-gray-500">{allFilteredChecked ? 'Deselect all' : 'Select all'} ({filtered.length})</span>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {sorted.map(function (item) {
          var sel = selections[item.id]
          var qty = sel?.qty || ''
          var remark = sel?.remark || ''
          var available = getAvailable(item)
          var isSelected = Number(qty) > 0
          var imgUrl = getImageUrl(item.image_path)

          return (
            <div key={item.id} className={"rounded-lg border p-3 transition-colors " +
              (isSelected ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200")}>
              <div className="flex gap-3">
                {/* Checkbox */}
                <input type="checkbox" checked={!!checked[item.id]}
                  onChange={function () { toggleCheck(item.id) }}
                  className="w-4 h-4 mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0" />
                {/* Image */}
                {imgUrl ? (
                  <img src={imgUrl} alt="" className="w-12 h-12 rounded object-cover border border-gray-200 flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs flex-shrink-0">📷</div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{titleCase(item.name)}</h4>
                      <p className="text-[11px] text-gray-500">
                        {item.categories?.name || '—'}{item.sub_categories?.name ? ' > ' + item.sub_categories.name : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-xs text-gray-500">Available</p>
                      <p className={"text-sm font-bold " + (available <= 0 ? "text-red-500" : "text-green-600")}>{available} {item.unit}</p>
                      {getTentative(item) > 0 && (
                        <p className="text-[10px] text-amber-600 font-medium">⚠ {getTentative(item)} tentative</p>
                      )}
                      {venueConflicts[item.id] && (
                        <div className="mt-0.5">
                          {venueConflicts[item.id].map(function (c, ci) {
                            return <p key={ci} className="text-[10px] text-red-600 font-medium">🏛️ {c.qty}× at {c.venue}</p>
                          })}
                        </div>
                      )}
                      {holdMap[item.id] && (
                        <p className="text-[10px] text-orange-600 font-medium mt-0.5" title={holdMap[item.id].reasons.join(', ')}>
                          🔧 {holdMap[item.id].qty} in maintenance
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Qty + Status row */}
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex gap-2 items-center">
                      <input type="number" min="0" max={available}
                        inputMode="numeric"
                        value={qty}
                        onChange={function (e) { updateSelection(item.id, 'qty', e.target.value) }}
                        placeholder="Qty"
                        className={"w-20 px-2 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " +
                          (isSelected ? "border-indigo-300 bg-white" : "border-gray-300")}
                        style={{ fontSize: '16px' }} />
                      <input type="text" value={remark}
                        onChange={function (e) { updateSelection(item.id, 'remark', e.target.value) }}
                        placeholder="Remark"
                        maxLength="200"
                        className="flex-1 px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        style={{ fontSize: '16px' }} />
                    </div>
                    {isSelected && (
                      <div className="flex gap-2 items-center">
                        <div className="flex bg-white border border-gray-300 rounded overflow-hidden">
                          <button type="button" onClick={function () { updateSelection(item.id, 'block_status', 'confirmed') }}
                            className={"px-2.5 py-1 text-[11px] font-bold transition-colors " + ((sel?.block_status || 'confirmed') === 'confirmed' ? "bg-green-600 text-white" : "text-gray-400 hover:bg-gray-50")}>
                            ✓ Confirmed</button>
                          <button type="button" onClick={function () { updateSelection(item.id, 'block_status', 'tentative'); if (!sel?.tentative_expires_at) updateSelection(item.id, 'tentative_expires_at', defaultExpiry) }}
                            className={"px-2.5 py-1 text-[11px] font-bold transition-colors " + (sel?.block_status === 'tentative' ? "bg-amber-500 text-white" : "text-gray-400 hover:bg-gray-50")}>
                            ⏳ Tentative</button>
                        </div>
                        {sel?.block_status === 'tentative' && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-400">Expires:</span>
                            <input type="date" value={sel?.tentative_expires_at || ''}
                              onChange={function (e) { updateSelection(item.id, 'tentative_expires_at', e.target.value) }}
                              className="px-1.5 py-1 border border-amber-300 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400 bg-amber-50"
                              style={{ fontSize: '14px' }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {sorted.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No items available in your categories</p>
        )}
      </div>
    </div>
  )
}

export default BlockInventory