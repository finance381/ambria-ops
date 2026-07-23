import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { useVoice } from '../../hooks/useVoice'
import EventDatePicker from '../../components/ui/EventDatePicker'

function makeEntry() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    expenseTypeId: '',
    expenseSubTypeId: '',
    description: '',
    amount: '',
    taxAmount: '',
    expenseDate: new Date().toISOString().split('T')[0],
    fieldValues: {},
    allocations: [{ departmentId: '', subDepartmentId: '', venueId: '', amountPaise: '' }],
    receiptFiles: [],
    receiptPreviews: [],
    audioBlob: null,
    audioUrl: '',
    recording: false,
    isItemPurchase: false,
    items: [makeItem()]
  }
}

function makeAllocation() {
  return { departmentId: '', subDepartmentId: '', venueId: '', amountPaise: '' }
}

// Compresses image files to under MAX_KB. PDFs / non-images pass through untouched.
async function compressImage(file, maxKB) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return file
  if (file.size <= maxKB * 1024) return file
  try {
    var url = URL.createObjectURL(file)
    var img = new Image()
    await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = url })
    URL.revokeObjectURL(url)
    var maxDim = 1600
    var scale = Math.min(maxDim / img.width, maxDim / img.height, 1)
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    var quality = 0.88
    var blob = null
    for (var i = 0; i < 8; i++) {
      blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', quality) })
      if (!blob) break
      if (blob.size <= maxKB * 1024) break
      quality = quality * 0.72
    }
    if (!blob) return file
    var newName = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (_) {
    return file
  }
}

function makeItem() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemQuery: '',
    itemMatchedId: null,
    itemMatchedSource: null,
    itemMatchedCategoryId: null,
    itemQty: '',
    itemUnit: 'Pieces',
    itemNotes: '',
    itemRate: ''
  }
}

