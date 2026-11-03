import SearchDropdown from '../../components/ui/SearchDropdown'

// Picks an expense type, then its sub-type, then renders whatever that
// sub-type's own extra_fields ask for — the same dynamic-field shape
// ExpenseForm.jsx uses for a normal expense entry. Shared by Cost Transfers
// (both the From and To row) and the Store Requisition "Adjust Expense"
// line, so the two can't drift into two different renderers for the same
// sub-type definition.
function ExpenseTypeFields({ value, onChange, expTypes, expSubTypes, stacked, quiet, vendors, venues, employees, staff }) {
  var etId = Number(value.expense_type_id) || 0
  var subId = Number(value.expense_sub_type_id) || 0
  var subs = expSubTypes.filter(function (s) { return s.expense_type_id === etId })
  var etItems = expTypes.map(function (x) { return { value: String(x.id), label: x.name } })
  var subItems = subs.map(function (x) { return { value: String(x.id), label: x.name } })
  var subType = subId ? expSubTypes.find(function (s) { return s.id === subId }) : null
  var extraFields = (subType && Array.isArray(subType.extra_fields))
    ? subType.extra_fields.filter(function (f) { return !(f.type === 'lookup' && f.source === 'categories') })
    : []

  function setMeta(key, val) {
    var meta = Object.assign({}, value.meta || {})
    meta[key] = val
    onChange({ meta: meta })
  }

  function itemsForSource(source, allowedDeptIds) {
    if (source === 'vendors') {
      return (vendors || []).map(function (v) { return { value: String(v.id), label: v.name } })
    }
    if (source === 'job_departments') {
      var allowed = allowedDeptIds || []
      return (employees || []).filter(function (emp) {
        if (allowed.length === 0) return true
        var jd = emp.job_department_ids || []
        for (var i = 0; i < jd.length; i++) { if (allowed.indexOf(jd[i]) !== -1) return true }
        return false
      }).map(function (emp) {
        return { value: String(emp.id), label: (emp.full_name || '—') + (emp.employee_code ? ' (' + emp.employee_code + ')' : '') }
      })
    }
    if (source === 'venues') {
      return (venues || []).map(function (v) { return { value: String(v.id), label: v.code ? (v.code + ' — ' + v.name) : v.name } })
    }
    if (source === 'staff') {
      return (staff || []).map(function (p) { return { value: String(p.id), label: p.name || '—' } })
    }
    return []
  }

  var fieldCls = 'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow'
  var fieldSty = { fontSize: '16px' }

  function renderExtraField(field) {
    var val = (value.meta || {})[field.key] || ''
    if (field.type === 'lookup') {
      return (
        <SearchDropdown key={field.key} label={field.label + (field.required ? ' *' : '')}
          items={itemsForSource(field.source, field.allowed_dept_ids)}
          value={val} onChange={function (v) { setMeta(field.key, v) }}
          placeholder={'Select ' + field.label + '...'} noVoice={stacked} inlineVoice={quiet} />
      )
    }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <select value={val} onChange={function (e) { setMeta(field.key, e.target.value) }} className={fieldCls + ' bg-white'} style={fieldSty}>
            <option value="">Select...</option>
            {(field.options || []).map(function (opt) { return <option key={opt} value={opt}>{opt}</option> })}
          </select>
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={val} onChange={function (e) { setMeta(field.key, e.target.value) }} rows={2} className={fieldCls + ' resize-none'} style={fieldSty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={val} onChange={function (e) { setMeta(field.key, e.target.value) }} className={fieldCls} style={fieldSty} />
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={val} onChange={function (e) { setMeta(field.key, e.target.value) }} placeholder={field.label} className={fieldCls} style={fieldSty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={val} onChange={function (e) { setMeta(field.key, e.target.value) }} placeholder={field.label} className={fieldCls} style={fieldSty} />
      </div>
    )
  }

  return (
    <div className={stacked ? "space-y-2.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2.5"}>
      <SearchDropdown items={etItems} noVoice={stacked} inlineVoice={quiet}
        value={value.expense_type_id}
        onChange={function (v) { onChange({ expense_type_id: v, expense_sub_type_id: '', meta: {} }) }}
        placeholder="Search expense type..." />
      <SearchDropdown items={subItems} noVoice={stacked} inlineVoice={quiet}
        value={value.expense_sub_type_id}
        onChange={function (v) { onChange({ expense_sub_type_id: v, meta: {} }) }}
        placeholder={!etId ? 'Pick a type first' : (subs.length === 0 ? 'No sub-types' : 'Sub-type (optional)')} />
      {extraFields.length > 0 && (
        <div className={(stacked ? "" : "sm:col-span-2") + " space-y-2.5"}>
          {extraFields.map(renderExtraField)}
        </div>
      )}
    </div>
  )
}

export default ExpenseTypeFields
