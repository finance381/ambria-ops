import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'

function makeEntry() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    categoryId: '',
    subCategoryId: '',
    expenseTypeId: '',
    description: '',
    amount: '',
    expenseDate: new Date().toISOString().split('T')[0],
    vendorName: '',
    travelMode: '',
    travelFrom: '',
    travelTo: '',
    allocations: [{ department: '', venueId: '', subVenueId: '', amountPaise: '' }],
    receiptFile: null,
    receiptPreview: '',
    audioBlob: null,
    audioUrl: '',
    recording: false
  }
}



function makeAllocation() {
  return { department: '', venueId: '', subVenueId: '', amountPaise: '' }
}

function ExpenseForm({ profile, onDone }) {
  // ── Reference data ──
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [expenseTypes, setExpenseTypes] = useState([])
  var [departments, setDepartments] = useState([])
  var [venues, setVenues] = useState([])
  var [subVenues, setSubVenues] = useState([])
  var [loading, setLoading] = useState(true)

  // ── Form state ──
  var [entries, setEntries] = useState([makeEntry()])
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [success, setSuccess] = useState('')

  useEffect(function () {
    loadRefData()
  }, [])

  async function loadRefData() {
    var [catR, scR, etR, dR, vR, svR] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, category_id, name').order('name'),
      supabase.from('expense_types').select('id, name, extra_fields, sort_order').eq('active', true).order('sort_order'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
      supabase.from('sub_venues').select('id, venue_id, name').eq('active', true).order('name')
    ])
    setCategories(catR.data || [])
    setSubCategories(scR.data || [])
    setExpenseTypes(etR.data || [])
    setDepartments(dR.data || [])
    setVenues(vR.data || [])
    setSubVenues(svR.data || [])
    setLoading(false)
  }

  // ── Entry helpers ──

  function updateEntry(idx, field, val) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      var copy = Object.assign({}, e)
      copy[field] = val
      if (field === 'categoryId') copy.subCategoryId = ''
      if (field === 'expenseTypeId') {
        copy.vendorName = ''
        copy.travelMode = ''
        copy.travelFrom = ''
        copy.travelTo = ''
      }
      return copy
    })
    setEntries(updated)
  }

  function addEntry() {
    setEntries(entries.concat([makeEntry()]))
  }

  function removeEntry(idx) {
    if (entries.length <= 1) return
    setEntries(entries.filter(function (_, i) { return i !== idx }))
  }

  function handleReceipt(idx, file) {
    if (!file) return
    var preview = URL.createObjectURL(file)
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.receiptPreview) URL.revokeObjectURL(e.receiptPreview)
      return Object.assign({}, e, { receiptFile: file, receiptPreview: preview })
    })
    setEntries(updated)
  }

  function removeReceipt(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.receiptPreview) URL.revokeObjectURL(e.receiptPreview)
      return Object.assign({}, e, { receiptFile: null, receiptPreview: '' })
    })
    setEntries(updated)
  }

  var mediaRecorders = {}

  function startRecording(idx) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []
      var recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorders[idx] = { recorder: recorder, stream: stream }

      recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop() })
        var blob = new Blob(chunks, { type: 'audio/webm' })
        var url = URL.createObjectURL(blob)
        var updated = entries.map(function (e, i) {
          if (i !== idx) return e
          if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
          return Object.assign({}, e, { audioBlob: blob, audioUrl: url, recording: false, receiptFile: null, receiptPreview: '' })
        })
        setEntries(updated)
        delete mediaRecorders[idx]
      }

      var updated = entries.map(function (e, i) {
        if (i !== idx) return e
        return Object.assign({}, e, { recording: true })
      })
      setEntries(updated)
      recorder.start()

      // Auto-stop after 30 seconds
      setTimeout(function () { stopRecording(idx) }, 30000)
    }).catch(function () {
      setError('Microphone access denied')
    })
  }

  function stopRecording(idx) {
    var mr = mediaRecorders[idx]
    if (mr && mr.recorder.state === 'recording') {
      mr.recorder.stop()
    }
  }

  function removeAudio(idx) {
    var updated = entries.map(function (e, i) {
      if (i !== idx) return e
      if (e.audioUrl) URL.revokeObjectURL(e.audioUrl)
      return Object.assign({}, e, { audioBlob: null, audioUrl: '', recording: false })
    })
    setEntries(updated)
  }

  function duplicateEntry(idx) {
    var src = entries[idx]
    var dup = Object.assign({}, src, {
      _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      receiptFile: null,
      receiptPreview: '',
      audioBlob: null,
      audioUrl: '',
      recording: false,
      allocations: src.allocations.map(function (a) { return Object.assign({}, a) })
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
        if (field === 'venueId') ac.subVenueId = ''
        return ac
      })
      return copy
    })
    setEntries(updated)
  }

  function addAllocation(entryIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      var copy = Object.assign({}, e)
      copy.allocations = e.allocations.concat([makeAllocation()])
      return copy
    })
    setEntries(updated)
  }

  function removeAllocation(entryIdx, allocIdx) {
    var updated = entries.map(function (e, i) {
      if (i !== entryIdx) return e
      if (e.allocations.length <= 1) return e
      var copy = Object.assign({}, e)
      copy.allocations = e.allocations.filter(function (_, j) { return j !== allocIdx })
      return copy
    })
    setEntries(updated)
  }

  // ── Type-specific field check ──

  function typeHasField(typeId, fieldName) {
    var t = expenseTypes.find(function (et) { return et.id === Number(typeId) })
    if (!t || !t.extra_fields) return false
    return t.extra_fields.indexOf(fieldName) !== -1
  }

  function getTypeName(typeId) {
    var t = expenseTypes.find(function (et) { return et.id === Number(typeId) })
    return t ? t.name : ''
  }

  // ── Validation ──

  function validateEntries() {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.categoryId) return 'Entry ' + (i + 1) + ': Select a category'
      if (!e.expenseTypeId) return 'Entry ' + (i + 1) + ': Select expense type'
      if (!e.description.trim()) return 'Entry ' + (i + 1) + ': Add description'
      if (!e.amount || Number(e.amount) <= 0) return 'Entry ' + (i + 1) + ': Enter valid amount'
      if (!e.expenseDate) return 'Entry ' + (i + 1) + ': Select date'
      if (typeHasField(e.expenseTypeId, 'vendor_name') && !e.vendorName.trim()) {
        return 'Entry ' + (i + 1) + ': Enter vendor name'
      }
      if (typeHasField(e.expenseTypeId, 'travel_from') && !e.travelFrom.trim()) {
        return 'Entry ' + (i + 1) + ': Enter travel from location'
      }
      if (typeHasField(e.expenseTypeId, 'travel_to') && !e.travelTo.trim()) {
        return 'Entry ' + (i + 1) + ': Enter travel to location'
      }
      if (!e.receiptFile && !e.audioBlob) return 'Entry ' + (i + 1) + ': Receipt image or voice note is required'
      // Validate allocations have at least dept
      for (var j = 0; j < e.allocations.length; j++) {
        var a = e.allocations[j]
        if (!a.department) return 'Entry ' + (i + 1) + ', Allocation ' + (j + 1) + ': Select department'
      }
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

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      var paise = Math.round(Number(e.amount) * 100)

      var payload = {
        user_id: profile.id,
        category_id: Number(e.categoryId),
        sub_category_id: e.subCategoryId ? Number(e.subCategoryId) : null,
        expense_type_id: Number(e.expenseTypeId),
        amount_paise: paise,
        description: e.description.trim(),
        expense_date: e.expenseDate,
        status: 'pending',
        vendor_name: typeHasField(e.expenseTypeId, 'vendor_name') ? e.vendorName.trim() : null,
        travel_from: typeHasField(e.expenseTypeId, 'travel_from') ? e.travelFrom.trim() : null,
        travel_to: typeHasField(e.expenseTypeId, 'travel_to') ? e.travelTo.trim() : null,
        travel_mode: typeHasField(e.expenseTypeId, 'travel_mode') ? e.travelMode : null
      }

      var { data: exp, error: insErr } = await supabase
        .from('expenses')
        .insert(payload)
        .select('id')
        .single()

      if (insErr || !exp) {
        failed++
        continue
      }

      // Upload receipt
      if (e.receiptFile) {
        var ext = e.receiptFile.name.split('.').pop()
        var rPath = profile.id + '/' + exp.id + '_' + Date.now() + '.' + ext
        var { error: upErr } = await supabase.storage.from('receipts').upload(rPath, e.receiptFile, { upsert: true })
        if (!upErr) {
          await supabase.from('expenses').update({ receipt_path: rPath }).eq('id', exp.id)
        }
      }

      // Upload voice receipt if no image
      if (!e.receiptFile && e.audioBlob) {
        var aPath = profile.id + '/' + exp.id + '_voice_' + Date.now() + '.webm'
        var { error: aErr } = await supabase.storage.from('receipts').upload(aPath, e.audioBlob, { contentType: 'audio/webm', upsert: true })
        if (!aErr) {
          await supabase.from('expenses').update({ receipt_path: aPath }).eq('id', exp.id)
        }
      }

      // Insert allocations
      var allocRows = e.allocations
        .filter(function (a) { return a.department })
        .map(function (a) {
          return {
            expense_id: exp.id,
            department: a.department,
            venue_id: a.venueId ? Number(a.venueId) : null,
            sub_venue_id: a.subVenueId ? Number(a.subVenueId) : null,
            amount_paise: a.amountPaise ? Math.round(Number(a.amountPaise) * 100) : 0
          }
        })

      if (allocRows.length > 0) {
        await supabase.from('expense_allocations').insert(allocRows)
      }

      try {
        await logActivity('EXPENSE_SUBMIT', (paise / 100) + ' pts | ' + e.description.trim().slice(0, 50))
      } catch (_) {}

      submitted++
    }

    setSaving(false)

    if (failed > 0 && submitted > 0) {
      setError(failed + ' failed, ' + submitted + ' submitted')
    } else if (failed > 0) {
      setError('All ' + failed + ' entries failed to submit')
    } else {
      setSuccess(submitted + ' expense' + (submitted > 1 ? 's' : '') + ' submitted')
      setEntries([makeEntry()])
      if (onDone) onDone()
      setTimeout(function () { setSuccess('') }, 3000)
    }
  }

  // ── Render helpers ──

  function filteredSubCats(categoryId) {
    if (!categoryId) return []
    return subCategories.filter(function (sc) { return sc.category_id === Number(categoryId) })
  }

  function filteredSubVenues(venueId) {
    if (!venueId) return []
    return subVenues.filter(function (sv) { return sv.venue_id === Number(venueId) })
  }

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{success}</div>
      )}

      {entries.map(function (entry, idx) {
        var subs = filteredSubCats(entry.categoryId)
        var showVendor = typeHasField(entry.expenseTypeId, 'vendor_name')
        var showTravel = typeHasField(entry.expenseTypeId, 'travel_from')

        return (
          <div key={entry._key} className="border border-amber-200 rounded-xl bg-white shadow-sm overflow-hidden">
            {/* Entry header */}
            <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200">
              <span className="font-semibold text-amber-900 text-sm">{'Expense #' + (idx + 1)}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={function () { duplicateEntry(idx) }}
                  className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
                  title="Duplicate"
                >📋</button>
                {entries.length > 1 && (
                  <button
                    type="button"
                    onClick={function () { removeEntry(idx) }}
                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200"
                    title="Remove"
                  >✕</button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Row 1: Category + Sub-category */}
              <div className="grid grid-cols-2 gap-3">
                <SearchDropdown
                  label="Category"
                  items={categories.map(function (c) { return { label: c.name, value: String(c.id) } })}
                  value={entry.categoryId}
                  onChange={function (val) { updateEntry(idx, 'categoryId', val) }}
                  placeholder="Select..."
                />
                <SearchDropdown
                  label="Sub-category"
                  items={subs.map(function (sc) { return { label: sc.name, value: String(sc.id) } })}
                  value={entry.subCategoryId}
                  onChange={function (val) { updateEntry(idx, 'subCategoryId', val) }}
                  placeholder={subs.length ? 'Select...' : 'Pick category first'}
                />
              </div>

              {/* Expense Type pills */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expense Type</label>
                <div className="flex flex-wrap gap-2">
                  {expenseTypes.map(function (et) {
                    var selected = Number(entry.expenseTypeId) === et.id
                    return (
                      <button
                        key={et.id}
                        type="button"
                        onClick={function () { updateEntry(idx, 'expenseTypeId', String(et.id)) }}
                        className={
                          'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ' +
                          (selected
                            ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300')
                        }
                      >{et.name}</button>
                    )
                  })}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  value={entry.description}
                  onChange={function (e) { updateEntry(idx, 'description', e.target.value) }}
                  placeholder="What was this expense for..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400 resize-none"
                />
              </div>

              {/* Type-specific: Vendor Payment */}
              {showVendor && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Name</label>
                  <input
                    type="text"
                    value={entry.vendorName}
                    onChange={function (e) { updateEntry(idx, 'vendorName', e.target.value) }}
                    placeholder="Vendor / supplier name"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                  />
                </div>
              )}

              {/* Type-specific: Travel */}
              {showTravel && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Travel Mode</label>
                    <div className="flex gap-2">
                      {['Between Venues', 'Field Site'].map(function (mode) {
                        var selected = entry.travelMode === mode
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={function () { updateEntry(idx, 'travelMode', mode) }}
                            className={
                              'px-3 py-1.5 rounded-lg text-sm border ' +
                              (selected
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300')
                            }
                          >{mode}</button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                      <input
                        type="text"
                        value={entry.travelFrom}
                        onChange={function (e) { updateEntry(idx, 'travelFrom', e.target.value) }}
                        placeholder="Starting point"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                      <input
                        type="text"
                        value={entry.travelTo}
                        onChange={function (e) { updateEntry(idx, 'travelTo', e.target.value) }}
                        placeholder="Destination"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Amount + Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={entry.amount}
                    onChange={function (e) { updateEntry(idx, 'amount', e.target.value) }}
                    placeholder="0"
                    min="1"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={entry.expenseDate}
                    onChange={function (e) { updateEntry(idx, 'expenseDate', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Allocations */}
              <div className="border border-gray-100 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Allocations</label>
                  <button
                    type="button"
                    onClick={function () { addAllocation(idx) }}
                    className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium"
                  >+ Row</button>
                </div>

                <div className="space-y-2">
                  {entry.allocations.map(function (alloc, aIdx) {
                    var svList = filteredSubVenues(alloc.venueId)
                    return (
                      <div key={aIdx} className="flex gap-2 items-start">
                        <div className="flex-1 grid grid-cols-4 gap-2">
                          {/* Department */}
                          <select
                            value={alloc.department}
                            onChange={function (e) { updateAllocation(idx, aIdx, 'department', e.target.value) }}
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300"
                          >
                            <option value="">Dept</option>
                            {departments.map(function (d) {
                              return <option key={d.id} value={d.name}>{d.name}</option>
                            })}
                          </select>

                          {/* Venue */}
                          <select
                            value={alloc.venueId}
                            onChange={function (e) { updateAllocation(idx, aIdx, 'venueId', e.target.value) }}
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300"
                          >
                            <option value="">Venue</option>
                            {venues.map(function (v) {
                              return <option key={v.id} value={String(v.id)}>{v.code}</option>
                            })}
                          </select>

                          {/* Sub-venue */}
                          <select
                            value={alloc.subVenueId}
                            onChange={function (e) { updateAllocation(idx, aIdx, 'subVenueId', e.target.value) }}
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-300"
                            disabled={!svList.length}
                          >
                            <option value="">Sub-venue</option>
                            {svList.map(function (sv) {
                              return <option key={sv.id} value={String(sv.id)}>{sv.name}</option>
                            })}
                          </select>

                          {/* Allocation amount */}
                          <input
                            type="number"
                            inputMode="numeric"
                            value={alloc.amountPaise}
                            onChange={function (e) { updateAllocation(idx, aIdx, 'amountPaise', e.target.value) }}
                            placeholder="Amt"
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-300"
                          />
                        </div>

                        {entry.allocations.length > 1 && (
                          <button
                            type="button"
                            onClick={function () { removeAllocation(idx, aIdx) }}
                            className="text-red-400 hover:text-red-600 text-xs mt-1"
                          >✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            {/* Receipt — image OR voice */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Receipt <span className="text-red-500">*</span></label>
                {entry.receiptPreview ? (
                  <div className="relative inline-block">
                    <img src={entry.receiptPreview} alt="Receipt" className="h-32 rounded-lg border border-gray-200 object-cover" />
                    <button
                      type="button"
                      onClick={function () { removeReceipt(idx) }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600"
                    >✕</button>
                  </div>
                ) : entry.audioUrl ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <audio src={entry.audioUrl} controls className="flex-1 h-8" />
                    <button
                      type="button"
                      onClick={function () { removeAudio(idx) }}
                      className="w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-sm hover:bg-red-600 flex-shrink-0"
                    >✕</button>
                  </div>
                ) : entry.recording ? (
                  <button
                    type="button"
                    onClick={function () { stopRecording(idx) }}
                    className="w-full py-3 rounded-lg bg-red-500 text-white text-sm font-medium animate-pulse flex items-center justify-center gap-2"
                  >
                    <span className="w-2.5 h-2.5 bg-white rounded-full" />
                    Recording... Tap to stop
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📁</span><span>Gallery</span>
                      <input type="file" accept="image/*,.pdf" className="hidden"
                        onChange={function (e) { handleReceipt(idx, e.target.files?.[0] || null); e.target.value = '' }} />
                    </label>
                    <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 cursor-pointer transition-colors">
                      <span>📷</span><span>Camera</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={function (e) { handleReceipt(idx, e.target.files?.[0] || null); e.target.value = '' }} />
                    </label>
                    <button
                      type="button"
                      onClick={function () { startRecording(idx) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                    >
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
        <button
          type="button"
          onClick={addEntry}
          className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-700 font-medium text-sm hover:bg-amber-50 transition-colors"
        >+ Add Another Expense</button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className={
            'flex-1 py-2.5 rounded-xl font-semibold text-sm text-white shadow-sm transition-all ' +
            (saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 active:scale-[0.98]')
          }
        >{saving ? 'Submitting...' : 'Submit ' + entries.length + ' Expense' + (entries.length > 1 ? 's' : '')}</button>
      </div>
    </div>
  )
}

export default ExpenseForm
