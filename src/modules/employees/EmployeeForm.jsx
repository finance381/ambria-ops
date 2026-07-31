import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'

var BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
var GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]
var MARITAL = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
]
var STATUSES = [
  { value: 'probation', label: 'Probation' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'resigned', label: 'Resigned' },
]
var ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
var MAX_FILE_BYTES = 10 * 1024 * 1024
var DOC_TYPES = [
  { key: 'aadhaar', label: 'Aadhaar Card', mandatory: true, hasExpiry: false },
  { key: 'pan', label: 'PAN Card', mandatory: true, hasExpiry: false },
  { key: 'passport', label: 'Passport', mandatory: false, hasExpiry: true },
  { key: 'driving_license', label: 'Driving License', mandatory: false, hasExpiry: true },
  { key: 'voter_id', label: 'Voter ID', mandatory: false, hasExpiry: false },
  { key: 'bank_proof', label: 'Bank Passbook / Cheque', mandatory: false, hasExpiry: false },
  { key: 'education', label: 'Educational Certificate', mandatory: false, hasExpiry: false },
  { key: 'previous_employment', label: 'Previous Employment', mandatory: false, hasExpiry: false },
  { key: 'address_proof', label: 'Address Proof', mandatory: false, hasExpiry: true },
  { key: 'medical_fitness', label: 'Medical Fitness Certificate', mandatory: false, hasExpiry: true },
  { key: 'police_verification', label: 'Police Verification', mandatory: false, hasExpiry: true },
]

function initDocs() {
  var init = {}
  DOC_TYPES.forEach(function (d) {
    init[d.key] = { file: null, existingPath: '', expiry: '', enabled: d.mandatory }
  })
  return init
}

