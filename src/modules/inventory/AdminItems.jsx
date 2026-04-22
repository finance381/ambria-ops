import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { formatDate, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import InventoryForm from './InventoryForm'

function AdminItems({ profile }) {
  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [departments, setDepartments] = useState([])
  var [venues, setVenues] = useState([])
  var [venueFilter, setVenueFilter] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')
  var [categories, setCategories] = useState([])
  var [subCategoriesAll, setSubCategoriesAll] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [subDeptFilter, setSubDeptFilter] = useState('')
  var [subVenues, setSubVenues] = useState([])
  var [subVenueFilter, setSubVenueFilter] = useState('')
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editItem, setEditItem] = useState(null)
  var [deleteConfirm, setDeleteConfirm] = useState(null)
  var [holdItem, setHoldItem] = useState(null)
  var [holds, setHolds] = useState([])
  var [holdForm, setHoldForm] = useState({ hold_from: '', hold_to: '', qty: 1, reason: '' })
  var [holdSaving, setHoldSaving] = useState(false)
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(50)
  var [importModal, setImportModal] = useState(null) // { rows, header, file }
  var [importMode, setImportMode] = useState('add') // 'add' or 'update'
  var [importProgress, setImportProgress] = useState(null) // { done, total, skipped }
  var [importing, setImporting] = useState(false)

  useEffect(function () {
    loadData()
  }, [])

  async function loadData() {
    try {
      var [itemsRes, csRes, deptRes, venueRes, profilesRes, catRes, subCatRes, subDeptRes, subVenueRes] = await Promise.all([
        supabase.from('inventory_items')
          .select('id, name, name_hindi, inventory_id, qty, blocked, unit, type, status, department, category_id, sub_category_id, rate_paise, min_order_qty, reorder_qty, is_asset, image_path, submitted_by, entry_date, description, categories(name), sub_categories(name), venue_allocations(qty, venues(code, name), sub_venue_id)')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.from('catering_store_items')
          .select('id, name, name_hindi, inventory_id, qty, unit, type, status, department, category_id, sub_category_id, rate_paise, is_asset, image_path, submitted_by, entry_date, description, brand, pack_size_qty, pack_size_unit, season_reorder_qty, off_season_reorder_qty, categories(name), sub_categories(name), cs_venue_allocations(qty, venues(code, name), sub_venue_id)')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.from('departments').select('id, name, category_ids').eq('active', true).order('name'),
        supabase.from('venues').select('id, code, name').eq('active', true).order('code'),
        supabase.from('profiles').select('id, name, email'),
        supabase.from('categories').select('id, name, sub_department_id').order('name'),
        supabase.from('sub_categories').select('id, name, category_id').order('name'),
        supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
        supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      ])
      var profileMap = {}
      ;(profilesRes.data || []).forEach(function (p) { profileMap[p.id] = p })
      var invItems = (itemsRes.data || []).map(function (item) {
        return Object.assign({}, item, { _source: 'inventory', profiles: profileMap[item.submitted_by] || null })
      })
      var csItems = (csRes.data || []).map(function (item) {
        return Object.assign({}, item, {
          _source: 'catering_store',
          blocked: 0,
          venue_allocations: item.cs_venue_allocations || [],
          profiles: profileMap[item.submitted_by] || null,
        })
      })
      setItems(invItems.concat(csItems).sort(function (a, b) {
        return new Date(b.entry_date || 0) - new Date(a.entry_date || 0)
      }))
      setDepartments(deptRes.data || [])
      setVenues(venueRes.data || [])
      setCategories(catRes.data || [])
      setSubCategoriesAll(subCatRes.data || [])
      setSubDepartments(subDeptRes.data || [])
      setSubVenues(subVenueRes.data || [])
      setLoading(false)
    } catch (err) {
      alert('Failed to load items: ' + (err.message || 'Unknown error'))
      setLoading(false)
    }
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  function exportItems() {
    var headers = ['Inventory ID', 'Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Status', 'Source', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order / Season Reorder', 'Reorder / Off Season Reorder', 'Rate (₹)', 'Is Asset', 'Venue Code', 'Venue Qty']
    var rows = filtered.map(function (i) {
      var venueStr = (i.venue_allocations || []).map(function (va) { return (va.venues?.code || '') + ':' + va.qty }).join('; ')
      var venueCodes = (i.venue_allocations || []).map(function (va) { return va.venues?.code || '' }).join('; ')
      var venueQtys = (i.venue_allocations || []).map(function (va) { return va.qty }).join('; ')
      return [
        i.inventory_id || '', i.name, i.name_hindi || '',
        i.categories?.name || '', i.sub_categories?.name || '',
        i.type || '', i.qty, i.unit || '', i.department || '',
        i.description || '', i.status, i._source || 'inventory',
        i.brand || '', i.pack_size_qty || '', i.pack_size_unit || '',
        i.season_reorder_qty || i.min_order_qty || '',
        i.off_season_reorder_qty || i.reorder_qty || '',
        i.rate_paise ? (i.rate_paise / 100) : '',
        i.is_asset || '', venueCodes, venueQtys
      ].map(csvEscape).join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_inventory_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  function downloadTemplate() {
    var headers = ['Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order Qty', 'Reorder Qty', 'Rate (₹)', 'Is Asset', 'Venue Code', 'Venue Qty']
    var example = ['Table Top White', 'टेबल टॉप सफेद', 'Cloths', 'Table Top', 'Indoor', '50', 'Pieces', 'Decor', 'White crushed cloth', '', '', '', '10', '15', '500', 'yes', 'PHD', '50']
    var csv = '\uFEFF' + headers.join(',') + '\n' + example.map(csvEscape).join(',')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_import_template.csv'; a.click()
  } 
  async function deleteItem(item) {
    var allocTable = item._source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
    var itemTable = item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
    await supabase.from(allocTable).delete().eq('item_id', item.id)
    if (item.image_path) {
      await supabase.storage.from('images').remove([item.image_path])
    }
    var { error: delErr } = await supabase.from(itemTable).delete().eq('id', item.id)
    if (delErr) { alert('Delete failed: ' + delErr.message); return }
    try { await logActivity('ITEM_DELETE', item.name + ' | ID: ' + (item.inventory_id || item.id)) } catch (_) {}
    setDeleteConfirm(null)
    loadData()
  }

  function parseCsvLine(line) {
    var result = []; var current = ''; var inQuotes = false
    for (var i = 0; i < line.length; i++) {
      var ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') { inQuotes = false }
        else { current += ch }
      } else {
        if (ch === '"') { inQuotes = true }
        else if (ch === ',') { result.push(current.trim()); current = '' }
        else { current += ch }
      }
    }
    result.push(current.trim())
    return result
  }

  function parseImportFile(e) {
    var file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    var reader = new FileReader()
    reader.onload = function (ev) {
      var text = ev.target.result
      var lines = text.split('\n').filter(function (l) { return l.trim() })
      if (lines.length < 2) { alert('CSV must have header + at least 1 data row'); return }
      var header = parseCsvLine(lines[0]).map(function (h) { return h.replace(/^\uFEFF/, '').trim().toLowerCase() })
      var nameIdx = header.findIndex(function (h) { return h === 'name' })
      if (nameIdx === -1) { alert('CSV must have a "Name" column'); return }
      var rows = []
      for (var r = 1; r < lines.length; r++) {
        var cols = parseCsvLine(lines[r])
        if (!cols[nameIdx]?.trim()) continue
        var row = {}
        header.forEach(function (h, i) { row[h] = (cols[i] || '').trim() })
        rows.push(row)
      }
      if (rows.length === 0) { alert('No valid data rows found'); return }
      setImportModal({ rows: rows, header: header, fileName: file.name })
      setImportMode('add')
      setImportProgress(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function findCol(row, keys) {
    for (var k = 0; k < keys.length; k++) { if (row[keys[k]] != null && row[keys[k]] !== '') return row[keys[k]] }
    return ''
  }

  async function runImport() {
    if (!importModal || importing) return
    setImporting(true)
    var rows = importModal.rows
    var done = 0; var skipped = 0
    var CHUNK = 50

    for (var c = 0; c < rows.length; c += CHUNK) {
      var chunk = rows.slice(c, c + CHUNK)
      var results = await Promise.allSettled(chunk.map(function (r) {
        return processImportRow(r)
      }))
      results.forEach(function (res) {
        if (res.status === 'fulfilled' && res.value) done++; else skipped++
      })
      setImportProgress({ done: done, total: rows.length, skipped: skipped })
    }

    try { await logActivity('IMPORT_CSV', importMode.toUpperCase() + ' | ' + done + ' processed, ' + skipped + ' skipped') } catch (_) {}
    setImporting(false)
    loadData()
  }

  async function processImportRow(r) {
    var itemName = findCol(r, ['name']).trim()
    if (!itemName) return false

    var catName = findCol(r, ['category'])
    var subCatName = findCol(r, ['sub-category', 'sub_category', 'subcategory'])
    var brand = findCol(r, ['brand'])
    var packQty = findCol(r, ['pack size qty', 'pack_size_qty'])
    var packUnit = findCol(r, ['pack size unit', 'pack_size_unit'])

    var cat = catName ? categories.find(function (c2) { return c2.name.toLowerCase() === catName.toLowerCase() }) : null
    var catId = cat?.id || null
    var subCat = subCatName ? subCategoriesAll.find(function (sc) { return sc.name.toLowerCase() === subCatName.toLowerCase() && (!catId || sc.category_id === catId) }) : null
    var subCatId = subCat?.id || null

    var isCatStore = false
    if (catId) {
      var catRow = categories.find(function (c2) { return c2.id === catId })
      var csSubDept = subDepartments.find(function (sd) { return sd.name === 'Catering Store' })
      if (catRow && csSubDept && catRow.sub_department_id === csSubDept.id) isCatStore = true
    }
    var tableName = isCatStore ? 'catering_store_items' : 'inventory_items'
    var allocTable = isCatStore ? 'cs_venue_allocations' : 'venue_allocations'

    var matchQuery = supabase.from(tableName).select('id, qty').eq('name', itemName).eq('status', 'approved')
    if (catId) matchQuery = matchQuery.eq('category_id', catId)
    if (subCatId) matchQuery = matchQuery.eq('sub_category_id', subCatId)
    if (isCatStore && brand) matchQuery = matchQuery.eq('brand', brand)
    var { data: existing } = await matchQuery.limit(1).maybeSingle()

    var newQty = Number(findCol(r, ['qty', 'quantity'])) || 0
    var venueCode = findCol(r, ['venue code', 'venue_code', 'venue'])
    var venueQty = Number(findCol(r, ['venue qty', 'venue_qty'])) || newQty

    var nameHindi = findCol(r, ['name hindi', 'name_hindi'])
    var unit = findCol(r, ['unit'])
    var dept = findCol(r, ['department', 'dept'])
    var type = findCol(r, ['type'])
    var desc = findCol(r, ['description'])
    var rate = findCol(r, ['rate', 'rate (₹)', 'rate_paise'])
    var isAsset = findCol(r, ['is asset', 'is_asset'])
    var minOrd = findCol(r, ['min order qty', 'min_order_qty', 'season reorder qty'])
    var reord = findCol(r, ['reorder qty', 'reorder_qty', 'off season reorder qty'])

    if (importMode === 'update') {
      if (!existing) return false
      var updatePayload = {}
      if (nameHindi) updatePayload.name_hindi = nameHindi
      if (unit) updatePayload.unit = unit
      if (dept) updatePayload.department = dept
      if (type) updatePayload.type = type
      if (desc) updatePayload.description = desc
      if (rate) updatePayload.rate_paise = Math.round(Number(rate) * 100)
      if (isAsset) updatePayload.is_asset = isAsset
      if (isCatStore) {
        if (brand) updatePayload.brand = brand
        if (packQty) updatePayload.pack_size_qty = Number(packQty)
        if (packUnit) updatePayload.pack_size_unit = packUnit
        if (minOrd) updatePayload.season_reorder_qty = Number(minOrd)
        if (reord) updatePayload.off_season_reorder_qty = Number(reord)
      } else {
        if (minOrd) updatePayload.min_order_qty = Number(minOrd)
        if (reord) updatePayload.reorder_qty = Number(reord)
      }
      if (Object.keys(updatePayload).length > 0) {
        var { error: updErr } = await supabase.from(tableName).update(updatePayload).eq('id', existing.id)
        if (updErr) return false
      }
      return true
    }

    // ADD mode
    if (existing) {
      var { error: qtyErr } = await supabase.from(tableName).update({ qty: (existing.qty || 0) + newQty }).eq('id', existing.id)
      if (qtyErr) return false
      if (venueCode) {
        var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
        if (venue) {
          var { data: existAlloc } = await supabase.from(allocTable).select('id, qty').eq('item_id', existing.id).eq('venue_id', venue.id).limit(1).maybeSingle()
          if (existAlloc) {
            await supabase.from(allocTable).update({ qty: existAlloc.qty + venueQty }).eq('id', existAlloc.id)
          } else {
            await supabase.from(allocTable).insert({ item_id: existing.id, venue_id: venue.id, qty: venueQty })
          }
        }
      }
      return true
    }

    // Create new
    var payload = { name: itemName, status: 'approved', submitted_by: profile?.id || null, qty: newQty }
    if (catId) payload.category_id = catId
    if (subCatId) payload.sub_category_id = subCatId
    if (nameHindi) payload.name_hindi = nameHindi
    payload.unit = unit || 'Pieces'
    if (dept) payload.department = dept
    payload.type = type || 'Indoor'
    if (desc) payload.description = desc
    if (rate) payload.rate_paise = Math.round(Number(rate) * 100)
    if (isAsset) payload.is_asset = isAsset
    if (isCatStore) {
      if (brand) payload.brand = brand
      if (packQty) payload.pack_size_qty = Number(packQty)
      if (packUnit) payload.pack_size_unit = packUnit
      if (minOrd) payload.season_reorder_qty = Number(minOrd)
      if (reord) payload.off_season_reorder_qty = Number(reord)
    } else {
      if (minOrd) payload.min_order_qty = Number(minOrd)
      if (reord) payload.reorder_qty = Number(reord)
    }
    var { data: newItem, error: insErr } = await supabase.from(tableName).insert(payload).select('id').single()
    if (insErr) return false
    if (newItem && venueCode) {
      var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
      if (venue) {
        await supabase.from(allocTable).insert({ item_id: newItem.id, venue_id: venue.id, qty: venueQty })
      }
    }
    return true
  }

  async function openHolds(item) {
   setHoldItem(item)
   setHoldForm({ hold_from: '', hold_to: '', qty: 1, reason: '' })
   var { data } = await supabase
     .from('maintenance_holds')
     .select('id, hold_from, hold_to, qty, reason, created_at')
     .eq('item_id', item.id)
     .order('hold_from', { ascending: false })
   setHolds(data || [])
 }

 async function addHold() {
   if (!holdForm.hold_from || !holdForm.hold_to || !holdForm.qty) return
   setHoldSaving(true)
   await supabase.from('maintenance_holds').insert({
     item_id: holdItem.id,
     hold_from: holdForm.hold_from,
     hold_to: holdForm.hold_to,
     qty: Number(holdForm.qty),
     reason: holdForm.reason.trim(),
     created_by: profile?.id,
   })
   try { await logActivity('MAINTENANCE_HOLD', holdItem.name + ' | ' + holdForm.qty + '× | ' + holdForm.hold_from + ' to ' + holdForm.hold_to + (holdForm.reason ? ' | ' + holdForm.reason : '')) } catch (_) {}
   setHoldSaving(false)
   openHolds(holdItem)
 }

 async function removeHold(holdId) {
   await supabase.from('maintenance_holds').delete().eq('id', holdId)
   try { await logActivity('MAINTENANCE_RELEASE', holdItem.name + ' | Hold #' + holdId) } catch (_) {}
   openHolds(holdItem)
 }

  var searchLower = search.toLowerCase()
  var filtered = items.filter(function (item) {
    var matchSearch = !search ||
      item.name.toLowerCase().includes(searchLower) ||
      (item.inventory_id || '').toLowerCase().includes(searchLower) ||
      (item.profiles?.name || '').toLowerCase().includes(searchLower) ||
      (item.profiles?.email || '').toLowerCase().includes(searchLower) ||
      (item.description || '').toLowerCase().includes(searchLower) ||
      (item.name_hindi || '').toLowerCase().includes(searchLower) ||
      (item.categories?.name || '').toLowerCase().includes(searchLower) ||
      (item.sub_categories?.name || '').toLowerCase().includes(searchLower) ||
      (item.department || '').toLowerCase().includes(searchLower) ||
      (item.brand || '').toLowerCase().includes(searchLower)
    var matchDept = !deptFilter || item.department === deptFilter
    var matchStatus = !statusFilter || item.status === statusFilter
    var matchSubDept = !subDeptFilter || (function () {
    var sdCatIds = categories.filter(function (c) { return String(c.sub_department_id) === subDeptFilter }).map(function (c) { return c.id })
    return sdCatIds.includes(item.category_id)
     })()
    var matchVenue = !venueFilter || (item.venue_allocations || []).some(function (va) { return va.venues?.code === venueFilter })
    var matchSubVenue = !subVenueFilter || (item.venue_allocations || []).some(function (va) { return String(va.sub_venue_id) === subVenueFilter })
    var matchCat = !catFilter || String(item.category_id) === catFilter
    var matchSubCat = !subCatFilter || String(item.sub_category_id) === subCatFilter
    return matchSearch && matchDept && matchSubDept && matchStatus && matchVenue && matchCat && matchSubCat && matchSubVenue
  })

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading items...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name, ID, description, submitter..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={deptFilter}
          onChange={function (e) { setDeptFilter(e.target.value); setSubDeptFilter(''); setCatFilter(''); setSubCatFilter(''); setPage(1) }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Departments</option>
          {departments.map(function (d) {
            return <option key={d.name} value={d.name}>{d.name}</option>
          })}
        </select>
        {(function () {
          var deptSubDepts = subDepartments.filter(function (sd) {
            if (!deptFilter) return true
            var dept = departments.find(function (d) { return d.name === deptFilter })
            return dept ? sd.department_id === dept.id : true
          })
          return (
            <select value={subDeptFilter}
              onChange={function (e) { setSubDeptFilter(e.target.value); setCatFilter(''); setSubCatFilter(''); setPage(1) }}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Sub-depts</option>
              {deptSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
            </select>
          )
        })()}
        <select
          value={statusFilter}
          onChange={function (e) { setStatusFilter(e.target.value); setPage(1) }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending (Admin)</option>
          <option value="pending_dept">Pending (Dept)</option>
        </select>
        <select
          value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value); setSubCatFilter(''); setPage(1) }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Categories</option>
          {categories.filter(function (c) {
            if (subDeptFilter) return c.sub_department_id === Number(subDeptFilter)
            if (!deptFilter) return true
            var dept = departments.find(function (d) { return d.name === deptFilter })
            return dept?.category_ids?.includes(c.id)
          }).map(function (c) {
            return <option key={c.id} value={String(c.id)}>{c.name}</option>
          })}
        </select>
        <select
          value={subCatFilter}
          onChange={function (e) { setSubCatFilter(e.target.value); setPage(1) }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Sub-categories</option>
          {subCategoriesAll.filter(function (sc) {
            if (catFilter) return String(sc.category_id) === catFilter
            if (deptFilter) {
              var dept = departments.find(function (d) { return d.name === deptFilter })
              return dept?.category_ids?.includes(sc.category_id)
            }
            return true
          }).map(function (sc) {
            return <option key={sc.id} value={String(sc.id)}>{sc.name}</option>
          })}
        </select>
        <select
          value={venueFilter}
          onChange={function (e) { setVenueFilter(e.target.value); setSubVenueFilter(''); setPage(1) }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Venues</option>
          {venues.map(function (v) {
            return <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
          })}
        </select>
        {(function () {
          var filteredSv = subVenues.filter(function (sv) {
            if (!venueFilter) return true
            var venue = venues.find(function (v) { return v.code === venueFilter })
            return venue ? sv.venue_id === venue.id : true
          })
          if (filteredSv.length === 0) return null
          return (
            <select value={subVenueFilter}
              onChange={function (e) { setSubVenueFilter(e.target.value); setPage(1) }}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Sub-venues</option>
              {filteredSv.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
            </select>
          )
        })()}
        <select
          value={perPage}
          onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={250}>250 / page</option>
        </select>
        <div className="text-sm text-gray-400 self-center">
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </div>
        <button onClick={exportItems}
          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">📥 Export</button>
        <label className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer">
          📤 Import
          <input type="file" accept=".csv" onChange={parseImportFile} className="hidden" />
        </label>
        <button onClick={downloadTemplate}
          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">📋 Template</button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-sm" style={{ minWidth: 1000 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-2 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider" style={{ width: 70 }}></th>
              <th className="text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Item / Hindi</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Category / Sub</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Dept</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Stock</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Unit</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Venues</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">By</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((page - 1) * perPage, page * perPage).map(function (item) {
              var venueAllocs = item.venue_allocations || []
              var imgUrl = getImageUrl(item.image_path)
              var statusColors = {
                approved: 'bg-green-100 text-green-700',
                pending: 'bg-amber-100 text-amber-700',
                pending_dept: 'bg-blue-100 text-blue-700',
              }
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2" style={{ minWidth: 100, width: 100 }}>
                        {imgUrl ? (
                          <img src={imgUrl} alt="" onClick={function () { setEnlargedImg(imgUrl) }}
                            className="w-14 h-14 rounded object-cover border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"/>
                    ) : (
                      <div className="w-14 h-14 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📷</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.name_hindi && <div className="text-[11px] text-gray-500">{item.name_hindi}</div>}
                    {item.brand && <div className="text-[11px] text-amber-600 font-medium">{item.brand}{item.pack_size_qty ? ' · ' + item.pack_size_qty + ' ' + (item.pack_size_unit || '') : ''}</div>}
                    <div className="text-[11px] text-gray-400 font-mono">{item.inventory_id || '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-600">{item.categories?.name || '—'}</div>
                    {item.sub_categories?.name && (
                      <div className="text-[11px] text-gray-400">{item.sub_categories.name}</div>
                    )}
                    {item.description && (
                      <div className="text-[11px] text-gray-400 truncate max-w-[150px]" title={item.description}>{item.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{item.department || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-medium text-gray-900">{item.qty}</div>
                    {item.rate_paise && (profile?.role === 'admin' || profile?.role === 'auditor') ? <div className="text-[11px] text-gray-400">₹{(item.rate_paise / 100).toFixed(item.rate_paise % 100 ? 2 : 0)}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{item.unit}</td>
                  
                  <td className="px-3 py-2">
                    {venueAllocs.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {venueAllocs.map(function (va) {
                          return (
                            <span key={va.venues?.code} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                              {va.venues?.code}: {va.qty}
                            </span>
                          )
                        })}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-600 text-[12px]">{item.profiles?.name || '—'}</div>
                    <div className="text-[11px] text-gray-400 truncate max-w-[120px]">{item.profiles?.email || ''}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-[12px] whitespace-nowrap">{formatDate(item.entry_date || item.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " + (statusColors[item.status] || 'bg-gray-100 text-gray-600')}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5">
                      <button
                        onClick={function () { setEditItem(item) }}
                        className="px-2.5 py-1 text-[11px] font-semibold border border-gray-300 rounded text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors"
                      >Edit</button>
                      {item._source !== 'catering_store' && (
                        <button
                          onClick={function () { openHolds(item) }}
                          className="px-2.5 py-1 text-[11px] font-semibold border border-orange-200 rounded text-orange-500 hover:bg-orange-50 transition-colors"
                        >🔧</button>
                      )}
                      {deleteConfirm === item.id ? (
                        <>
                          <button onClick={function () { deleteItem(item) }}
                            className="px-2.5 py-1 text-[11px] font-bold bg-red-600 text-white rounded hover:bg-red-700 transition-colors">Yes</button>
                          <button onClick={function () { setDeleteConfirm(null) }}
                            className="px-2.5 py-1 text-[11px] font-semibold border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors">No</button>
                        </>
                      ) : (
                        <button onClick={function () { setDeleteConfirm(item.id) }}
                          className="px-2.5 py-1 text-[11px] font-semibold border border-red-200 rounded text-red-500 hover:bg-red-50 transition-colors">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="11" className="px-4 py-8 text-center text-gray-400">No items found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {(function () {
        var totalPages = Math.ceil(filtered.length / perPage)
        if (totalPages <= 1) return null
        return (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button onClick={function () { setPage(1) }} disabled={page === 1}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">«</button>
            <button onClick={function () { setPage(page - 1) }} disabled={page === 1}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
            {Array.from({ length: totalPages }, function (_, i) { return i + 1 }).filter(function (p) {
              return p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)
            }).map(function (p, i, arr) {
              var showGap = i > 0 && p - arr[i - 1] > 1
              return (
                <span key={p}>
                  {showGap && <span className="px-1 text-gray-300">…</span>}
                  <button onClick={function () { setPage(p) }}
                    className={"px-3 py-1.5 text-xs rounded font-medium transition-colors " +
                      (p === page ? "bg-indigo-600 text-white" : "border border-gray-300 hover:bg-gray-50")}>{p}</button>
                </span>
              )
            })}
            <button onClick={function () { setPage(page + 1) }} disabled={page === totalPages}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">›</button>
            <button onClick={function () { setPage(totalPages) }} disabled={page === totalPages}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">»</button>
            <span className="text-xs text-gray-400 ml-2">Page {page} of {totalPages}</span>
          </div>
        )
      })()}
      {/* Edit modal */}
      <Modal open={!!editItem} onClose={function () { setEditItem(null) }} title="Edit Item" wide>
        {editItem && (
          <InventoryForm
            item={editItem}
            profile={profile}
            onClose={function () { setEditItem(null) }}
            onSaved={function () { setEditItem(null); loadData() }}
          />
        )}
      </Modal>
          
      {/* Enlarged image modal */}
      <Modal open={!!enlargedImg} onClose={function () { setEnlargedImg(null) }} title="Item Photo">
        {enlargedImg && (
          <div className="flex items-center justify-center">
            <img src={enlargedImg} alt="" className="max-w-full max-h-[70vh] rounded-lg" />
          </div>
        )}
      </Modal>
      {/* Maintenance hold modal */}
     <Modal open={!!holdItem} onClose={function () { setHoldItem(null) }} title={'Maintenance — ' + (holdItem?.name || '')}>
       {holdItem && (
         <div className="space-y-4">
           {/* Add new hold */}
           <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
             <h4 className="text-xs font-bold text-orange-700 uppercase tracking-wider">New Hold</h4>
             <div className="grid grid-cols-2 gap-2">
               <div>
                 <label className="block text-[11px] text-gray-500 mb-0.5">From</label>
                 <input type="date" value={holdForm.hold_from} onChange={function (e) { setHoldForm(function (p) { return Object.assign({}, p, { hold_from: e.target.value }) }) }}
                   className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
               </div>
               <div>
                 <label className="block text-[11px] text-gray-500 mb-0.5">To</label>
                 <input type="date" value={holdForm.hold_to} onChange={function (e) { setHoldForm(function (p) { return Object.assign({}, p, { hold_to: e.target.value }) }) }}
                   className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
               </div>
             </div>
             <div className="grid grid-cols-3 gap-2">
               <div>
                 <label className="block text-[11px] text-gray-500 mb-0.5">Qty</label>
                 <input type="number" min="1" value={holdForm.qty} onChange={function (e) { setHoldForm(function (p) { return Object.assign({}, p, { qty: e.target.value }) }) }}
                   className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
               </div>
               <div className="col-span-2">
                 <label className="block text-[11px] text-gray-500 mb-0.5">Reason</label>
                 <input type="text" value={holdForm.reason} onChange={function (e) { setHoldForm(function (p) { return Object.assign({}, p, { reason: e.target.value }) }) }}
                   placeholder="e.g. Repair, painting..." maxLength="200"
                   className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
               </div>
             </div>
             <button onClick={addHold} disabled={holdSaving || !holdForm.hold_from || !holdForm.hold_to}
               className="w-full py-2 text-sm font-semibold text-white bg-orange-500 rounded hover:bg-orange-600 disabled:opacity-50 transition-colors">
               {holdSaving ? 'Saving...' : 'Add Hold'}</button>
           </div>
           {/* Existing holds */}
           {holds.length > 0 ? (
             <div className="space-y-2">
               <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Holds</h4>
               {holds.map(function (h) {
                 return (
                   <div key={h.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                     <div>
                       <p className="text-sm font-medium text-gray-800">{h.qty}× — {h.reason || 'No reason'}</p>
                       <p className="text-[11px] text-gray-400">
                         {new Date(h.hold_from).toLocaleDateString('en-IN', {day:'numeric',month:'short'})} → {new Date(h.hold_to).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}
                       </p>
                     </div>
                     <button onClick={function () { removeHold(h.id) }}
                       className="px-2 py-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">Remove</button>
                   </div>
                 )
               })}
             </div>
           ) : (
             <p className="text-sm text-gray-400 text-center py-2">No active holds</p>
           )}
         </div>
       )}
     </Modal>
     {/* Import modal */}
      <Modal open={!!importModal} onClose={function () { if (!importing) { setImportModal(null); setImportProgress(null) } }} title="Import Items">
        {importModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{importModal.fileName}</p>
              <p className="text-xs text-gray-500 mt-1">{importModal.rows.length} data rows found</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {importModal.header.slice(0, 10).map(function (h) {
                  return <span key={h} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono">{h}</span>
                })}
                {importModal.header.length > 10 && <span className="text-[10px] text-gray-400">+{importModal.header.length - 10} more</span>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Import Mode</label>
              <div className="flex gap-0 bg-white border border-gray-300 rounded-lg overflow-hidden">
                <button type="button" onClick={function () { setImportMode('add') }}
                  className={"flex-1 py-3 text-sm font-medium transition-colors " + (importMode === 'add' ? "bg-green-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                  ➕ Add Items
                </button>
                <button type="button" onClick={function () { setImportMode('update') }}
                  className={"flex-1 py-3 text-sm font-medium transition-colors " + (importMode === 'update' ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                  ✏️ Update Info
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                {importMode === 'add'
                  ? 'Existing items: qty will be added. New items: will be created as approved.'
                  : 'Existing items: info fields updated (qty unchanged). Items not found: skipped.'}
              </p>
            </div>

            {/* Preview first 3 rows */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Preview (first 3 rows)</p>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="text-[11px] w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {importModal.header.slice(0, 8).map(function (h) {
                        return <th key={h} className="px-2 py-1.5 text-left font-bold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {importModal.rows.slice(0, 3).map(function (row, ri) {
                      return (
                        <tr key={ri} className="border-b border-gray-100">
                          {importModal.header.slice(0, 8).map(function (h) {
                            return <td key={h} className="px-2 py-1.5 text-gray-600 whitespace-nowrap max-w-[150px] truncate">{row[h] || '—'}</td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Progress */}
            {importProgress && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Progress</span>
                  <span className="text-gray-500">{importProgress.done + importProgress.skipped} / {importProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: Math.round(((importProgress.done + importProgress.skipped) / importProgress.total) * 100) + '%' }} />
                </div>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span className="text-green-600 font-medium">{importProgress.done} processed</span>
                  <span className="text-amber-600 font-medium">{importProgress.skipped} skipped</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={function () { setImportModal(null); setImportProgress(null) }} disabled={importing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">Cancel</button>
              <button onClick={runImport} disabled={importing || (importProgress && importProgress.done + importProgress.skipped >= importProgress.total)}
                className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50">
                {importing ? 'Importing...' : importProgress ? 'Done' : 'Start Import'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AdminItems