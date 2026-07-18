import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'

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

function MyProfile({ profile }) {
  var [row, setRow] = useState(null)
  var [loading, setLoading] = useState(true)
  var [error, setError] = useState('')
  var [showSensitive, setShowSensitive] = useState(false)
  var [docLoading, setDocLoading] = useState(null)

  // Editable fields
  var [editing, setEditing] = useState(false)
  var [contactNumber, setContactNumber] = useState('')
  var [emergencyContact, setEmergencyContact] = useState('')
  var [presentAddress, setPresentAddress] = useState('')
  var [permanentAddress, setPermanentAddress] = useState('')
  var [saving, setSaving] = useState(false)
  var [savedMsg, setSavedMsg] = useState('')

  useEffect(function () { loadRow() }, [])

  async function loadRow() {
    setLoading(true); setError('')
    // RLS ensures the user only gets their own row via profile_id = auth.uid()
    var { data, error: err } = await supabase.from('employees')
      .select('*').eq('profile_id', profile.id).maybeSingle()
    if (err) { setError(err.message); setLoading(false); return }
    if (!data) {
      setError('No employee record is linked to your account. Ask an administrator to link your record.')
      setLoading(false); return
    }
    setRow(data)
    setContactNumber(data.contact_number || '')
    setEmergencyContact(data.emergency_contact || '')
    setPresentAddress(data.present_address || '')
    setPermanentAddress(data.permanent_address || '')
    setLoading(false)
  }

  async function saveEdits() {
    if (saving) return
    setSaving(true); setError(''); setSavedMsg('')
    var { data, error: err } = await supabase.rpc('update_my_employee_profile', {
      p_contact_number: contactNumber.trim(),
      p_emergency_contact: emergencyContact.trim(),
      p_present_address: presentAddress.trim(),
      p_permanent_address: permanentAddress.trim(),
    })
    if (err) { setError(err.message); setSaving(false); return }
    try { await logActivity('MY_PROFILE_UPDATE', row.employee_code + ' | self-update') } catch (_) {}
    setRow(data)
    setEditing(false)
    setSaving(false)
    setSavedMsg('Saved. Changes visible to admin & Finance/HR.')
    setTimeout(function () { setSavedMsg('') }, 3500)
  }

  function cancelEdit() {
    setContactNumber(row.contact_number || '')
    setEmergencyContact(row.emergency_contact || '')
    setPresentAddress(row.present_address || '')
    setPermanentAddress(row.permanent_address || '')
    setEditing(false)
    setError('')
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

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading your profile...</p>
  }

  if (error && !row) {
    return (
      <div className="max-w-md mx-auto mt-8 bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-sm text-amber-800">{error}</p>
      </div>
    )
  }

  if (!row) return null

  var st = STATUS_STYLES[row.status] || { label: row.status, cls: 'bg-gray-100 text-gray-500' }
  var hasSensitive = row.aadhaar_number || row.pan_number || row.bank_account_number ||
                     row.ifsc_code || row.bank_name || row.ctc_annual_paise ||
                     row.uan || row.esic || row.aadhaar_file_path || row.pan_file_path

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-800">{row.full_name}</h2>
              <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + st.cls}>{st.label}</span>
            </div>
            <div className="text-xs font-mono text-gray-500 mt-0.5">{row.employee_code}</div>
            <div className="text-sm text-gray-700 mt-1">
              {row.designation || '—'}
              {row.work_location ? ' · ' + row.work_location : ''}
            </div>
          </div>
        </div>
      </div>

      {savedMsg && (
        <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 text-sm text-green-800">✓ {savedMsg}</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Editable: Contact & Address */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Contact & Address</div>
          {!editing ? (
            <button onClick={function () { setEditing(true); setSavedMsg('') }}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 font-medium">
              ✎ Edit
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={cancelEdit} disabled={saving}
                className="text-xs px-3 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveEdits} disabled={saving}
                className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-medium">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <MyField label="Contact Number">
              <input type="tel" value={contactNumber} onChange={function (e) { setContactNumber(e.target.value) }}
                style={{ fontSize: '16px' }} className={myInp} />
            </MyField>
            <MyField label="Emergency Contact">
              <input type="tel" value={emergencyContact} onChange={function (e) { setEmergencyContact(e.target.value) }}
                style={{ fontSize: '16px' }} className={myInp} />
            </MyField>
            <MyField label="Present Address">
              <textarea value={presentAddress} onChange={function (e) { setPresentAddress(e.target.value) }}
                rows="2" style={{ fontSize: '16px' }} className={myInp + ' resize-none'} />
            </MyField>
            <MyField label="Permanent Address">
              <textarea value={permanentAddress} onChange={function (e) { setPermanentAddress(e.target.value) }}
                rows="2" style={{ fontSize: '16px' }} className={myInp + ' resize-none'} />
            </MyField>
            <p className="text-[11px] text-gray-500">
              Other fields (name, DOB, department, statutory, bank, salary) can only be updated by admin or Finance/HR. Contact them to change any of those.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            <MyRow label="Contact" value={row.contact_number} />
            <MyRow label="Personal Email" value={row.personal_email} />
            <MyRow label="Emergency Contact" value={row.emergency_contact} />
            <MyRow label="Present Address" value={row.present_address} span2 />
            <MyRow label="Permanent Address" value={row.permanent_address} span2 />
          </div>
        )}
      </div>

      {/* Personal (read-only) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Personal</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
          <MyRow label="Date of Birth" value={row.dob ? formatDate(row.dob) : null} />
          <MyRow label="Gender" value={GENDER_LABEL[row.gender]} />
          <MyRow label="Blood Group" value={row.blood_group} />
          <MyRow label="Marital Status" value={MARITAL_LABEL[row.marital_status]} />
          <MyRow label="Father's Name" value={row.father_name} span2 />
        </div>
      </div>

      {/* Employment (read-only) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Employment</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
          <MyRow label="Date of Joining" value={row.doj ? formatDate(row.doj) : null} />
          <MyRow label="Probation End" value={row.probation_end_date ? formatDate(row.probation_end_date) : null} />
          <MyRow label="Confirmation Date" value={row.confirmation_date ? formatDate(row.confirmation_date) : null} />
          <MyRow label="Work Location" value={row.work_location} />
        </div>
      </div>

      {/* Sensitive (self can view) */}
      {hasSensitive && !showSensitive && (
        <button onClick={function () { setShowSensitive(true) }}
          className="w-full py-3 border-2 border-dashed border-amber-300 rounded-lg text-sm text-amber-700 font-medium hover:bg-amber-50 transition-colors">
          🔒 Show sensitive info (Statutory · Bank · Salary · Documents)
        </button>
      )}

      {hasSensitive && showSensitive && (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 flex items-center justify-between">
            <span>🔒 Your sensitive info. Do not share these screens.</span>
            <button onClick={function () { setShowSensitive(false) }}
              className="text-amber-700 hover:text-amber-900 text-xs font-semibold">Hide</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Statutory</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
              <MyRow label="Aadhaar" value={row.aadhaar_number} mono />
              <MyRow label="PAN" value={row.pan_number} mono />
              <MyRow label="UAN (PF)" value={row.uan} mono />
              <MyRow label="ESIC" value={row.esic} mono />
              <MyRow label="PT State" value={row.pt_state} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Bank & Salary</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
              <MyRow label="Bank Name" value={row.bank_name} />
              <MyRow label="Account Number" value={row.bank_account_number} mono />
              <MyRow label="IFSC" value={row.ifsc_code} mono />
              <MyRow label="Annual CTC" value={rupees(row.ctc_annual_paise)} />
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              Bank details or CTC need to change? Contact Finance/HR.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Documents</div>
            <div className="flex flex-wrap gap-2">
              <MyDocButton label="Aadhaar Card" hasFile={!!row.aadhaar_file_path}
                onOpen={function () { openDoc('aadhaar') }}
                loading={docLoading === 'aadhaar'}
                expiryDate={row.aadhaar_expiry_date} />
              <MyDocButton label="PAN Card" hasFile={!!row.pan_file_path}
                onOpen={function () { openDoc('pan') }}
                loading={docLoading === 'pan'}
                expiryDate={row.pan_expiry_date} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

var myInp = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"

function MyField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function MyRow({ label, value, span2, mono }) {
  var cls = span2 ? 'md:col-span-2' : ''
  var valCls = 'text-sm text-gray-800 ' + (mono ? 'font-mono' : '') + ' whitespace-pre-wrap break-words'
  return (
    <div className={cls}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-0.5">{label}</div>
      <div className={valCls}>{value == null || value === '' ? <span className="text-gray-300">—</span> : value}</div>
    </div>
  )
}

function MyDocButton({ label, hasFile, onOpen, loading, expiryDate }) {
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
    if (_diff < 0) expiryStatus = { cls: 'text-red-600', label: 'Expired · renew with HR' }
    else if (_diff <= 30) expiryStatus = { cls: 'text-amber-600', label: _diff + 'd left (' + expiryDate + ')' }
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

export default MyProfile