function ExpenseForm({ profile, onDone }) {
  var [expenseTypes, setExpenseTypes] = useState([])
  var [expenseSubTypes, setExpenseSubTypes] = useState([])
  var [departments, setDepartments] = useState([])
  var [venues, setVenues] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [loading, setLoading] = useState(true)
  var [lookupCache, setLookupCache] = useState({})

  var [entries, setEntries] = useState([makeEntry()])
  var [saving, setSaving] = useState(false)
  var [isFunction, setIsFunction] = useState(false)
  var [eventDate, setEventDate] = useState('')
  var [eventId, setEventId] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var voice = useVoice()
  var [error, setError] = useState('')
  var [success, setSuccess] = useState('')
  var [zoomImg, setZoomImg] = useState('')
  var [itemSearchKey, setItemSearchKey] = useState('')
  var [itemMatches, setItemMatches] = useState([])
  var itemSearchTimer = useRef(null)

  useEffect(function () { loadRefData(); ensureLookupData('vendors') }, [])

  async function loadRefData() {
    var [etR, estR, dR, vR, sdR] = await Promise.all([
      supabase.from('expense_types').select('id, name, icon, description, sort_order').eq('active', true).order('sort_order').order('name'),
      supabase.from('expense_sub_types').select('id, expense_type_id, name, extra_fields, active, sort_order').eq('active', true).order('sort_order').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id, departments!inner(hide_from_lists)').eq('active', true).eq('departments.hide_from_lists', false).order('name'),
    ])
    setExpenseTypes(etR.data || [])
    setExpenseSubTypes(estR.data || [])
    var allDepts = dR.data || []
    var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'
    var userDeptIds = profile?.event_dept_ids || []
    setDepartments((isAdminRole || userDeptIds.length === 0) ? allDepts : allDepts.filter(function (d) { return userDeptIds.indexOf(d.id) !== -1 }))
    setVenues(vR.data || [])
    setSubDepartments(sdR.data || [])
    setLoading(false)
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, contract_type, venue_name, session, client_name')
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    setEvents(rows)
    setEventsLoading(false)
    if (rows.length === 1) setEventId(String(rows[0].id))
    else if (!rows.some(function (r) { return String(r.id) === eventId })) setEventId('')
  }

  function toggleFunction(val) {
    setIsFunction(val)
    if (!val) { setEventId(''); setEventDate(''); setEvents([]) }
  }

  // ── Lookup data loader ──
  async function ensureLookupData(source) {
    if (!source || lookupCache[source]) return
    var items = []
    if (source === 'vendors') {
      // Store raw rows — filtered by parent sub-type at render time.
      var { data } = await supabase.from('vendors')
        .select('id, name, contact, phone, expense_type_ids, expense_sub_type_ids').eq('active', true).order('name')
      items = data || []
    } else if (source === 'job_departments') {
      // Store raw rows — filtered by field.allowed_dept_ids at render time.
      var { data: jdData } = await supabase.from('job_departments')
        .select('id, name').eq('active', true).order('name')
      items = jdData || []
    } else if (source === 'staff') {
      var { data: pData } = await supabase.from('profiles').select('id, name').order('name')
      items = (pData || []).map(function (p) { return { label: p.name || '—', value: String(p.id) } })
    } else if (source === 'categories') {
      var { data: cData } = await supabase.from('categories').select('id, name').order('name')
      items = (cData || []).map(function (c) { return { label: c.name, value: String(c.id) } })
    } else if (source === 'venues') {
      var { data: vData } = await supabase.from('venues').select('id, code, name').eq('active', true).order('name')
      items = (vData || []).map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })
    }
    setLookupCache(function (prev) {
      var next = Object.assign({}, prev)
      next[source] = items
      return next
    })
  }

  // ── Entry helpers ──
  function updateEntry(idx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      var copy = Object.assign({}, e)
      copy[field] = val
      if (field === 'expenseTypeId') { copy.expenseSubTypeId = ''; copy.fieldValues = {} }
      if (field === 'expenseSubTypeId') { copy.fieldValues = {} }
      return copy
    })
    setEntries(updated)

    // Pre-fetch lookup data when sub-type changes
    if (field === 'expenseSubTypeId' && val) {
      var st = expenseSubTypes.find(function (s) { return String(s.id) === val })
      if (st && st.extra_fields) {
        st.extra_fields.forEach(function (f) {
          if (f.type === 'lookup' && f.source) ensureLookupData(f.source)
        })
      }
    }
  }

  function addEntry() { setEntries(entries.concat([makeEntry()])) }

  function removeEntry(idx) {
    if (entries.length <= 1) return
    setEntries(entries.filter(function (_, i) { return i !== idx }))
  }

  async function addReceipts(idx, fileList) {
    if (!fileList || fileList.length === 0) return
    var raw = Array.from(fileList)
    var files = []
    for (var i = 0; i < raw.length; i++) {
      var f = await compressImage(raw[i], 100)
      files.push(f)
    }
    setEntries(function (prev) {
      return prev.map(function (e, ii) {
        if (ii !== idx) return e
        var newFiles = e.receiptFiles.concat(files)
        var newPreviews = e.receiptPreviews.concat(files.map(function (fl) { return URL.createObjectURL(fl) }))
        return Object.assign({}, e, { receiptFiles: newFiles, receiptPreviews: newPreviews })
      })
    })
  }

  function removeReceipt(idx, rIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      var url = e.receiptPreviews[rIdx]
      if (url) URL.revokeObjectURL(url)
      return Object.assign({}, e, {
        receiptFiles: e.receiptFiles.filter(function (_, j) { return j !== rIdx }),
        receiptPreviews: e.receiptPreviews.filter(function (_, j) { return j !== rIdx })
      })
    })
    setEntries(updated)
  }

  var mediaRecorders = useRef({})

  function startRecording(idx) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []
      var recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorders.current[idx] = { recorder: recorder, stream: stream }
      recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop() })
        var blob = new Blob(chunks, { type: 'audio/webm' })
        var url = URL.createObjectURL(blob)
        var updated = entries.map(function (e, i) {
          if (i !== idx) return e
          if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
          e.receiptPreviews.forEach(function (u) { URL.revokeObjectURL(u) })
          return Object.assign({}, e, { audioBlob: blob, audioUrl: url, recording: false, receiptFiles: [], receiptPreviews: [] })
        })
        setEntries(updated)
        delete mediaRecorders.current[idx]
      }
      var updated = entries.map(function (e, i) {
        if (i !== idx) return e
        return Object.assign({}, e, { recording: true })
      })
      setEntries(updated)
      recorder.start()
      setTimeout(function () { stopRecording(idx) }, 30000)
    }).catch(function () { setError('Microphone access denied') })
  }

  function stopRecording(idx) {
    var mr = mediaRecorders.current[idx]
    if (mr && mr.recorder.state === 'recording') mr.recorder.stop()
  }

  function removeAudio(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
      return Object.assign({}, e, { audioBlob: null, audioUrl: '', recording: false })
    })
    setEntries(updated)
  }

  // ── Item receipt helpers ──
  function toggleItemPurchase(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      var on = !e.isItemPurchase
      return Object.assign({}, e, {
        isItemPurchase: on,
        items: on ? (e.items && e.items.length > 0 ? e.items : [makeItem()]) : [makeItem()]
      })
    })
    setEntries(updated)
    setItemMatches([])
    setItemSearchKey('')
  }

  function computeItemsTotal(entry) {
    if (!entry || !entry.items) return 0
    var total = 0
    entry.items.forEach(function (it) {
      var qty = Number(it.itemQty) || 0
      var rate = Number(it.itemRate) || 0
      total += qty * rate
    })
    return total
  }

  function addItem(entryIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      return Object.assign({}, e, { items: e.items.concat([makeItem()]) })
    })
    setEntries(updated)
  }

  function removeItem(entryIdx, itemIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      if (e.items.length <= 1) return e
      return Object.assign({}, e, { items: e.items.filter(function (_, j) { return j !== itemIdx }) })
    })
    setEntries(updated)
    var key = entryIdx + '_' + itemIdx
    if (itemSearchKey === key) { setItemMatches([]); setItemSearchKey('') }
  }

  function updateItem(entryIdx, itemIdx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var copy = Object.assign({}, e)
      copy.items = e.items.map(function (it, j) {
        if (j !== itemIdx) return it
        var ic = Object.assign({}, it)
        ic[field] = val
        if (field === 'itemQuery') {
          ic.itemMatchedId = null
          ic.itemMatchedSource = null
          ic.itemMatchedCategoryId = null
        }
        return ic
      })
      return copy
    })
    setEntries(updated)
  }

  function searchInventoryItems(entryIdx, itemIdx, term) {
    setItemSearchKey(entryIdx + '_' + itemIdx)
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.trim().length < 2) { setItemMatches([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      Promise.all([
        supabase.from('inventory_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
        supabase.from('catering_store_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
      ]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
        setItemMatches(inv.concat(cs).slice(0, 8))
      })
    }, 300)
  }

  function pickItemMatch(entryIdx, itemIdx, item) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var copy = Object.assign({}, e)
      copy.items = e.items.map(function (it, j) {
        if (j !== itemIdx) return it
        return Object.assign({}, it, {
          itemQuery: item.name,
          itemMatchedId: item.id,
          itemMatchedSource: item._source,
          itemMatchedCategoryId: item.category_id || null,
          itemUnit: item.unit || it.itemUnit
        })
      })
      return copy
    })
    setEntries(updated)
    setItemMatches([])
    setItemSearchKey('')
  }

  function duplicateEntry(idx) {
    var src = entries[idx]
    var dup = Object.assign({}, src, {
      _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      receiptFiles: [], receiptPreviews: [], audioBlob: null, audioUrl: '', recording: false,
      fieldValues: Object.assign({}, src.fieldValues),
      allocations: src.allocations.map(function (a) { return Object.assign({}, a) }),
      items: (src.items || []).map(function (it) {
        return Object.assign({}, it, { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8) })
      })
    })
    var updated = entries.slice()
    updated.splice(idx + 1, 0, dup)
    setEntries(updated)
  }

  // ── Allocation helpers ──
  function updateAllocation(entryIdx, allocIdx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var copy = Object.assign({}, e)
      copy.allocations = e.allocations.map(function (a, j) {
        if (j !== allocIdx) return a
        var ac = Object.assign({}, a)
        ac[field] = val
        return ac
      })
      return copy
    })
    setEntries(updated)
  }

  function addAllocation(entryIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      return Object.assign({}, e, { allocations: e.allocations.concat([makeAllocation()]) })
    })
    setEntries(updated)
  }

  function removeAllocation(entryIdx, allocIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      if (e.allocations.length <= 1) return e
      return Object.assign({}, e, { allocations: e.allocations.filter(function (_, j) { return j !== allocIdx }) })
    })
    setEntries(updated)
  }

  // ── Sub-type field helpers ──
  function getSubTypeFields(subTypeId) {
    var st = expenseSubTypes.find(function (s) { return s.id === Number(subTypeId) })
    if (!st || !st.extra_fields) return []
    return st.extra_fields.filter(function (f) {
      return !(f.type === 'lookup' && f.source === 'categories')
    })
  }

  function updateFieldValue(entryIdx, key, val) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var fv = Object.assign({}, e.fieldValues)
      fv[key] = val
      return Object.assign({}, e, { fieldValues: fv })
    })
    setEntries(updated)
  }

  function renderDynamicField(field, value, onChange, entry) {
    var cls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400'
    var sty = { fontSize: '16px' }

    if (field.type === 'lookup') {
      var items = []
      if (field.source === 'vendors') {
        // Filter vendors: match on current sub-type, or parent type if tagged at type level.
        var raw = lookupCache.vendors || []
        var subTypeIdNum = entry ? Number(entry.expenseSubTypeId) : 0
        var subType = subTypeIdNum ? expenseSubTypes.find(function (s) { return s.id === subTypeIdNum }) : null
        var parentTypeId = subType ? subType.expense_type_id : 0
        items = raw.filter(function (v) {
          if (!subTypeIdNum) return true
          var stIds = v.expense_sub_type_ids || []
          var tIds = v.expense_type_ids || []
          return stIds.indexOf(subTypeIdNum) !== -1 || (parentTypeId && tIds.indexOf(parentTypeId) !== -1)
        }).map(function (v) {
          var label = v.contact ? v.name + ' — ' + v.contact : v.name
          return { label: label, value: v.name }
        })
      } else if (field.source === 'job_departments') {
        // Filter to admin-configured allowed depts (empty list ⇒ show all).
        var rawDepts = lookupCache.job_departments || []
        var allowedIds = field.allowed_dept_ids || []
        items = rawDepts.filter(function (d) {
          if (allowedIds.length === 0) return true
          return allowedIds.indexOf(d.id) !== -1
        }).map(function (d) { return { label: d.name, value: String(d.id) } })
      } else {
        items = lookupCache[field.source] || []
      }
      return (
        <SearchDropdown
          key={field.key}
          label={field.label + (field.required ? ' *' : '')}
          items={items}
          value={value || ''}
          onChange={onChange}
          placeholder={'Select ' + field.label + '...'}
        />
      )
    }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <select value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls + ' bg-white'} style={sty}>
            <option value="">Select...</option>
            {(field.options || []).map(function (opt) { return <option key={opt} value={opt}>{opt}</option> })}
          </select>
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={value || ''} onChange={function (e) { onChange(e.target.value) }} rows={2} className={cls + ' resize-none'} style={sty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls} style={sty} />
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
      </div>
    )
  }

  // ── Validation ──
  function validateEntries() {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.expenseTypeId) return 'Entry ' + (i + 1) + ': Select expense type'
      if (!e.expenseSubTypeId) return 'Entry ' + (i + 1) + ': Select sub-type'
      if (!e.description.trim()) return 'Entry ' + (i + 1) + ': Add description'
      if (!e.isItemPurchase && (!e.amount || Number(e.amount) <= 0)) return 'Entry ' + (i + 1) + ': Enter valid amount'
      if (!e.expenseDate) return 'Entry ' + (i + 1) + ': Select date'
      var _toYMD = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
      var _todayStr = _toYMD(new Date())
      var _minStr = _toYMD(new Date(Date.now() - 3 * 86400000))
      if (e.expenseDate > _todayStr) return 'Entry ' + (i + 1) + ': Future dates require a requisition, not a direct expense'
      if (e.expenseDate < _minStr) return 'Entry ' + (i + 1) + ': Date is more than 3 days old — contact admin or raise a requisition'
      var fields = getSubTypeFields(e.expenseSubTypeId)
      for (var f = 0; f < fields.length; f++) {
        if (fields[f].required && !(e.fieldValues[fields[f].key] || '').toString().trim()) {
          return 'Entry ' + (i + 1) + ': ' + fields[f].label + ' is required'
        }
      }
      if (e.isItemPurchase) {
        if (!e.items || e.items.length === 0) return 'Entry ' + (i + 1) + ': Add at least one item'
        for (var it = 0; it < e.items.length; it++) {
          var im = e.items[it]
          var itLabel = 'Entry ' + (i + 1) + ' \u00b7 Item ' + (it + 1)
          if (!im.itemQuery || !im.itemQuery.trim()) return itLabel + ': Item name required'
          if (!im.itemQty || Number(im.itemQty) <= 0) return itLabel + ': Qty must be > 0'
          if (!im.itemUnit) return itLabel + ': Unit required'
          if (im.itemRate === '' || im.itemRate === null || im.itemRate === undefined || Number(im.itemRate) < 0) return itLabel + ': Rate required'
        }
        if (computeItemsTotal(e) <= 0) return 'Entry ' + (i + 1) + ': Items total must be > 0'
      }
      if (e.receiptFiles.length === 0 && !e.audioBlob) return 'Entry ' + (i + 1) + ': Receipt image or voice note is required'
    }
    return null
  }

  // ── Submit ──
  async function handleSubmit() {
    if (saving) return
    setError('')
    setSuccess('')
    var valErr = validateEntries()
    if (valErr) { setError(valErr); return }

    setSaving(true)
    var submitted = 0
    var failed = 0
    var batchId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null

    try {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        var paise = e.isItemPurchase
          ? Math.round(computeItemsTotal(e) * 100)
          : Math.round(Number(e.amount) * 100)

        try {
          var meta = Object.assign({}, e.fieldValues)
          if (e.isItemPurchase) {
            meta.item_receipts = e.items.map(function (im) {
              var qtyN = Number(im.itemQty) || 0
              var rateN = Number(im.itemRate) || 0
              return {
                query: (im.itemQuery || '').trim(),
                matched_item_id: im.itemMatchedId,
                matched_source: im.itemMatchedSource,
                matched_category_id: im.itemMatchedCategoryId,
                qty: qtyN,
                unit: im.itemUnit,
                notes: (im.itemNotes || '').trim() || null,
                rate_paise: Math.round(rateN * 100),
                line_total_paise: Math.round(qtyN * rateN * 100),
                resulting_item_id: null,
                received_by: null,
                received_at: null,
                cancel_reason: null
              }
            })
          }
          var payload = {
            user_id: profile.id,
            batch_id: batchId,
            expense_type_id: Number(e.expenseTypeId),
            expense_sub_type_id: Number(e.expenseSubTypeId),
            amount_paise: paise,
            tax_paise: e.taxAmount ? Math.round(Number(e.taxAmount) * 100) : 0,
            description: e.description.trim(),
            expense_date: e.expenseDate,
            status: 'recorded',
            event_id: eventId ? Number(eventId) : null,
            metadata: meta,
            vendor_name: e.fieldValues.vendor_name || null,
            travel_from: e.fieldValues.travel_from || null,
            travel_to: e.fieldValues.travel_to || null,
            travel_mode: e.fieldValues.travel_mode || null,
            item_receipt_status: e.isItemPurchase ? 'pending' : null,
          }

          var { data: exp, error: insErr } = await supabase.from('expenses').insert(payload).select('id').single()
          if (insErr || !exp) { failed++; continue }

          if (e.receiptFiles && e.receiptFiles.length > 0) {
            var uploadedPaths = []
            var uploadErrors = []
            for (var f = 0; f < e.receiptFiles.length; f++) {
              var file = e.receiptFiles[f]
              var ext = (file.name && file.name.indexOf('.') !== -1) ? file.name.split('.').pop() : 'jpg'
              var rPath = profile.id + '/' + exp.id + '_' + Date.now() + '_' + f + '.' + ext
              var { error: upErr } = await supabase.storage.from('receipts').upload(rPath, file, { upsert: true })
              if (upErr) {
                uploadErrors.push('File ' + (f + 1) + ' (' + (file.name || 'unnamed') + '): ' + upErr.message)
              } else {
                uploadedPaths.push(rPath)
              }
            }
            if (uploadedPaths.length > 0) {
              var { error: updErr } = await supabase.rpc('attach_expense_receipts', {
                p_expense_id: exp.id,
                p_paths: uploadedPaths
              })
              if (updErr) uploadErrors.push('Save paths failed: ' + updErr.message)
            }
            if (uploadErrors.length > 0) {
              setError('Expense saved but ' + uploadErrors.length + ' receipt(s) failed to attach:\n' + uploadErrors.join('\n') + '\n\nEdit the expense to re-attach.')
              setSaving(false)
              return
            }
          }

          if ((!e.receiptFiles || e.receiptFiles.length === 0) && e.audioBlob) {
            var aPath = profile.id + '/' + exp.id + '_voice_' + Date.now() + '.webm'
            var { error: aErr } = await supabase.storage.from('receipts').upload(aPath, e.audioBlob, { contentType: 'audio/webm', upsert: true })
            if (aErr) {
              setError('Voice upload failed: ' + aErr.message); setSaving(false); return
            }
            var { error: aRpcErr } = await supabase.rpc('attach_expense_receipts', {
              p_expense_id: exp.id,
              p_paths: [aPath]
            })
            if (aRpcErr) {
              setError('Voice attach failed: ' + aRpcErr.message); setSaving(false); return
            }
          }

          var allocRows = e.allocations
            .filter(function (a) { return a.venueId || a.departmentId })
            .map(function (a) {
              return {
                expense_id: exp.id,
                department: a.departmentId ? (departments.find(function (d) { return String(d.id) === a.departmentId }) || {}).name || null : null,
                department_id: a.departmentId ? Number(a.departmentId) : null,
                sub_department_id: a.subDepartmentId ? Number(a.subDepartmentId) : null,
                venue_id: a.venueId ? Number(a.venueId) : null,
                amount_paise: a.amountPaise ? Math.round(Number(a.amountPaise) * 100) : 0
              }
            })
          if (allocRows.length > 0) await supabase.from('expense_allocations').insert(allocRows)

          try {
            await supabase.rpc('wallet_self_debit', {
              p_amount_paise: paise,
              p_description: 'Expense: ' + e.description.trim().slice(0, 50),
              p_ref_type: 'expense',
              p_ref_id: String(exp.id),
            })
          } catch (_) {}

          try { await logActivity('EXPENSE_SUBMIT', (paise / 100) + ' pts | ' + e.description.trim().slice(0, 50)) } catch (_) {}
          submitted++
        } catch (_) { failed++ }
      }
    } finally { setSaving(false) }

    if (failed > 0 && submitted > 0) {
      setError(failed + ' failed, ' + submitted + ' submitted')
    } else if (failed > 0) {
      setError('All ' + failed + ' entries failed to submit')
    } else {
      setSuccess(submitted + ' expense' + (submitted > 1 ? 's' : '') + ' submitted')
      setTimeout(function () { setEntries([makeEntry()]); if (onDone) onDone() }, 1500)
    }
  }

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      {success && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{success}</div>}

      {/* For a Function? */}
      <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">For a Function?</label>
          <button type="button" onClick={function () { toggleFunction(!isFunction) }} className="flex items-center gap-2">
            <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-500" : "bg-gray-300")}>
              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
            </div>
          </button>
        </div>
        {isFunction && (
          <div className="space-y-2">
            <EventDatePicker label="Function Date" value={eventDate}
              onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
            {eventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
            {eventDate && !eventsLoading && events.length === 0 && <p className="text-xs text-gray-400">No events on this date</p>}
            {events.length > 0 && (
              <select value={eventId} onChange={function (e) { setEventId(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                <option value="">Select event...</option>
                {events.map(function (ev) { return <option key={ev.id} value={String(ev.id)}>{ev.event_name + ' · ' + (ev.venue_name || '')}</option> })}
              </select>
            )}
            {(function () {
              var sel = eventId ? events.find(function (ev) { return String(ev.id) === eventId }) : null
              if (!sel) return null
              return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-bold text-indigo-700">{sel.event_name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-indigo-600">
                    {sel.function_date && <span>📅 {sel.function_date}</span>}
                    {sel.contract_type && <span>🎉 {sel.contract_type}</span>}
                    {sel.venue_name && <span>📍 {sel.venue_name}</span>}
                    {sel.session && <span>🕐 {sel.session}</span>}
                    {sel.client_name && <span>👤 {sel.client_name}</span>}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {entries.map(function (entry, idx) {
        var isAdminEst = profile?.role === 'admin' || profile?.role === 'auditor'
        var userEstIds = profile?.expense_sub_type_ids || []
        var subTypesForType = expenseSubTypes.filter(function (st) {
          if (st.expense_type_id !== Number(entry.expenseTypeId)) return false
          if (!isAdminEst && userEstIds.indexOf(st.id) === -1) return false
          return true
        })
        var subTypeFields = entry.expenseSubTypeId ? getSubTypeFields(entry.expenseSubTypeId) : []

        return (
          <div key={entry._key} className="border border-amber-200 rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200">
              <span className="font-semibold text-amber-900 text-sm">{'Expense #' + (idx + 1)}</span>
              <div className="flex gap-1">
                <button type="button" onClick={function () { duplicateEntry(idx) }}
                  className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200" title="Duplicate">📋</button>
                {entries.length > 1 && (
                  <button type="button" onClick={function () { removeEntry(idx) }}
                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200" title="Remove">✕</button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Expense Type */}
              {(function () {
                var isAdminEt = profile?.role === 'admin' || profile?.role === 'auditor'
                var userEtIds = profile?.expense_type_ids || []
                var typeList = isAdminEt ? expenseTypes : expenseTypes.filter(function (et) { return userEtIds.indexOf(et.id) !== -1 })
                return (
                  <div>
                    <SearchDropdown
                      label="Expense Type"
                      items={typeList.map(function (et) { return { label: (et.icon ? et.icon + ' ' : '') + et.name, value: String(et.id) } })}
                      value={entry.expenseTypeId}
                      onChange={function (val) { updateEntry(idx, 'expenseTypeId', val) }}
                      placeholder="Search or select type..."
                    />
                  </div>
                )
              })()}

              {/* Sub-Type */}
              {entry.expenseTypeId && subTypesForType.length > 0 && (
                <div>
                  <SearchDropdown
                    label="Sub-Type"
                    items={subTypesForType.map(function (st) { return { label: st.name, value: String(st.id) } })}
                    value={entry.expenseSubTypeId}
                    onChange={function (val) { updateEntry(idx, 'expenseSubTypeId', val) }}
                    placeholder="Search or select sub-type..."
                  />
                </div>
              )}

              {/* Auto-select if only 1 sub-type */}
              {entry.expenseTypeId && subTypesForType.length === 1 && !entry.expenseSubTypeId && (function () {
                setTimeout(function () { updateEntry(idx, 'expenseSubTypeId', String(subTypesForType[0].id)) }, 0)
                return null
              })()}

              {/* No sub-types warning */}
              {entry.expenseTypeId && subTypesForType.length === 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No sub-types configured for this type. Contact admin.</p>
              )}

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Description</label>
                  <button type="button"
                    onClick={function () {
                      if (voice.listening) { voice.stop() }
                      else { voice.start(function (text) { updateEntry(idx, 'description', entry.description + (entry.description ? ' ' : '') + text) }) }
                    }}
                    className={"px-2 py-0.5 rounded text-xs font-medium transition-all " +
                      (voice.listening ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}
                  >{voice.listening ? '⏹ Stop' : '🎤 Dictate'}</button>
                </div>
                <textarea value={entry.description} onChange={function (e) { updateEntry(idx, 'description', e.target.value) }}
                  placeholder="What was this expense for..." rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 resize-none" />
              </div>

              {/* Dynamic fields from sub-type */}
              {subTypeFields.map(function (field) {
                return renderDynamicField(field, entry.fieldValues[field.key] || '', function (val) {
                  updateFieldValue(idx, field.key, val)
                }, entry)
              })}

              {/* Date — gated to today ± 3 days back */}
              {(function () {
                var toYMD = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
                var today = toYMD(new Date())
                var minDate = toYMD(new Date(Date.now() - 3 * 86400000))
                return (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                    <input type="date" value={entry.expenseDate} min={minDate} max={today}
                      onChange={function (e) { updateEntry(idx, 'expenseDate', e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                    <p className="text-[10px] text-gray-500 mt-1">Today or up to 3 days back. For future expenses, raise a requisition instead.</p>
                  </div>
                )
              })()}

              {/* Item purchase toggle + fields */}
              <div className={"border rounded-lg p-3 transition-colors " + (entry.isItemPurchase ? "border-indigo-200 bg-indigo-50/40" : "border-gray-100 bg-gray-50")}>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-gray-700">📦 Item Select</label>
                    <p className="text-[10px] text-gray-400 mt-0.5">Item enters inventory via receiver</p>
                  </div>
                  <button type="button" onClick={function () { toggleItemPurchase(idx) }} className="flex items-center">
                    <div className={"relative w-9 h-5 rounded-full transition-colors " + (entry.isItemPurchase ? "bg-indigo-500" : "bg-gray-300")}>
                      <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (entry.isItemPurchase ? "translate-x-4" : "translate-x-0.5")} />
                    </div>
                  </button>
                </div>

                {entry.isItemPurchase && (
                  <div className="mt-3 space-y-3">
                    {entry.items.map(function (im, iIdx) {
                      var key = idx + '_' + iIdx
                      var lineTotal = (Number(im.itemQty) || 0) * (Number(im.itemRate) || 0)
                      return (
                        <div key={im._key} className="border border-indigo-100 rounded-lg bg-white p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-indigo-700">Item #{iIdx + 1}</span>
                            {entry.items.length > 1 && (
                              <button type="button" onClick={function () { removeItem(idx, iIdx) }}
                                className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100" title="Remove item">✕</button>
                            )}
                          </div>

                          {/* Item name search */}
                          <div className="relative">
                            <label className="block text-xs font-medium text-gray-600 mb-1">Item Name <span className="text-red-500">*</span>{im.itemMatchedId && <span className="ml-2 text-[10px] font-bold text-green-600">✓ Matched existing</span>}</label>
                            <input type="text" value={im.itemQuery}
                              onChange={function (e) { updateItem(idx, iIdx, 'itemQuery', e.target.value); searchInventoryItems(idx, iIdx, e.target.value) }}
                              onFocus={function () { if (im.itemQuery && im.itemQuery.length >= 2) searchInventoryItems(idx, iIdx, im.itemQuery) }}
                              placeholder="Search or type new item name..."
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                            {itemSearchKey === key && itemMatches.length > 0 && (
                              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                                {itemMatches.map(function (m) {
                                  return (
                                    <button key={m._source + '_' + m.id} type="button"
                                      onMouseDown={function (evt) { evt.preventDefault(); pickItemMatch(idx, iIdx, m) }}
                                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-0">
                                      <div className="text-sm text-gray-800 font-medium truncate">{m.name}</div>
                                      <div className="text-[10px] text-gray-400">{m._source === 'catering_store' ? 'Catering Store' : 'Inventory'}{m.unit ? ' · ' + m.unit : ''}</div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {im.itemQuery && !im.itemMatchedId && itemMatches.length === 0 && itemSearchKey === key && im.itemQuery.length >= 2 && (
                              <p className="text-[10px] text-amber-600 mt-1">No match — receiver will create as new inventory item</p>
                            )}
                          </div>

                          {/* Qty + Unit */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Qty <span className="text-red-500">*</span></label>
                              <input type="number" inputMode="numeric" value={im.itemQty}
                                onChange={function (e) { updateItem(idx, iIdx, 'itemQty', e.target.value) }}
                                placeholder="0" min="0" step="any"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                              <select value={im.itemUnit}
                                onChange={function (e) { updateItem(idx, iIdx, 'itemUnit', e.target.value) }}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                                {['Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens', 'Kg', 'Grams', 'Liters', 'ML', 'Meters', 'Feet', 'Rolls', 'Packets', 'Bags', 'Boxes', 'Cartons', 'Bottles', 'Sheets', 'Reams'].map(function (u) {
                                  return <option key={u} value={u}>{u}</option>
                                })}
                              </select>
                            </div>
                          </div>

                          {/* Notes + Rate */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Notes <span className="text-gray-400">(brand, size, spec)</span></label>
                              <input type="text" value={im.itemNotes}
                                onChange={function (e) { updateItem(idx, iIdx, 'itemNotes', e.target.value) }}
                                placeholder="e.g. White ceramic, 10-inch round"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Rate (pts) <span className="text-red-500">*</span></label>
                              <input type="number" inputMode="decimal" value={im.itemRate}
                                onChange={function (e) { updateItem(idx, iIdx, 'itemRate', e.target.value) }}
                                placeholder="0" min="0" step="any"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                            </div>
                          </div>

                          {lineTotal > 0 && (
                            <div className="flex items-center justify-end pt-1 border-t border-gray-100">
                              <span className="text-[11px] text-gray-500">Line total:&nbsp;</span>
                              <span className="text-xs font-bold text-indigo-700">{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    <button type="button" onClick={function () { addItem(idx) }}
                      className="w-full py-2 rounded-lg border-2 border-dashed border-indigo-300 text-indigo-600 text-xs font-semibold hover:bg-indigo-50 transition-colors">
                      + Add Item
                    </button>
                  </div>
                )}
              </div>

              {/* Allocations — hidden in Item Select mode */}
              {!entry.isItemPurchase && (
              <div className="border border-gray-100 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Allocations</label>
                  <button type="button" onClick={function () { addAllocation(idx) }}
                    className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium">+ Row</button>
                </div>
                <div className="space-y-2">
                  {entry.allocations.map(function (alloc, aIdx) {
                    var allocSubDepts = alloc.departmentId ? subDepartments.filter(function (sd) { return sd.department_id === Number(alloc.departmentId) }) : []
                    var allocDept = alloc.departmentId ? departments.find(function (d) { return String(d.id) === alloc.departmentId }) : null
                    var allocIsVenue = allocDept && allocDept.name.toLowerCase().indexOf('venue') === 0
                    return (
                      <div key={aIdx} className="flex gap-2 items-start">
                        <div className="flex-1 space-y-1.5">
                          <div className="grid grid-cols-2 gap-2">
                            <select value={alloc.departmentId}
                              onChange={function (e) { setEntries(function (prev) { return prev.map(function (en, i) { if (i !== idx) return en; var copy = Object.assign({}, en); copy.allocations = en.allocations.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { departmentId: e.target.value, subDepartmentId: '', venueId: '' }) : a }); return copy }) }) }}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                              <option value="">Dept</option>
                              {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                            </select>
                            {allocIsVenue ? (
                              <select value={alloc.venueId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Venue</option>
                                {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code + ' — ' + v.name}</option> })}
                              </select>
                            ) : allocSubDepts.length > 0 ? (
                              <select value={alloc.subDepartmentId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'subDepartmentId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Sub-dept</option>
                                {allocSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                              </select>
                            ) : <div />}
                          </div>
                          <div className={"grid gap-2 " + (allocIsVenue ? "" : "grid-cols-2")}>
                            {!allocIsVenue && (
                              <select value={alloc.venueId}
                                onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                                <option value="">Venue</option>
                                {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code}</option> })}
                              </select>
                            )}
                            <input type="number" inputMode="numeric" value={alloc.amountPaise}
                              onChange={function (e) { updateAllocation(idx, aIdx, 'amountPaise', e.target.value) }}
                              placeholder="Amt" className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                          </div>
                        </div>
                        {entry.allocations.length > 1 && (
                          <button type="button" onClick={function () { removeAllocation(idx, aIdx) }}
                            className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              )}

              {/* Amount + GST + Gross Total — bottom */}
              <div className="border border-amber-200 rounded-lg bg-amber-50/40 p-3 space-y-2">
                {entry.isItemPurchase && (
                  <p className="text-[10px] text-amber-700 font-semibold">Amount auto-calculated from items × rate</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts) <span className="text-red-500">*</span></label>
                    <input type="number" inputMode="decimal"
                      value={entry.isItemPurchase ? computeItemsTotal(entry).toString() : entry.amount}
                      onChange={function (e) { if (!entry.isItemPurchase) updateEntry(idx, 'amount', e.target.value) }}
                      readOnly={entry.isItemPurchase}
                      placeholder="0" min="0" step="any"
                      className={"w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-300 " + (entry.isItemPurchase ? "border-amber-200 bg-amber-100/60 text-gray-700 font-semibold cursor-not-allowed" : "border-gray-200 bg-white")}
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">GST Amount (pts)</label>
                    <input type="number" inputMode="decimal" value={entry.taxAmount}
                      onChange={function (e) { updateEntry(idx, 'taxAmount', e.target.value) }}
                      placeholder="0" min="0" step="any"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }} />
                  </div>
                </div>
                {(function () {
                  var amt = entry.isItemPurchase ? computeItemsTotal(entry) : (Number(entry.amount) || 0)
                  var gst = Number(entry.taxAmount) || 0
                  var gross = amt + gst
                  return (
                    <div className="flex items-center justify-between pt-2 border-t border-amber-200">
                      <span className="text-xs font-semibold text-gray-600">Gross Total</span>
                      <span className="text-base font-bold text-amber-800">{gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                    </div>
                  )
                })()}
              </div>

              {/* Receipt */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Receipt <span className="text-red-500">*</span></label>
                {entry.receiptFiles.length > 0 ? (
                  <div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {entry.receiptPreviews.map(function (url, rIdx) {
                        var file = entry.receiptFiles[rIdx]
                        var isPdf = file && file.type === 'application/pdf'
                        return (
                          <div key={rIdx} className="relative">
                            {isPdf ? (
                              <div className="h-24 rounded-lg border border-gray-200 bg-gray-50 flex flex-col items-center justify-center text-gray-500 px-1">
                                <span className="text-2xl">📄</span>
                                <span className="text-[10px] truncate max-w-full">{file.name}</span>
                              </div>
                            ) : (
                              <img src={url} alt={"Receipt " + (rIdx + 1)}
                                onClick={function () { setZoomImg(url) }}
                                className="h-24 w-full rounded-lg border border-gray-200 object-cover cursor-pointer active:opacity-80" />
                            )}
                            <button type="button" onClick={function () { removeReceipt(idx, rIdx) }}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-sm hover:bg-red-600">✕</button>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 text-center mb-2">{entry.receiptFiles.length} receipt{entry.receiptFiles.length > 1 ? 's' : ''} attached · tap image to enlarge</p>
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                        <span>📁</span><span>+ Add More</span>
                        <input type="file" accept="image/*,.pdf" multiple className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                        <span>📷</span><span>+ Photo</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                      </label>
                    </div>
                  </div>
                ) : entry.audioUrl ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <audio src={entry.audioUrl} controls className="flex-1 h-8" />
                    <button type="button" onClick={function () { removeAudio(idx) }}
                      className="w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600 flex-shrink-0">✕</button>
                  </div>
                ) : entry.recording ? (
                  <button type="button" onClick={function () { stopRecording(idx) }}
                    className="w-full py-3 rounded-lg bg-red-500 text-white text-sm font-medium animate-pulse flex items-center justify-center gap-2">
                    <span className="w-2.5 h-2.5 bg-white rounded-full" />Recording... Tap to stop
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📁</span><span>Gallery</span>
                      <input type="file" accept="image/*,.pdf" multiple className="hidden"
                        onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                    </label>
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📷</span><span>Camera</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={function (e) { addReceipts(idx, e.target.files); e.target.value = '' }} />
                    </label>
                    <button type="button" onClick={function () { startRecording(idx) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                      <span>🎙</span><span>Voice</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Add entry + Submit bar */}
      <div className="flex gap-3">
        <button type="button" onClick={addEntry}
          className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-700 font-medium text-sm hover:bg-amber-50 transition-colors">
          + Add Another Expense
        </button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className={'flex-1 py-2.5 rounded-xl font-semibold text-sm text-white shadow-sm transition-all ' +
            (saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 active:scale-[0.98]')}>
          {saving ? 'Submitting...' : 'Submit ' + entries.length + ' Expense' + (entries.length > 1 ? 's' : '')}
        </button>
      </div>

      {zoomImg && (
        <div onClick={function () { setZoomImg('') }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" style={{ margin: 0 }}>
          <button onClick={function () { setZoomImg('') }}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 text-white rounded-full text-xl flex items-center justify-center hover:bg-white/30">✕</button>
          <img src={zoomImg} alt="Receipt" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  )
}

export default ExpenseForm
