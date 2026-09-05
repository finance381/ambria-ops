import { useState, useEffect, useMemo } from 'react'
import { prepUpload } from '../../lib/uploadHelper'
import { supabase, getImageUrl, fetchAll } from '../../lib/supabase'
import { formatDate, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import InventoryForm from './InventoryForm'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'

function FilterDropdown({ value, onChange, options, placeholder, multi }) {
  var [open, setOpen] = useState(false)
  var [q, setQ] = useState('')
  var qLower = q.toLowerCase()
  var filtered = q ? options.filter(function (o) { return o.label.toLowerCase().indexOf(qLower) !== -1 }) : options
  var vals = multi ? (value || []) : []
  var selected = multi ? null : options.find(function (o) { return o.value === value })
  var displayLabel = multi
    ? (function () {
        if (vals.length === 0) return placeholder
        if (vals.length <= 2) {
          return vals.map(function (v) {
            var o = options.find(function (x) { return x.value === v })
            return (o && o.label) || v
          }).join(', ')
        }
        return vals.length + ' selected'
      })()
    : (selected ? selected.label : placeholder)
  var hasValue = multi ? vals.length > 0 : !!value
  function toggle(v) {
    if (!multi) { onChange(v); setOpen(false); return }
    var idx = vals.indexOf(v)
    if (idx === -1) { onChange(vals.concat([v])) }
    else { onChange(vals.filter(function (x) { return x !== v })) }
  }
  function clearAll() { onChange(multi ? [] : ''); setOpen(false) }
  return (
    <div className="relative" style={{ minWidth: 140 }}>
      <button type="button" onClick={function () { setOpen(!open); setQ('') }}
        className={"px-3 py-2.5 border rounded-lg text-sm text-left w-full truncate focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (hasValue ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 text-gray-500")}>
        {displayLabel}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg" style={{ maxHeight: 300, display: 'flex', flexDirection: 'column' }}>
          <div className="p-1.5 border-b border-gray-100">
            <input type="text" value={q} onChange={function (e) { setQ(e.target.value) }} placeholder="Type to filter..."
              autoFocus className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            <button type="button" onClick={clearAll}
              className={"w-full text-left px-3 py-2 text-sm hover:bg-gray-50 " + (!hasValue ? "font-bold text-indigo-600" : "text-gray-400")}>
              {placeholder}
            </button>
            {filtered.map(function (o) {
              var isOn = multi ? vals.indexOf(o.value) !== -1 : o.value === value
              return (
                <button key={o.value} type="button" onClick={function () { toggle(o.value) }}
                  className={"w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 truncate flex items-center gap-2 " + (isOn ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-gray-700")}>
                  {multi && <span className={"inline-block w-4 h-4 rounded border text-center text-[10px] leading-4 flex-shrink-0 " + (isOn ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300")}>{isOn ? '✓' : ''}</span>}
                  {o.label}
                </button>
              )
            })}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No matches</p>}
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={function () { setOpen(false) }} />}
    </div>
  )
}

function AdminItems({ profile }) {
  var canViewCosts = hasPerm(profile?.permsNew, 'finance.view_costs')
  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [deptFilter, setDeptFilter] = useState([])
  var [statusFilter, setStatusFilter] = useState([])
  var [departments, setDepartments] = useState([])
  var venues = useReferenceData().venues.filter(function (v) { return v.active })
  var [venueFilter, setVenueFilter] = useState([])
  var [catFilter, setCatFilter] = useState([])
  var [subCatFilter, setSubCatFilter] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategoriesAll, setSubCategoriesAll] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [subDeptFilter, setSubDeptFilter] = useState([])
  var [masterDeptFilter, setMasterDeptFilter] = useState([])
  var [defaultApplied, setDefaultApplied] = useState(false)
  var [subVenues, setSubVenues] = useState([])
  var [subVenueFilter, setSubVenueFilter] = useState([])
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editItem, setEditItem] = useState(null)
  var [deleteConfirm, setDeleteConfirm] = useState(null)
  var [holdItem, setHoldItem] = useState(null)
  var [holds, setHolds] = useState([])
  var [holdForm, setHoldForm] = useState({ hold_from: '', hold_to: '', qty: 1, reason: '' })
  var [holdSaving, setHoldSaving] = useState(false)
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(50)
  var [sortKey, setSortKey] = useState(null)
  var [sortDir, setSortDir] = useState('asc')
  var [importModal, setImportModal] = useState(null) // { rows, header, file }
  var [importMode, setImportMode] = useState('add') // 'add' or 'update'
  var [importProgress, setImportProgress] = useState(null) // { done, total, skipped }
  var [importing, setImporting] = useState(false)
  var [exportModal, setExportModal] = useState(false)
  var [bulkImgModal, setBulkImgModal] = useState(null) // { file, matched, unmatched, duplicates, replacing, total }
  var [bulkImgProgress, setBulkImgProgress] = useState(null) // { done, failed, total, failedRows }
  var [bulkImgProcessing, setBulkImgProcessing] = useState(false)

  useEffect(function () {
    loadData()
  }, [])

  async function loadData() {
    try {
      var [invAll, csAll, deptRes, profilesRes, catRes, subCatRes, subDeptRes, subVenueRes] = await Promise.all([
        fetchAll(supabase.from('inventory_items')
          .select('id, name, name_hindi, inventory_id, qty, blocked, unit, type, status, department, category_id, sub_category_id, rate_paise, min_order_qty, reorder_qty, is_asset, image_path, submitted_by, entry_date, description, dimensions, categories(name, sub_department_id), sub_categories(name), venue_allocations(qty, venues(code, name), sub_venue_id, sub_department_id)')
          .order('created_at', { ascending: false })),
        fetchAll(supabase.from('catering_store_items')
          .select('id, name, name_hindi, inventory_id, qty, unit, type, status, department, category_id, sub_category_id, rate_paise, is_asset, image_path, submitted_by, entry_date, description, dimensions, brand, pack_size_qty, pack_size_unit, season_reorder_qty, off_season_reorder_qty, categories(name, sub_department_id), sub_categories(name), cs_venue_allocations(qty, venues(code, name), sub_venue_id, sub_department_id)')
          .order('created_at', { ascending: false })),
        supabase.from('departments').select('id, name, category_ids, is_inventory_default').eq('active', true).order('name'),
        supabase.from('profiles').select('id, name, email'),
        supabase.from('categories').select('id, name, sub_department_id').order('name'),
        supabase.from('sub_categories').select('id, name, category_id').order('name'),
        supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
        supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      ])
      var profileMap = {}
      ;(profilesRes.data || []).forEach(function (p) { profileMap[p.id] = p })
      var invItems = (invAll || []).map(function (item) {
        return Object.assign({}, item, { _source: 'inventory', profiles: profileMap[item.submitted_by] || null })
      })
      var csItems = (csAll || []).map(function (item) {
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
      var loadedDepts = deptRes.data || []
      setDepartments(loadedDepts)
      if (!defaultApplied) {
        var defDept = loadedDepts.find(function (d) { return d.is_inventory_default })
        if (defDept) setMasterDeptFilter([String(defDept.id)])
        setDefaultApplied(true)
      }
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

  function resetFilters() {
    setSearch(''); setDeptFilter([]); setStatusFilter([]); setSubDeptFilter([])
    setMasterDeptFilter([]); setDefaultApplied(true)
    setCatFilter([]); setSubCatFilter([]); setVenueFilter([]); setSubVenueFilter([])
    setPage(1)
  }

  function formatDimensionsCsv(dims) {
    if (!Array.isArray(dims) || dims.length === 0) return ''
    var parts = []
    dims.forEach(function (d) {
      if (!d || !d.name) return
      var t = d.type || 'number'
      var val = ''
      var unit = ''
      if (t === 'number') {
        val = d.qty != null ? String(d.qty).trim() : ''
        unit = d.unit ? String(d.unit).trim() : ''
        if (unit.toLowerCase() === 'pieces') unit = ''
      } else {
        val = d.value != null ? String(d.value).trim() : ''
      }
      if (!val || val.toLowerCase() === 'pieces') return
      parts.push(d.name + ': ' + val + (unit ? ' ' + unit : ''))
    })
    return parts.join('; ')
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  function exportItems() {
    var headers = ['ID', 'Inventory ID', 'Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Status', 'Source', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order / Season Reorder', 'Reorder / Off Season Reorder']
    if (canViewCosts) headers.push('Rate (₹)')
    headers = headers.concat(['Is Asset', 'Dimensions', 'Venue Code', 'Sub-Venue', 'Venue Qty', 'Image URL', 'Date Added'])
    var rows = sorted.map(function (i) {
      var allocs = i.venue_allocations || []
      if (venueFilter.length > 0) {
        allocs = allocs.filter(function (va) { return va.venues && venueFilter.indexOf(va.venues.code) !== -1 })
      }
      if (subVenueFilter.length > 0) {
        allocs = allocs.filter(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id || '')) !== -1 })
      }
      var venueCodes = allocs.map(function (va) { return va.venues?.code || '' }).join('; ')
      var venueSubVenues = allocs.map(function (va) { var sv = subVenues.find(function (s) { return s.id === va.sub_venue_id }); return sv?.name || '' }).join('; ')
      var venueQtys = allocs.map(function (va) { return va.qty }).join('; ')
      var imgUrl = i.image_path ? supabase.storage.from('images').getPublicUrl(i.image_path).data?.publicUrl || '' : ''
      var row = [
        i.id, i.inventory_id || '', i.name, i.name_hindi || '',
        i.categories?.name || '', i.sub_categories?.name || '',
        i.type || '', venueFilter.length > 0 ? allocs.reduce(function (sum, va) { return sum + (va.qty || 0) }, 0) : i.qty, i.unit || '', i.department || '',
        i.description || '', i.status, i._source || 'inventory',
        i.brand || '', i.pack_size_qty || '', i.pack_size_unit || '',
        i.season_reorder_qty || i.min_order_qty || '',
        i.off_season_reorder_qty || i.reorder_qty || '',
      ]
      if (canViewCosts) row.push(i.rate_paise ? (i.rate_paise / 100) : '')
      row.push(i.is_asset || '', formatDimensionsCsv(i.dimensions), venueCodes, venueSubVenues, venueQtys, imgUrl, i.entry_date || (i.created_at ? i.created_at.split('T')[0] : ''))
      return row.map(csvEscape).join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_inventory_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  function exportPdf() {
    function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
    var filterParts = []
    if (search && search.trim()) filterParts.push({ label: 'Search', value: search.trim() })
    if (masterDeptFilter.length) filterParts.push({ label: 'Master Dept', value: masterDeptFilter.map(function (id) { var d = departments.find(function (x) { return String(x.id) === id }); return d ? d.name : id }).join(', ') })
    if (subDeptFilter.length) filterParts.push({ label: 'Master Sub-dept', value: subDeptFilter.map(function (id) { var sd = subDepartments.find(function (x) { return String(x.id) === id }); return sd ? sd.name : id }).join(', ') })
    if (statusFilter.length) filterParts.push({ label: 'Status', value: statusFilter.join(', ') })
    if (catFilter.length) filterParts.push({ label: 'Category', value: catFilter.map(function (cid) { var c = categories.find(function (x) { return String(x.id) === cid }); return c ? c.name : cid }).join(', ') })
    if (subCatFilter.length) filterParts.push({ label: 'Sub-category', value: subCatFilter.map(function (scid) { var sc = subCategoriesAll.find(function (x) { return String(x.id) === scid }); return sc ? sc.name : scid }).join(', ') })
    if (venueFilter.length) filterParts.push({ label: 'Venue', value: venueFilter.join(', ') })
    if (subVenueFilter.length) filterParts.push({ label: 'Sub-venue', value: subVenueFilter.map(function (svid) { var sv = subVenues.find(function (x) { return String(x.id) === svid }); return sv ? sv.name : svid }).join(', ') })
    if (deptFilter.length) filterParts.push({ label: 'Alloc Dept', value: deptFilter.join(', ') })
    var rows = sorted.map(function (item, idx) {
      var allocs = item.venue_allocations || []
      if (venueFilter.length > 0) allocs = allocs.filter(function (va) { return va.venues && venueFilter.indexOf(va.venues.code) !== -1 })
      if (subVenueFilter.length > 0) allocs = allocs.filter(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id || '')) !== -1 })
      var subDeptMap = {}
      allocs.forEach(function (va) {
        var sdKey = va.sub_department_id || 'null'
        if (!subDeptMap[sdKey]) {
          var sd = subDepartments.find(function (x) { return x.id === va.sub_department_id })
          subDeptMap[sdKey] = { name: sd ? sd.name : (item.department || '—'), total: 0, venues: [] }
        }
        subDeptMap[sdKey].total += (va.qty || 0)
        var svName = va.sub_venue_id ? (subVenues.find(function (sv) { return sv.id === va.sub_venue_id }) || {}).name : null
        subDeptMap[sdKey].venues.push({ code: (va.venues?.code || '') + (svName ? ':' + svName : ''), qty: va.qty || 0 })
      })
      var subDeptBlocks = Object.keys(subDeptMap).map(function (k) { return subDeptMap[k] })
      var totalQty = venueFilter.length > 0 ? allocs.reduce(function (s, va) { return s + (va.qty || 0) }, 0) : item.qty
      var imgUrl = getImageUrl(item.image_path)
      return { idx: idx + 1, invId: item.inventory_id || '', name: item.name, hindi: item.name_hindi || '', cat: item.categories?.name || '', subCat: item.sub_categories?.name || '', subDeptBlocks: subDeptBlocks, qty: totalQty, unit: item.unit || '', remarks: item.description || '', img: imgUrl || '' }
    })
    var w = window.open('', '_blank')
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site.'); return }
    var css = 'body{font-family:sans-serif;margin:20px;color:#333}' +
      'h1{font-size:22px;margin:0 0 4px;font-weight:800}' +
      '.filters{font-size:11px;color:#888;margin-bottom:6px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}' +
      'th{background:#fff;color:#666;padding:10px 8px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #ddd}' +
      'td{padding:10px 8px;vertical-align:middle}' +
      '.item-row td{border-top:1px solid #e5e7eb}' +
      '.remarks-row td{padding:2px 8px 12px;font-size:11px;color:#555;border-bottom:1px solid #e5e7eb}' +
      '.remarks-lbl{font-weight:700;color:#888;letter-spacing:0.5px;margin-right:6px}' +
      '.hindi{font-size:11px;color:#888;margin-top:2px}' +
      '.subcat{font-size:11px;color:#888;margin-top:2px}' +
      '.qty-big{font-size:22px;font-weight:700;color:#111}' +
      '.unit{font-size:12px;color:#666}' +
      '.name-big{font-size:14px;font-weight:700;color:#111}' +
      '.cat-name{font-size:13px;font-weight:600;color:#111}' +
      '.sd-block{margin-bottom:8px}' +
      '.sd-block:last-child{margin-bottom:0}' +
      '.sd-name{font-size:13px;font-weight:700;color:#111;margin-right:8px}' +
      '.sd-total{display:inline-block;background:#065f46;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;vertical-align:middle}' +
      '.venues{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}' +
      '.venue{font-size:11px;color:#4338ca;background:#eef2ff;padding:2px 8px;border-radius:6px;font-weight:600}' +
      '.img{width:170px;height:170px;object-fit:cover;border-radius:8px;border:1px solid #ddd}' +
      '.no-img{width:170px;height:170px;background:#f3f4f6;border-radius:8px;display:inline-block}' +
      '.inv-id{font-family:monospace;font-size:12px}' +
      '.num{font-size:14px;color:#888;font-weight:600}' +
      '.filter-box{margin:8px 0 12px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px}' +
      '.filter-title{font-size:10px;font-weight:700;color:#888;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px}' +
      '.filter-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.filter-chip{display:inline-flex;align-items:baseline;gap:4px;font-size:11px;background:#fff;border:1px solid #d1d5db;border-radius:12px;padding:2px 10px}' +
      '.filter-chip .k{font-weight:700;color:#4338ca}' +
      '.filter-chip .v{color:#111}' +
      '@media print{body{margin:10px}@page{size:A4 landscape;margin:8mm}.item-row,.remarks-row{page-break-inside:avoid}.item-row{page-break-after:avoid}.remarks-row{page-break-before:avoid}}'
    var html = '<!DOCTYPE html><html><head><title>Ambria Inventory</title><style>' + css + '</style></head><body>'
    html += '<h1>Ambria Inventory</h1>'
    html += '<div class="filters">' + filtered.length + ' items | Exported ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div>'
    if (filterParts.length) {
      var chips = filterParts.map(function (f) { return '<span class="filter-chip"><span class="k">' + escHtml(f.label) + ':</span><span class="v">' + escHtml(f.value) + '</span></span>' }).join('')
      html += '<div class="filter-box"><div class="filter-title">Applied Filters</div><div class="filter-chips">' + chips + '</div></div>'
    }
    html += '<table><thead><tr>' +
      '<th style="width:36px">#</th>' +
      '<th style="width:190px">Photo</th>' +
      '<th style="width:90px">Inv ID</th>' +
      '<th>Item Name</th>' +
      '<th>Category</th>' +
      '<th>Sub-Department &amp; Venues</th>' +
      '<th style="width:60px">Qty</th>' +
      '<th style="width:60px">Unit</th>' +
      '</tr></thead><tbody>'
    rows.forEach(function (r) {
      var imgHtml = r.img ? '<img class="img" src="' + r.img + '" loading="lazy" />' : '<span class="no-img"></span>'
      var sdHtml = r.subDeptBlocks.length ? r.subDeptBlocks.map(function (sd) {
        var venueChips = sd.venues.map(function (v) { return '<span class="venue">' + escHtml(v.code) + ':' + v.qty + '</span>' }).join('')
        return '<div class="sd-block"><span class="sd-name">' + escHtml(sd.name || '—') + '</span><span class="sd-total">' + sd.total + '</span>' + (venueChips ? '<div class="venues">' + venueChips + '</div>' : '') + '</div>'
      }).join('') : '<span style="color:#999">—</span>'
      html += '<tr class="item-row">' +
        '<td class="num">' + r.idx + '</td>' +
        '<td>' + imgHtml + '</td>' +
        '<td class="inv-id">' + escHtml(r.invId) + '</td>' +
        '<td><div class="name-big">' + escHtml(r.name) + '</div>' + (r.hindi ? '<div class="hindi">' + escHtml(r.hindi) + '</div>' : '') + '</td>' +
        '<td><div class="cat-name">' + escHtml(r.cat) + '</div>' + (r.subCat ? '<div class="subcat">' + escHtml(r.subCat) + '</div>' : '') + '</td>' +
        '<td>' + sdHtml + '</td>' +
        '<td class="qty-big">' + r.qty + '</td>' +
        '<td class="unit">' + escHtml(r.unit) + '</td>' +
        '</tr>'
      if (r.remarks) {
        html += '<tr class="remarks-row"><td></td><td colspan="7"><span class="remarks-lbl">REMARKS:</span>' + escHtml(r.remarks) + '</td></tr>'
      }
    })
    html += '</tbody></table></body></html>'
    w.document.write(html)
    w.document.close()
    setTimeout(function () { w.print() }, 1500)
  }

  function downloadTemplate() {
    var headers = ['Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order Qty', 'Reorder Qty', 'Rate (₹)', 'Is Asset', 'Dimensions', 'Venue Code', 'Sub-Venue', 'Venue Qty']
    var example = ['Table Top White', 'टेबल टॉप सफेद', 'Cloths', 'Table Top', 'Indoor', '50', 'Pieces', 'Decor', 'White crushed cloth', '', '', '', '10', '15', '500', 'yes', 'Length:10 Feet; Width:6 Feet', 'PHD', 'Main Hall', '50']
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
      var hasIdCol = header.indexOf('id') !== -1
      setImportModal({ rows: rows, header: header, fileName: file.name, hasId: hasIdCol })
      setImportMode('add')
      setImportProgress(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function findCol(row, keys) {
    for (var k = 0; k < keys.length; k++) { if (row[keys[k]] != null && row[keys[k]] !== '') return row[keys[k]] }
    return ''
  }

  // ─── BULK IMAGE IMPORT ─────────────────────────────────────
  async function parseBulkImageZip(e) {
    var file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 500 * 1024 * 1024) { alert('ZIP too large (max 500MB)'); return }
    try {
      var mod = await import('jszip')
      var JSZip = mod.default || mod
      var zip = await JSZip.loadAsync(file)
      var entries = []
      zip.forEach(function (relPath, entry) {
        if (entry.dir) return
        if (relPath.indexOf('__MACOSX') !== -1) return
        var basename = relPath.split('/').pop()
        if (!basename || basename.charAt(0) === '.') return
        var m = basename.match(/^(.+?)\.(jpe?g|png|webp|gif)$/i)
        if (!m) return
        entries.push({ invId: m[1].trim(), ext: m[2].toLowerCase(), entry: entry, basename: basename })
      })
      if (entries.length === 0) { alert('No image files found in ZIP (jpg/jpeg/png/webp/gif).'); return }

      var invMap = {}
      items.forEach(function (it) {
        if (it.inventory_id) invMap[String(it.inventory_id).toLowerCase()] = it
      })

      var matched = []; var unmatched = []; var seen = {}
      entries.forEach(function (en) {
        var key = en.invId.toLowerCase()
        if (seen[key]) { seen[key].push(en.basename); return }
        seen[key] = [en.basename]
        var it = invMap[key]
        if (it) matched.push(Object.assign({}, en, { item: it }))
        else unmatched.push(en)
      })
      var duplicates = Object.keys(seen).filter(function (k) { return seen[k].length > 1 }).map(function (k) { return { key: k, files: seen[k] } })
      var replacing = matched.filter(function (m) { return m.item.image_path }).length

      setBulkImgModal({ file: file, matched: matched, unmatched: unmatched, duplicates: duplicates, replacing: replacing, total: entries.length })
      setBulkImgProgress(null)
    } catch (err) {
      alert('Failed to read ZIP: ' + (err?.message || err))
    }
  }

  async function runBulkImageImport() {
    if (!bulkImgModal || bulkImgProcessing) return
    setBulkImgProcessing(true)
    var matched = bulkImgModal.matched
    var done = 0; var failed = 0; var failedRows = []
    var CHUNK = 4
    for (var i = 0; i < matched.length; i += CHUNK) {
      var batch = matched.slice(i, i + CHUNK)
      var results = await Promise.all(batch.map(async function (m) {
        try {
          var rawBlob = await m.entry.async('blob')
          var rawFile = new File([rawBlob], m.basename, { type: 'image/jpeg' })
          var compressed = await prepUpload(rawFile, 100)
          var prefix = m.item._source === 'catering_store' ? 'catering' : 'inventory'
          var tableName = m.item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
          var path = prefix + '/' + m.item.id + '_' + Date.now() + '.jpg'
          var { error: upErr } = await supabase.storage.from('images').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          var oldPath = m.item.image_path
          var { error: updErr } = await supabase.from(tableName).update({ image_path: path }).eq('id', m.item.id)
          if (updErr) throw updErr
          if (oldPath && oldPath !== path) { try { await supabase.storage.from('images').remove([oldPath]) } catch (_) {} }
          return { ok: true }
        } catch (err) {
          return { ok: false, invId: m.invId, basename: m.basename, reason: err?.message || 'Upload/update failed' }
        }
      }))
      results.forEach(function (r) { if (r.ok) done++; else { failed++; failedRows.push(r) } })
      setBulkImgProgress({ done: done, failed: failed, total: matched.length, failedRows: failedRows })
    }
    try { await logActivity('IMAGE_BULK_IMPORT', done + ' updated | ' + failed + ' failed | ' + bulkImgModal.unmatched.length + ' unmatched') } catch (_) {}
    setBulkImgProcessing(false)
    loadData()
  }

  async function runImport() {
    if (!importModal || importing) return
    if (importMode === 'update' && !importModal.hasId) { alert('Update mode requires an "id" column in your CSV. Use Export to get a CSV with IDs.'); return }
    setImporting(true)
    var rows = importModal.rows
    var done = 0; var skipped = 0; var skippedRows = []
    var CHUNK = 50
    for (var c = 0; c < rows.length; c++) {
      try {
        var result = await processImportRow(rows[c])
        if (result === true) done++; else { skipped++; skippedRows.push({ row: c + 1, reason: typeof result === 'string' ? result : 'Processing failed', cat: findCol(rows[c], ['category']) || '—', id: findCol(rows[c], ['id', 'inventory id', 'inventory_id']) || '—', name: findCol(rows[c], ['name']) || '—' }) }
      } catch (err) { skipped++; skippedRows.push({ row: c + 1, reason: err?.message || 'Unexpected error', cat: findCol(rows[c], ['category']) || '—', id: findCol(rows[c], ['id', 'inventory id', 'inventory_id']) || '—', name: findCol(rows[c], ['name']) || '—' }) }
      if ((c + 1) % 20 === 0 || c === rows.length - 1) {
        setImportProgress({ done: done, total: rows.length, skipped: skipped, skippedRows: skippedRows })
      }
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

    if (catName && !cat) return 'Category "' + catName + '" not found in masters'
    if (subCatName && !subCat) return 'Sub-category "' + subCatName + '" not found' + (catName ? ' under "' + catName + '"' : '')

    var isCatStore = false
    if (catId) {
      var catRow = categories.find(function (c2) { return c2.id === catId })
      var csSubDept = subDepartments.find(function (sd) { return sd.name === 'Catering Store' })
      if (catRow && csSubDept && catRow.sub_department_id === csSubDept.id) isCatStore = true
    }
    var tableName = isCatStore ? 'catering_store_items' : 'inventory_items'
    var allocTable = isCatStore ? 'cs_venue_allocations' : 'venue_allocations'

    var existing = null
    var invIdVal = findCol(r, ['inventory id', 'inventory_id']).trim()
    var sourceVal = findCol(r, ['source']).trim().toLowerCase()
    var rowId = findCol(r, ['id']).toString().trim()

    // Explicit Source column takes precedence over category-based inference.
    // Prevents id-collision writes to the wrong table (2026-07-30 incident root cause).
    if (sourceVal === 'catering_store' || sourceVal === 'cs' || sourceVal === 'catering store') {
      isCatStore = true; tableName = 'catering_store_items'; allocTable = 'cs_venue_allocations'
    } else if (sourceVal === 'inventory' || sourceVal === 'inventory_items' || sourceVal === 'main') {
      isCatStore = false; tableName = 'inventory_items'; allocTable = 'venue_allocations'
    }

    if (importMode === 'update') {
      // Primary match: inventory_id (globally unique via prefix e.g. CS-*, FLO-*, PRBR-*, GLWA-*).
      // Never falls back to numeric id without an explicit Source — id alone is ambiguous across tables.
      if (invIdVal) {
        var { data: invIdMatch } = await supabase.from(tableName).select('id, qty').eq('inventory_id', invIdVal).limit(1).maybeSingle()
        if (invIdMatch) {
          existing = invIdMatch
        } else {
          var otherTable = isCatStore ? 'inventory_items' : 'catering_store_items'
          var { data: wrongTableMatch } = await supabase.from(otherTable).select('id').eq('inventory_id', invIdVal).limit(1).maybeSingle()
          if (wrongTableMatch) return 'inventory_id "' + invIdVal + '" belongs to ' + otherTable + ', not ' + tableName + '. Fix Source column or use correct sheet.'
          return 'inventory_id "' + invIdVal + '" not found in ' + tableName
        }
      } else if (rowId) {
        if (!sourceVal) return 'Numeric id present but no inventory_id and no Source column. Add "inventory_id" (preferred) or a "Source" column (catering_store / inventory).'
        var { data: idMatch } = await supabase.from(tableName).select('id, qty').eq('id', Number(rowId)).limit(1).maybeSingle()
        if (idMatch) existing = idMatch
        else return 'id "' + rowId + '" not found in ' + tableName + ' (per Source)'
      } else {
        return 'Update mode requires "inventory_id" (recommended) or "id" + "Source" column'
      }
    } else {
      var matchQuery = supabase.from(tableName).select('id, qty').ilike('name', itemName.replace(/%/g, '\\%').replace(/_/g, '\\_'))
      if (catId) matchQuery = matchQuery.eq('category_id', catId)
      if (subCatId) matchQuery = matchQuery.eq('sub_category_id', subCatId)
      if (isCatStore && brand) matchQuery = matchQuery.eq('brand', brand)
      var { data: nameMatch } = await matchQuery.limit(1).maybeSingle()
      existing = nameMatch
    }

    var newQty = Number(findCol(r, ['qty', 'quantity'])) || 0
    var venueCode = findCol(r, ['venue code', 'venue_code', 'venue'])
    var subVenueName = findCol(r, ['sub-venue', 'sub_venue', 'subvenue'])
    var venueQty = Number(findCol(r, ['venue qty', 'venue_qty'])) || newQty

    if (venueCode) {
      var vcCheck = venueCode.split(';').map(function (v) { return v.trim() }).filter(Boolean)
      var svCheck = subVenueName ? subVenueName.split(';').map(function (s) { return s.trim() }) : []
      for (var vci = 0; vci < vcCheck.length; vci++) {
        var matchVen = venues.find(function (v) { return v.code.toLowerCase() === vcCheck[vci].toLowerCase() })
        if (!matchVen) return 'Venue code "' + vcCheck[vci] + '" not found in masters'
        if (svCheck[vci] && svCheck[vci] !== '') {
          var matchSv = subVenues.find(function (s) { return s.name.toLowerCase() === svCheck[vci].toLowerCase() && s.venue_id === matchVen.id })
          if (!matchSv) return 'Sub-venue "' + svCheck[vci] + '" not found under ' + vcCheck[vci]
        }
      }
    }

    var nameHindi = findCol(r, ['name hindi', 'name_hindi'])
    var unit = findCol(r, ['unit'])
    var dept = findCol(r, ['department', 'dept'])
    var type = findCol(r, ['type'])
    var desc = findCol(r, ['description'])
    var rate = findCol(r, ['rate', 'rate (₹)', 'rate_paise'])
    var isAsset = findCol(r, ['is asset', 'is_asset'])
    var dimStr = findCol(r, ['dimensions'])
    var parsedDims = null
    if (dimStr) { parsedDims = dimStr.split(';').map(function (s) { var parts = s.trim().split(':'); if (parts.length < 2) return null; var nv = parts[1].trim().split(' '); return { name: parts[0].trim(), qty: nv[0] || '', unit: nv.slice(1).join(' ') || 'Pieces' } }).filter(Boolean); if (parsedDims.length === 0) parsedDims = null }
    var minOrd = findCol(r, ['min order qty', 'min_order_qty', 'season reorder qty'])
    var reord = findCol(r, ['reorder qty', 'reorder_qty', 'off season reorder qty'])

    if (importMode === 'update') {
      if (!existing) return 'No matching item found (ID: ' + (rowId || 'none') + ')'
      var updatePayload = {}
      if (itemName) updatePayload.name = itemName
      if (nameHindi) updatePayload.name_hindi = nameHindi
      if (catId) updatePayload.category_id = catId
      if (subCatId) updatePayload.sub_category_id = subCatId
      if (unit) updatePayload.unit = unit
      if (dept) updatePayload.department = dept
      if (type) updatePayload.type = type
      if (desc) updatePayload.description = desc
      if (rate) updatePayload.rate_paise = Math.round(Number(rate) * 100)
      if (isAsset) updatePayload.is_asset = isAsset.toLowerCase()
      if (parsedDims) updatePayload.dimensions = parsedDims
      if (newQty > 0) updatePayload.qty = newQty
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
        if (updErr) return 'DB update failed: ' + updErr.message
      }
      // Update venue allocations if provided
      if (venueCode) {
        var venueCodes = venueCode.split(';').map(function (v) { return v.trim() }).filter(Boolean)
        var venueQtyStr = findCol(r, ['venue qty', 'venue_qty'])
        var venueQtys = venueQtyStr ? venueQtyStr.split(';').map(function (q) { return Number(q.trim()) || 0 }) : []
        var subVenueNames = subVenueName ? subVenueName.split(';').map(function (s) { return s.trim() }) : []

        for (var vi = 0; vi < venueCodes.length; vi++) {
          var vCode = venueCodes[vi]
          var vQty = venueQtys[vi] || 0
          if (!vCode || !vQty) continue
          var venue = venues.find(function (v) { return v.code.toLowerCase() === vCode.toLowerCase() })
          if (!venue) continue
          var subVenueId = null
          if (subVenueNames[vi]) {
            var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueNames[vi].toLowerCase() && s.venue_id === venue.id })
            if (sv) subVenueId = sv.id
          }
          var { data: existAlloc } = await supabase.from(allocTable).select('id, qty').eq('item_id', existing.id).eq('venue_id', venue.id).limit(1).maybeSingle()
          var { data: allAllocs } = await supabase.from(allocTable).select('id, venue_id, qty').eq('item_id', existing.id)
          var otherAllocsTotal = (allAllocs || []).reduce(function (sum, a) {
            return sum + (existAlloc && a.id === existAlloc.id ? 0 : (a.qty || 0))
          }, 0)
          if (!updatePayload.qty) {
            var newTotal = otherAllocsTotal + vQty
            await supabase.from(tableName).update({ qty: newTotal }).eq('id', existing.id)
          }
          if (existAlloc) {
            await supabase.from(allocTable).update({ qty: vQty }).eq('id', existAlloc.id)
          } else {
            var allocPayload = { item_id: existing.id, venue_id: venue.id, qty: vQty }
            if (subVenueId) allocPayload.sub_venue_id = subVenueId
            await supabase.from(allocTable).insert(allocPayload)
          }
        }
      }
      return true
    }

    // ADD mode
    if (existing) {
      var { error: qtyErr } = await supabase.from(tableName).update({ qty: (existing.qty || 0) + newQty }).eq('id', existing.id)
      if (qtyErr) return 'Qty update failed: ' + qtyErr.message
      if (venueCode) {
        var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
        if (venue) {
          var { data: existAlloc } = await supabase.from(allocTable).select('id, qty').eq('item_id', existing.id).eq('venue_id', venue.id).limit(1).maybeSingle()
          var subVenueId = null
          if (subVenueName) {
            var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueName.toLowerCase() && s.venue_id === venue.id })
            if (sv) subVenueId = sv.id
          }
          if (existAlloc) {
            await supabase.from(allocTable).update({ qty: existAlloc.qty + venueQty }).eq('id', existAlloc.id)
          } else {
            var allocPayload = { item_id: existing.id, venue_id: venue.id, qty: venueQty }
            if (subVenueId) allocPayload.sub_venue_id = subVenueId
            await supabase.from(allocTable).insert(allocPayload)
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
    if (parsedDims) payload.dimensions = parsedDims
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
    if (!catId) return 'Category required for new items'
    var { data: newItem, error: insErr } = await supabase.from(tableName).insert(payload).select('id').single()
    if (insErr) return 'Insert failed: ' + insErr.message
    if (newItem && venueCode) {
      var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
      if (venue) {
        var allocPayload = { item_id: newItem.id, venue_id: venue.id, qty: venueQty }
        if (subVenueName) {
          var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueName.toLowerCase() && s.venue_id === venue.id })
          if (sv) allocPayload.sub_venue_id = sv.id
        }
        await supabase.from(allocTable).insert(allocPayload)
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

  var filtered = useMemo(function () {
    var searchLower = search.toLowerCase()
    return items.filter(function (item) {
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
      var matchDept = deptFilter.length === 0 || deptFilter.indexOf(item.department) !== -1
      var matchStatus = statusFilter.length === 0 || statusFilter.indexOf(item.status) !== -1
      var matchMasterDept = masterDeptFilter.length === 0 || (function () {
        var sdId = item.categories?.sub_department_id
        if (!sdId) return false
        var sd = subDepartments.find(function (x) { return x.id === sdId })
        return sd && masterDeptFilter.indexOf(String(sd.department_id)) !== -1
      })()
      var matchSubDept = subDeptFilter.length === 0 || (function () {
        var sdCatIds = categories.filter(function (c) { return subDeptFilter.indexOf(String(c.sub_department_id)) !== -1 }).map(function (c) { return c.id })
        return sdCatIds.indexOf(item.category_id) !== -1
      })()
      var matchVenue = venueFilter.length === 0 || (item.venue_allocations || []).some(function (va) { return venueFilter.indexOf(va.venues?.code) !== -1 })
      var matchSubVenue = subVenueFilter.length === 0 || (item.venue_allocations || []).some(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id)) !== -1 })
      var matchCat = catFilter.length === 0 || catFilter.indexOf(String(item.category_id)) !== -1
      var matchSubCat = subCatFilter.length === 0 || subCatFilter.indexOf(String(item.sub_category_id)) !== -1
      return matchSearch && matchMasterDept && matchDept && matchSubDept && matchStatus && matchVenue && matchCat && matchSubCat && matchSubVenue
    })
  }, [items, search, deptFilter, statusFilter, masterDeptFilter, subDepartments, subDeptFilter, categories, venueFilter, subVenueFilter, catFilter, subCatFilter])

  function handleSort(key) {
    if (sortKey === key) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc') }
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  function sortValue(item, key) {
    if (key === 'name') return (item.name || '').toLowerCase()
    if (key === 'category') return (item.categories?.name || '').toLowerCase()
    if (key === 'masterDept') {
      var sd = subDepartments.find(function (x) { return x.id === item.categories?.sub_department_id })
      var d = sd ? departments.find(function (x) { return x.id === sd.department_id }) : null
      return (d?.name || '').toLowerCase()
    }
    if (key === 'allocDept') return (item.department || '').toLowerCase()
    if (key === 'stock') return Number(item.qty) || 0
    if (key === 'unit') return (item.unit || '').toLowerCase()
    if (key === 'venues') return (item.venue_allocations || []).length
    if (key === 'by') return (item.profiles?.name || '').toLowerCase()
    if (key === 'date') return new Date(item.entry_date || item.created_at || 0).getTime()
    if (key === 'status') return (item.status || '').toLowerCase()
    return ''
  }

  var sorted = useMemo(function () {
    if (!sortKey) return filtered
    return filtered.slice().sort(function (a, b) {
      var va = sortValue(a, sortKey), vb = sortValue(b, sortKey)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir, subDepartments, departments])

  function sortArrow(key) { return sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading items...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — filters row */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name, ID, description, submitter..."
          className="flex-1 min-w-[220px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <FilterDropdown value={masterDeptFilter} placeholder="Master Dept" multi
          onChange={function (v) { setMasterDeptFilter(v); setSubDeptFilter([]); setCatFilter([]); setSubCatFilter([]); setPage(1) }}
          options={departments.map(function (d) { return { label: d.name + (d.is_inventory_default ? ' ★' : ''), value: String(d.id) } })} />
        <FilterDropdown value={subDeptFilter} placeholder="Master Sub-dept" multi
          onChange={function (v) { setSubDeptFilter(v); setCatFilter([]); setSubCatFilter([]); setPage(1) }}
          options={subDepartments.filter(function (sd) {
            if (masterDeptFilter.length > 0) return masterDeptFilter.indexOf(String(sd.department_id)) !== -1
            return true
          }).map(function (sd) { return { label: sd.name, value: String(sd.id) } })} />
        <FilterDropdown value={statusFilter} placeholder="All Statuses" multi
          onChange={function (v) { setStatusFilter(v); setPage(1) }}
          options={[{ label: 'Approved', value: 'approved' }, { label: 'Pending (Admin)', value: 'pending' }, { label: 'Pending (Dept)', value: 'pending_dept' }]} />
        <FilterDropdown value={catFilter} placeholder="All Categories" multi
          onChange={function (v) { setCatFilter(v); setSubCatFilter([]); setPage(1) }}
          options={categories.filter(function (c) {
            if (subDeptFilter.length > 0) return subDeptFilter.indexOf(String(c.sub_department_id)) !== -1
            if (deptFilter.length === 0) return true
            var deptCatIds = []; departments.filter(function (d) { return deptFilter.indexOf(d.name) !== -1 }).forEach(function (d) { (d.category_ids || []).forEach(function (cid) { if (deptCatIds.indexOf(cid) === -1) deptCatIds.push(cid) }) })
            return deptCatIds.indexOf(c.id) !== -1
          }).map(function (c) { return { label: c.name, value: String(c.id) } })} />
        <FilterDropdown value={subCatFilter} placeholder="All Sub-categories" multi
          onChange={function (v) { setSubCatFilter(v); setPage(1) }}
          options={subCategoriesAll.filter(function (sc) {
            if (catFilter.length > 0) return catFilter.indexOf(String(sc.category_id)) !== -1
            if (deptFilter.length > 0) {
              var deptCatIds = []; departments.filter(function (d) { return deptFilter.indexOf(d.name) !== -1 }).forEach(function (d) { (d.category_ids || []).forEach(function (cid) { if (deptCatIds.indexOf(cid) === -1) deptCatIds.push(cid) }) })
              return deptCatIds.indexOf(sc.category_id) !== -1
            }
            return true
          }).map(function (sc) { return { label: sc.name, value: String(sc.id) } })} />
        <FilterDropdown value={venueFilter} placeholder="All Venues" multi
          onChange={function (v) { setVenueFilter(v); setSubVenueFilter([]); setPage(1) }}
          options={venues.map(function (v) { return { label: v.code + ' \u2014 ' + v.name, value: v.code } })} />
        <FilterDropdown value={subVenueFilter} placeholder="All Sub-venues" multi
          onChange={function (v) { setSubVenueFilter(v); setPage(1) }}
          options={subVenues.filter(function (sv) {
            if (venueFilter.length === 0) return true
            var vIds = venues.filter(function (v2) { return venueFilter.indexOf(v2.code) !== -1 }).map(function (v2) { return v2.id })
            return vIds.indexOf(sv.venue_id) !== -1
          }).map(function (sv) { return { label: sv.name, value: String(sv.id) } })} />
        <FilterDropdown value={deptFilter} placeholder="Alloc Dept" multi
          onChange={function (v) { setDeptFilter(v); setPage(1) }}
          options={departments.map(function (d) { return { label: d.name, value: d.name } })} />
      </div>
      {/* Toolbar — actions row */}
      <div className="flex gap-2 flex-wrap items-center">
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
        {(search || masterDeptFilter.length || deptFilter.length || statusFilter.length || subDeptFilter.length || catFilter.length || subCatFilter.length || venueFilter.length || subVenueFilter.length) && (
          <button onClick={resetFilters}
            className="px-3 py-2.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors font-medium">✕ Reset</button>
        )}
        <button onClick={function () { setExportModal(true) }}
          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">📥 Export</button>
        <label className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer">
          📤 Import
          <input type="file" accept=".csv" onChange={parseImportFile} className="hidden" />
        </label>
        <label className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer">
          🖼️ Bulk Images
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={parseBulkImageZip} className="hidden" />
        </label>
        <button onClick={downloadTemplate}
          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">📋 Template</button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-sm" style={{ minWidth: 1080 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-2 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider" style={{ width: 70 }}></th>
              <th onClick={function () { handleSort('name') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Item / Hindi{sortArrow('name')}</th>
              <th onClick={function () { handleSort('category') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Category / Sub{sortArrow('category')}</th>
              <th onClick={function () { handleSort('masterDept') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Master Dept{sortArrow('masterDept')}</th>
              <th onClick={function () { handleSort('stock') }} className="cursor-pointer select-none text-right px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Stock{sortArrow('stock')}</th>
              <th onClick={function () { handleSort('allocDept') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Allocation{sortArrow('allocDept')}</th>
              <th onClick={function () { handleSort('date') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Submitted{sortArrow('date')}</th>
              <th onClick={function () { handleSort('status') }} className="cursor-pointer select-none text-left px-3 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-900">Status{sortArrow('status')}</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider" style={{ width: 150 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice((page - 1) * perPage, page * perPage).map(function (item) {
              var venueAllocs = item.venue_allocations || []
              var imgUrl = getImageUrl(item.image_path)
              var statusColors = {
                approved: 'bg-green-100 text-green-700',
                pending: 'bg-amber-100 text-amber-700',
                pending_dept: 'bg-blue-100 text-blue-700',
              }
              return (
                <tr key={(item._source || 'i') + ':' + item.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                  <td className="px-3 py-2">
                    {(function () {
                      var sdId = item.categories?.sub_department_id
                      if (!sdId) return <span className="text-gray-400">—</span>
                      var sd = subDepartments.find(function (x) { return x.id === sdId })
                      var d = sd ? departments.find(function (x) { return x.id === sd.department_id }) : null
                      return (
                        <div>
                          <div className="text-gray-600 text-[12px]">{d?.name || '—'}</div>
                          {sd && <div className="text-[11px] text-gray-400">{sd.name}</div>}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="font-medium text-gray-900">{item.qty} <span className="text-[11px] font-normal text-gray-400">{item.unit || ''}</span></div>
                    {item.rate_paise && canViewCosts ? <div className="text-[11px] text-gray-400">₹{(item.rate_paise / 100).toFixed(item.rate_paise % 100 ? 2 : 0)}</div> : null}
                  </td>
                  
                  <td className="px-3 py-2">
                    <div className="text-gray-700 text-[12px] font-medium">{item.department || '—'}</div>
                    {(function () {
                      var allocs = item.venue_allocations || []
                      var sdIds = []
                      allocs.forEach(function (va) { if (va.sub_department_id && sdIds.indexOf(va.sub_department_id) === -1) sdIds.push(va.sub_department_id) })
                      if (sdIds.length === 0) return null
                      var names = sdIds.map(function (id) { var sd = subDepartments.find(function (x) { return x.id === id }); return sd?.name }).filter(Boolean)
                      if (names.length === 0) return null
                      return <div className="text-[11px] text-gray-400">{names.join(', ')}</div>
                    })()}
                    {venueAllocs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {venueAllocs.map(function (va, vi) {
                          var svName = va.sub_venue_id ? (subVenues.find(function (sv) { return sv.id === va.sub_venue_id }) || {}).name : null
                          return (
                            <span key={(va.venues?.code || '') + '-' + vi} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                              {va.venues?.code}{svName ? ':' + svName : ''}: {va.qty}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-700 text-[12px] font-medium">{item.profiles?.name || '—'}</div>
                    <div className="text-[11px] text-gray-400 whitespace-nowrap">{formatDate(item.entry_date || item.created_at)}</div>
                    {item.profiles?.email && <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{item.profiles.email}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " + (statusColors[item.status] || 'bg-gray-100 text-gray-600')}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap" style={{ width: 150 }}>
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={function () { setEditItem(item) }}
                        className="px-2 py-1 text-[11px] font-semibold border border-gray-300 rounded text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors"
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
                <td colSpan="9" className="px-4 py-8 text-center text-gray-400">No items found</td>
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
     {/* Export modal */}
      <Modal open={exportModal} onClose={function () { setExportModal(false) }} title="Export Inventory">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{filtered.length} items will be exported (based on current filters).</p>
          <div className="flex gap-3">
            <button onClick={function () { exportItems(); setExportModal(false) }}
              className="flex-1 py-3 text-sm font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              📊 Export CSV
            </button>
            <button onClick={function () { exportPdf(); setExportModal(false) }}
              className="flex-1 py-3 text-sm font-semibold border border-indigo-300 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors">
              📄 Export PDF
            </button>
          </div>
          <p className="text-[11px] text-gray-400">CSV includes all columns. PDF excludes By, Date, Status for compact layout.</p>
        </div>
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
                  : 'Matches items by ID column. Info fields updated (qty unchanged). Items without matching ID: skipped.'}
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
                {importProgress.skippedRows && importProgress.skippedRows.length > 0 && !importing && (
                  <div className="mt-3 max-h-40 overflow-y-auto">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Skipped Items</p>
                      <button onClick={function () {
                        var hdr = ['Row', 'ID', 'Name', 'Category', 'Reason']
                        var csvRows = importProgress.skippedRows.map(function (s) { return [s.row, s.id, s.name, s.cat, s.reason || ''].map(csvEscape).join(',') })
                        var csv = '\uFEFF' + hdr.join(',') + '\n' + csvRows.join('\n')
                        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'skipped_rows_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
                      }} className="text-[10px] text-indigo-600 font-medium hover:underline">📥 Download CSV</button>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead><tr className="text-left text-gray-500"><th className="pr-2 py-0.5">Row</th><th className="pr-2 py-0.5">ID</th><th className="pr-2 py-0.5">Name</th><th className="py-0.5">Reason</th></tr></thead>
                      <tbody>
                        {importProgress.skippedRows.map(function (s, i) {
                          return <tr key={i} className="text-gray-600 border-t border-gray-100"><td className="pr-2 py-0.5">{s.row}</td><td className="pr-2 py-0.5 font-mono">{s.id}</td><td className="pr-2 py-0.5">{s.name}</td><td className="py-0.5 text-amber-700">{s.reason}</td></tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={function () { setImportModal(null); setImportProgress(null) }} disabled={importing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">Cancel</button>
              <button onClick={importProgress && !importing ? function () { setImportModal(null); setImportProgress(null) } : runImport} disabled={importing}
                className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50">
                {importing ? 'Importing...' : importProgress ? 'Done' : 'Start Import'}</button>
            </div>
          </div>
        )}
      </Modal>
      {/* Bulk image import modal */}
      <Modal open={!!bulkImgModal} onClose={function () { if (!bulkImgProcessing) { setBulkImgModal(null); setBulkImgProgress(null) } }} title="Bulk Image Import">
        {bulkImgModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{bulkImgModal.file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{bulkImgModal.total} image{bulkImgModal.total !== 1 ? 's' : ''} in ZIP</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-green-700">{bulkImgModal.matched.length}</div>
                <div className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Matched</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-amber-700">{bulkImgModal.replacing}</div>
                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Replacing</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-red-700">{bulkImgModal.unmatched.length}</div>
                <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Unmatched</div>
              </div>
            </div>
            <p className="text-[11px] text-gray-500">
              Filename must match inventory ID (e.g. <span className="font-mono">CS-994.jpg</span> → item with ID <span className="font-mono">CS-994</span>). Case-insensitive. Auto-compressed to ~100KB. Existing images are replaced.
            </p>
            {bulkImgModal.unmatched.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-700 font-medium">Unmatched files ({bulkImgModal.unmatched.length})</summary>
                <div className="mt-1 bg-amber-50 border border-amber-100 rounded p-2 max-h-32 overflow-y-auto">
                  {bulkImgModal.unmatched.slice(0, 30).map(function (u, i) {
                    return <div key={i} className="font-mono text-[10px] text-amber-800">{u.basename}</div>
                  })}
                  {bulkImgModal.unmatched.length > 30 && <div className="text-[10px] text-amber-600 mt-1">+ {bulkImgModal.unmatched.length - 30} more</div>}
                </div>
              </details>
            )}
            {bulkImgModal.duplicates.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-700 font-medium">Duplicate IDs in ZIP ({bulkImgModal.duplicates.length}) — first wins</summary>
                <div className="mt-1 bg-red-50 border border-red-100 rounded p-2 max-h-32 overflow-y-auto">
                  {bulkImgModal.duplicates.slice(0, 20).map(function (d, i) {
                    return <div key={i} className="font-mono text-[10px] text-red-800">{d.key}: {d.files.join(', ')}</div>
                  })}
                </div>
              </details>
            )}
            {bulkImgProgress && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">{bulkImgProgress.done + bulkImgProgress.failed} / {bulkImgProgress.total}</span>
                  <span className="text-gray-500">{bulkImgProgress.done} ok · {bulkImgProgress.failed} failed</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: (bulkImgProgress.total ? (((bulkImgProgress.done + bulkImgProgress.failed) / bulkImgProgress.total) * 100) : 0) + '%' }}></div>
                </div>
                {bulkImgProgress.failedRows && bulkImgProgress.failedRows.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-red-700 font-medium">Failed ({bulkImgProgress.failedRows.length})</summary>
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {bulkImgProgress.failedRows.slice(0, 20).map(function (f, i) {
                        return <div key={i} className="text-[10px] text-red-800"><span className="font-mono">{f.basename}</span> — {f.reason}</div>
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={function () { setBulkImgModal(null); setBulkImgProgress(null) }} disabled={bulkImgProcessing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
                {bulkImgProgress && !bulkImgProcessing ? 'Close' : 'Cancel'}</button>
              <button onClick={bulkImgProgress && !bulkImgProcessing ? function () { setBulkImgModal(null); setBulkImgProgress(null) } : runBulkImageImport}
                disabled={bulkImgProcessing || bulkImgModal.matched.length === 0}
                className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50">
                {bulkImgProcessing ? 'Uploading...' : bulkImgProgress ? 'Done' : 'Upload ' + bulkImgModal.matched.length + ' Image' + (bulkImgModal.matched.length !== 1 ? 's' : '')}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AdminItems