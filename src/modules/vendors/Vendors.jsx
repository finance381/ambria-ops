import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { filterVisibleVendors } from '../../lib/vendorGating'
import { useReferenceData } from '../../lib/referenceData.jsx'
import SearchDropdown from '../../components/ui/SearchDropdown'
import VoiceInput from '../../components/ui/VoiceInput'

function Vendors({ profile }) {
  var [vendors, setVendors] = useState([])
  var [categories, setCategories] = useState([])
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var refData = useReferenceData()
  var expenseTypes = refData.expenseTypes.filter(function (t) { return t.active })
  var expenseSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active })
  var [expandedExpTypes, setExpandedExpTypes] = useState({})
  var [expandedEtVendors, setExpandedEtVendors] = useState({})
  var [expandedCatDepts, setExpandedCatDepts] = useState({})
  var [expandedExpDepts, setExpandedExpDepts] = useState({})
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [estFilter, setEstFilter] = useState('')
  var [showInactive, setShowInactive] = useState(false)
  var [editing, setEditing] = useState(null)
  var [form, setForm] = useState({ name: '', contact: '', phone: '', phone2: '', email: '', address: '', category_ids: [], expense_type_ids: [], expense_sub_type_ids: [], notes: '', opening_balance: '', opening_balance_direction: 'credit', gst_number: '', pan_number: '', bank_account: '', bank_ifsc: '', vendor_type: 'Supplier', lead_time_days: '', referred_by: '' })
  var [importReview, setImportReview] = useState(null)
  var [importSummary, setImportSummary] = useState(null)
  var importFileRef = useRef(null)

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    var [vRes, cRes, dRes, sdRes] = await Promise.all([
      supabase.from('vendors').select('*').order('name'),
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
    ])
    setVendors(filterVisibleVendors(vRes.data || [], profile))
    setCategories(cRes.data || [])
    setDepartments(dRes.data || [])
    setSubDepartments(sdRes.data || [])
    setLoading(false)
  }

  function startAdd() {
    setExpandedCatDepts({})
    setExpandedExpDepts({})
    setExpandedExpTypes({})
    setEditing('new')
    setForm({ name: '', contact: '', phone: '', phone2: '', email: '', address: '', category_ids: [], expense_type_ids: [], expense_sub_type_ids: [], notes: '', opening_balance: '', gst_number: '', pan_number: '', bank_account: '', bank_ifsc: '', vendor_type: 'Supplier', lead_time_days: '', referred_by: '' })
  }

  function startEdit(v) {
    setExpandedCatDepts({})
    setExpandedExpDepts({})
    setExpandedExpTypes({})
    setEditing(v.id)
    setForm({
      name: v.name || '',
      contact: v.contact || '',
      phone: v.phone || '',
      phone2: v.phone2 || '',
      email: v.email || '',
      address: v.address || '',
      category_ids: v.category_ids || [],
      expense_type_ids: v.expense_type_ids || [],
      expense_sub_type_ids: v.expense_sub_type_ids || [],
      notes: v.notes || '',
      opening_balance: v.opening_balance_paise ? String(Math.abs(v.opening_balance_paise) / 100) : '',
      opening_balance_direction: (v.opening_balance_paise || 0) < 0 ? 'debit' : 'credit',
      gst_number: v.gst_number || '',
      pan_number: v.pan_number || '',
      bank_account: v.bank_account || '',
      bank_ifsc: v.bank_ifsc || '',
      vendor_type: v.vendor_type || 'Supplier',
      lead_time_days: v.lead_time_days ? String(v.lead_time_days) : '',
      referred_by: v.referred_by || '',
    })
  }

  function cancelEdit() {
    setExpandedCatDepts({})
    setExpandedExpDepts({})
    setExpandedExpTypes({})
    setEditing(null)
    setForm({ name: '', contact: '', phone: '', phone2: '', email: '', address: '', category_ids: [], expense_type_ids: [], expense_sub_type_ids: [], notes: '', opening_balance: '', opening_balance_direction: 'credit', gst_number: '', pan_number: '', bank_account: '', bank_ifsc: '', vendor_type: 'Supplier', lead_time_days: '', referred_by: '' })
  }

  function toggleCat(catId) {
    setForm(function (prev) {
      var ids = prev.category_ids.slice()
      var idx = ids.indexOf(catId)
      if (idx !== -1) ids.splice(idx, 1)
      else ids.push(catId)
      return Object.assign({}, prev, { category_ids: ids })
    })
  }

  function toggleExpSubType(stId) {
    setForm(function (prev) {
      var ids = (prev.expense_sub_type_ids || []).slice()
      var idx = ids.indexOf(stId)
      if (idx !== -1) ids.splice(idx, 1)
      else ids.push(stId)
      return Object.assign({}, prev, { expense_sub_type_ids: ids })
    })
  }

  function toggleExpType(tId) {
    // Toggling a type toggles all its sub-types atomically.
    setForm(function (prev) {
      var typeIds = (prev.expense_type_ids || []).slice()
      var subTypeIds = (prev.expense_sub_type_ids || []).slice()
      var childSubIds = expenseSubTypes.filter(function (s) { return s.expense_type_id === tId }).map(function (s) { return s.id })
      var tIdx = typeIds.indexOf(tId)
      if (tIdx !== -1) {
        typeIds.splice(tIdx, 1)
        subTypeIds = subTypeIds.filter(function (id) { return childSubIds.indexOf(id) === -1 })
      } else {
        typeIds.push(tId)
        childSubIds.forEach(function (id) { if (subTypeIds.indexOf(id) === -1) subTypeIds.push(id) })
      }
      return Object.assign({}, prev, { expense_type_ids: typeIds, expense_sub_type_ids: subTypeIds })
    })
  }

  function toggleExpTypeExpand(tId) {
    setExpandedExpTypes(function (prev) { var n = Object.assign({}, prev); n[tId] = !prev[tId]; return n })
  }

  function toggleCatDeptExpand(deptKey) {
    setExpandedCatDepts(function (prev) { var n = Object.assign({}, prev); n[deptKey] = !prev[deptKey]; return n })
  }

  function toggleExpDeptExpand(deptKey) {
    setExpandedExpDepts(function (prev) { var n = Object.assign({}, prev); n[deptKey] = !prev[deptKey]; return n })
  } 

  async function saveVendor() {
    if (saving) return
    if (!form.name.trim()) { alert('Vendor name required'); return }
    setSaving(true)

    var payload = {
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      phone2: form.phone2.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      category_ids: form.category_ids,
      expense_type_ids: form.expense_type_ids || [],
      expense_sub_type_ids: form.expense_sub_type_ids || [],
      notes: form.notes.trim() || null,
      opening_balance_paise: form.opening_balance
        ? Math.round(Number(form.opening_balance) * 100) * (form.opening_balance_direction === 'debit' ? -1 : 1)
        : 0,
      gst_number: form.gst_number.trim() || null,
      pan_number: form.pan_number.trim() || null,
      bank_account: form.bank_account.trim() || null,
      bank_ifsc: form.bank_ifsc.trim() || null,
      vendor_type: form.vendor_type || 'Supplier',
      lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : null,
      referred_by: form.referred_by.trim() || null,
    }

    if (editing === 'new') {
      payload.created_by = profile.id
      var { error } = await supabase.from('vendors').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('VENDOR_ADD', payload.name) } catch (_) {}
    } else {
      var { error } = await supabase.from('vendors').update(payload).eq('id', editing)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('VENDOR_EDIT', payload.name) } catch (_) {}
    }

    setSaving(false)
    cancelEdit()
    loadAll()
  }

  async function toggleActive(v) {
    if (saving) return
    setSaving(true)
    var newActive = !v.active
    var { error } = await supabase.from('vendors').update({ active: newActive }).eq('id', v.id)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    try { await logActivity(newActive ? 'VENDOR_ACTIVATE' : 'VENDOR_DEACTIVATE', v.name) } catch (_) {}
    setSaving(false)
    loadAll()
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

  var fieldLabels = {
    name: 'Name', vendor_type: 'Type', referred_by: 'Referred By', contact: 'Contact',
    phone: 'Phone', phone2: 'Phone 2', email: 'Email', address: 'Address',
    category_ids: 'Categories', lead_time_days: 'Lead Time',
    opening_balance_paise: 'Opening Balance', gst_number: 'GST', pan_number: 'PAN',
    bank_account: 'Bank Account', bank_ifsc: 'Bank IFSC', notes: 'Notes', active: 'Active',
  }

  async function handleImportFile(e) {
    var file = e.target.files?.[0]
    if (!file) return
    var input = e.target
    var text = await file.text()
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() })
    if (lines.length < 2) { alert('CSV must have header + at least 1 row'); input.value = ''; return }

    var header = parseCsvLine(lines[0]).map(function (h) { return h.replace(/^\uFEFF/, '').trim().toLowerCase() })
    function idx(n) { return header.indexOf(n.toLowerCase()) }
    function col(row, n) { var i = idx(n); return i === -1 ? '' : (row[i] || '').trim() }
    if (idx('name') === -1) { alert('CSV must have a "Name" column'); input.value = ''; return }

    var openingKey = idx('opening balance (\u20B9)') !== -1 ? 'opening balance (\u20B9)' : 'opening balance'
    var has = {
      id: idx('id') !== -1, type: idx('vendor type') !== -1, referred: idx('referred by') !== -1,
      contact: idx('contact person') !== -1, phone: idx('phone') !== -1, phone2: idx('phone 2') !== -1,
      email: idx('email') !== -1, address: idx('address') !== -1, cats: idx('categories') !== -1,
      lead: idx('lead time (days)') !== -1, opening: idx(openingKey) !== -1,
      gst: idx('gst number') !== -1, pan: idx('pan number') !== -1,
      bank: idx('bank account') !== -1, ifsc: idx('bank ifsc') !== -1,
      notes: idx('notes') !== -1, active: idx('active') !== -1,
    }

    var catByName = {}; categories.forEach(function (c) { catByName[c.name.toLowerCase()] = c })

    function parseText(row, cellName) {
      var v = col(row, cellName)
      if (v === '') return undefined
      if (v.toLowerCase() === '[clear]') return null
      return v
    }
    function parseIntCell(row, cellName) {
      var v = col(row, cellName)
      if (v === '') return undefined
      if (v.toLowerCase() === '[clear]') return null
      var n = parseInt(v, 10); return isNaN(n) ? undefined : n
    }
    function parseRupees(row, cellName) {
      var v = col(row, cellName)
      if (v === '') return undefined
      if (v.toLowerCase() === '[clear]') return 0
      var n = Number(v); return isNaN(n) ? undefined : Math.round(n * 100)
    }
    function parseBool(row, cellName) {
      var v = col(row, cellName).toLowerCase()
      if (v === '') return undefined
      return (v === 'yes' || v === 'true' || v === '1' || v === 'y')
    }
    function scalarDiffer(a, b) {
      var na = a == null || a === '' ? null : a
      var nb = b == null || b === '' ? null : b
      return na !== nb
    }
    function arrayDiffer(a, b) {
      var sa = (a || []).slice().sort(); var sb = (b || []).slice().sort()
      if (sa.length !== sb.length) return true
      for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return true
      return false
    }

    var updates = [], unchanged = [], newRows = [], skipped = []

    for (var r = 1; r < lines.length; r++) {
      var raw = parseCsvLine(lines[r])
      var name = col(raw, 'name')
      if (!name) { skipped.push({ row: r + 1, name: '(empty)', reason: 'Missing Name' }); continue }

      var rowId = has.id ? col(raw, 'id') : ''
      var existing = null
      if (rowId) existing = vendors.find(function (v) { return String(v.id) === rowId })
      if (rowId && !existing) { skipped.push({ row: r + 1, name: name, reason: 'ID "' + rowId + '" not found' }); continue }
      if (!existing) existing = vendors.find(function (v) { return v.name.toLowerCase() === name.toLowerCase() })

      var catIds; var catUnknown = []
      if (has.cats) {
        var catsRaw = col(raw, 'categories')
        if (catsRaw === '') catIds = undefined
        else if (catsRaw.toLowerCase() === '[clear]') catIds = []
        else {
          catIds = []
          catsRaw.split('|').forEach(function (n) {
            var nm = n.trim(); if (!nm) return
            var c = catByName[nm.toLowerCase()]
            if (c) { if (catIds.indexOf(c.id) === -1) catIds.push(c.id) } else catUnknown.push(nm)
          })
        }
      }

      var parsed = {}
      if (has.type)     parsed.vendor_type = parseText(raw, 'vendor type')
      if (has.referred) parsed.referred_by = parseText(raw, 'referred by')
      if (has.contact)  parsed.contact = parseText(raw, 'contact person')
      if (has.phone)    parsed.phone = parseText(raw, 'phone')
      if (has.phone2)   parsed.phone2 = parseText(raw, 'phone 2')
      if (has.email)    parsed.email = parseText(raw, 'email')
      if (has.address)  parsed.address = parseText(raw, 'address')
      if (has.cats)     parsed.category_ids = catIds
      if (has.lead)     parsed.lead_time_days = parseIntCell(raw, 'lead time (days)')
      if (has.opening)  parsed.opening_balance_paise = parseRupees(raw, openingKey)
      if (has.gst)      parsed.gst_number = parseText(raw, 'gst number')
      if (has.pan)      parsed.pan_number = parseText(raw, 'pan number')
      if (has.bank)     parsed.bank_account = parseText(raw, 'bank account')
      if (has.ifsc)     parsed.bank_ifsc = parseText(raw, 'bank ifsc')
      if (has.notes)    parsed.notes = parseText(raw, 'notes')
      if (has.active)   parsed.active = parseBool(raw, 'active')

      var warnings = []
      if (catUnknown.length > 0) warnings.push('Unknown categories: ' + catUnknown.join(', '))

      if (existing) {
        var payload = {}; var changedFields = []
        if (name !== existing.name) { payload.name = name; changedFields.push('name') }
        Object.keys(parsed).forEach(function (k) {
          var v = parsed[k]
          if (v === undefined) return
          var differ = (k === 'category_ids') ? arrayDiffer(existing[k], v) : scalarDiffer(existing[k], v)
          if (differ) { payload[k] = v; changedFields.push(k) }
        })
        if (Object.keys(payload).length === 0) unchanged.push({ row: r + 1, name: name, warnings: warnings })
        else updates.push({ row: r + 1, id: existing.id, name: name, payload: payload, changedFields: changedFields, warnings: warnings })
      } else {
        var insertPayload = { name: name }
        Object.keys(parsed).forEach(function (k) { if (parsed[k] !== undefined) insertPayload[k] = parsed[k] })
        if (insertPayload.vendor_type == null) insertPayload.vendor_type = 'Supplier'
        if (insertPayload.active == null) insertPayload.active = true
        if (insertPayload.opening_balance_paise == null) insertPayload.opening_balance_paise = 0
        if (insertPayload.category_ids == null) insertPayload.category_ids = []
        newRows.push({ row: r + 1, name: name, payload: insertPayload, warnings: warnings })
      }
    }

    var newRowsSelected = {}
    newRows.forEach(function (_, i) { newRowsSelected[i] = true })

    setImportReview({ updates: updates, unchanged: unchanged, newRows: newRows, skipped: skipped, newRowsSelected: newRowsSelected })
    setImportSummary(null)
    input.value = ''
  }

  function toggleNewRow(i) {
    setImportReview(function (prev) {
      if (!prev) return prev
      var sel = Object.assign({}, prev.newRowsSelected)
      sel[i] = !sel[i]
      return Object.assign({}, prev, { newRowsSelected: sel })
    })
  }

  function toggleAllNewRows(checked) {
    setImportReview(function (prev) {
      if (!prev) return prev
      var sel = {}
      prev.newRows.forEach(function (_, i) { sel[i] = checked })
      return Object.assign({}, prev, { newRowsSelected: sel })
    })
  }

  function cancelImport() { setImportReview(null) }

  async function confirmImport() {
    if (!importReview || saving) return
    setSaving(true)
    var updated = 0, inserted = 0
    var failed = []

    for (var i = 0; i < importReview.updates.length; i++) {
      var u = importReview.updates[i]
      var { error } = await supabase.from('vendors').update(u.payload).eq('id', u.id)
      if (error) failed.push({ row: u.row, name: u.name, reason: 'Update failed: ' + error.message })
      else updated++
    }

    for (var j = 0; j < importReview.newRows.length; j++) {
      if (!importReview.newRowsSelected[j]) continue
      var nr = importReview.newRows[j]
      var payload = Object.assign({ created_by: profile.id }, nr.payload)
      var { error: insErr } = await supabase.from('vendors').insert(payload)
      if (insErr) failed.push({ row: nr.row, name: nr.name, reason: 'Insert failed: ' + insErr.message })
      else inserted++
    }

    try { await logActivity('IMPORT_CSV', 'VENDORS | ' + updated + ' updated, ' + inserted + ' inserted, ' + importReview.unchanged.length + ' unchanged, ' + (importReview.skipped.length + failed.length) + ' errors') } catch (_) {}

    setImportSummary({
      updated: updated,
      inserted: inserted,
      unchanged: importReview.unchanged.length,
      skipped: importReview.skipped.concat(failed),
    })
    setImportReview(null)
    setSaving(false)
    loadAll()
  }

  function downloadSkippedCsv() {
    if (!importSummary || !importSummary.skipped || importSummary.skipped.length === 0) return
    function esc(v) { var s = String(v == null ? '' : v); if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'; return s }
    var rows = importSummary.skipped.map(function (s) { return [s.row, s.name, s.reason].map(esc).join(',') })
    var csv = '\uFEFF' + ['Row', 'Name', 'Reason'].join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a'); a.href = url; a.download = 'vendor_import_issues.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportCSV() {
    function esc(v) {
      var s = String(v == null ? '' : v)
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    var catNameById = {}
    categories.forEach(function (c) { catNameById[c.id] = c.name })

    var headers = ['ID', 'Name', 'Vendor Type', 'Referred By', 'Contact Person', 'Phone', 'Phone 2', 'Email', 'Address', 'Categories', 'Lead Time (days)', 'Opening Balance (\u20B9)', 'GST Number', 'PAN Number', 'Bank Account', 'Bank IFSC', 'Notes', 'Active']
    var rows = vendors.map(function (v) {
      var catNames = (v.category_ids || []).map(function (cid) { return catNameById[cid] }).filter(Boolean).join(' | ')
      var openingRupees = v.opening_balance_paise ? (v.opening_balance_paise / 100).toFixed(2) : ''
      return [
        v.id,
        v.name || '',
        v.vendor_type || '',
        v.referred_by || '',
        v.contact || '',
        v.phone || '',
        v.phone2 || '',
        v.email || '',
        v.address || '',
        catNames,
        v.lead_time_days == null ? '' : v.lead_time_days,
        openingRupees,
        v.gst_number || '',
        v.pan_number || '',
        v.bank_account || '',
        v.bank_ifsc || '',
        v.notes || '',
        v.active ? 'Yes' : 'No',
      ].map(esc).join(',')
    })

    var csv = '\uFEFF' + headers.map(esc).join(',') + '\n' + rows.join('\n')
    var d = new Date()
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url; a.download = 'vendors_' + stamp + '.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    try { logActivity('EXPORT_CSV', 'VENDORS | ' + vendors.length + ' rows') } catch (_) {}
  }

  var filtered = vendors.filter(function (v) {
    if (!showInactive && !v.active) return false
    if (search && v.name.toLowerCase().indexOf(search.toLowerCase()) === -1) return false
    if (catFilter && (v.category_ids || []).indexOf(Number(catFilter)) === -1) return false
    if (estFilter && (v.expense_sub_type_ids || []).indexOf(Number(estFilter)) === -1) return false
    return true
  })

  var catMap = {}
  categories.forEach(function (c) { catMap[c.id] = c.name })

  var activeCount = vendors.filter(function (v) { return v.active }).length
  var inactiveCount = vendors.length - activeCount
  var taggedCount = vendors.filter(function (v) { return (v.category_ids || []).length > 0 }).length

  if (loading) return <p className="text-gray-400 text-sm text-center py-12">Loading vendors...</p>

  // ═══ IMPORT REVIEW VIEW ═══
  if (importReview) {
    var newRowsSelectedCount = 0
    importReview.newRows.forEach(function (_, i) { if (importReview.newRowsSelected[i]) newRowsSelectedCount++ })
    var newRowsAllChecked = importReview.newRows.length > 0 && newRowsSelectedCount === importReview.newRows.length
    var totalChanges = importReview.updates.length + newRowsSelectedCount

    return (
      <div className="max-w-3xl mx-auto space-y-5 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Import Review</h3>
            <p className="text-xs text-gray-400 mt-0.5">Confirm changes below — nothing is saved until you click Apply</p>
          </div>
          <button onClick={cancelImport} disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">✕ Cancel</button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-blue-700">{importReview.updates.length}</p>
            <p className="text-[11px] text-blue-600 font-medium mt-0.5">Will update</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-green-700">{newRowsSelectedCount}<span className="text-sm text-green-500">/{importReview.newRows.length}</span></p>
            <p className="text-[11px] text-green-600 font-medium mt-0.5">New (selected)</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-gray-700">{importReview.unchanged.length}</p>
            <p className="text-[11px] text-gray-500 font-medium mt-0.5">Unchanged</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-2xl font-bold text-amber-700">{importReview.skipped.length}</p>
            <p className="text-[11px] text-amber-600 font-medium mt-0.5">Errors</p>
          </div>
        </div>

        {importReview.updates.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-200">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Updates</p>
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {importReview.updates.map(function (u) {
                return (
                  <div key={u.row} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                    <span className="text-gray-400 font-mono w-10 flex-shrink-0">#{u.row}</span>
                    <span className="font-medium text-gray-700 truncate flex-1">{u.name}</span>
                    <span className="text-gray-500 text-right">{u.changedFields.map(function (f) { return fieldLabels[f] || f }).join(', ')}</span>
                    {u.warnings.length > 0 && (<span className="text-amber-600" title={u.warnings.join('; ')}>⚠</span>)}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {importReview.newRows.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wider">New Vendors — check to insert</p>
              <label className="flex items-center gap-2 text-xs text-green-700 font-semibold cursor-pointer">
                <input type="checkbox" checked={newRowsAllChecked}
                  onChange={function (e) { toggleAllNewRows(e.target.checked) }}
                  className="rounded" />
                {newRowsAllChecked ? 'Deselect all' : 'Select all'}
              </label>
            </div>
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {importReview.newRows.map(function (nr, i) {
                var checked = !!importReview.newRowsSelected[i]
                return (
                  <label key={i} className={"flex items-start gap-3 px-5 py-2.5 cursor-pointer transition-colors " + (checked ? "bg-white" : "bg-gray-50")}>
                    <input type="checkbox" checked={checked}
                      onChange={function () { toggleNewRow(i) }}
                      className="rounded mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-mono text-[11px]">#{nr.row}</span>
                        <span className="font-medium text-sm text-gray-800 truncate">{nr.name}</span>
                        {nr.warnings.length > 0 && (<span className="text-amber-600 text-xs" title={nr.warnings.join('; ')}>⚠</span>)}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {nr.payload.vendor_type || 'Supplier'}
                        {nr.payload.phone ? ' · ' + nr.payload.phone : ''}
                        {nr.payload.contact ? ' · ' + nr.payload.contact : ''}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {importReview.skipped.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Errors — will not be imported</p>
            </div>
            <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {importReview.skipped.map(function (s, si) {
                return (
                  <div key={si} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                    <span className="text-gray-400 font-mono w-10 flex-shrink-0">#{s.row}</span>
                    <span className="font-medium text-gray-700 w-40 truncate">{s.name}</span>
                    <span className="text-amber-600 flex-1">{s.reason}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-gray-50/95 backdrop-blur py-3 -mx-2 px-2 border-t border-gray-200">
          <button onClick={cancelImport} disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={confirmImport} disabled={saving || totalChanges === 0}
            className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
            {saving ? 'Applying...' : 'Confirm & Apply — ' + totalChanges + ' change' + (totalChanges !== 1 ? 's' : '')}
          </button>
        </div>
      </div>
    )
  }

  // ═══ FORM VIEW ═══
  if (editing) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{editing === 'new' ? 'Add Vendor' : 'Edit Vendor'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{editing === 'new' ? 'Register a new vendor in the system' : 'Update vendor details'}</p>
          </div>
          <button onClick={cancelEdit} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">✕ Cancel</button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
          {/* Identity */}
          <div className="p-5 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Identity</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { name: e.target.value }) }) }}
                placeholder="e.g. Sharma Traders"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Type</label>
                <select value={form.vendor_type}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { vendor_type: e.target.value }) }) }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {['Supplier', 'Contractor', 'Service Provider', 'Rental'].map(function (t) {
                    return <option key={t} value={t}>{t}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Referred By</label>
                <input type="text" value={form.referred_by}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { referred_by: e.target.value }) }) }}
                  placeholder="Employee name (for fuzzy match later)"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lead Time (days)</label>
                <input type="number" min="0" value={form.lead_time_days}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { lead_time_days: e.target.value }) }) }}
                  placeholder="e.g. 3"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="p-5 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person</label>
                <input type="text" value={form.contact}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { contact: e.target.value }) }) }}
                  placeholder="Name"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={form.email}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { email: e.target.value }) }) }}
                  placeholder="vendor@email.com"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="tel" value={form.phone}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { phone: e.target.value }) }) }}
                  placeholder="Primary"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp / Alt Phone</label>
                <input type="tel" value={form.phone2}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { phone2: e.target.value }) }) }}
                  placeholder="Secondary"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
              <textarea value={form.address}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { address: e.target.value }) }) }}
                rows="2" placeholder="Street, area, city..."
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50"
                style={{ fontSize: '16px' }} />
            </div>
          </div>

          {/* Financial */}
          <div className="p-5 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Financial</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Opening Balance (₹)</label>
                <div className="flex gap-1">
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={form.opening_balance}
                    onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { opening_balance: e.target.value }) }) }}
                    placeholder="0.00"
                    className="flex-1 min-w-0 px-3 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                    style={{ fontSize: '16px' }} />
                  <div className="flex bg-gray-100 border border-gray-200 rounded-lg p-0.5 flex-shrink-0">
                    <button type="button"
                      onClick={function () { setForm(function (p) { return Object.assign({}, p, { opening_balance_direction: 'credit' }) }) }}
                      className={"px-2.5 text-[11px] font-bold rounded-md transition-colors " +
                        (form.opening_balance_direction !== 'debit' ? "bg-amber-500 text-white shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                      Cr
                    </button>
                    <button type="button"
                      onClick={function () { setForm(function (p) { return Object.assign({}, p, { opening_balance_direction: 'debit' }) }) }}
                      className={"px-2.5 text-[11px] font-bold rounded-md transition-colors " +
                        (form.opening_balance_direction === 'debit' ? "bg-green-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                      Dr
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {form.opening_balance_direction === 'debit'
                    ? 'Vendor owes us (advance / recovery pending)'
                    : 'We owe vendor (carried outstanding)'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">GST Number</label>
                <input type="text" value={form.gst_number} maxLength="15"
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { gst_number: e.target.value.toUpperCase() }) }) }}
                  placeholder="22AAAAA0000A1Z5"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 uppercase"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">PAN Number</label>
                <input type="text" value={form.pan_number} maxLength="10"
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { pan_number: e.target.value.toUpperCase() }) }) }}
                  placeholder="ABCDE1234F"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 uppercase"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bank Account</label>
                <input type="text" value={form.bank_account}
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { bank_account: e.target.value }) }) }}
                  placeholder="Account number"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">IFSC Code</label>
                <input type="text" value={form.bank_ifsc} maxLength="11"
                  onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { bank_ifsc: e.target.value.toUpperCase() }) }) }}
                  placeholder="SBIN0001234"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 uppercase"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Categories</p>
              {form.category_ids.length > 0 && (
                <span className="text-[11px] text-indigo-600 font-semibold">{form.category_ids.length} selected</span>
              )}
            </div>
            <div className="space-y-3 lg:max-h-96 lg:overflow-y-auto p-1">
              {(function () {
                // Group: dept → sub-dept → categories
                var byDept = {}
                categories.forEach(function (c) {
                  var sd = subDepartments.find(function (s) { return s.id === c.sub_department_id })
                  var deptKey = sd ? String(sd.department_id) : '__unassigned'
                  var sdKey = sd ? String(sd.id) : '__none'
                  if (!byDept[deptKey]) byDept[deptKey] = {}
                  if (!byDept[deptKey][sdKey]) byDept[deptKey][sdKey] = []
                  byDept[deptKey][sdKey].push(c)
                })
                var orderedDepts = departments.filter(function (d) { return byDept[String(d.id)] })
                var groups = orderedDepts.map(function (d) {
                  var sdMap = byDept[String(d.id)]
                  var sdList = subDepartments.filter(function (s) { return s.department_id === d.id && sdMap[String(s.id)] }).map(function (s) {
                    return { key: 'sd' + s.id, name: s.name, cats: sdMap[String(s.id)] }
                  })
                  if (sdMap.__none) sdList.push({ key: 'd' + d.id + '-none', name: null, cats: sdMap.__none })
                  return { key: 'd' + d.id, deptName: d.name, subGroups: sdList }
                })
                if (byDept.__unassigned) {
                  groups.push({ key: 'unassigned', deptName: 'Unassigned', subGroups: [{ key: 'unassigned-flat', name: null, cats: byDept.__unassigned.__none || [] }] })
                }
                if (groups.length === 0) return <p className="text-xs text-gray-400 px-1">No categories available</p>
                return groups.map(function (g) {
                  var deptCats = g.subGroups.reduce(function (a, sg) { return a.concat(sg.cats) }, [])
                  var deptSelCount = deptCats.filter(function (c) { return form.category_ids.indexOf(c.id) !== -1 }).length
                  var isExpanded = expandedCatDepts[g.key] != null ? expandedCatDepts[g.key] : (deptSelCount > 0)
                  return (
                    <div key={g.key} className="border border-gray-100 rounded-lg overflow-hidden">
                      <button type="button" onClick={function () { toggleCatDeptExpand(g.key) }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100">
                        <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">{g.deptName}</span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {deptSelCount > 0 ? deptSelCount + ' / ' : ''}{deptCats.length} categor{deptCats.length !== 1 ? 'ies' : 'y'} <span className="text-gray-500 ml-1">{isExpanded ? '▼' : '▶'}</span>
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="space-y-2 p-2 bg-white">
                          {g.subGroups.map(function (sg) {
                            return (
                              <div key={sg.key}>
                                {sg.name && <p className="text-[10px] text-gray-400 mb-1">{sg.name}</p>}
                                <div className="flex flex-wrap gap-2">
                                  {sg.cats.map(function (c) {
                                    var selected = form.category_ids.indexOf(c.id) !== -1
                                    return (
                                      <button key={c.id} type="button" onClick={function () { toggleCat(c.id) }}
                                        className={"px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all " +
                                          (selected ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600")}>
                                        {c.name}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Expense Types (groups vendor by which expense sub-types they serve) */}
          <div className="p-5 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expense Types</p>
              {(form.expense_sub_type_ids || []).length > 0 && (
                <span className="text-[11px] text-indigo-600 font-semibold">{(form.expense_sub_type_ids || []).length} sub-type{(form.expense_sub_type_ids || []).length !== 1 ? 's' : ''} selected</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mb-2">Tick a parent type to bulk-tick its sub-types. Click a row to expand and pick specific sub-types.</p>
            <div className="space-y-2 lg:max-h-80 lg:overflow-y-auto p-1">
              {expenseTypes.length === 0 && <p className="text-xs text-gray-400 px-1">No expense types configured</p>}
              {(function () {
                // Group expense types by department (via sub_department_id → department, fallback to direct department_id)
                var byDept = {}
                expenseTypes.forEach(function (t) {
                  var deptKey = '__unassigned'
                  if (t.sub_department_id) {
                    var sd = subDepartments.find(function (s) { return s.id === t.sub_department_id })
                    if (sd && sd.department_id) deptKey = String(sd.department_id)
                  } else if (t.department_id) {
                    deptKey = String(t.department_id)
                  }
                  if (!byDept[deptKey]) byDept[deptKey] = []
                  byDept[deptKey].push(t)
                })
                var orderedDepts = departments.filter(function (d) { return byDept[String(d.id)] })
                var groups = orderedDepts.map(function (d) { return { key: 'd' + d.id, deptName: d.name, types: byDept[String(d.id)] } })
                if (byDept.__unassigned) groups.push({ key: 'unassigned', deptName: 'Unassigned', types: byDept.__unassigned })
                if (groups.length === 0) return null

                return groups.map(function (g) {
                  var typeSelCount = g.types.filter(function (t) { return (form.expense_type_ids || []).indexOf(t.id) !== -1 }).length
                  var subSelCount = g.types.reduce(function (sum, t) {
                    var subs = expenseSubTypes.filter(function (s) { return s.expense_type_id === t.id })
                    return sum + subs.filter(function (s) { return (form.expense_sub_type_ids || []).indexOf(s.id) !== -1 }).length
                  }, 0)
                  var isDeptExpanded = expandedExpDepts[g.key] != null ? expandedExpDepts[g.key] : (subSelCount > 0 || typeSelCount > 0)
                  return (
                    <div key={g.key} className="border border-gray-100 rounded-lg overflow-hidden">
                      <button type="button" onClick={function () { toggleExpDeptExpand(g.key) }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100">
                        <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">{g.deptName}</span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {typeSelCount > 0 ? typeSelCount + ' / ' : ''}{g.types.length} type{g.types.length !== 1 ? 's' : ''} <span className="text-gray-500 ml-1">{isDeptExpanded ? '▼' : '▶'}</span>
                        </span>
                      </button>
                      {isDeptExpanded && (
                        <div className="space-y-1.5 p-2 bg-white">
                          {g.types.map(function (t) {
                        var subs = expenseSubTypes.filter(function (s) { return s.expense_type_id === t.id })
                        var typeChecked = (form.expense_type_ids || []).indexOf(t.id) !== -1
                        var selSubCount = subs.filter(function (s) { return (form.expense_sub_type_ids || []).indexOf(s.id) !== -1 }).length
                        var isExpanded = expandedExpTypes[t.id] != null ? expandedExpTypes[t.id] : (selSubCount > 0)
                        return (
                          <div key={t.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                      <input type="checkbox" checked={typeChecked}
                        onChange={function () { toggleExpType(t.id) }}
                        onClick={function (e) { e.stopPropagation() }}
                        className="w-3.5 h-3.5 rounded accent-indigo-600" />
                      <button type="button" onClick={function () { toggleExpTypeExpand(t.id) }}
                        className="flex-1 flex items-center justify-between text-left">
                        <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                          {t.icon ? t.icon + ' ' : ''}{t.name}
                        </span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {selSubCount > 0 ? selSubCount + ' / ' : ''}{subs.length} sub-type{subs.length !== 1 ? 's' : ''} <span className="text-gray-500 ml-1">{isExpanded ? '▼' : '▶'}</span>
                        </span>
                      </button>
                    </div>
                    {isExpanded && subs.length > 0 && (
                      <div className="flex flex-wrap gap-2 p-2 bg-white">
                        {subs.map(function (st) {
                          var selected = (form.expense_sub_type_ids || []).indexOf(st.id) !== -1
                          return (
                            <button key={st.id} type="button" onClick={function () { toggleExpSubType(st.id) }}
                              className={"px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all " +
                                (selected ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50")}>
                              {st.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Notes */}
          <div className="p-5">
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <VoiceInput as="textarea" value={form.notes}
              onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { notes: e.target.value }) }) }}
              rows="2" placeholder="Internal notes, special instructions..."
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50" />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={cancelEdit} disabled={saving}
            className="flex-1 py-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-semibold disabled:opacity-50">Cancel</button>
          <button onClick={saveVendor} disabled={saving}
            className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold shadow-sm">
            {saving ? 'Saving...' : (editing === 'new' ? '+ Add Vendor' : 'Save Changes')}
          </button>
        </div>
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 lg:gap-4">
        <div className="bg-white rounded-xl border border-gray-200 px-3 py-3 lg:px-5 lg:py-4 shadow-sm">
          <p className="text-xl lg:text-2xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-[10px] lg:text-xs text-gray-400 font-medium mt-0.5">Active Vendors</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-3 py-3 lg:px-5 lg:py-4 shadow-sm">
          <p className="text-xl lg:text-2xl font-bold text-indigo-600">{taggedCount}</p>
          <p className="text-[10px] lg:text-xs text-gray-400 font-medium mt-0.5">Category Tagged</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-3 py-3 lg:px-5 lg:py-4 shadow-sm">
          <p className="text-xl lg:text-2xl font-bold text-gray-400">{inactiveCount}</p>
          <p className="text-[10px] lg:text-xs text-gray-400 font-medium mt-0.5">Inactive</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-3 lg:px-4 shadow-sm space-y-2 lg:space-y-0 lg:flex lg:items-center lg:gap-3 lg:flex-wrap">
        <div className="lg:flex-1 lg:min-w-[220px] relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
          <input type="text" value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search vendors..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
            style={{ fontSize: '16px' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 lg:contents">
          <div className="lg:min-w-[180px]">
            <SearchDropdown
              items={categories.map(function (c) { return { label: c.name, value: String(c.id) } })}
              value={catFilter}
              onChange={function (v) { setCatFilter(v) }}
              placeholder="🔎 Category" />
          </div>
          <div className="lg:min-w-[220px]">
            <SearchDropdown
              items={expenseSubTypes.map(function (st) {
                var parent = expenseTypes.find(function (t) { return t.id === st.expense_type_id })
                var prefix = parent ? (parent.name + ' › ') : ''
                return { label: prefix + st.name, value: String(st.id) }
              })}
              value={estFilter}
              onChange={function (v) { setEstFilter(v) }}
              placeholder="🔎 Sub-expense type" />
          </div>
          {(catFilter || estFilter) && (
            <button type="button"
              onClick={function () { setCatFilter(''); setEstFilter('') }}
              className="lg:whitespace-nowrap px-3 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
              ✕ Clear filters
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showInactive}
            onChange={function () { setShowInactive(!showInactive) }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          Show inactive
        </label>
        <input type="file" accept=".csv,text/csv" ref={importFileRef} onChange={handleImportFile} style={{ display: 'none' }} />
        <div className="grid grid-cols-2 gap-2 lg:contents lg:ml-auto">
          <button onClick={function () { if (importFileRef.current) importFileRef.current.click() }}
            className="w-full lg:w-auto px-3 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap lg:ml-auto"
            title="Import from CSV — review before applying">
            ⤒ Import CSV
          </button>
          <button onClick={exportCSV} disabled={vendors.length === 0}
            className="w-full lg:w-auto px-3 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            title="Export vendors — includes GST, PAN, bank details">
            ⤓ Export CSV
          </button>
        </div>
        <button onClick={startAdd}
          className="w-full lg:w-auto px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm whitespace-nowrap">
          + Add Vendor
        </button>
      </div>

      {/* Import summary banner */}
      {importSummary && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm flex items-center gap-4 flex-wrap">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Import result</span>
          <span className="text-xs text-blue-700 font-semibold">{importSummary.updated} updated</span>
          <span className="text-xs text-green-700 font-semibold">{importSummary.inserted} inserted</span>
          <span className="text-xs text-gray-500 font-semibold">{importSummary.unchanged} unchanged</span>
          {importSummary.skipped.length > 0 && (
            <span className="text-xs text-amber-700 font-semibold">{importSummary.skipped.length} error{importSummary.skipped.length !== 1 ? 's' : ''}</span>
          )}
          {importSummary.skipped.length > 0 && (
            <button onClick={downloadSkippedCsv}
              className="text-xs text-indigo-600 font-semibold hover:text-indigo-700 underline">
              Download error log
            </button>
          )}
          <button onClick={function () { setImportSummary(null) }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {/* Results count */}
      {(search || catFilter) && (
        <p className="text-xs text-gray-400 px-1">{filtered.length} result{filtered.length !== 1 ? 's' : ''}{search ? ' for "' + search + '"' : ''}</p>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <div className="text-4xl mb-3">🏪</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">
            {vendors.length === 0 ? 'No vendors yet' : 'No matching vendors'}
          </p>
          <p className="text-xs text-gray-400 mb-4">
            {vendors.length === 0 ? 'Add your first vendor to start building your directory' : 'Try changing your search or filter'}
          </p>
          {vendors.length === 0 && (
            <button onClick={startAdd}
              className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
              + Add First Vendor
            </button>
          )}
        </div>
      )}

      {/* Vendor table-style cards */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header — desktop only */}
          <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            <div className="col-span-2">Vendor</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-3">Categories</div>
            <div className="col-span-2">Expense Types</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {/* Rows */}
          {filtered.map(function (v, vi) {
            var catNames = (v.category_ids || []).map(function (cid) { return catMap[cid] }).filter(Boolean)
            // Expense types: direct tags from vendor.expense_type_ids
            var estIdSet = {}
            ;(v.expense_sub_type_ids || []).forEach(function (id) { estIdSet[id] = true })
            var etNames = expenseSubTypes.filter(function (st) { return estIdSet[st.id] })
              .map(function (st) { return st.name })
            return (
              <div key={v.id}
                className={"px-4 py-3 lg:px-5 lg:py-4 lg:grid lg:grid-cols-12 lg:gap-3 lg:items-center transition-colors " +
                  (vi < filtered.length - 1 ? "border-b border-gray-100 lg:border-gray-50 " : "") +
                  (v.active ? "hover:bg-gray-50" : "opacity-50 bg-gray-50/50")}>
                {/* Name + notes */}
                <div className="lg:col-span-2 min-w-0 flex items-start justify-between gap-2 lg:block">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">{v.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {v.vendor_type && v.vendor_type !== 'Supplier' && (
                        <span className="text-[10px] font-medium text-gray-400">{v.vendor_type}</span>
                      )}
                      {v.opening_balance_paise !== 0 && v.opening_balance_paise != null && (
                        <span className={"text-[10px] font-semibold " + (v.opening_balance_paise > 0 ? "text-amber-600" : "text-green-700")}>
                          Opening: ₹{(Math.abs(v.opening_balance_paise) / 100).toLocaleString('en-IN')} {v.opening_balance_paise > 0 ? 'Cr' : 'Dr'}
                        </span>
                      )}
                    </div>
                    {v.notes && <p className="text-[11px] text-gray-400 truncate mt-0.5">{v.notes}</p>}
                  </div>
                  {/* Status pill inline with name on mobile */}
                  <span className={"lg:hidden shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " +
                    (v.active ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500")}>
                    {v.active ? 'Active' : 'Off'}
                  </span>
                </div>
                {/* Contact */}
                <div className="lg:col-span-2 min-w-0 mt-1.5 lg:mt-0">
                  {v.contact && <p className="text-xs text-gray-600 truncate">{v.contact}</p>}
                  {v.phone && (
                    <a href={'tel:' + v.phone.replace(/[^0-9+]/g, '')}
                      title={'Call ' + (v.contact || v.name || 'vendor') + (v.phone2 ? ' · alt: ' + v.phone2 : '')}
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 truncate no-underline">
                      📞 {v.phone}
                    </a>
                  )}
                  {v.phone2 && (
                    <a href={'tel:' + v.phone2.replace(/[^0-9+]/g, '')}
                      title={'Call alt: ' + v.phone2}
                      className="block text-[10px] text-gray-400 hover:text-indigo-600 truncate no-underline mt-0.5">
                      📞 {v.phone2}
                    </a>
                  )}
                  {!v.contact && !v.phone && <span className="text-[11px] text-gray-300 hidden lg:inline">—</span>}
                </div>
                {/* Categories */}
                <div className="lg:col-span-3 min-w-0 mt-1.5 lg:mt-0">
                  {catNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {catNames.slice(0, 4).map(function (cn, ci) {
                        return <span key={ci} className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{cn}</span>
                      })}
                      {catNames.length > 4 && <span className="text-[10px] text-gray-400 font-medium">+{catNames.length - 4}</span>}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-300 italic">No categories</span>
                  )}
                </div>
                {/* Expense Types (desktop-labelled; mobile shows inline block too) */}
                <div className="lg:col-span-2 min-w-0 mt-1.5 lg:mt-0">
                  <p className="lg:hidden text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Expense Types</p>
                  {etNames.length > 0 ? (
                    (function () {
                      var isExpanded = !!expandedEtVendors[v.id]
                      var visibleNames = isExpanded ? etNames : etNames.slice(0, 3)
                      return (
                        <div className="flex flex-wrap gap-1">
                          {visibleNames.map(function (en, ei) {
                            return <span key={ei} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{en}</span>
                          })}
                          {etNames.length > 3 && (
                            <button type="button"
                              onClick={function () { setExpandedEtVendors(function (prev) { var n = Object.assign({}, prev); n[v.id] = !prev[v.id]; return n }) }}
                              className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 hover:underline px-1">
                              {isExpanded ? '− Less' : '+' + (etNames.length - 3) + ' more'}
                            </button>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                    <span className="text-[11px] text-gray-300 italic">—</span>
                  )}
                </div>
                {/* Status (desktop only — mobile shows it inline with name) */}
                <div className="hidden lg:block lg:col-span-1">
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " +
                    (v.active ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500")}>
                    {v.active ? 'Active' : 'Off'}
                  </span>
                </div>
                {/* Actions */}
                <div className="lg:col-span-2 flex justify-end gap-4 mt-2 lg:mt-0 pt-2 lg:pt-0 border-t lg:border-0 border-gray-100">
                  <button onClick={function () { startEdit(v) }}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">Edit</button>
                  <button onClick={function () { toggleActive(v) }}
                    className={"text-xs font-semibold transition-colors " + (v.active ? "text-gray-400 hover:text-red-600" : "text-green-600 hover:text-green-800")}>
                    {v.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Vendors