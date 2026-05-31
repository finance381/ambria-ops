import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function ExpenseTypeMaster({ onBack }) {
  var [expTypes, setExpTypes] = useState([])
  var [typeName, setTypeName] = useState('')
  var [typeEditId, setTypeEditId] = useState(null)
  var [typeSaving, setTypeSaving] = useState(false)
  var [typeEditName, setTypeEditName] = useState('')
  var [typeFields, setTypeFields] = useState([])
  var [addFieldMode, setAddFieldMode] = useState(false)
  var [newFieldLabel, setNewFieldLabel] = useState('')
  var [newFieldType, setNewFieldType] = useState('text')
  var [newFieldRequired, setNewFieldRequired] = useState(false)
  var [newFieldOptions, setNewFieldOptions] = useState('')

  useEffect(function () { loadExpTypes() }, [])

  async function loadExpTypes() {
    var { data } = await supabase.from('expense_types').select('id, name, extra_fields, active, sort_order').order('sort_order')
    setExpTypes(data || [])
  }

  function startEditType(et) {
    setTypeEditId(et.id)
    setTypeEditName(et.name)
    setTypeFields(et.extra_fields && Array.isArray(et.extra_fields) ? et.extra_fields.map(function (f) { return Object.assign({}, f) }) : [])
    setAddFieldMode(false)
    resetNewField()
  }
  function cancelEditType() {
    setTypeEditId(null)
    setTypeEditName('')
    setTypeFields([])
    setAddFieldMode(false)
    resetNewField()
  }
  function resetNewField() {
    setNewFieldLabel('')
    setNewFieldType('text')
    setNewFieldRequired(false)
    setNewFieldOptions('')
  }
  function generateFieldKey(label) {
    var base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!base) return 'field'
    var key = base
    var n = 2
    while (typeFields.some(function (f) { return f.key === key })) { key = base + '_' + n; n++ }
    return key
  }
  function addFieldToType() {
    if (!newFieldLabel.trim()) return
    var field = { key: generateFieldKey(newFieldLabel.trim()), label: newFieldLabel.trim(), type: newFieldType, required: newFieldRequired }
    if (newFieldType === 'select' && newFieldOptions.trim()) {
      field.options = newFieldOptions.split(',').map(function (o) { return o.trim() }).filter(Boolean)
    }
    setTypeFields(typeFields.concat([field]))
    setAddFieldMode(false)
    resetNewField()
  }
  function removeFieldFromType(idx) {
    setTypeFields(typeFields.filter(function (_, i) { return i !== idx }))
  }
  async function saveExpType() {
    if (typeSaving) return
    setTypeSaving(true)
    var checkName = typeEditId ? typeEditName.trim() : typeName.trim()
    if (!checkName) { setTypeSaving(false); return }
    var dupe = expTypes.find(function (t) { return t.name.toLowerCase() === checkName.toLowerCase() && t.id !== typeEditId })
    if (dupe) { alert('Expense type "' + dupe.name + '" already exists.'); setTypeSaving(false); return }
    if (typeEditId) {
      await supabase.from('expense_types').update({ name: typeEditName.trim(), extra_fields: typeFields }).eq('id', typeEditId)
    } else {
      var maxSort = expTypes.reduce(function (m, t) { return t.sort_order > m ? t.sort_order : m }, 0)
      await supabase.from('expense_types').insert({ name: typeName.trim(), sort_order: maxSort + 1 })
    }
    setTypeName('')
    cancelEditType()
    setTypeSaving(false)
    loadExpTypes()
  }
  async function toggleExpType(id, active) {
    await supabase.from('expense_types').update({ active: !active }).eq('id', id)
    loadExpTypes()
  }
  async function deleteExpType(id, name) {
    if (!confirm('Delete expense type "' + name + '"? This cannot be undone.')) return
    var { error } = await supabase.from('expense_types').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message + (error.message.indexOf('violates foreign key') !== -1 ? '\n\nThis type is used by existing expenses and cannot be deleted. Deactivate it instead.' : '')); return }
    loadExpTypes()
  }

  return (
    <div className="space-y-4">
      {onBack && (
        <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
      )}
      <h2 className="text-lg font-bold text-gray-900">Expense Types</h2>
      <div className="space-y-2">
        {expTypes.map(function (et) {
          var isEditing = typeEditId === et.id
          return (
            <div key={et.id} className={"bg-white border rounded-lg overflow-hidden " + (isEditing ? "border-purple-300 ring-1 ring-purple-200" : "border-gray-200")}>
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={"text-sm font-medium truncate " + (et.active ? "text-gray-800" : "text-gray-400 line-through")}>{et.name}</span>
                  {et.extra_fields && et.extra_fields.length > 0 && (
                    <span className="text-[10px] text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">{et.extra_fields.length} fields</span>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {!isEditing && (
                    <button onClick={function () { startEditType(et) }}
                      className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-600 hover:bg-gray-300 min-h-[32px] min-w-[32px]">✎</button>
                  )}
                  <button onClick={function () { toggleExpType(et.id, et.active) }}
                    className={"text-xs px-2 py-1 rounded min-h-[32px] " + (et.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-600 hover:bg-red-200")}>
                    {et.active ? 'On' : 'Off'}
                  </button>
                  <button onClick={function () { deleteExpType(et.id, et.name) }}
                    className="text-xs px-2 py-1 rounded min-h-[32px] bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600">✕</button>
                </div>
              </div>
              {isEditing && (
                <div className="border-t border-purple-200 p-3 space-y-3 bg-purple-50/30">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Type Name</label>
                    <input type="text" value={typeEditName} onChange={function (e) { setTypeEditName(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Fields</p>
                    {typeFields.length === 0 && !addFieldMode && (
                      <p className="text-xs text-gray-400 italic">No custom fields</p>
                    )}
                    <div className="space-y-1.5">
                      {typeFields.map(function (f, idx) {
                        return (
                          <div key={f.key} className="flex items-start justify-between p-2 bg-white rounded border border-gray-200">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium text-gray-800">{f.label}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{f.type}</span>
                                {f.required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">required</span>}
                              </div>
                              {f.type === 'select' && f.options && (
                                <p className="text-[10px] text-gray-400 mt-0.5">{f.options.join(', ')}</p>
                              )}
                            </div>
                            <button onClick={function () { removeFieldFromType(idx) }}
                              className="text-xs text-red-400 hover:text-red-600 px-1 min-h-[28px] min-w-[28px]">✕</button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {!addFieldMode ? (
                    <button onClick={function () { setAddFieldMode(true) }}
                      className="text-xs text-purple-600 font-medium hover:text-purple-800">+ Add Field</button>
                  ) : (
                    <div className="p-3 bg-white rounded-lg border border-purple-200 space-y-2">
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Label</label>
                        <input type="text" value={newFieldLabel} onChange={function (e) { setNewFieldLabel(e.target.value) }}
                          placeholder="e.g. Invoice Number"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                          style={{ fontSize: '16px' }} />
                      </div>
                      <div className="flex gap-2 items-center">
                        <div className="flex-1">
                          <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Type</label>
                          <select value={newFieldType} onChange={function (e) { setNewFieldType(e.target.value) }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                            style={{ fontSize: '16px' }}>
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="select">Dropdown</option>
                            <option value="date">Date</option>
                            <option value="textarea">Long Text</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-1 mt-3">
                          <input type="checkbox" checked={newFieldRequired} onChange={function (e) { setNewFieldRequired(e.target.checked) }} />
                          <span className="text-xs text-gray-600">Required</span>
                        </label>
                      </div>
                      {newFieldType === 'select' && (
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Options (comma separated)</label>
                          <input type="text" value={newFieldOptions} onChange={function (e) { setNewFieldOptions(e.target.value) }}
                            placeholder="e.g. Car, Bus, Train"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                            style={{ fontSize: '16px' }} />
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button onClick={function () { setAddFieldMode(false); resetNewField() }}
                          className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 min-h-[36px]">Cancel</button>
                        <button onClick={addFieldToType} disabled={!newFieldLabel.trim()}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 min-h-[36px]">Add Field</button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 justify-end pt-1 border-t border-gray-200">
                    <button onClick={cancelEditType}
                      className="px-4 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 min-h-[36px]">Cancel</button>
                    <button onClick={saveExpType} disabled={typeSaving || !typeEditName.trim()}
                      className="px-4 py-2 text-xs font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 min-h-[36px]">
                      {typeSaving ? 'Saving...' : 'Update Type'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!typeEditId && (
        <div className="flex gap-2">
          <input type="text" value={typeName} onChange={function (e) { setTypeName(e.target.value) }}
            placeholder="New type name..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            style={{ fontSize: '16px' }}
            onKeyDown={function (e) { if (e.key === 'Enter') saveExpType() }} />
          <button onClick={saveExpType} disabled={typeSaving || !typeName.trim()}
            className="px-4 py-2 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 min-h-[44px]">
            Add
          </button>
        </div>
      )}
    </div>
  )
}

export default ExpenseTypeMaster