function fileExt(f) {
  var parts = (f.name || '').split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function EmployeeForm({ employee, profile, jobDepartments, managers, canSeeSalary, onClose, onSaved }) {
  var isEdit = !!(employee && employee.id)

  var [tab, setTab] = useState('personal')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Personal
  var [fullName, setFullName] = useState('')
  var [dob, setDob] = useState('')
  var [gender, setGender] = useState('')
  var [fatherName, setFatherName] = useState('')
  var [bloodGroup, setBloodGroup] = useState('')
  var [maritalStatus, setMaritalStatus] = useState('')
  var [contactNumber, setContactNumber] = useState('')
  var [personalEmail, setPersonalEmail] = useState('')
  var [emergencyContact, setEmergencyContact] = useState('')
  var [presentAddress, setPresentAddress] = useState('')
  var [permanentAddress, setPermanentAddress] = useState('')
  var [sameAddress, setSameAddress] = useState(false)

  // Employment
  var [employeeCode, setEmployeeCode] = useState('')
  var [doj, setDoj] = useState('')
  var [probationEnd, setProbationEnd] = useState('')
  var [confirmationDate, setConfirmationDate] = useState('')
  var [designation, setDesignation] = useState('')
  var [jobDeptIds, setJobDeptIds] = useState([])
  var [reportingManagerId, setReportingManagerId] = useState('')
  var [workLocation, setWorkLocation] = useState('')
  var [status, setStatus] = useState('probation')
  var [terminationReason, setTerminationReason] = useState('')

  // Statutory
  var [aadhaar, setAadhaar] = useState('')
  var [pan, setPan] = useState('')
  var [uan, setUan] = useState('')
  var [esic, setEsic] = useState('')
  var [ptState, setPtState] = useState('')

  // Bank & salary
  var [bankAccount, setBankAccount] = useState('')
  var [ifsc, setIfsc] = useState('')
  var [bankName, setBankName] = useState('')
  var [monthlyCashRupees, setMonthlyCashRupees] = useState('')
  var [monthlyBankRupees, setMonthlyBankRupees] = useState('')
  var [nightWageRupees, setNightWageRupees] = useState('')
  var [shiftFrom, setShiftFrom] = useState('')
  var [shiftTo, setShiftTo] = useState('')

  // Photo
  var [photoFile, setPhotoFile] = useState(null)
  var [photoPath, setPhotoPath] = useState('')
  var [photoSignedUrl, setPhotoSignedUrl] = useState('')

  // Docs — unified state, one entry per doc type
  var [docs, setDocs] = useState(initDocs())

  useEffect(function () {
    if (!isEdit) return
    var e = employee
    setFullName(e.full_name || '')
    setDob(e.dob || '')
    setGender(e.gender || '')
    setFatherName(e.father_name || '')
    setBloodGroup(e.blood_group || '')
    setMaritalStatus(e.marital_status || '')
    setContactNumber(e.contact_number || '')
    setPersonalEmail(e.personal_email || '')
    setEmergencyContact(e.emergency_contact || '')
    setPresentAddress(e.present_address || '')
    setPermanentAddress(e.permanent_address || '')

    setEmployeeCode(e.employee_code || '')
    setDoj(e.doj || '')
    setProbationEnd(e.probation_end_date || '')
    setConfirmationDate(e.confirmation_date || '')
    setDesignation(e.designation || '')
    setJobDeptIds(e.job_department_ids || [])
    setReportingManagerId(e.reporting_manager_id || '')
    setWorkLocation(e.work_location || '')
    setStatus(e.status || 'probation')
    setTerminationReason(e.termination_reason || '')

    setAadhaar(e.aadhaar_number || '')
    setPan(e.pan_number || '')
    setUan(e.uan || '')
    setEsic(e.esic || '')
    setPtState(e.pt_state || '')

    setBankAccount(e.bank_account_number || '')
    setIfsc(e.ifsc_code || '')
    setBankName(e.bank_name || '')
    setMonthlyCashRupees(canSeeSalary && e.monthly_cash_paise
      ? String(Math.round(e.monthly_cash_paise / 100)) : '')
    setMonthlyBankRupees(canSeeSalary && e.monthly_bank_paise
      ? String(Math.round(e.monthly_bank_paise / 100)) : '')
    setNightWageRupees(canSeeSalary && e.night_wage_paise
      ? String(Math.round(e.night_wage_paise / 100)) : '')
    setShiftFrom(e.shift_start ? e.shift_start.slice(0, 5) : '')
    setShiftTo(e.shift_end ? e.shift_end.slice(0, 5) : '')

    setPhotoPath(e.photo_file_path || '')
  }, [employee])

  // Load existing docs from employee_documents on edit
  useEffect(function () {
    if (!isEdit || !employee?.id) return
    supabase.from('employee_documents')
      .select('doc_type, file_path, expiry_date')
      .eq('employee_id', employee.id)
      .then(function (res) {
        var rows = res.data || []
        setDocs(function (prev) {
          var next = Object.assign({}, prev)
          rows.forEach(function (r) {
            if (next[r.doc_type]) {
              next[r.doc_type] = Object.assign({}, next[r.doc_type], {
                existingPath: r.file_path || '',
                expiry: r.expiry_date || '',
                enabled: true,
              })
            }
          })
          return next
        })
      })
  }, [employee?.id])

  // Fetch signed URL for existing photo
  useEffect(function () {
    if (!photoPath) { setPhotoSignedUrl(''); return }
    supabase.storage.from('employee-docs').createSignedUrl(photoPath, 600)
      .then(function (res) { if (res.data) setPhotoSignedUrl(res.data.signedUrl) })
  }, [photoPath])

  useEffect(function () {
    if (sameAddress) setPermanentAddress(presentAddress)
  }, [sameAddress, presentAddress])

  function validate() {
    if (!fullName.trim()) return { tab: 'personal', msg: 'Full Name is required' }

    if (personalEmail && personalEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(personalEmail.trim())) return { tab: 'personal', msg: 'Personal Email format invalid' }
    if (aadhaar && !/^[0-9]{12}$/.test(aadhaar.trim())) return { tab: 'statutory', msg: 'Aadhaar must be 12 digits' }
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase())) return { tab: 'statutory', msg: 'PAN format invalid (AAAAA9999A)' }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) return { tab: 'bank', msg: 'IFSC format invalid' }
    if (monthlyCashRupees && Number(monthlyCashRupees) < 0) return { tab: 'bank', msg: 'Monthly Cash cannot be negative' }
    if (monthlyBankRupees && Number(monthlyBankRupees) < 0) return { tab: 'bank', msg: 'Monthly Bank cannot be negative' }

    return null
  }

  function checkFile(f) {
    if (!f) return null
    if (ALLOWED_MIME.indexOf(f.type) === -1) return 'File type must be PDF, JPEG, PNG, or WEBP'
    if (f.size > MAX_FILE_BYTES) return 'File size must be under 10 MB'
    return null
  }

  async function uploadDoc(employeeId, docType, file, oldPath) {
    var ext = fileExt(file)
    var newPath = employeeId + '/' + docType + '.' + ext
    var { error: upErr } = await supabase.storage.from('employee-docs')
      .upload(newPath, file, { upsert: true, contentType: file.type })
    if (upErr) throw upErr
    // Delete old if extension differed (upsert overwrites same key only)
    if (oldPath && oldPath !== newPath) {
      try { await supabase.storage.from('employee-docs').remove([oldPath]) } catch (_) {}
    }
    return newPath
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    setError('')

    var v = validate()
    if (v) { setTab(v.tab); setError(v.msg); return }

    var fileErr = checkFile(photoFile)
    if (!fileErr) {
      for (var _k = 0; _k < DOC_TYPES.length; _k++) {
        var _dk = DOC_TYPES[_k].key
        if (docs[_dk] && docs[_dk].enabled && docs[_dk].file) {
          fileErr = checkFile(docs[_dk].file)
          if (fileErr) break
        }
      }
    }
    if (fileErr) { setError(fileErr); return }

    setSaving(true)

    var payload = {
      full_name: fullName.trim(),
      dob: dob || null,
      gender: gender || null,
      father_name: fatherName.trim() || null,
      blood_group: bloodGroup || null,
      marital_status: maritalStatus || null,
      contact_number: contactNumber.trim() || null,
      personal_email: personalEmail.trim() || null,
      emergency_contact: emergencyContact.trim() || null,
      present_address: presentAddress.trim() || null,
      permanent_address: permanentAddress.trim() || null,
      doj: doj || null,
      probation_end_date: probationEnd || null,
      confirmation_date: confirmationDate || null,
      designation: designation.trim() || null,
      job_department_ids: jobDeptIds,
      reporting_manager_id: reportingManagerId || null,
      work_location: workLocation.trim() || null,
      status: status || 'probation',
      termination_reason: (status === 'terminated' || status === 'resigned') ? (terminationReason.trim() || null) : null,
      aadhaar_number: aadhaar.trim() || null,
      pan_number: pan.trim().toUpperCase() || null,
      uan: uan.trim() || null,
      esic: esic.trim() || null,
      pt_state: ptState.trim() || null,
      bank_account_number: bankAccount.trim() || null,
      ifsc_code: ifsc.trim().toUpperCase() || null,
      bank_name: bankName.trim() || null,
      shift_start: shiftFrom || null,
      shift_end: shiftTo || null,
    }
    if (canSeeSalary) {
      var cashP = monthlyCashRupees ? Math.round(Number(monthlyCashRupees) * 100) : 0
      var bankP = monthlyBankRupees ? Math.round(Number(monthlyBankRupees) * 100) : 0
      var nightP = nightWageRupees ? Math.round(Number(nightWageRupees) * 100) : 0
      payload.monthly_cash_paise = cashP
      payload.monthly_bank_paise = bankP
      payload.night_wage_paise = nightP > 0 ? nightP : null
      payload.ctc_annual_paise = (cashP + bankP) > 0 ? (cashP + bankP) * 12 : null
    }

    // Employee code: only send on insert if user overrode. Blank → let trigger generate.
    if (!isEdit && employeeCode.trim()) {
      payload.employee_code = employeeCode.trim()
    } else if (isEdit && employeeCode.trim() && employeeCode.trim() !== employee.employee_code) {
      payload.employee_code = employeeCode.trim()
    }

    if (!isEdit) payload.created_by = profile?.id || null
    payload.updated_by = profile?.id || null

    var savedRow = null
    var opErr = null

    if (isEdit) {
      var upd = await supabase.from('employees').update(payload).eq('id', employee.id).select().single()
      savedRow = upd.data; opErr = upd.error
    } else {
      var ins = await supabase.from('employees').insert(payload).select().single()
      savedRow = ins.data; opErr = ins.error
    }

    if (opErr || !savedRow) {
      setError((opErr && opErr.message) || 'Save failed')
      setSaving(false)
      return
    }

    // Upload files + sync employee_documents rows
    var fileErrors = []
    for (var _di = 0; _di < DOC_TYPES.length; _di++) {
      var _dt = DOC_TYPES[_di]
      var _state = docs[_dt.key]
      if (!_state) continue

      if (_state.enabled && _state.file) {
        // New file → upload + upsert row
        try {
          var _newPath = await uploadDoc(savedRow.id, _dt.key, _state.file, _state.existingPath)
          var upErr = (await supabase.from('employee_documents')
            .upsert({
              employee_id: savedRow.id,
              doc_type: _dt.key,
              file_path: _newPath,
              expiry_date: _dt.hasExpiry ? (_state.expiry || null) : null,
              uploaded_by: profile?.id || null,
            }, { onConflict: 'employee_id,doc_type' })).error
          if (upErr) throw upErr
        } catch (err) {
          fileErrors.push(_dt.label + ' upload failed: ' + (err.message || err))
        }
      } else if (_state.enabled && _state.existingPath && _dt.hasExpiry) {
        // No new file but expiry may have changed
        try {
          await supabase.from('employee_documents')
            .update({ expiry_date: _state.expiry || null })
            .eq('employee_id', savedRow.id).eq('doc_type', _dt.key)
        } catch (err) {
          fileErrors.push(_dt.label + ' expiry update failed: ' + (err.message || err))
        }
      } else if (!_state.enabled && _state.existingPath) {
        // User un-checked → remove doc row + storage file
        try {
          await supabase.from('employee_documents')
            .delete().eq('employee_id', savedRow.id).eq('doc_type', _dt.key)
          try { await supabase.storage.from('employee-docs').remove([_state.existingPath]) } catch (_) {}
        } catch (err) {
          fileErrors.push(_dt.label + ' removal failed: ' + (err.message || err))
        }
      }
    }
    if (photoFile) {
      try {
        var newPhotoPath = await uploadDoc(savedRow.id, 'photo', photoFile, photoPath)
        setPhotoPath(newPhotoPath)
        setPhotoFile(null)
        await supabase.from('employees').update({ photo_file_path: newPhotoPath }).eq('id', savedRow.id)
      } catch (err) {
        fileErrors.push('Photo upload failed: ' + (err.message || err))
      }
    }

    try {
      await logActivity(isEdit ? 'EMPLOYEE_UPDATE' : 'EMPLOYEE_CREATE',
        savedRow.employee_code + ' | ' + savedRow.full_name)
    } catch (_) {}

    setSaving(false)

    if (fileErrors.length > 0) {
      setError('Employee saved, but: ' + fileErrors.join(' · ') + ' — you can retry from the edit screen.')
      // Don't close so user sees the error; still call onSaved to refresh list
      if (onSaved) onSaved()
      return
    }

    if (onSaved) onSaved()
    if (onClose) onClose()
  }

  var jobDeptOptions = (jobDepartments || []).filter(function (d) { return d.is_active })
  var managerOptions = (managers || [])
    .filter(function (m) { return m.id !== (employee?.id) }) // avoid self as manager
    .map(function (m) {
      return { value: m.id, label: m.full_name + ' — ' + (m.designation || '—') + ' (' + m.employee_code + ')' }
    })

  function toggleDept(id) {
    if (jobDeptIds.indexOf(id) === -1) {
      setJobDeptIds(jobDeptIds.concat([id]))
    } else {
      setJobDeptIds(jobDeptIds.filter(function (x) { return x !== id }))
    }
  }

  var TABS = [
    { key: 'personal', label: 'Personal' },
    { key: 'employment', label: 'Employment' },
    { key: 'statutory', label: 'Statutory' },
    { key: 'bank', label: 'Bank & Salary' },
    { key: 'documents', label: 'Documents' },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Photo */}
      <div className="flex items-center gap-4 pb-3 border-b border-gray-100">
        <div className="w-20 h-20 rounded-full border-2 border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
          {photoFile ? (
            <img src={URL.createObjectURL(photoFile)} className="w-full h-full object-cover" alt="Preview" />
          ) : photoSignedUrl ? (
            <img src={photoSignedUrl} className="w-full h-full object-cover" alt="Employee" />
          ) : (
            <span className="text-3xl text-gray-300">👤</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <label className="inline-block px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md cursor-pointer hover:bg-indigo-100">
            {(photoPath || photoFile) ? 'Replace Photo' : 'Upload Photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={function (e) { setPhotoFile(e.target.files[0] || null) }}
              className="sr-only" />
          </label>
          {photoFile && (
            <button type="button" onClick={function () { setPhotoFile(null) }}
              className="ml-2 text-xs text-gray-500 hover:text-gray-700">Cancel selection</button>
          )}
          <p className="text-[10px] text-gray-400 mt-1">JPEG, PNG, WEBP. Max 10 MB.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 overflow-x-auto">
        {TABS.map(function (t) {
          return (
            <button type="button" key={t.key} onClick={function () { setTab(t.key) }}
              className={"px-3 py-2 text-xs font-semibold rounded-md whitespace-nowrap transition-colors " +
                (tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ═══ PERSONAL ═══ */}
      {tab === 'personal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Full Name" required>
            <input type="text" value={fullName} onChange={function (e) { setFullName(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Date of Birth" required>
            <input type="date" value={dob} onChange={function (e) { setDob(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Gender" required>
            <select value={gender} onChange={function (e) { setGender(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp}>
              <option value="">Select...</option>
              {GENDERS.map(function (g) { return <option key={g.value} value={g.value}>{g.label}</option> })}
            </select>
          </Field>
          <Field label="Father's Name" required>
            <input type="text" value={fatherName} onChange={function (e) { setFatherName(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Blood Group">
            <select value={bloodGroup} onChange={function (e) { setBloodGroup(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp}>
              <option value="">—</option>
              {BLOOD_GROUPS.map(function (b) { return <option key={b} value={b}>{b}</option> })}
            </select>
          </Field>
          <Field label="Marital Status" required>
            <select value={maritalStatus} onChange={function (e) { setMaritalStatus(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp}>
              <option value="">Select...</option>
              {MARITAL.map(function (m) { return <option key={m.value} value={m.value}>{m.label}</option> })}
            </select>
          </Field>
          <Field label="Contact Number" required>
            <input type="tel" value={contactNumber} onChange={function (e) { setContactNumber(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Personal Email" required>
            <input type="email" value={personalEmail} onChange={function (e) { setPersonalEmail(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Emergency Contact" required>
            <input type="tel" value={emergencyContact} onChange={function (e) { setEmergencyContact(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Present Address" required>
              <textarea value={presentAddress} onChange={function (e) { setPresentAddress(e.target.value) }}
                rows="2" style={{ fontSize: '16px' }} className={inp + ' resize-none'} />
            </Field>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <input type="checkbox" id="sameaddr" checked={sameAddress}
              onChange={function (e) { setSameAddress(e.target.checked) }}
              className="w-4 h-4 rounded" />
            <label htmlFor="sameaddr" className="text-xs text-gray-600 cursor-pointer">Permanent address same as present</label>
          </div>
          <div className="md:col-span-2">
            <Field label="Permanent Address" required>
              <textarea value={permanentAddress} onChange={function (e) { setPermanentAddress(e.target.value) }}
                rows="2" disabled={sameAddress} style={{ fontSize: '16px' }}
                className={inp + ' resize-none' + (sameAddress ? ' bg-gray-50 text-gray-500' : '')} />
            </Field>
          </div>
        </div>
      )}

      {/* ═══ EMPLOYMENT ═══ */}
      {tab === 'employment' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={"Employee Code" + (isEdit ? '' : ' (auto if blank)')}>
            <input type="text" value={employeeCode}
              onChange={function (e) { setEmployeeCode(e.target.value) }}
              placeholder={isEdit ? '' : 'Auto-generated on save'}
              style={{ fontSize: '16px' }} className={inp + ' font-mono'} />
          </Field>
          <Field label="Date of Joining" required>
            <input type="date" value={doj} onChange={function (e) { setDoj(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Probation End Date">
            <input type="date" value={probationEnd} onChange={function (e) { setProbationEnd(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Confirmation Date">
            <input type="date" value={confirmationDate} onChange={function (e) { setConfirmationDate(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Designation" required>
            <input type="text" value={designation} onChange={function (e) { setDesignation(e.target.value) }}
              placeholder="e.g. Senior Coordinator"
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
          <Field label="Work Location">
            <input type="text" value={workLocation} onChange={function (e) { setWorkLocation(e.target.value) }}
              placeholder="e.g. Pushpanjali, Exotica..."
              style={{ fontSize: '16px' }} className={inp} />
          </Field>

          <div className="md:col-span-2">
            <Field label="Job Departments (multi-select)">
              <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-md bg-gray-50 min-h-[42px]">
                {jobDeptOptions.length === 0 && <span className="text-xs text-gray-400">No job departments configured. Add via Masters → Job Departments.</span>}
                {jobDeptOptions.map(function (d) {
                  var checked = jobDeptIds.indexOf(d.id) !== -1
                  return (
                    <button type="button" key={d.id} onClick={function () { toggleDept(d.id) }}
                      className={"px-2.5 py-1 text-xs rounded-full border transition-colors " +
                        (checked
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-indigo-400")}>
                      {checked ? '✓ ' : ''}{d.name}
                    </button>
                  )
                })}
              </div>
            </Field>
          </div>

          <div className="md:col-span-2">
            <SearchDropdown
              label="Reporting Manager"
              items={managerOptions}
              value={reportingManagerId}
              onChange={setReportingManagerId}
              placeholder="Search manager by name or code..."
            />
          </div>

          <Field label="Status" required>
            <select value={status} onChange={function (e) { setStatus(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp}>
              {STATUSES.map(function (s) { return <option key={s.value} value={s.value}>{s.label}</option> })}
            </select>
          </Field>

          {(status === 'terminated' || status === 'resigned') && (
            <div className="md:col-span-2">
              <Field label="Termination / Resignation Reason" required>
                <textarea value={terminationReason}
                  onChange={function (e) { setTerminationReason(e.target.value) }}
                  rows="2" style={{ fontSize: '16px' }} className={inp + ' resize-none'} />
              </Field>
            </div>
          )}
        </div>
      )}

      {/* ═══ STATUTORY ═══ */}
      {tab === 'statutory' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Aadhaar Number (12 digits)">
            <input type="text" value={aadhaar}
              onChange={function (e) { setAadhaar(e.target.value.replace(/\s/g, '')) }}
              maxLength="12" inputMode="numeric"
              style={{ fontSize: '16px' }} className={inp + ' font-mono'} />
          </Field>
          <Field label="PAN Number">
            <input type="text" value={pan}
              onChange={function (e) { setPan(e.target.value.toUpperCase()) }}
              maxLength="10" placeholder="AAAAA9999A"
              style={{ fontSize: '16px' }} className={inp + ' font-mono uppercase'} />
          </Field>
          <Field label="UAN (PF)">
            <input type="text" value={uan} onChange={function (e) { setUan(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp + ' font-mono'} />
          </Field>
          <Field label="ESIC">
            <input type="text" value={esic} onChange={function (e) { setEsic(e.target.value) }}
              style={{ fontSize: '16px' }} className={inp + ' font-mono'} />
          </Field>
          <Field label="Professional Tax State">
            <input type="text" value={ptState}
              onChange={function (e) { setPtState(e.target.value) }}
              placeholder="e.g. Delhi, Maharashtra..."
              style={{ fontSize: '16px' }} className={inp} />
          </Field>
        </div>
      )}

      {/* ═══ BANK & SALARY ═══ */}
      {tab === 'bank' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
            🔒 Bank details and salary visible only to admin, Finance/Accounts, Management/HR, and the employee themselves.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bank Account Number">
              <input type="text" value={bankAccount}
                onChange={function (e) { setBankAccount(e.target.value.replace(/\s/g, '')) }}
                style={{ fontSize: '16px' }} className={inp + ' font-mono'} />
            </Field>
            <Field label="IFSC Code">
              <input type="text" value={ifsc}
                onChange={function (e) { setIfsc(e.target.value.toUpperCase()) }}
                maxLength="11" placeholder="ABCD0123456"
                style={{ fontSize: '16px' }} className={inp + ' font-mono uppercase'} />
            </Field>
            <Field label="Bank Name">
              <input type="text" value={bankName}
                onChange={function (e) { setBankName(e.target.value) }}
                style={{ fontSize: '16px' }} className={inp} />
            </Field>
            {canSeeSalary && (
              <Field label="Monthly Cash (₹)">
                <input type="number" value={monthlyCashRupees}
                  onChange={function (e) { setMonthlyCashRupees(e.target.value) }}
                  placeholder="e.g. 15000" min="0" step="1"
                  style={{ fontSize: '16px' }} className={inp} />
              </Field>
            )}
            {canSeeSalary && (
              <Field label="Monthly Bank (₹)">
                <input type="number" value={monthlyBankRupees}
                  onChange={function (e) { setMonthlyBankRupees(e.target.value) }}
                  placeholder="e.g. 35000" min="0" step="1"
                  style={{ fontSize: '16px' }} className={inp} />
              </Field>
            )}
            {canSeeSalary && (
              <Field label="Night Wage (₹)">
                <input type="number" value={nightWageRupees}
                  onChange={function (e) { setNightWageRupees(e.target.value) }}
                  placeholder="e.g. 500" min="0" step="1"
                  style={{ fontSize: '16px' }} className={inp} />
              </Field>
            )}
            <Field label="Shift From">
              <input type="time" value={shiftFrom}
                onChange={function (e) { setShiftFrom(e.target.value) }}
                style={{ fontSize: '16px' }} className={inp} />
            </Field>
            <Field label="Shift To">
              <input type="time" value={shiftTo}
                onChange={function (e) { setShiftTo(e.target.value) }}
                style={{ fontSize: '16px' }} className={inp} />
            </Field>
            {!canSeeSalary && (
              <div className="md:col-span-2">
                <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-xs text-gray-400 italic">
                  🔒 Monthly Cash / Bank Salary — Restricted, no permission to view or edit
                </div>
              </div>
            )}
          </div>
          {canSeeSalary && (Number(monthlyCashRupees) > 0 || Number(monthlyBankRupees) > 0) && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2 text-xs text-indigo-700">
              <span className="font-semibold">Annual CTC:</span>{' '}
              ₹ {((Number(monthlyCashRupees) || 0) + (Number(monthlyBankRupees) || 0)) * 12}
              <span className="text-indigo-500 ml-1">(auto-computed as (Cash + Bank) × 12)</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ DOCUMENTS ═══ */}
      {tab === 'documents' && (
        <div className="space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600">
            Tick the docs on file. Upload PDF or image (JPEG/PNG/WEBP). Max 10 MB per file. Only admin and Finance/HR can access.
          </div>

          {DOC_TYPES.map(function (dt) {
            var state = docs[dt.key] || { file: null, existingPath: '', expiry: '', enabled: false }
            return (
              <div key={dt.key} className={"border rounded-md " + (state.enabled ? "border-indigo-200 bg-indigo-50/30" : "border-gray-200 bg-white")}>
                <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                  <input type="checkbox"
                    checked={!!state.enabled}
                    disabled={dt.mandatory}
                    onChange={function (e) {
                      var checked = e.target.checked
                      setDocs(function (prev) {
                        var n = Object.assign({}, prev)
                        n[dt.key] = Object.assign({}, prev[dt.key], { enabled: checked })
                        return n
                      })
                    }}
                    className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" />
                  <span className="text-sm font-medium text-gray-700">{dt.label}</span>
                  {dt.mandatory && <span className="text-[10px] font-bold uppercase text-red-500 ml-1">Required</span>}
                  {state.existingPath && <span className="text-[10px] text-green-600 ml-1">✓ On file</span>}
                </label>
                {state.enabled && (
                  <div className="px-3 pb-3">
                    <DocSlot label=""
                      existingPath={state.existingPath}
                      selectedFile={state.file}
                      onSelect={function (f) {
                        setDocs(function (prev) {
                          var n = Object.assign({}, prev)
                          n[dt.key] = Object.assign({}, prev[dt.key], { file: f })
                          return n
                        })
                      }}
                      employeeId={employee?.id}
                      docType={dt.key}
                      expiryDate={dt.hasExpiry ? state.expiry : undefined}
                      onExpiryChange={dt.hasExpiry ? function (v) {
                        setDocs(function (prev) {
                          var n = Object.assign({}, prev)
                          n[dt.key] = Object.assign({}, prev[dt.key], { expiry: v })
                          return n
                        })
                      } : undefined} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
      )}

      <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Employee')}
        </button>
      </div>
    </form>
  )
}

// Shared input class
var inp = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function DocSlot({ label, existingPath, selectedFile, onSelect, employeeId, docType, expiryDate, onExpiryChange }) {
  var [previewUrl, setPreviewUrl] = useState('')
  var [loadingPreview, setLoadingPreview] = useState(false)

  async function openPreview() {
    if (!employeeId || !existingPath) return
    setLoadingPreview(true)
    var { data, error } = await supabase.storage.from('employee-docs')
      .createSignedUrl(existingPath, 60)
    setLoadingPreview(false)
    if (error) { alert('Preview failed: ' + error.message); return }
    setPreviewUrl(data.signedUrl)
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {existingPath && (
          <button type="button" onClick={openPreview} disabled={loadingPreview}
            className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50">
            {loadingPreview ? 'Loading...' : '👁 View current'}
          </button>
        )}
      </div>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
        onChange={function (e) { onSelect(e.target.files[0] || null) }}
        className="block w-full text-xs text-gray-500
          file:mr-3 file:py-1.5 file:px-3 file:rounded-md
          file:border file:border-gray-300 file:text-xs
          file:font-medium file:bg-white file:text-gray-700
          hover:file:bg-gray-50" />
      {selectedFile && (
        <p className="text-[11px] text-indigo-600 mt-1">
          ✓ Ready to upload: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
        </p>
      )}
      {existingPath && !selectedFile && (
        <p className="text-[11px] text-gray-400 mt-1 font-mono">On file: {existingPath}</p>
      )}
      {onExpiryChange && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[11px] text-gray-500 whitespace-nowrap">Expiry date:</label>
          <input type="date" value={expiryDate || ''}
            onChange={function (e) { onExpiryChange(e.target.value) }}
            style={{ fontSize: '16px' }}
            className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          {expiryDate && (
            <button type="button" onClick={function () { onExpiryChange('') }}
              className="text-[10px] text-gray-400 hover:text-red-500 px-1.5 rounded">Clear</button>
          )}
        </div>
      )}
    </div>
  )
}

export default EmployeeForm