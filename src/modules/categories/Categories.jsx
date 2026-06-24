import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'

function Categories() {
  var [tab, setTab] = useState('departments')
  var [departments, setDepartments] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [venues, setVenues] = useState([])
  var [loading, setLoading] = useState(true)
  useRealtime(['categories', 'sub_categories', 'departments', 'sub_departments', 'venues', 'sub_venues'], function () { if (!saving) loadAll() })

  // Add form state
  var [newDept, setNewDept] = useState('')
  var [newCat, setNewCat] = useState('')
  var [newCatCode, setNewCatCode] = useState('')
  var [newVenueCode, setNewVenueCode] = useState('')
  var [newVenueName, setNewVenueName] = useState('')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Inline edit for depts/venues
  var [editing, setEditing] = useState(null)
  var [editVal, setEditVal] = useState('')
  var [editVal2, setEditVal2] = useState('')
  var [deptSearch, setDeptSearch] = useState('')
  var [catSearch, setCatSearch] = useState('')
  var [venueSearch, setVenueSearch] = useState('')
  var [subVenues, setSubVenues] = useState([])
  var [newSubVenue, setNewSubVenue] = useState({}) // { venueId: value }
  var [editDeptCats, setEditDeptCats] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [newSubDept, setNewSubDept] = useState({}) // { deptId: value }
  var [newCatSubDept, setNewCatSubDept] = useState('')
  var [editCatSubDept, setEditCatSubDept] = useState('')
  var [editingSubDept, setEditingSubDept] = useState(null) // { id, name }
  var [editSubDeptName, setEditSubDeptName] = useState('')
  var [editSubDeptCatIds, setEditSubDeptCatIds] = useState([])
  var [newSubDeptCode, setNewSubDeptCode] = useState({})
  var [editSubDeptCode, setEditSubDeptCode] = useState('')

  // Category edit modal
  var [editCat, setEditCat] = useState(null)
  var [editCatName, setEditCatName] = useState('')
  var [editCatCode, setEditCatCode] = useState('')
  var [editCatConsumable, setEditCatConsumable] = useState(true)
  var [expTypes, setExpTypes] = useState([])
  var [editDeptExpTypes, setEditDeptExpTypes] = useState([])
  var [editSubDeptExpTypes, setEditSubDeptExpTypes] = useState([])
  var [editCatExpTypes, setEditCatExpTypes] = useState([])
  var [editCatExpSubTypes, setEditCatExpSubTypes] = useState([])
  var [expSubTypes, setExpSubTypes] = useState([])
  var [editCatDims, setEditCatDims] = useState([])
  var [dragDimIdx, setDragDimIdx] = useState(null)
  var [dragOverIdx, setDragOverIdx] = useState(null)
  var [editCatSubs, setEditCatSubs] = useState([])
  var [newDimName, setNewDimName] = useState('')
  var [newSubName, setNewSubName] = useState('')

  useEffect(function () {
    loadAll()
    supabase.from('expense_types').select('id, name, active').eq('active', true).order('sort_order').then(function (res) {
      setExpTypes(res.data || [])
    })
    supabase.from('expense_sub_types').select('id, name, expense_type_id, active').eq('active', true).order('sort_order').then(function (res) {
      setExpSubTypes(res.data || [])
    })
  }, [])

  async function loadAll() {
    var [deptRes, catRes, subRes, venueRes, subDeptRes, subVenueRes] = await Promise.all([
      supabase.from('departments').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('sub_categories').select('*, categories(name)').order('name'),
      supabase.from('venues').select('*').order('code'),
      supabase.from('sub_departments').select('*').order('name'),
      supabase.from('sub_venues').select('*').order('name'),
    ])
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])
    setSubCategories(subRes.data || [])
    setVenues(venueRes.data || [])
    setSubDepartments(subDeptRes.data || [])
    setSubVenues(subVenueRes.data || [])
    setLoading(false)
  }

  // ═══ DEPARTMENT CRUD ═══
  async function addDepartment(e) {
    e.preventDefault()
    if (!newDept.trim()) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('departments').insert({ name: newDept.trim() })
    if (err) { setError(err.message) } else { logActivity('DEPT_CREATE', newDept.trim()); setNewDept(''); loadAll() }
    setSaving(false)
  }

  async function toggleDepartment(dept) {
    await supabase.from('departments').update({ active: !dept.active }).eq('id', dept.id)
    logActivity('DEPT_TOGGLE', dept.name + ' → ' + (dept.active ? 'inactive' : 'active'))
    loadAll()
  }

  async function deleteDepartment(dept) {
    if (!confirm('Delete department "' + dept.name + '"?')) return
    var { error: err } = await supabase.from('departments').delete().eq('id', dept.id)
    if (err) { setError(err.message) } else { logActivity('DEPT_DELETE', dept.name); loadAll() }
  }

  async function saveEditDept(dept) {
    if (!editVal.trim()) return
    var { error: err } = await supabase.from('departments').update({ name: editVal.trim(), category_ids: editDeptCats, expense_type_ids: editDeptExpTypes }).eq('id', dept.id)
    if (err) { setError(err.message) } else { setEditing(null); loadAll() }
  }
  async function addSubDepartment(deptId) {
    var val = (newSubDept[deptId] || '').trim()
    if (!val) return
    setSaving(true); setError('')
    var code = (newSubDeptCode[deptId] || '').trim().toUpperCase() || null
    var { error: err } = await supabase.from('sub_departments').insert({ name: val, department_id: deptId, code: code })
    if (err) { setError(err.message) } else {
      logActivity('SUB_DEPT_CREATE', (code ? code + ' — ' : '') + val)
      setNewSubDept(function (prev) { return Object.assign({}, prev, { [deptId]: '' }) })
      setNewSubDeptCode(function (prev) { return Object.assign({}, prev, { [deptId]: '' }) })
      loadAll()
    }
    setSaving(false)
  }

  async function deleteSubDepartment(sd) {
    if (!confirm('Delete sub-department "' + sd.name + '"?')) return
    var { error: err } = await supabase.from('sub_departments').delete().eq('id', sd.id)
    if (err) { setError(err.message) } else { logActivity('SUB_DEPT_DELETE', sd.name); loadAll() }
  }

  async function toggleSubDepartment(sd) {
    await supabase.from('sub_departments').update({ active: !sd.active }).eq('id', sd.id)
    loadAll()
  }
  function openEditSubDept(sd) {
    setEditingSubDept(sd)
    setEditSubDeptName(sd.name)
    setEditSubDeptExpTypes(sd.expense_type_ids || [])
    var catIds = categories.filter(function (c) { return c.sub_department_id === sd.id }).map(function (c) { return c.id })
    setEditSubDeptCatIds(catIds)
  }

  async function saveEditSubDept() {
    if (!editingSubDept || !editSubDeptName.trim()) return
    setSaving(true); setError('')
    // Update sub-dept name
    await supabase.from('sub_departments').update({ name: editSubDeptName.trim(), expense_type_ids: editSubDeptExpTypes }).eq('id', editingSubDept.id)
    // Remove sub_department_id from categories no longer selected
    var oldCatIds = categories.filter(function (c) { return c.sub_department_id === editingSubDept.id }).map(function (c) { return c.id })
    var toRemove = oldCatIds.filter(function (id) { return !editSubDeptCatIds.includes(id) })
    var toAdd = editSubDeptCatIds.filter(function (id) { return !oldCatIds.includes(id) })
    for (var i = 0; i < toRemove.length; i++) {
      await supabase.from('categories').update({ sub_department_id: null }).eq('id', toRemove[i])
    }
    for (var i = 0; i < toAdd.length; i++) {
      await supabase.from('categories').update({ sub_department_id: editingSubDept.id }).eq('id', toAdd[i])
    }
    logActivity('SUB_DEPT_UPDATE', editSubDeptName.trim() + ' | ' + editSubDeptCatIds.length + ' categories')
    setEditingSubDept(null)
    loadAll()
    setSaving(false)
  }
  // ═══ CATEGORY CRUD ═══
  async function addCategory(e) {
    e.preventDefault()
    if (!newCat.trim()) return
    setSaving(true); setError('')
    var payload = { name: newCat.trim() }
    if (newCatCode.trim()) payload.code = newCatCode.trim().toUpperCase()
    if (newCatSubDept) payload.sub_department_id = Number(newCatSubDept)
    var { error: err } = await supabase.from('categories').insert(payload)
    if (err) { setError(err.message) } else { logActivity('CAT_CREATE', newCat.trim()); setNewCat(''); setNewCatCode(''); setNewCatSubDept(''); loadAll() }
    setSaving(false)
  }

  async function deleteCategory(cat) {
    if (!confirm('Delete category "' + cat.name + '"? Items using it will become uncategorized.')) return
    var { error: err } = await supabase.from('categories').delete().eq('id', cat.id)
    if (err) { setError(err.message) } else { logActivity('CAT_DELETE', cat.name); loadAll() }
  }

  // ═══ CATEGORY EDIT MODAL ═══
  function openEditCat(cat) {
    setEditCat(cat)
    setEditCatName(cat.name)
    setEditCatCode(cat.code || '')
    setEditCatConsumable(cat.consumable !== false)
    setEditCatDims(cat.dimension_fields || [])
    setEditCatSubs(subCategories.filter(function (s) { return s.category_id === cat.id }))
    setEditCatSubDept(cat.sub_department_id ? String(cat.sub_department_id) : '')
    setEditCatExpTypes(cat.expense_type_ids || [])
    setEditCatExpSubTypes(cat.expense_sub_type_ids || [])
    setNewDimName('')
    setNewDimType('number')
    setEditDimIdx(null)
    setEditDimOptions([])
    setNewDimOption('')
    setNewSubName('')
    setError('')
  }

  var [newDimType, setNewDimType] = useState('number')
  var [editDimIdx, setEditDimIdx] = useState(null)
  var [editDimOptions, setEditDimOptions] = useState([])
  var [newDimOption, setNewDimOption] = useState('')
  var [dimPasteOpen, setDimPasteOpen] = useState(false)
  var [dimPasteText, setDimPasteText] = useState('')

  function addDimField() {
    if (!newDimName.trim()) return
    var exists = editCatDims.some(function (d) { return d.name.toLowerCase() === newDimName.trim().toLowerCase() })
    if (exists) { setError('Dimension "' + newDimName.trim() + '" already exists'); return }
    var field = { name: newDimName.trim(), type: newDimType, nameGen: false }
    if (newDimType === 'select') field.options = []
    setEditCatDims(function (prev) { return prev.concat([field]) })
    setNewDimName('')
    setNewDimType('number')
    setError('')
  }

  function updateDimType(index, newType) {
    setEditCatDims(function (prev) { return prev.map(function (d, i) {
      if (i !== index) return d
      var updated = { name: d.name, type: newType }
      if (newType === 'select') updated.options = d.options || []
      return updated
    }) })
  }

  function openDimOptions(index) {
    setEditDimIdx(index)
    setEditDimOptions((editCatDims[index].options || []).slice())
    setNewDimOption('')
  }

  function closeDimOptions() { setEditDimIdx(null); setEditDimOptions([]); setNewDimOption(''); setDimPasteOpen(false); setDimPasteText('') }

  function saveDimOptions() {
    setEditCatDims(function (prev) { return prev.map(function (d, i) {
      if (i !== editDimIdx) return d
      return Object.assign({}, d, { options: editDimOptions })
    }) })
    closeDimOptions()
  }

  function removeDimField(index) {
    setEditCatDims(function (prev) { return prev.filter(function (_, i) { return i !== index }) })
  }

  async function addEditSubCat() {
    if (!newSubName.trim() || !editCat) return
    setSaving(true); setError('')
    var { data, error: err } = await supabase.from('sub_categories')
      .insert({ name: newSubName.trim(), category_id: editCat.id })
      .select().single()
    if (err) { setError(err.message) } else {
      setEditCatSubs(function (prev) { return [...prev, data] })
      setNewSubName('')
    }
    setSaving(false)
  }

  async function deleteEditSubCat(subId) {
    var { error: err } = await supabase.from('sub_categories').delete().eq('id', subId)
    if (err) { setError(err.message) } else {
      setEditCatSubs(function (prev) { return prev.filter(function (s) { return s.id !== subId }) })
    }
  }

  async function saveEditSubCat(sub) {
    if (!editVal.trim()) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('sub_categories').update({ name: editVal.trim() }).eq('id', sub.id)
    if (err) { setError(err.message) } else {
      setEditCatSubs(function (prev) {
        return prev.map(function (s) { return s.id === sub.id ? Object.assign({}, s, { name: editVal.trim() }) : s })
      })
      setEditing(null)
      logActivity('SUBCAT_UPDATE', sub.name + ' → ' + editVal.trim())
    }
    setSaving(false)
  }

  async function saveEditCat(e) {
    e.preventDefault()
    if (!editCatName.trim()) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('categories').update({
      name: editCatName.trim(),
      code: editCatCode.trim().toUpperCase() || null,
      dimension_fields: editCatDims,
      sub_department_id: editCatSubDept ? Number(editCatSubDept) : null,
      consumable: editCatConsumable,
      expense_type_ids: editCatExpTypes,
      expense_sub_type_ids: editCatExpSubTypes,
    }).eq('id', editCat.id)
    if (err) { setError(err.message) } else {
      setEditCat(null)
      loadAll()
    }
    setSaving(false)
  }

  // ═══ VENUE CRUD ═══
  async function addVenue(e) {
    e.preventDefault()
    if (!newVenueCode.trim() || !newVenueName.trim()) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('venues').insert({ code: newVenueCode.trim().toUpperCase(), name: newVenueName.trim() })
    if (err) { setError(err.message) } else { setNewVenueCode(''); setNewVenueName(''); loadAll() }
    setSaving(false)
  }

  async function toggleVenue(venue) {
    await supabase.from('venues').update({ active: !venue.active }).eq('id', venue.id)
    loadAll()
  }

  async function deleteVenue(venue) {
    if (!confirm('Delete venue "' + venue.code + ' — ' + venue.name + '"?')) return
    var { error: err } = await supabase.from('venues').delete().eq('id', venue.id)
    if (err) { setError(err.message) } else { loadAll() }
  }

  async function addSubVenue(venueId) {
    var val = (newSubVenue[venueId] || '').trim()
    if (!val) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('sub_venues').insert({ name: val, venue_id: venueId })
    if (err) { setError(err.message) } else {
      setNewSubVenue(function (prev) { return Object.assign({}, prev, { [venueId]: '' }) })
      loadAll()
    }
    setSaving(false)
  }

  async function deleteSubVenue(sv) {
    if (!confirm('Delete sub-venue "' + sv.name + '"?')) return
    await supabase.from('sub_venues').delete().eq('id', sv.id)
    loadAll()
  }

  async function toggleSubVenue(sv) {
    await supabase.from('sub_venues').update({ active: !sv.active }).eq('id', sv.id)
    loadAll()
  }

  async function saveEditVenue(venue) {
    if (!editVal.trim() || !editVal2.trim()) return
    var { error: err } = await supabase.from('venues').update({ code: editVal.trim().toUpperCase(), name: editVal2.trim() }).eq('id', venue.id)
    if (err) { setError(err.message) } else { setEditing(null); loadAll() }
  }

  // ═══ CSV EXPORT/IMPORT ═══
  function exportCSV() {
    function esc(v) { var s = String(v == null ? '' : v); if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'; return s }
    var headers = ['ID', 'Category', 'Code', 'Department', 'Sub-department', 'Item Type', 'Expense Categories', 'Expense Sub-Categories', 'Dimension Fields', 'Sub-categories']
    var rows = []
    categories.forEach(function (cat) {
      var dept = ''
      var subDeptName = ''
      if (cat.sub_department_id) {
        var sd = subDepartments.find(function (s) { return s.id === cat.sub_department_id })
        if (sd) {
          subDeptName = sd.name
          var d = departments.find(function (dp) { return dp.id === sd.department_id })
          if (d) dept = d.name
        }
      }
      var itemType = cat.consumable === false ? 'Asset' : 'Consumable'
      var expCats = (cat.expense_type_ids || []).map(function (eid) {
        var et = expTypes.find(function (e) { return e.id === eid })
        return et ? et.name : ''
      }).filter(Boolean).join('; ')
      var dims = (cat.dimension_fields || []).map(function (df) {
        var t = df.type || 'number'
        var parts = df.name
        if (t !== 'number') parts = parts + ' [' + t + ']'
        if (t === 'select' && df.options && df.options.length > 0) parts = parts + ' (' + df.options.join('|') + ')'
        if (df.nameGen) parts = parts + ' *nameGen'
        return parts
      }).join('; ')
      var subs = subCategories.filter(function (s) { return Number(s.category_id) === Number(cat.id) }).map(function (s) { return s.name }).join('; ')
      var expSubCats = (cat.expense_sub_type_ids || []).map(function (sid) { var st = expSubTypes.find(function (s) { return s.id === sid }); return st ? st.name : '' }).filter(Boolean).join('; ')
      rows.push([cat.id, cat.name, cat.code || '', dept, subDeptName, itemType, expCats, expSubCats, dims, subs].map(esc).join(','))
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_categories_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  async function importCSV(e) {
    var file = e.target.files?.[0]
    if (!file) return
    var text = await file.text()
    var lines = text.split('\n').filter(function (l) { return l.trim() })
    if (lines.length < 2) { alert('CSV must have header + at least 1 row'); return }
    var header = lines[0].toLowerCase().replace(/[\uFEFF]/g, '')
    var cols0 = header.split(',').map(function (h) { return h.trim() })
    var hasId = cols0[0] === 'id'
    var offset = hasId ? 1 : 0
    var created = 0; var updated = 0; var skipped = 0
    for (var r = 1; r < lines.length; r++) {
      var cols = lines[r].split(',')
      var rowId = hasId ? (cols[0] || '').trim() : ''
      var catName = (cols[offset] || '').trim()
      var catCode = (cols[offset + 1] || '').trim().toUpperCase()
      if (!catName) { skipped++; continue }
      var catId = null
      if (rowId) {
        var byId = categories.find(function (c) { return String(c.id) === rowId })
        if (byId) {
          var updates = {}
          if (catName && catName !== byId.name) updates.name = catName
          if (catCode && catCode !== (byId.code || '')) updates.code = catCode
          if (Object.keys(updates).length > 0) {
            await supabase.from('categories').update(updates).eq('id', byId.id)
            updated++
          } else { skipped++ }
          catId = byId.id
        }
      }
      if (!catId) {
        var byName = categories.find(function (c) { return c.name.toLowerCase() === catName.toLowerCase() })
        if (byName) {
          catId = byName.id
          if (catCode && catCode !== (byName.code || '')) {
            await supabase.from('categories').update({ code: catCode }).eq('id', byName.id)
            updated++
          } else { skipped++ }
        } else {
          var payload = { name: catName, status: 'approved' }
          if (catCode) payload.code = catCode
          var { data: newCatData } = await supabase.from('categories').insert(payload).select().single()
          if (newCatData) { catId = newCatData.id; created++ }
        }
      }
    }
    alert('Import done: ' + created + ' created, ' + updated + ' updated, ' + skipped + ' unchanged')
    loadAll()
    e.target.value = ''
  }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-0 bg-white border border-gray-200 rounded-lg overflow-hidden">
        {['departments', 'categories', 'venues'].map(function (t) {
          var labels = { departments: 'Departments', categories: 'Categories', venues: 'Venues' }
          return (
            <button
              key={t}
              onClick={function () { setTab(t); setError(''); setEditing(null) }}
              className={"flex-1 py-2.5 text-sm font-medium transition-colors " +
                (tab === t ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50")}
            >
              {labels[t]}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* ═══ DEPARTMENTS ═══ */}
      {tab === 'departments' && (
        <div className="space-y-4">
          <input type="text" value={deptSearch}
            onChange={function (e) { setDeptSearch(e.target.value) }}
            placeholder="Search departments..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <form onSubmit={addDepartment} className="flex gap-2">
            <input type="text" value={newDept} onChange={function (e) { setNewDept(e.target.value) }}
              placeholder="New department name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" disabled={saving || !newDept.trim()}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              + Add
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {departments.filter(function (dept) {
              return !deptSearch || dept.name.toLowerCase().includes(deptSearch.toLowerCase())
            }).map(function (dept) {
              var isEditing = editing === 'dept-' + dept.id
              var deptCatNames = (dept.category_ids || []).map(function (cid) {
                var c = categories.find(function (cat) { return cat.id === cid })
                return c ? c.name : null
              }).filter(Boolean)
              var deptSubDepts = subDepartments.filter(function (sd) { return sd.department_id === dept.id })

              return (
                <div key={dept.id} className="px-4 py-3 border-b border-gray-100 last:border-0">
                  {isEditing ? (
                    <div className="space-y-3 mb-3">
                      <div className="flex items-center gap-2">
                        <input type="text" value={editVal} onChange={function (e) { setEditVal(e.target.value) }}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          onKeyDown={function (e) { if (e.key === 'Enter') saveEditDept(dept) }} />
                        <button onClick={function () { saveEditDept(dept) }} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white">Save</button>
                        <button onClick={function () { setEditing(null) }} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">Cancel</button>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Inventory Categories</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {categories.filter(function (c) { return c.status === 'approved' }).map(function (cat) {
                            var checked = editDeptCats.includes(cat.id)
                            return (
                              <label key={cat.id} className={"flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                                (checked ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                                <input type="checkbox" checked={checked}
                                  onChange={function () {
                                    setEditDeptCats(function (prev) {
                                      return checked ? prev.filter(function (id) { return id !== cat.id }) : prev.concat([cat.id])
                                    })
                                  }}
                                  className="w-3.5 h-3.5 rounded" />
                                {cat.name}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Expense Categories</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {expTypes.map(function (et) {
                            var checked = editDeptExpTypes.includes(et.id)
                            return (
                              <label key={et.id} className={"flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                                (checked ? "bg-purple-50 border-purple-300 text-purple-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                                <input type="checkbox" checked={checked}
                                  onChange={function () {
                                    setEditDeptExpTypes(function (prev) {
                                      return checked ? prev.filter(function (id) { return id !== et.id }) : prev.concat([et.id])
                                    })
                                  }}
                                  className="w-3.5 h-3.5 rounded" />
                                {et.name}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={"text-sm font-medium " + (dept.active ? "text-gray-800" : "text-gray-400 line-through")}>{dept.name}</span>
                          <span className={"text-xs px-1.5 py-0.5 rounded-full font-medium " +
                            (dept.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                            {dept.active ? 'Active' : 'Inactive'}
                          </span>
                          {deptSubDepts.length > 0 && (
                            <span className="text-xs text-gray-400">{deptSubDepts.length} sub-dept{deptSubDepts.length !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={function () { setEditing('dept-' + dept.id); setEditVal(dept.name); setEditDeptCats(dept.category_ids || []); setEditDeptExpTypes(dept.expense_type_ids || []) }}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">Edit</button>
                          <button onClick={function () { toggleDepartment(dept) }}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                            {dept.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={function () { deleteDepartment(dept) }}
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">Delete</button>
                        </div>
                      </div>
                      {deptCatNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {deptCatNames.map(function (name) {
                            return <span key={name} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">{name}</span>
                          })}
                        </div>
                      )}
                    </div>
                  )}

                      {/* Sub-departments */}
                      {deptSubDepts.map(function (sd) {
                            var sdCats = categories.filter(function (c) { return c.sub_department_id === sd.id })
                            var isEditingSd = editingSubDept && editingSubDept.id === sd.id

                            if (isEditingSd) {
                              // Get categories tagged to this department for selection
                              var deptCatIds = dept.category_ids || []
                              var deptCats = categories.filter(function (c) { return deptCatIds.includes(c.id) && c.status === 'approved' })
                              return (
                                <div key={sd.id} className="text-xs bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-3 space-y-2">
                                  <div className="flex gap-2">
                                    <input type="text" value={editSubDeptCode}
                                      onChange={function (e) { setEditSubDeptCode(e.target.value) }}
                                      placeholder="Code"
                                      className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                                      style={{ fontSize: '16px' }} />
                                    <input type="text" value={editSubDeptName}
                                      onChange={function (e) { setEditSubDeptName(e.target.value) }}
                                      placeholder="Name"
                                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                      style={{ fontSize: '16px' }} />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Assign Categories</label>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                      {deptCats.map(function (cat) {
                                        var checked = editSubDeptCatIds.includes(cat.id)
                                        return (
                                          <label key={cat.id} className={"flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                                            (checked ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                                            <input type="checkbox" checked={checked}
                                              onChange={function () {
                                                setEditSubDeptCatIds(function (prev) {
                                                  return checked ? prev.filter(function (id) { return id !== cat.id }) : prev.concat([cat.id])
                                                })
                                              }}
                                              className="w-3.5 h-3.5 rounded" />
                                            {cat.name}
                                          </label>
                                        )
                                      })}
                                      {deptCats.length === 0 && <span className="text-gray-400">No categories tagged to this department</span>}
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Expense Categories</label>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                      {expTypes.map(function (et) {
                                        var checked = editSubDeptExpTypes.includes(et.id)
                                        return (
                                          <label key={et.id} className={"flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                                            (checked ? "bg-purple-50 border-purple-300 text-purple-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                                            <input type="checkbox" checked={checked}
                                              onChange={function () {
                                                setEditSubDeptExpTypes(function (prev) {
                                                  return checked ? prev.filter(function (id) { return id !== et.id }) : prev.concat([et.id])
                                                })
                                              }}
                                              className="w-3.5 h-3.5 rounded" />
                                            {et.name}
                                          </label>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <div className="flex gap-2 justify-end">
                                    <button onClick={function () { setEditingSubDept(null) }}
                                      className="px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
                                    <button onClick={saveEditSubDept} disabled={saving || !editSubDeptName.trim()}
                                      className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div key={sd.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={"font-medium " + (sd.active ? "text-gray-700" : "text-gray-400")}>{sd.code ? sd.code + ' — ' : ''}{sd.name}</span>
                                  {sdCats.length > 0 && (
                                    <span className="text-gray-400">{sdCats.map(function (c) { return c.name }).join(', ')}</span>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={function () { openEditSubDept(sd) }}
                                    className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">Edit</button>
                                  <button onClick={function () { toggleSubDepartment(sd) }}
                                    className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200">{sd.active ? 'Off' : 'On'}</button>
                                  <button onClick={function () { deleteSubDepartment(sd) }}
                                    className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100">✕</button>
                                </div>
                              </div>
                            )
                          })}

                      {/* Add sub-department inline */}
                      <div className="mt-2 ml-4 flex gap-2">
                        <input type="text" value={newSubDeptCode[dept.id] || ''}
                          onChange={function (e) { setNewSubDeptCode(function (prev) { return Object.assign({}, prev, { [dept.id]: e.target.value }) }) }}
                          placeholder="Code"
                          className="w-16 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase" />
                        <input type="text" value={newSubDept[dept.id] || ''}
                          onChange={function (e) { setNewSubDept(function (prev) { return Object.assign({}, prev, { [dept.id]: e.target.value }) }) }}
                          placeholder="Add sub-department..."
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); addSubDepartment(dept.id) } }} />
                        <button onClick={function () { addSubDepartment(dept.id) }}
                          disabled={!(newSubDept[dept.id] || '').trim() || saving}
                          className="px-2 py-1.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">+ Add</button>
                      </div>
                </div>
              )
            })}
            {departments.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">No departments yet</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ CATEGORIES + SUB-CATEGORIES ═══ */}
      {tab === 'categories' && (
        <div className="space-y-6">
          {/* CSV buttons */}
          <div className="flex justify-end gap-2">
            <button onClick={exportCSV}
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              📤 Export CSV
            </button>
            <label className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer">
              📥 Import CSV
              <input type="file" accept=".csv" onChange={importCSV} className="hidden" />
            </label>
          </div>

          {/* Add category */}
          <input type="text" value={catSearch}
            onChange={function (e) { setCatSearch(e.target.value) }}
            placeholder="Search categories..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <form onSubmit={addCategory} className="flex gap-2 flex-wrap">
            <input type="text" value={newCatCode} onChange={function (e) { setNewCatCode(e.target.value.toUpperCase()) }}
              placeholder="Code (e.g. LGT)"
              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase font-mono" />
            <input type="text" value={newCat} onChange={function (e) { setNewCat(e.target.value) }}
              placeholder="New category name"
              className="flex-1 min-w-[150px] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            {subDepartments.length > 0 && (
              <select value={newCatSubDept}
                onChange={function (e) { setNewCatSubDept(e.target.value) }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">No sub-dept</option>
                {subDepartments.filter(function (sd) { return sd.active }).map(function (sd) {
                  var dept = departments.find(function (d) { return d.id === sd.department_id })
                  return <option key={sd.id} value={sd.id}>{dept?.name ? dept.name + ' → ' : ''}{sd.name}</option>
                })}
              </select>
            )}
            <button type="submit" disabled={saving || !newCat.trim()}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              + Add
            </button>
          </form>

          {/* Category list */}
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {categories.filter(function (cat) {
              return !catSearch || cat.name.toLowerCase().includes(catSearch.toLowerCase()) || (cat.code || '').toLowerCase().includes(catSearch.toLowerCase())
            }).map(function (cat) {
              var subCount = subCategories.filter(function (s) { return s.category_id === cat.id }).length
              var dims = cat.dimension_fields || []
              return (
                <div key={cat.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    {cat.code && (
                      <span className="text-xs font-mono font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{cat.code}</span>
                    )}
                    <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                    {(function () {
                      var sd = subDepartments.find(function (s) { return s.id === cat.sub_department_id })
                      if (!sd) return null
                      var dept = departments.find(function (d) { return d.id === sd.department_id })
                      return <span className="text-[11px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium">{dept?.name ? dept.name + ' → ' : ''}{sd.name}</span>
                    })()}
                    {subCount > 0 && (
                      <span className="text-xs text-gray-400">{subCount} sub-categories</span>
                    )}
                    {dims.length > 0 && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{dims.length} dimensions</span>
                    )}
                    <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded-full " +
                      (cat.consumable === false ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500")}>
                      {cat.consumable === false ? 'Asset' : 'Consumable'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function () { openEditCat(cat) }}
                      className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                      Edit
                    </button>
                    <button onClick={function () { deleteCategory(cat) }}
                      className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
            {categories.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">No categories yet</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ VENUES ═══ */}
      {tab === 'venues' && (
        <div className="space-y-4">
          <input type="text" value={venueSearch}
            onChange={function (e) { setVenueSearch(e.target.value) }}
            placeholder="Search venues..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <form onSubmit={addVenue} className="flex gap-2 flex-wrap">
            <input type="text" value={newVenueCode} onChange={function (e) { setNewVenueCode(e.target.value) }}
              placeholder="Code (e.g. AP)"
              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase" />
            <input type="text" value={newVenueName} onChange={function (e) { setNewVenueName(e.target.value) }}
              placeholder="Venue name"
              className="flex-1 min-w-[150px] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" disabled={saving || !newVenueCode.trim() || !newVenueName.trim()}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              + Add
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {venues.filter(function (v) {
              return !venueSearch || v.name.toLowerCase().includes(venueSearch.toLowerCase()) || v.code.toLowerCase().includes(venueSearch.toLowerCase())
            }).map(function (v) {
              return (
                <div key={v.id} className="px-4 py-3">
                  {editing === 'ven-' + v.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="text" value={editVal} onChange={function (e) { setEditVal(e.target.value.toUpperCase()) }}
                        placeholder="Code" className="w-20 px-2 py-1 border border-gray-300 rounded text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <input type="text" value={editVal2} onChange={function (e) { setEditVal2(e.target.value) }}
                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        onKeyDown={function (e) { if (e.key === 'Enter') saveEditVenue(v) }} />
                      <button onClick={function () { saveEditVenue(v) }} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white">Save</button>
                      <button onClick={function () { setEditing(null) }} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-gray-800 font-mono">{v.code}</span>
                            <span className={"text-sm " + (v.active ? "text-gray-600" : "text-gray-400 line-through")}>{v.name}</span>
                            <span className={"text-xs px-1.5 py-0.5 rounded-full font-medium " +
                              (v.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                              {v.active ? 'Active' : 'Inactive'}
                            </span>
                            {(function () {
                              var vSubs = subVenues.filter(function (sv) { return sv.venue_id === v.id })
                              return vSubs.length > 0 ? <span className="text-xs text-gray-400">{vSubs.length} sub-venue{vSubs.length !== 1 ? 's' : ''}</span> : null
                            })()}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={function () { setEditing('ven-' + v.id); setEditVal(v.code); setEditVal2(v.name) }}
                              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">Edit</button>
                            <button onClick={function () { toggleVenue(v) }}
                              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                              {v.active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={function () { deleteVenue(v) }}
                              className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">Delete</button>
                          </div>
                        </div>

                        {/* Sub-venues */}
                        {(function () {
                          var vSubs = subVenues.filter(function (sv) { return sv.venue_id === v.id })
                          if (vSubs.length === 0 && !newSubVenue[v.id]) return null
                          return (
                            <div className="mt-2 ml-6 space-y-1">
                              {vSubs.map(function (sv) {
                                return (
                                  <div key={sv.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-2">
                                    <span className={"font-medium " + (sv.active ? "text-gray-700" : "text-gray-400")}>{sv.name}</span>
                                    <div className="flex gap-1">
                                      <button onClick={function () { toggleSubVenue(sv) }}
                                        className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200">{sv.active ? 'Off' : 'On'}</button>
                                      <button onClick={function () { deleteSubVenue(sv) }}
                                        className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100">✕</button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}

                        {/* Add sub-venue */}
                        <div className="mt-2 ml-6 flex gap-2">
                          <input type="text" value={newSubVenue[v.id] || ''}
                            onChange={function (e) { setNewSubVenue(function (prev) { return Object.assign({}, prev, { [v.id]: e.target.value }) }) }}
                            placeholder="Add sub-venue..."
                            className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); addSubVenue(v.id) } }} />
                          <button type="button" onClick={function () { addSubVenue(v.id) }}
                            disabled={!(newSubVenue[v.id] || '').trim() || saving}
                            className="px-2 py-1.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">+ Add</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
            {venues.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">No venues yet</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ EDIT CATEGORY MODAL ═══ */}
      <Modal open={!!editCat} onClose={function () { setEditCat(null) }} title={'Edit: ' + (editCat?.name || '')} wide>
        {editCat && (
          <form onSubmit={saveEditCat} className="space-y-5">
            {/* Name & Code */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                <input type="text" value={editCatCode} onChange={function (e) { setEditCatCode(e.target.value.toUpperCase()) }}
                  placeholder="LGT"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase font-mono" />
              </div>
              {subDepartments.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sub-department</label>
                  <select value={editCatSubDept}
                    onChange={function (e) { setEditCatSubDept(e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">None</option>
                    {subDepartments.filter(function (sd) { return sd.active }).map(function (sd) {
                      var dept = departments.find(function (d) { return d.id === sd.department_id })
                      return <option key={sd.id} value={String(sd.id)}>{dept?.name ? dept.name + ' → ' : ''}{sd.name}</option>
                    })}
                  </select>
                </div>
              )}
              <div className="col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Category Name</label>
                <input type="text" value={editCatName} onChange={function (e) { setEditCatName(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            {/* Item Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Item Type</label>
              <div className="flex gap-2">
                <button type="button" onClick={function () { setEditCatConsumable(true) }}
                  className={"flex-1 py-2 text-sm font-bold rounded-md border transition-colors " +
                    (editCatConsumable ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                  🔄 Consumable
                </button>
                <button type="button" onClick={function () { setEditCatConsumable(false) }}
                  className={"flex-1 py-2 text-sm font-bold rounded-md border transition-colors " +
                    (!editCatConsumable ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                  🏷 Asset
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {editCatConsumable ? 'Stock qty will be deducted when issued from requisitions' : 'Stock qty stays unchanged — items are relocated, not consumed'}
              </p>
            </div>

            {/* Expense Categories */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Expense Categories</label>
              <div className="flex flex-wrap gap-2">
                {expTypes.map(function (et) {
                  var checked = editCatExpTypes.includes(et.id)
                  return (
                    <label key={et.id} className={"flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                      (checked ? "bg-purple-50 border-purple-300 text-purple-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                      <input type="checkbox" checked={checked}
                        onChange={function () {
                          if (checked) {
                            setEditCatExpTypes(function (prev) { return prev.filter(function (id) { return id !== et.id }) })
                            var childIds = expSubTypes.filter(function (st) { return st.expense_type_id === et.id }).map(function (st) { return st.id })
                            if (childIds.length > 0) setEditCatExpSubTypes(function (prev) { return prev.filter(function (id) { return childIds.indexOf(id) === -1 }) })
                          } else {
                            setEditCatExpTypes(function (prev) { return prev.concat([et.id]) })
                          }
                        }}
                        className="w-3.5 h-3.5 rounded" />
                      {et.name}
                    </label>
                  )
                })}
              </div>
            </div>
            {/* Expense Sub-Categories (cascading) */}
            {editCatExpTypes.length > 0 && (function () {
              var relevantSubs = expSubTypes.filter(function (st) { return editCatExpTypes.indexOf(st.expense_type_id) !== -1 })
              if (relevantSubs.length === 0) return null
              return (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Expense Sub-Categories</label>
                  <div className="space-y-2">
                    {editCatExpTypes.map(function (etId) {
                      var et = expTypes.find(function (e) { return e.id === etId })
                      if (!et) return null
                      var subs = expSubTypes.filter(function (st) { return st.expense_type_id === etId })
                      if (subs.length === 0) return null
                      return (
                        <div key={etId}>
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">{et.name}</p>
                          <div className="flex flex-wrap gap-2">
                            {subs.map(function (st) {
                              var checked = editCatExpSubTypes.includes(st.id)
                              return (
                                <label key={st.id} className={"flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors " +
                                  (checked ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                                  <input type="checkbox" checked={checked}
                                    onChange={function () {
                                      setEditCatExpSubTypes(function (prev) {
                                        return checked ? prev.filter(function (id) { return id !== st.id }) : prev.concat([st.id])
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded" />
                                  {st.name}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            {/* Sub-categories */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sub-categories</label>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {editCatSubs.length === 0 && (
                  <p className="text-xs text-gray-400">No sub-categories</p>
                )}
               {editCatSubs.map(function (sub) {
                  var isEditingSub = editing === 'sub-' + sub.id
                  return (
                    <div key={sub.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      {isEditingSub ? (
                        <>
                          <input type="text" value={editVal}
                            onChange={function (e) { setEditVal(e.target.value) }}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); saveEditSubCat(sub) } }}
                            style={{ fontSize: '16px' }} />
                          <button type="button" onClick={function () { saveEditSubCat(sub) }}
                            className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                          <button type="button" onClick={function () { setEditing(null) }}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-gray-800">{sub.name}</span>
                          <button type="button" onClick={function () { setEditing('sub-' + sub.id); setEditVal(sub.name) }}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200">Edit</button>
                            
                          <button type="button" onClick={function () { deleteEditSubCat(sub.id) }}
                            className="text-red-400 hover:text-red-600 text-sm">×</button>
                        </>
                      )}
                    </div>
                  )
                })}
                <div className="flex gap-2 pt-1">
                  <input type="text" value={newSubName} onChange={function (e) { setNewSubName(e.target.value) }}
                    placeholder="New sub-category..."
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); addEditSubCat() } }} />
                  <button type="button" onClick={addEditSubCat} disabled={!newSubName.trim()}
                    className="px-3 py-1.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                    + Add
                  </button>
                </div>
              </div>
            </div>

            {/* Dimensions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Dimension Fields</label>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {editCatDims.length === 0 && (
                  <p className="text-xs text-gray-400">No dimensions — items in this category won't show dimension inputs</p>
                )}
                {editCatDims.map(function (dim, i) {
                  var dimType = dim.type || 'number'
                  var typeLabels = { number: '123 Number', text: 'Abc Text', select: '▾ Dropdown' }
                  return (
                    <div key={i} className="space-y-0" draggable={editDimIdx === null}
                      onDragStart={function () { setDragDimIdx(i) }}
                      onDragOver={function (e) { e.preventDefault(); setDragOverIdx(i) }}
                      onDragEnd={function () {
                        if (dragDimIdx !== null && dragOverIdx !== null && dragDimIdx !== dragOverIdx) {
                          setEditCatDims(function (prev) {
                            var arr = prev.slice(); var item = arr.splice(dragDimIdx, 1)[0]; arr.splice(dragOverIdx, 0, item); return arr
                          })
                        }
                        setDragDimIdx(null); setDragOverIdx(null)
                      }}
                      onDragLeave={function () { setDragOverIdx(null) }}>
                      <div className={"bg-white px-3 py-2.5 border space-y-2 transition-all " + (editDimIdx === i ? "rounded-t-lg border-gray-200" : "rounded-lg " + (dragOverIdx === i ? "border-indigo-400 bg-indigo-50" : "border-gray-200"))}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={"text-gray-400 select-none " + (editDimIdx === null ? "cursor-grab active:cursor-grabbing" : "")} title="Drag to reorder">⠿</span>
                            <span className="text-sm font-medium text-gray-800">{dim.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + (dimType === 'number' ? "bg-blue-50 text-blue-600" : dimType === 'text' ? "bg-green-50 text-green-600" : "bg-purple-50 text-purple-600")}>{typeLabels[dimType]}</span>
                            {dimType === 'select' && <button type="button" onClick={function () { editDimIdx === i ? closeDimOptions() : openDimOptions(i) }} className="text-[11px] text-indigo-600 font-semibold hover:text-indigo-800">{(dim.options || []).length} options ⚙</button>}
                            <button type="button" onClick={function () { removeDimField(i) }} className="text-xs text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </div>
                        <div className="flex gap-1 items-center">
                          {['number', 'text', 'select'].map(function (t) {
                            var active = dimType === t
                            var labels = { number: '123', text: 'Abc', select: '▾' }
                            return <button key={t} type="button" onClick={function () { updateDimType(i, t) }} className={"px-2.5 py-1 text-[11px] font-semibold rounded border transition-colors " + (active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-400 hover:bg-gray-50")}>{labels[t] + ' ' + t.charAt(0).toUpperCase() + t.slice(1)}</button>
                          })}
                          <span className="mx-1 text-gray-300">|</span>
                          <button type="button" onClick={function () { setEditCatDims(function (prev) { return prev.map(function (d, j) { if (j !== i) return d; return Object.assign({}, d, { nameGen: !d.nameGen }) }) }) }}
                            className={"px-2.5 py-1 text-[11px] font-semibold rounded border transition-colors " + (dim.nameGen ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-400 hover:bg-gray-50")}>
                            🏷 Name Gen
                          </button>
                        </div>
                      </div>
                      {editDimIdx === i && (
                        <div className="bg-purple-50 rounded-b-lg p-3 border border-t-0 border-purple-200 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-purple-700 uppercase tracking-wider">Options — {dim.name}</p>
                            <button type="button" onClick={saveDimOptions} className="text-xs font-bold text-white bg-purple-600 px-3 py-1 rounded hover:bg-purple-700">✓ Done</button>
                          </div>
                          {editDimOptions.length === 0 && <p className="text-xs text-purple-400">No options yet — add some below</p>}
                          {editDimOptions.map(function (opt, oi) {
                            var isEditingOpt = editing === 'dimopt-' + oi
                            return (
                              <div key={oi} className="flex items-center gap-2 bg-white rounded px-3 py-1.5 border border-purple-100">
                                {isEditingOpt ? (
                                  <>
                                    <input type="text" value={editVal} onChange={function (e) { setEditVal(e.target.value) }}
                                      className="flex-1 px-2 py-1 border border-purple-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                                      onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); if (editVal.trim()) { setEditDimOptions(function (prev) { return prev.map(function (o, j) { return j === oi ? editVal.trim() : o }) }); setEditing(null) } } }}
                                      style={{ fontSize: '16px' }} autoFocus />
                                    <button type="button" onClick={function () { if (editVal.trim()) { setEditDimOptions(function (prev) { return prev.map(function (o, j) { return j === oi ? editVal.trim() : o }) }); setEditing(null) } }}
                                      className="text-xs px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700">Save</button>
                                    <button type="button" onClick={function () { setEditing(null) }}
                                      className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <span className="flex-1 text-sm text-gray-800">{opt}</span>
                                    <button type="button" onClick={function () { setEditing('dimopt-' + oi); setEditVal(opt) }}
                                      className="text-xs text-gray-400 hover:text-indigo-600">✎</button>
                                    <button type="button" onClick={function () { setEditDimOptions(function (prev) { return prev.filter(function (_, j) { return j !== oi }) }) }} className="text-xs text-red-400 hover:text-red-600">✕</button>
                                  </>
                                )}
                              </div>
                            )
                          })}
                          <div className="flex gap-2">
                            <input type="text" value={newDimOption} onChange={function (e) { setNewDimOption(e.target.value) }}
                              placeholder="New option..." className="flex-1 px-2 py-1.5 border border-purple-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                              onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); if (newDimOption.trim()) { setEditDimOptions(function (prev) { return prev.concat([newDimOption.trim()]) }); setNewDimOption('') } } }} />
                            <button type="button" onClick={function () { if (newDimOption.trim()) { setEditDimOptions(function (prev) { return prev.concat([newDimOption.trim()]) }); setNewDimOption('') } }} disabled={!newDimOption.trim()}
                              className="px-3 py-1.5 text-xs text-white bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 font-medium">+ Add</button>
                            <button type="button" onClick={function () { setDimPasteOpen(function (p) { return !p }) }}
                              className={"px-3 py-1.5 text-xs font-medium rounded border transition-colors " + (dimPasteOpen ? "bg-purple-100 border-purple-400 text-purple-700" : "border-purple-200 text-purple-600 hover:bg-purple-50")}>📋 Paste</button>
                          </div>
                          {dimPasteOpen && (
                            <div className="space-y-1.5">
                              <textarea value={dimPasteText} onChange={function (e) { setDimPasteText(e.target.value) }}
                                rows="4" placeholder={"Paste one option per line...\ne.g.\nYellow\nRed\nBlue\nGreen"}
                                className="w-full px-2.5 py-2 border border-purple-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" style={{ fontSize: '16px' }} />
                              <div className="flex gap-2 justify-end">
                                <span className="text-[11px] text-purple-400 self-center">{dimPasteText.trim() ? dimPasteText.trim().split('\n').filter(function (l) { return l.trim() }).length + ' items' : ''}</span>
                                <button type="button" onClick={function () {
                                  var lines = dimPasteText.split('\n').map(function (l) { return l.trim() }).filter(Boolean)
                                  if (lines.length === 0) return
                                  setEditDimOptions(function (prev) {
                                    var existing = prev.map(function (o) { return o.toLowerCase() })
                                    var newOpts = lines.filter(function (l) { return existing.indexOf(l.toLowerCase()) === -1 })
                                    return prev.concat(newOpts)
                                  })
                                  setDimPasteText('')
                                  setDimPasteOpen(false)
                                }} disabled={!dimPasteText.trim()}
                                  className="px-3 py-1.5 text-xs text-white bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 font-medium">Import {dimPasteText.trim() ? dimPasteText.trim().split('\n').filter(function (l) { return l.trim() }).length : 0} Items</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="flex gap-2 pt-1">
                  <input type="text" value={newDimName} onChange={function (e) { setNewDimName(e.target.value) }}
                    placeholder="e.g. Length, Breadth, Width..."
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); addDimField() } }} />
                  <select value={newDimType} onChange={function (e) { setNewDimType(e.target.value) }}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="number">123 Number</option>
                    <option value="text">Abc Text</option>
                    <option value="select">▾ Dropdown</option>
                  </select>
                  <button type="button" onClick={addDimField} disabled={!newDimName.trim()}
                    className="px-3 py-1.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                    + Add
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button type="button" onClick={function () { setEditCat(null) }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Saving...' : 'Save Category'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

export default Categories
