import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import Modal from '../../components/ui/Modal'
import EmployeeForm from './EmployeeForm'
import EmployeeDetail from './EmployeeDetail'

var STATUS_STYLES = {
  active:      { label: 'Active',      cls: 'bg-green-100 text-green-700' },
  probation:   { label: 'Probation',   cls: 'bg-amber-100 text-amber-700' },
  on_leave:    { label: 'On Leave',    cls: 'bg-blue-100 text-blue-700' },
  terminated:  { label: 'Terminated',  cls: 'bg-red-100 text-red-600' },
  resigned:    { label: 'Resigned',    cls: 'bg-gray-200 text-gray-600' },
}

function Employees({ profile }) {
  var [rows, setRows] = useState([])
  var [jobDepartments, setJobDepartments] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)

  // Filters
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState([]) // multi
  var [deptFilter, setDeptFilter] = useState([])     // multi
  var [showExited, setShowExited] = useState(false)

  // Sort
  var [sortKey, setSortKey] = useState('employee_code')
  var [sortDir, setSortDir] = useState('asc')

  // Modals
  var [editRow, setEditRow] = useState(null)
  var [viewRow, setViewRow] = useState(null)
  var [showCreate, setShowCreate] = useState(false)

  var isAdminOrHR = profile && (profile.role === 'admin' || profile.role === 'auditor')

  useRealtime(['employees', 'job_departments'], function () { if (!saving) loadAll() })

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    var [empRes, jdRes] = await Promise.all([
      supabase.from('employees')
        .select('id, employee_code, full_name, designation, job_department_ids, contact_number, personal_email, status, doj, profile_id, reporting_manager_id')
        .order('employee_code', { ascending: true }),
      supabase.from('job_departments').select('*').order('sort_order').order('name'),
    ])
    if (empRes.error) { console.error('Employees load:', empRes.error); }
    setRows(empRes.data || [])
    setJobDepartments(jdRes.data || [])
    setLoading(false)
  }

  // Managers list for form picker (only active/probation/on_leave)
  var managerList = rows.filter(function (r) {
    return r.status === 'active' || r.status === 'probation' || r.status === 'on_leave'
  })

  function toggleSort(key) {
    if (sortKey === key) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc') }
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleFilter(arr, val, setter) {
    if (arr.indexOf(val) === -1) { setter(arr.concat([val])) }
    else { setter(arr.filter(function (x) { return x !== val })) }
  }

  // Filter + sort
  var filtered = rows.filter(function (r) {
    if (!showExited && (r.status === 'terminated' || r.status === 'resigned')) return false
    if (statusFilter.length > 0 && statusFilter.indexOf(r.status) === -1) return false
    if (deptFilter.length > 0) {
      var hit = (r.job_department_ids || []).some(function (id) { return deptFilter.indexOf(id) !== -1 })
      if (!hit) return false
    }
    if (search) {
      var q = search.toLowerCase()
      var hay = (r.full_name || '') + ' ' + (r.employee_code || '') + ' ' +
                (r.designation || '') + ' ' + (r.contact_number || '') + ' ' +
                (r.personal_email || '')
      if (hay.toLowerCase().indexOf(q) === -1) return false
    }
    return true
  })

  filtered.sort(function (a, b) {
    var va = a[sortKey] || ''
    var vb = b[sortKey] || ''
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  var jdMap = {}
  jobDepartments.forEach(function (d) { jdMap[d.id] = d.name })

  function deptChips(ids) {
    if (!ids || ids.length === 0) return <span className="text-gray-400 text-xs">—</span>
    return (
      <div className="flex flex-wrap gap-1">
        {ids.map(function (id) {
          var name = jdMap[id] || ('#' + id)
          return <span key={id} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{name}</span>
        })}
      </div>
    )
  }

  function SortHeader({ label, k }) {
    var active = sortKey === k
    return (
      <button onClick={function () { toggleSort(k) }}
        className="flex items-center gap-1 text-left font-bold text-[11px] uppercase tracking-wider text-gray-500 hover:text-gray-800">
        {label} {active && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    )
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search name / code / designation / contact..."
          style={{ fontSize: '16px' }}
          className="flex-1 min-w-[220px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />

        <ChipMultiFilter
          label="Status"
          options={Object.keys(STATUS_STYLES).map(function (k) { return { value: k, label: STATUS_STYLES[k].label } })}
          selected={statusFilter}
          onToggle={function (v) { toggleFilter(statusFilter, v, setStatusFilter) }}
          onClear={function () { setStatusFilter([]) }} />

        <ChipMultiFilter
          label="Job Dept"
          options={jobDepartments.filter(function (d) { return d.is_active }).map(function (d) { return { value: d.id, label: d.name } })}
          selected={deptFilter}
          onToggle={function (v) { toggleFilter(deptFilter, v, setDeptFilter) }}
          onClear={function () { setDeptFilter([]) }} />

        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showExited}
            onChange={function (e) { setShowExited(e.target.checked) }}
            className="w-3.5 h-3.5 rounded" />
          Show exited
        </label>

        <button onClick={function () { setShowCreate(true) }}
          className="ml-auto px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 font-medium">
          + Add Employee
        </button>
      </div>

      {/* Summary bar */}
      <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-4">
        <span>Total: <b className="text-gray-700">{rows.length}</b></span>
        <span>Shown: <b className="text-gray-700">{filtered.length}</b></span>
        <span>Active: <b className="text-green-600">{rows.filter(function (r) { return r.status === 'active' }).length}</b></span>
        <span>Probation: <b className="text-amber-600">{rows.filter(function (r) { return r.status === 'probation' }).length}</b></span>
        <span>On Leave: <b className="text-blue-600">{rows.filter(function (r) { return r.status === 'on_leave' }).length}</b></span>
        <span>Exited: <b className="text-gray-500">{rows.filter(function (r) { return r.status === 'terminated' || r.status === 'resigned' }).length}</b></span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1000 }}>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left"><SortHeader label="Code" k="employee_code" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Name" k="full_name" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Designation" k="designation" /></th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">Departments</th>
                <th className="px-3 py-2 text-left"><SortHeader label="Status" k="status" /></th>
                <th className="px-3 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">Contact</th>
                <th className="px-3 py-2 text-left"><SortHeader label="DOJ" k="doj" /></th>
                <th className="px-3 py-2 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">App</th>
                <th className="px-3 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan="9" className="px-3 py-8 text-center text-gray-400 text-sm">
                  {rows.length === 0
                    ? 'No employees yet. Click "+ Add Employee" to create the first one.'
                    : 'No matches for current filters.'}
                </td></tr>
              )}
              {filtered.map(function (r) {
                var st = STATUS_STYLES[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-500' }
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.employee_code}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.full_name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.designation || '—'}</td>
                    <td className="px-3 py-2">{deptChips(r.job_department_ids)}</td>
                    <td className="px-3 py-2">
                      <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + st.cls}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div>{r.contact_number || '—'}</div>
                      <div className="text-gray-400">{r.personal_email || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.doj ? formatDate(r.doj) : '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {r.profile_id ? (
                        <span title="Linked to app login" className="text-green-600 text-sm">✓</span>
                      ) : (
                        <span title="No app access" className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={function () { setViewRow(r) }}
                        className="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 mr-1">View</button>
                      <button onClick={function () { setEditRow(r) }}
                        className="text-xs px-2 py-1 rounded text-indigo-600 hover:bg-indigo-50">Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">
        🔒 Bank details, salary, Aadhaar, PAN, and documents are only visible inside the edit form and detail view.
      </p>

      {/* Create modal */}
      <Modal open={showCreate} onClose={function () { if (!saving) setShowCreate(false) }} title="Add Employee" wide>
        {showCreate && (
          <EmployeeForm
            employee={null}
            profile={profile}
            jobDepartments={jobDepartments}
            managers={managerList}
            onClose={function () { setShowCreate(false) }}
            onSaved={function () { setShowCreate(false); loadAll() }} />
        )}
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editRow} onClose={function () { if (!saving) setEditRow(null) }}
        title={editRow ? ('Edit: ' + editRow.full_name + ' (' + editRow.employee_code + ')') : 'Edit Employee'} wide>
        {editRow && (
          <EmployeeForm
            employee={editRow}
            profile={profile}
            jobDepartments={jobDepartments}
            managers={managerList}
            onClose={function () { setEditRow(null) }}
            onSaved={function () { setEditRow(null); loadAll() }} />
        )}
      </Modal>

      {/* Detail modal */}
      <Modal open={!!viewRow} onClose={function () { setViewRow(null) }}
        title={viewRow ? viewRow.full_name + ' — Detail' : 'Employee'} wide>
        {viewRow && (
          <EmployeeDetail
            employeeId={viewRow.id}
            jobDepartments={jobDepartments}
            managers={managerList}
            profile={profile}
            canEdit={isAdminOrHR}
            onEdit={function (r) { setViewRow(null); setEditRow(r) }} />
        )}
      </Modal>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// ChipMultiFilter: chip-style dropdown multi-select with clear
// ────────────────────────────────────────────────────────────
function ChipMultiFilter({ label, options, selected, onToggle, onClear }) {
  var [open, setOpen] = useState(false)
  var hasSel = selected.length > 0
  return (
    <div className="relative">
      <button type="button" onClick={function () { setOpen(!open) }}
        className={"px-3 py-2 text-sm border rounded-md transition-colors whitespace-nowrap " +
          (hasSel ? "bg-indigo-50 text-indigo-700 border-indigo-400 font-medium" : "bg-white text-gray-500 border-gray-300 hover:border-gray-400")}>
        {label}{hasSel ? ' (' + selected.length + ')' : ''} <span className="text-xs">▾</span>
      </button>
      {open && (
        <>
          <div onClick={function () { setOpen(false) }}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div className="absolute z-50 mt-1 min-w-[180px] max-h-[300px] overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
            <button type="button" onClick={function () { onClear(); setOpen(false) }}
              className={"w-full text-left px-3 py-2 text-xs border-b border-gray-100 " +
                (hasSel ? "text-red-600 hover:bg-red-50" : "text-gray-400")}>
              Clear
            </button>
            {options.map(function (o) {
              var checked = selected.indexOf(o.value) !== -1
              return (
                <button type="button" key={o.value}
                  onClick={function () { onToggle(o.value) }}
                  className={"w-full text-left px-3 py-2 text-sm flex items-center gap-2 " +
                    (checked ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-50")}>
                  <span className={"w-3.5 h-3.5 rounded border flex items-center justify-center " +
                    (checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300")}>
                    {checked && <span className="text-[9px]">✓</span>}
                  </span>
                  {o.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default Employees