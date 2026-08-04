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
  pending:     { label: 'Pending',     cls: 'bg-purple-100 text-purple-700' },
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
  var [statusFilter, setStatusFilter] = useState(['pending']) // default: show pending on load
  var [deptFilter, setDeptFilter] = useState([])     // multi
  var [showExited, setShowExited] = useState(false)

  // Sort
  var [sortKey, setSortKey] = useState('employee_code')
  var [sortDir, setSortDir] = useState('asc')

  // Modals
  var [editRow, setEditRow] = useState(null)
  var [viewRow, setViewRow] = useState(null)
  var [showCreate, setShowCreate] = useState(false)
  var [deleteRow, setDeleteRow] = useState(null)
  var [approveRow, setApproveRow] = useState(null)
  var [copiedLink, setCopiedLink] = useState(false)

  // CSV import
  var [importModal, setImportModal] = useState(null)  // { rows, header, fileName }
  var [importing, setImporting] = useState(false)
  var [importProgress, setImportProgress] = useState(null) // { done, total }
  var [importSummary, setImportSummary] = useState(null)   // { created, skipped, skippedRows }

  var perms = (profile && profile.permissions) || []
  var isAdminOrHR = profile && (profile.role === 'admin' || profile.role === 'auditor')
  var hasEmployeesPerm = isAdminOrHR || perms.indexOf('feature_employees') !== -1
  var canSeeAll = isAdminOrHR
  var canSeeSalary = isAdminOrHR || perms.indexOf('feature_employees_salary') !== -1

  useRealtime(['employees', 'job_departments'], function () { if (!saving) loadAll() })

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    var empQuery = supabase.from('employees')
      .select('id, employee_code, full_name, designation, job_department_ids, contact_number, personal_email, status, doj, profile_id, reporting_manager_id, created_by')
      .order('employee_code', { ascending: true })
    if (!canSeeAll) empQuery = empQuery.eq('created_by', profile.id)

    var [empRes, jdRes] = await Promise.all([
      empQuery,
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

  async function handleDelete() {
    if (!deleteRow || saving) return
    setSaving(true)
    try {
      // Collect storage paths first (photo + docs)
      var pathsPublic = []
      var pathsEmpDocs = []
      var empRes = await supabase.from('employees').select('photo_file_path, submission_uuid').eq('id', deleteRow.id).single()
      var photoPath = empRes.data && empRes.data.photo_file_path
      var submissionUuid = empRes.data && empRes.data.submission_uuid
      if (photoPath) {
        if (photoPath.indexOf('submissions/') === 0) pathsPublic.push(photoPath)
        else pathsEmpDocs.push(photoPath)
      }
      var docRes = await supabase.from('employee_documents').select('file_path').eq('employee_id', deleteRow.id)
      ;(docRes.data || []).forEach(function (d) {
        if (!d.file_path) return
        if (d.file_path.indexOf('submissions/') === 0) pathsPublic.push(d.file_path)
        else pathsEmpDocs.push(d.file_path)
      })
      // Also sweep any leftover files under submissions/<uuid>/ prefix (belt & braces)
      if (submissionUuid) {
        try {
          var listRes = await supabase.storage.from('employee-public-submissions').list('submissions/' + submissionUuid, { limit: 100 })
          ;(listRes.data || []).forEach(function (o) {
            if (o && o.name) {
              var p = 'submissions/' + submissionUuid + '/' + o.name
              if (pathsPublic.indexOf(p) === -1) pathsPublic.push(p)
            }
          })
          var listDocsRes = await supabase.storage.from('employee-public-submissions').list('submissions/' + submissionUuid + '/docs', { limit: 100 })
          ;(listDocsRes.data || []).forEach(function (o) {
            if (o && o.name) {
              var p2 = 'submissions/' + submissionUuid + '/docs/' + o.name
              if (pathsPublic.indexOf(p2) === -1) pathsPublic.push(p2)
            }
          })
        } catch (_) {}
      }
      // Best-effort storage cleanup
      if (pathsPublic.length) { try { await supabase.storage.from('employee-public-submissions').remove(pathsPublic) } catch (_) {} }
      if (pathsEmpDocs.length) { try { await supabase.storage.from('employee-docs').remove(pathsEmpDocs) } catch (_) {} }
      // Delete FK rows then employee
      await supabase.from('employee_documents').delete().eq('employee_id', deleteRow.id)
      var delRes = await supabase.from('employees').delete().eq('id', deleteRow.id)
      if (delRes.error) throw new Error(delRes.error.message)
      try { await logActivity('EMPLOYEE_DELETE', (deleteRow.employee_code || 'no-code') + ' | ' + deleteRow.full_name) } catch (_) {}
      setDeleteRow(null)
      await loadAll()
    } catch (err) {
      alert('Delete failed: ' + (err.message || err) + '\nEmployee may have linked records (expenses, wallet, salary). Change status to Terminated / Resigned instead.')
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    if (!approveRow || saving) return
    if (approveRow.status !== 'pending') { setApproveRow(null); return }
    setSaving(true)
    try {
      var upd = await supabase.from('employees')
        .update({ status: 'probation' })
        .eq('id', approveRow.id)
        .eq('status', 'pending')
      if (upd.error) throw new Error(upd.error.message)
      try { await logActivity('EMPLOYEE_APPROVE', (approveRow.employee_code || 'pending') + ' | ' + approveRow.full_name) } catch (_) {}
      setApproveRow(null)
      await loadAll()
    } catch (err) {
      alert('Approve failed: ' + (err.message || err))
    } finally {
      setSaving(false)
    }
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

  // ═══ CSV IMPORT ═══
  function parseCsvLine(line) {
    var out = []; var cur = ''; var inQ = false
    for (var i = 0; i < line.length; i++) {
      var ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else { inQ = !inQ }
      } else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
      else { cur += ch }
    }
    out.push(cur)
    return out
  }

  function handleCsvFile(e) {
    var file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    var reader = new FileReader()
    reader.onload = function (ev) {
      var text = ev.target.result
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() })
      if (lines.length < 2) { alert('CSV must have header + at least 1 data row'); return }
      var header = parseCsvLine(lines[0]).map(function (h) { return h.replace(/^\uFEFF/, '').trim().toLowerCase() })
      var mustHave = ['full_name', 'dob', 'gender', 'father_name', 'marital_status',
        'contact_number', 'personal_email', 'emergency_contact',
        'present_address', 'permanent_address', 'doj', 'designation']
      var missing = mustHave.filter(function (h) { return header.indexOf(h) === -1 })
      if (missing.length > 0) {
        alert('CSV missing required columns:\n' + missing.join(', ') + '\n\nDownload template for reference.')
        return
      }
      var parsedRows = []
      for (var r = 1; r < lines.length; r++) {
        var cols = parseCsvLine(lines[r])
        var row = {}
        header.forEach(function (h, i) { row[h] = (cols[i] || '').trim() })
        if (row.full_name) parsedRows.push(row)
      }
      if (parsedRows.length === 0) { alert('No valid data rows found'); return }
      setImportModal({ rows: parsedRows, header: header, fileName: file.name })
      setImportSummary(null); setImportProgress(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function downloadTemplate() {
    var headers = ['full_name', 'dob', 'gender', 'father_name', 'blood_group', 'marital_status',
      'contact_number', 'personal_email', 'emergency_contact', 'present_address', 'permanent_address',
      'employee_code', 'doj', 'probation_end_date', 'confirmation_date', 'designation',
      'job_departments', 'work_location', 'status',
      'aadhaar_number', 'pan_number', 'uan', 'esic', 'pt_state',
      'bank_account_number', 'ifsc_code', 'bank_name', 'ctc_annual_rupees']
    var sample = ['John Doe', '1995-04-15', 'male', 'Robert Doe', 'O+', 'single',
      '+919999999999', 'john@example.com', '+919888888888', 'Delhi, India', 'Delhi, India',
      '', '2024-01-15', '', '', 'Coordinator',
      'Kitchen; F&B Service', 'Pushpanjali', 'probation',
      '', '', '', '', 'Delhi',
      '', '', '', '']
    var csv = headers.join(',') + '\n' + sample.map(function (v) {
      var s = String(v || '')
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }).join(',') + '\n'
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url; a.download = 'employees_import_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function validateRow(row) {
    // Format checks matching DB CHECK constraints
    if (row.dob && isNaN(new Date(row.dob).getTime())) return 'Invalid dob (use YYYY-MM-DD)'
    if (row.doj && isNaN(new Date(row.doj).getTime())) return 'Invalid doj (use YYYY-MM-DD)'
    if (['male', 'female', 'other'].indexOf(row.gender.toLowerCase()) === -1) return 'gender must be male/female/other'
    if (['single', 'married', 'divorced', 'widowed', 'separated'].indexOf(row.marital_status.toLowerCase()) === -1) return 'marital_status invalid'
    if (row.personal_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.personal_email)) return 'personal_email format invalid'
    if (row.aadhaar_number && !/^[0-9]{12}$/.test(row.aadhaar_number)) return 'aadhaar_number must be 12 digits'
    if (row.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(row.pan_number.toUpperCase())) return 'pan_number format invalid'
    if (row.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(row.ifsc_code.toUpperCase())) return 'ifsc_code format invalid'
    if (row.status && ['active', 'probation', 'on_leave', 'terminated', 'resigned'].indexOf(row.status.toLowerCase()) === -1) return 'status invalid'
    return null
  }

  async function runImport() {
    if (!importModal || importing) return
    setImporting(true)
    var rowsToImport = importModal.rows
    var created = 0; var skipped = 0; var skippedRows = []

    // Preload existing emails/aadhaar/PAN for dedup
    var { data: existing } = await supabase.from('employees')
      .select('personal_email, aadhaar_number, pan_number')
    var emailSet = {}, aadhaarSet = {}, panSet = {}
    ;(existing || []).forEach(function (e) {
      if (e.personal_email) emailSet[e.personal_email.toLowerCase()] = true
      if (e.aadhaar_number) aadhaarSet[e.aadhaar_number] = true
      if (e.pan_number) panSet[e.pan_number] = true
    })

    // Job dept name → id map
    var jdNameMap = {}
    jobDepartments.forEach(function (d) { jdNameMap[d.name.toLowerCase()] = d.id })

    for (var i = 0; i < rowsToImport.length; i++) {
      setImportProgress({ done: i, total: rowsToImport.length })
      var row = rowsToImport[i]

      var validationErr = validateRow(row)
      if (validationErr) { skipped++; skippedRows.push({ row: i + 2, name: row.full_name, reason: validationErr }); continue }

      var emailLower = (row.personal_email || '').toLowerCase()
      if (emailLower && emailSet[emailLower]) { skipped++; skippedRows.push({ row: i + 2, name: row.full_name, reason: 'Email already exists' }); continue }
      if (row.aadhaar_number && aadhaarSet[row.aadhaar_number]) { skipped++; skippedRows.push({ row: i + 2, name: row.full_name, reason: 'Aadhaar already exists' }); continue }
      var panUpper = (row.pan_number || '').toUpperCase()
      if (panUpper && panSet[panUpper]) { skipped++; skippedRows.push({ row: i + 2, name: row.full_name, reason: 'PAN already exists' }); continue }

      // Resolve job departments from semicolon-separated names
      var jdIds = []
      if (row.job_departments) {
        var names = row.job_departments.split(';').map(function (n) { return n.trim() }).filter(Boolean)
        var missingJd = []
        names.forEach(function (nm) {
          var id = jdNameMap[nm.toLowerCase()]
          if (id) { jdIds.push(id) } else { missingJd.push(nm) }
        })
        if (missingJd.length > 0) {
          skipped++
          skippedRows.push({ row: i + 2, name: row.full_name, reason: 'Unknown job_departments: ' + missingJd.join(', ') })
          continue
        }
      }

      var payload = {
        full_name: row.full_name,
        dob: row.dob,
        gender: row.gender.toLowerCase(),
        father_name: row.father_name,
        blood_group: row.blood_group || null,
        marital_status: row.marital_status.toLowerCase(),
        contact_number: row.contact_number,
        personal_email: row.personal_email,
        emergency_contact: row.emergency_contact,
        present_address: row.present_address,
        permanent_address: row.permanent_address,
        doj: row.doj,
        probation_end_date: row.probation_end_date || null,
        confirmation_date: row.confirmation_date || null,
        designation: row.designation,
        job_department_ids: jdIds,
        work_location: row.work_location || null,
        status: (row.status || 'probation').toLowerCase(),
        aadhaar_number: row.aadhaar_number || null,
        pan_number: panUpper || null,
        uan: row.uan || null,
        esic: row.esic || null,
        pt_state: row.pt_state || null,
        bank_account_number: row.bank_account_number || null,
        ifsc_code: (row.ifsc_code || '').toUpperCase() || null,
        bank_name: row.bank_name || null,
        ctc_annual_paise: row.ctc_annual_rupees ? Math.round(Number(row.ctc_annual_rupees) * 100) : null,
        created_by: profile?.id || null,
      }
      if (row.employee_code) payload.employee_code = row.employee_code

      var { error: insErr } = await supabase.from('employees').insert(payload)
      if (insErr) {
        skipped++
        skippedRows.push({ row: i + 2, name: row.full_name, reason: insErr.message })
      } else {
        created++
        // Update dedup sets so batch dups within same file get caught
        if (emailLower) emailSet[emailLower] = true
        if (row.aadhaar_number) aadhaarSet[row.aadhaar_number] = true
        if (panUpper) panSet[panUpper] = true
      }
    }

    setImportProgress({ done: rowsToImport.length, total: rowsToImport.length })

    try { await logActivity('EMPLOYEE_IMPORT_CSV', created + ' created, ' + skipped + ' skipped') } catch (_) {}

    setImportSummary({ created: created, skipped: skipped, skippedRows: skippedRows })
    setImporting(false)
    loadAll()
  }

  function downloadSkippedCsv() {
    if (!importSummary || !importSummary.skippedRows || importSummary.skippedRows.length === 0) return
    function esc(v) {
      var s = String(v == null ? '' : v)
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    var rows = importSummary.skippedRows.map(function (s) { return [s.row, s.name || '', s.reason].map(esc).join(',') })
    var csv = 'Row,Name,Reason\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url; a.download = 'employees_import_skipped.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  var publicFormUrl = 'https://finance381.github.io/employee-form/'
  async function copyPublicFormLink() {
    try {
      await navigator.clipboard.writeText(publicFormUrl)
      setCopiedLink(true)
      setTimeout(function () { setCopiedLink(false) }, 2000)
    } catch (e) {
      alert('Copy failed. Link: ' + publicFormUrl)
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Public form link */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg">
        <div className="text-lg shrink-0">🔗</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">Public Joining Form</div>
          <div className="text-xs text-gray-700 font-mono truncate select-all">{publicFormUrl}</div>
        </div>
        <button onClick={copyPublicFormLink}
          className={"shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors " + (copiedLink ? "text-white bg-green-600" : "text-white bg-indigo-600 hover:bg-indigo-700")}>
          {copiedLink ? '✓ Copied' : 'Copy link'}
        </button>
        <a href={publicFormUrl} target="_blank" rel="noopener noreferrer"
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-white border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors">
          Open
        </a>
      </div>

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

        <div className="ml-auto flex items-center gap-2">
          {isAdminOrHR && (
            <button onClick={downloadTemplate}
              title="Download CSV template"
              className="px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              ⬇ Template
            </button>
          )}
          {isAdminOrHR && (
            <label className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer">
              📥 Import CSV
              <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="hidden" />
            </label>
          )}
          {hasEmployeesPerm && (
            <button onClick={function () { setShowCreate(true) }}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 font-medium">
              + Add Employee
            </button>
          )}
        </div>
      </div>

      {importSummary && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2 flex items-center justify-between text-xs">
          <div className="text-gray-700">
            <span className="font-semibold text-indigo-700">Import done:</span>
            <span className="ml-2">{importSummary.created} created</span>
            {importSummary.skipped > 0 && <span className="ml-2 text-amber-700 font-medium">· {importSummary.skipped} skipped</span>}
          </div>
          <div className="flex items-center gap-2">
            {importSummary.skippedRows && importSummary.skippedRows.length > 0 && (
              <button onClick={downloadSkippedCsv}
                className="px-2 py-1 text-xs font-medium bg-white border border-indigo-300 text-indigo-700 rounded hover:bg-indigo-100">
                Download skipped CSV
              </button>
            )}
            <button onClick={function () { setImportSummary(null) }}
              className="text-gray-400 hover:text-gray-600 text-base leading-none">×</button>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-4">
        <span>Total: <b className="text-gray-700">{rows.length}</b></span>
        <span>Shown: <b className="text-gray-700">{filtered.length}</b></span>
        <span>Active: <b className="text-green-600">{rows.filter(function (r) { return r.status === 'active' }).length}</b></span>
        <span>Probation: <b className="text-amber-600">{rows.filter(function (r) { return r.status === 'probation' }).length}</b></span>
        <span>Pending: <b className="text-purple-600">{rows.filter(function (r) { return r.status === 'pending' }).length}</b></span>
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
                <th className="px-3 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider w-32">Actions</th>
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
                      {(canSeeAll || r.created_by === profile.id) && (
                        <button onClick={function () { setEditRow(r) }}
                          className="text-xs px-2 py-1 rounded text-indigo-600 hover:bg-indigo-50">Edit</button>
                      )}
                      {r.status === 'pending' && isAdminOrHR && (
                        <button onClick={function () { setApproveRow(r) }}
                          className="text-xs px-2 py-1 rounded text-green-600 hover:bg-green-50 ml-1">Approve</button>
                      )}
                      {isAdminOrHR && (
                        <button onClick={function () { setDeleteRow(r) }}
                          className={"text-xs px-2 py-1 rounded ml-1 " + (r.status === 'pending' ? 'text-orange-600 hover:bg-orange-50' : 'text-red-600 hover:bg-red-50')}>{r.status === 'pending' ? 'Reject' : 'Delete'}</button>
                      )}
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

      {/* Delete / Reject confirmation */}
      <Modal open={!!deleteRow} onClose={function () { if (!saving) setDeleteRow(null) }} title={deleteRow && deleteRow.status === 'pending' ? 'Reject Submission' : 'Delete Employee'}>
        {deleteRow && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <div className="font-semibold mb-1">{deleteRow.status === 'pending' ? 'Reject and delete this pending submission?' : 'Permanent delete — cannot be undone.'}</div>
              <div>Employee record, all documents, and uploaded files will be removed.</div>
              {deleteRow.status !== 'pending' && (
                <div className="mt-2 text-xs">If this person has expenses, wallet entries, or salary history, delete will fail. Change status to Terminated / Resigned instead to preserve history.</div>
              )}
            </div>
            <div className="text-sm text-gray-700">
              <div><b>{deleteRow.full_name}</b></div>
              <div className="text-xs text-gray-500">{deleteRow.employee_code || 'no code'} · {(STATUS_STYLES[deleteRow.status] || {}).label || deleteRow.status}</div>
            </div>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <button onClick={function () { setDeleteRow(null) }} disabled={saving}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={saving}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 font-medium">
                {saving ? (deleteRow && deleteRow.status === 'pending' ? 'Rejecting...' : 'Deleting...') : (deleteRow && deleteRow.status === 'pending' ? 'Reject & Delete' : 'Delete Permanently')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Approve confirmation */}
      <Modal open={!!approveRow} onClose={function () { if (!saving) setApproveRow(null) }} title="Approve Submission">
        {approveRow && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
              <div className="font-semibold mb-1">Approve this submission?</div>
              <div>Status will change to Probation. Employee code will be generated automatically.</div>
              <div className="mt-2 text-xs">Review documents and details first via View. You can fill missing fields (departments, salary, DOJ) via Edit after approval.</div>
            </div>
            <div className="text-sm text-gray-700">
              <div><b>{approveRow.full_name}</b></div>
              <div className="text-xs text-gray-500">{approveRow.contact_number || '—'} · {approveRow.personal_email || ''}</div>
            </div>
            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <button onClick={function () { setApproveRow(null) }} disabled={saving}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleApprove} disabled={saving}
                className="px-4 py-2 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium">
                {saving ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create modal */}
      <Modal open={showCreate} onClose={function () { if (!saving) setShowCreate(false) }} title="Add Employee" wide>
        {showCreate && (
          <EmployeeForm
            employee={null}
            profile={profile}
            jobDepartments={jobDepartments}
            managers={managerList}
            canSeeSalary={canSeeSalary}
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
            canSeeSalary={canSeeSalary}
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
            canEdit={canSeeAll || viewRow.created_by === profile.id}
            canSeeSalary={canSeeSalary}
            onEdit={function (r) { setViewRow(null); setEditRow(r) }} />
        )}
      </Modal>

      {/* Import CSV preview modal */}
      <Modal open={!!importModal}
        onClose={function () { if (!importing) { setImportModal(null); setImportProgress(null) } }}
        title="Import Employees from CSV">
        {importModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{importModal.fileName}</p>
              <p className="text-xs text-gray-500 mt-1">{importModal.rows.length} data rows found</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {importModal.header.slice(0, 12).map(function (h) {
                  return <span key={h} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono">{h}</span>
                })}
                {importModal.header.length > 12 && <span className="text-[10px] text-gray-400">+{importModal.header.length - 12} more</span>}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800 space-y-1">
              <p><b>Create-only mode.</b> Existing employees (matched by personal_email, aadhaar_number, or pan_number) will be skipped.</p>
              <p><b>Job departments</b> should be semicolon-separated names matching the master list exactly (e.g., <code className="bg-white px-1 rounded">Kitchen; F&B Service</code>).</p>
              <p><b>Files</b> (Aadhaar/PAN images) are not imported. Upload them via edit afterwards.</p>
              <p><b>Employee code</b> auto-generated when blank; explicit codes are kept as-is.</p>
            </div>

            {importProgress && (
              <div>
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>Importing...</span>
                  <span>{importProgress.done} / {importProgress.total}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all"
                    style={{ width: (importProgress.total > 0 ? (importProgress.done * 100 / importProgress.total) : 0) + '%' }} />
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={function () { setImportModal(null); setImportProgress(null) }}
                disabled={importing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors">
                Cancel
              </button>
              <button onClick={runImport} disabled={importing}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                {importing ? 'Importing...' : ('Import ' + importModal.rows.length + ' Rows')}
              </button>
            </div>
          </div>
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