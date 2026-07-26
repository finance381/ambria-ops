import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'

var STATUS_STYLES = {
  active:      { label: 'Active',      cls: 'bg-green-100 text-green-700' },
  probation:   { label: 'Probation',   cls: 'bg-amber-100 text-amber-700' },
  on_leave:    { label: 'On Leave',    cls: 'bg-blue-100 text-blue-700' },
  terminated:  { label: 'Terminated',  cls: 'bg-red-100 text-red-600' },
  resigned:    { label: 'Resigned',    cls: 'bg-gray-200 text-gray-600' },
}

var GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' }
var MARITAL_LABEL = { single: 'Single', married: 'Married', divorced: 'Divorced', widowed: 'Widowed', separated: 'Separated' }

function rupees(paise) {
  if (paise == null) return null
  return '₹ ' + (paise / 100).toLocaleString('en-IN')
}

function EmployeeDetail({ employeeId, jobDepartments, managers, profile, onEdit, canEdit, canSeeSalary }) {
  var [row, setRow] = useState(null)
  var [directReports, setDirectReports] = useState([])
  var [loading, setLoading] = useState(true)
  var [error, setError] = useState('')
  var [showSensitive, setShowSensitive] = useState(false)
  var [docLoading, setDocLoading] = useState(null) // 'aadhaar' | 'pan'
  var [photoUrl, setPhotoUrl] = useState('')

  // Self-service salary state (loaded only when viewer === owner)
  var [mySalaryRollup, setMySalaryRollup] = useState(null)
  var [mySalaryEntries, setMySalaryEntries] = useState([])
  var [salaryLoading, setSalaryLoading] = useState(false)

  useEffect(function () { loadRow() }, [employeeId])

  var isSelfView = !!(profile && row && row.profile_id === profile.id)

  useEffect(function () {
    if (!isSelfView) return
    loadMySalary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelfView])

  async function loadMySalary() {
    setSalaryLoading(true)
    var [rollupRes, entriesRes] = await Promise.all([
      supabase.from('v_employee_ledger').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('ledger_entries').select('*')
        .eq('ledger_type', 'user_salary')
        .eq('party_uuid', employeeId)
        .is('deleted_at', null)
        .order('entry_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(50)
    ])
    if (!rollupRes.error) setMySalaryRollup(rollupRes.data)
    if (!entriesRes.error) setMySalaryEntries(entriesRes.data || [])
    setSalaryLoading(false)
  }

  async function loadRow() {
    setLoading(true); setError('')
    var { data, error: err } = await supabase.from('employees')
      .select('*').eq('id', employeeId).maybeSingle()
    if (err) { setError(err.message); setLoading(false); return }
    if (!data) { setError('Not found or access denied.'); setLoading(false); return }
    if (!canSeeSalary) {
      data.ctc_annual_paise = null
      data.monthly_cash_paise = null
      data.monthly_bank_paise = null
    }
    setRow(data)
    // Fetch photo signed URL
    if (data.photo_file_path) {
      supabase.storage.from('employee-docs').createSignedUrl(data.photo_file_path, 600)
        .then(function (r) { if (r.data) setPhotoUrl(r.data.signedUrl) })
    }

    var { data: reports } = await supabase.from('employees')
      .select('id, employee_code, full_name, designation, status')
      .eq('reporting_manager_id', employeeId)
      .in('status', ['active', 'probation', 'on_leave'])
      .order('full_name')
    setDirectReports(reports || [])
    setLoading(false)
  }

  async function openDoc(docType) {
    if (!row) return
    var path = docType === 'aadhaar' ? row.aadhaar_file_path : row.pan_file_path
    if (!path) return
    setDocLoading(docType)
    var { data, error: err } = await supabase.storage.from('employee-docs').createSignedUrl(path, 60)
    setDocLoading(null)
    if (err) { alert('Preview failed: ' + err.message); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
  if (!row) return null

  var st = STATUS_STYLES[row.status] || { label: row.status, cls: 'bg-gray-100 text-gray-500' }
  var jdMap = {}
  ;(jobDepartments || []).forEach(function (d) { jdMap[d.id] = d.name })
  var deptNames = (row.job_department_ids || []).map(function (id) { return jdMap[id] || ('#' + id) })

  var mgr = null
  if (row.reporting_manager_id) {
    mgr = (managers || []).find(function (m) { return m.id === row.reporting_manager_id })
  }

  var hasSensitive = row.aadhaar_number || row.pan_number || row.bank_account_number ||
                     row.ifsc_code || row.bank_name ||
                     (canSeeSalary && (row.ctc_annual_paise || row.monthly_cash_paise || row.monthly_bank_paise)) ||
                     row.uan || row.esic || row.aadhaar_file_path || row.pan_file_path

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-16 h-16 rounded-full border-2 border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
            {photoUrl ? (
              <img src={photoUrl} className="w-full h-full object-cover" alt={row.full_name} />
            ) : (
              <span className="text-2xl text-gray-300">👤</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-gray-800">{row.full_name}</h3>
            <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + st.cls}>{st.label}</span>
            {row.profile_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">APP USER</span>}
          </div>
          <div className="text-xs font-mono text-gray-500 mt-0.5">{row.employee_code}</div>
          <div className="text-xs text-gray-600 mt-1">{row.designation || '—'}{row.work_location ? ' · ' + row.work_location : ''}</div>
          </div>
        </div>
        {canEdit && onEdit && (
          <button onClick={function () { onEdit(row) }}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700">
            ✎ Edit
          </button>
        )}
      </div>

      {/* Personal */}
      <Section title="Personal">
        <Row label="Date of Birth" value={row.dob ? formatDate(row.dob) : null} />
        <Row label="Gender" value={GENDER_LABEL[row.gender]} />
        <Row label="Blood Group" value={row.blood_group} />
        <Row label="Marital Status" value={MARITAL_LABEL[row.marital_status]} />
        <Row label="Father's Name" value={row.father_name} />
        <Row label="Contact" value={row.contact_number} />
        <Row label="Emergency Contact" value={row.emergency_contact} />
        <Row label="Personal Email" value={row.personal_email} />
        <Row label="Present Address" value={row.present_address} span2 />
        <Row label="Permanent Address" value={row.permanent_address} span2 />
      </Section>

      {/* Employment */}
      <Section title="Employment">
        <Row label="Date of Joining" value={row.doj ? formatDate(row.doj) : null} />
        <Row label="Probation End" value={row.probation_end_date ? formatDate(row.probation_end_date) : null} />
        <Row label="Confirmation Date" value={row.confirmation_date ? formatDate(row.confirmation_date) : null} />
        <Row label="Work Location" value={row.work_location} />
        <Row label="Job Departments" value={
          deptNames.length === 0 ? null : (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {deptNames.map(function (n, i) {
                return <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{n}</span>
              })}
            </div>
          )
        } span2 />
        <Row label="Reporting Manager" value={
          mgr ? (mgr.full_name + ' (' + mgr.employee_code + ')') : (row.reporting_manager_id ? '—' : null)
        } />
        {row.terminated_at && <Row label="Exited On" value={formatDate(row.terminated_at)} />}
        {row.termination_reason && <Row label="Reason" value={row.termination_reason} span2 />}
      </Section>

      {/* Direct reports */}
      {directReports.length > 0 && (
        <Section title={'Direct Reports (' + directReports.length + ')'}>
          <div className="col-span-2 space-y-1">
            {directReports.map(function (dr) {
              return (
                <div key={dr.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500">{dr.employee_code}</span>
                  <span className="font-medium text-gray-700">{dr.full_name}</span>
                  <span className="text-gray-400">— {dr.designation || '—'}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Self-service Salary Ledger — only visible to the employee themselves */}
      {isSelfView && (
        <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">My Salary</div>
              <p className="text-[10px] text-gray-500 mt-0.5">Visible only to you.</p>
            </div>
            {salaryLoading && <span className="text-[10px] text-gray-400">Loading…</span>}
          </div>

          {mySalaryRollup && (
            <div className="bg-white border border-indigo-100 rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Outstanding to you</div>
              <div className={"text-2xl font-bold mt-0.5 " +
                ((mySalaryRollup.balance_paise || 0) > 0 ? "text-amber-800"
                 : (mySalaryRollup.balance_paise || 0) < 0 ? "text-red-700" : "text-gray-500")}>
                {rupees(mySalaryRollup.balance_paise) || '₹ 0'}
              </div>
              {((mySalaryRollup.cash_balance_paise || 0) !== 0 || (mySalaryRollup.bank_balance_paise || 0) !== 0) && (
                <div className="flex gap-3 mt-1.5 text-[11px] flex-wrap">
                  <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{rupees(mySalaryRollup.cash_balance_paise) || '₹ 0'}</span></span>
                  <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{rupees(mySalaryRollup.bank_balance_paise) || '₹ 0'}</span></span>
                </div>
              )}
              {(mySalaryRollup.unpaid_since_days || 0) >= 30 && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700 font-medium">
                  ⏳ Unpaid for {mySalaryRollup.unpaid_since_days} days
                </div>
              )}
            </div>
          )}

          {mySalaryEntries.length === 0 && !salaryLoading ? (
            <p className="text-[11px] text-gray-500 text-center py-3">No salary entries yet.</p>
          ) : (
            <div className="bg-white border border-indigo-100 rounded-md overflow-hidden">
              {mySalaryEntries.map(function (e, idx) {
                var isCredit = (e.credit_paise || 0) > 0
                var amt = isCredit ? (e.credit_paise || 0) : (e.debit_paise || 0)
                var meta = e.metadata || {}
                var kind = meta.kind || e.ref_type
                return (
                  <div key={e.id}
                    className={"flex items-start gap-2 px-2.5 py-2 " +
                      (idx < mySalaryEntries.length - 1 ? "border-b border-gray-100" : "")}>
                    <div className={"w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 " +
                      (isCredit ? "bg-amber-500" : "bg-green-500")}></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {e.description || (isCredit ? 'Salary credit' : 'Salary payment')}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {e.entry_date} · {kind}
                        {meta.salary_month ? ' · ' + meta.salary_month : ''}
                        {meta.reason ? ' · ' + meta.reason : ''}
                      </p>
                      {meta.mode && (
                        <span className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                          {meta.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      )}
                    </div>
                    <p className={"text-xs font-bold flex-shrink-0 " + (isCredit ? "text-amber-800" : "text-green-700")}>
                      {isCredit ? '+' : '−'}{rupees(amt)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Sensitive gate */}
      {hasSensitive && !showSensitive && (
        <button onClick={function () { setShowSensitive(true) }}
          className="w-full py-3 border-2 border-dashed border-amber-300 rounded-lg text-sm text-amber-700 font-medium hover:bg-amber-50 transition-colors">
          🔒 Show sensitive info (Statutory · Bank · Salary · Documents)
        </button>
      )}

      {hasSensitive && showSensitive && (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 flex items-center justify-between">
            <span>🔒 Sensitive information — visible only to admin, Finance/HR, and the employee.</span>
            <button onClick={function () { setShowSensitive(false) }}
              className="text-amber-700 hover:text-amber-900 text-xs font-semibold">Hide</button>
          </div>

          <Section title="Statutory">
            <Row label="Aadhaar" value={row.aadhaar_number} mono />
            <Row label="PAN" value={row.pan_number} mono />
            <Row label="UAN (PF)" value={row.uan} mono />
            <Row label="ESIC" value={row.esic} mono />
            <Row label="PT State" value={row.pt_state} />
          </Section>

          <Section title="Bank & Salary">
            <Row label="Bank Name" value={row.bank_name} />
            <Row label="Account Number" value={row.bank_account_number} mono />
            <Row label="IFSC" value={row.ifsc_code} mono />
            {canSeeSalary ? (
              <>
                <Row label="Monthly Cash" value={rupees(row.monthly_cash_paise)} />
                <Row label="Monthly Bank" value={rupees(row.monthly_bank_paise)} />
                <Row label="Annual CTC (derived)" value={rupees(row.ctc_annual_paise)} span2 />
              </>
            ) : (
              <Row label="Salary" value={<span className="italic text-gray-400">🔒 Restricted</span>} span2 />
            )}
          </Section>

          <Section title="Documents">
            <div className="col-span-2 flex flex-wrap gap-2">
              <DocButton label="Aadhaar Card" hasFile={!!row.aadhaar_file_path}
                onOpen={function () { openDoc('aadhaar') }}
                loading={docLoading === 'aadhaar'}
                expiryDate={row.aadhaar_expiry_date} />
              <DocButton label="PAN Card" hasFile={!!row.pan_file_path}
                onOpen={function () { openDoc('pan') }}
                loading={docLoading === 'pan'}
                expiryDate={row.pan_expiry_date} />
            </div>
          </Section>
        </>
      )}

      {/* Audit footer */}
      <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-100 flex flex-wrap gap-x-4">
        {row.created_at && <span>Created: {formatDate(row.created_at)}</span>}
        {row.updated_at && <span>Updated: {formatDate(row.updated_at)}</span>}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  )
}

function Row({ label, value, span2, mono }) {
  var cls = span2 ? 'col-span-2' : ''
  var valCls = 'text-sm text-gray-800 ' + (mono ? 'font-mono' : '') + ' whitespace-pre-wrap break-words'
  return (
    <div className={cls}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-0.5">{label}</div>
      <div className={valCls}>{value == null || value === '' ? <span className="text-gray-300">—</span> : value}</div>
    </div>
  )
}

function DocButton({ label, hasFile, onOpen, loading, expiryDate }) {
  if (!hasFile) {
    return (
      <div className="px-3 py-2 border border-gray-200 rounded-md text-xs text-gray-400 bg-gray-50">
        {label}: not uploaded
      </div>
    )
  }
  var expiryStatus = null
  if (expiryDate) {
    var _today = new Date().toISOString().split('T')[0]
    var _diff = Math.floor((new Date(expiryDate) - new Date(_today)) / 86400000)
    if (_diff < 0) expiryStatus = { cls: 'text-red-600', label: 'Expired ' + expiryDate }
    else if (_diff <= 30) expiryStatus = { cls: 'text-amber-600', label: _diff + 'd left · ' + expiryDate }
    else expiryStatus = { cls: 'text-gray-500', label: 'Exp: ' + expiryDate }
  }
  return (
    <div className="flex flex-col gap-1">
      <button onClick={onOpen} disabled={loading}
        className="px-3 py-2 border border-indigo-200 bg-indigo-50 rounded-md text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
        {loading ? '⏳ ' + label : '👁 View ' + label}
      </button>
      {expiryStatus && (
        <span className={"text-[10px] " + expiryStatus.cls}>⏱ {expiryStatus.label}</span>
      )}
    </div>
  )
}

export default EmployeeDetail