import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

var BUCKET = 'employee-public-submissions'
var DOC_TYPES = [
  { key: 'aadhaar', label: 'Aadhaar Card Copy', required: true },
  { key: 'pan', label: 'PAN Card Copy', required: true },
  { key: 'bank_proof', label: 'Bank Passbook / Cancelled Cheque', required: false },
  { key: 'passport', label: 'Passport', required: false },
  { key: 'driving_license', label: 'Driving Licence', required: false }
]

function fileExt(name) {
  var i = name.lastIndexOf('.')
  return i > 0 ? name.substring(i + 1).toLowerCase() : 'bin'
}

function Field(props) {
  return (
    <label className="block mb-3">
      <span className="text-sm text-gray-700 block mb-1">
        {props.label}{props.required ? <span className="text-red-500"> *</span> : null}
      </span>
      {props.children}
    </label>
  )
}

function TextInput(props) {
  return <input {...props} style={Object.assign({ fontSize: '16px' }, props.style || {})}
    className={'w-full border border-gray-300 rounded px-3 py-2 ' + (props.className || '')} />
}

function TextArea(props) {
  return <textarea {...props} style={Object.assign({ fontSize: '16px' }, props.style || {})}
    className={'w-full border border-gray-300 rounded px-3 py-2 ' + (props.className || '')} />
}

function PublicEmployeeForm() {
  var [submissionId] = useState(function () { return crypto.randomUUID() })
  var [saving, setSaving] = useState(false)
  var [done, setDone] = useState(null)
  var [error, setError] = useState('')

  // Section 1
  var [sourceRef, setSourceRef] = useState('')
  var [photoFile, setPhotoFile] = useState(null)
  var [fullName, setFullName] = useState('')
  var [fatherName, setFatherName] = useState('')
  var [dob, setDob] = useState('')
  var [gender, setGender] = useState('')
  var [mobile, setMobile] = useState('')
  var [email, setEmail] = useState('')
  var [aadhaar, setAadhaar] = useState('')
  var [pan, setPan] = useState('')

  // Section 2
  var [curAddr, setCurAddr] = useState('')
  var [curPin, setCurPin] = useState('')
  var [permSame, setPermSame] = useState(false)
  var [permAddr, setPermAddr] = useState('')
  var [permPin, setPermPin] = useState('')

  // Section 3
  var [emgName, setEmgName] = useState('')
  var [emgRel, setEmgRel] = useState('')
  var [emgMob, setEmgMob] = useState('')

  // Section 4
  var [bankName, setBankName] = useState('')
  var [branchName, setBranchName] = useState('')
  var [acctNum, setAcctNum] = useState('')
  var [ifsc, setIfsc] = useState('')

  // Section 5 — Employment
  var [nightWage, setNightWage] = useState('')
  var [prevSalary, setPrevSalary] = useState('')

  // Section 6 — Docs
  var [docFiles, setDocFiles] = useState({})
  var [docExpiries, setDocExpiries] = useState({})

  // Section 7
  var [declared, setDeclared] = useState(false)

  // Honeypot
  var honeyRef = useRef(null)

  function setDocFile(k, f) {
    var next = Object.assign({}, docFiles)
    next[k] = f
    setDocFiles(next)
  }

  function setDocExpiry(k, v) {
    var next = Object.assign({}, docExpiries)
    next[k] = v
    setDocExpiries(next)
  }

  async function uploadTo(path, file) {
    var r = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, cacheControl: '3600' })
    if (r.error) throw new Error('Upload failed for ' + path + ': ' + r.error.message)
    return path
  }

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault()
    if (saving) return
    setError('')

    // Client-side validation (server also validates)
    if (!fullName.trim()) return setError('Full Name required')
    if (!mobile.trim()) return setError('Mobile Number required')
    if (!/^[0-9]{12}$/.test(aadhaar.replace(/\s/g, ''))) return setError('Aadhaar must be 12 digits')
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase())) return setError('PAN format invalid (AAAAA9999A)')
    if (!curAddr.trim()) return setError('Current address required')
    if (!emgName.trim() || !emgRel.trim() || !emgMob.trim()) return setError('Emergency contact required')
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) return setError('IFSC format invalid')
    if (!docFiles.aadhaar) return setError('Aadhaar Card upload required')
    if (!docFiles.pan) return setError('PAN Card upload required')
    if (!declared) return setError('Please accept the declaration')

    setSaving(true)
    try {
      var basePath = 'submissions/' + submissionId

      // Upload photo
      var photoPath = null
      if (photoFile) {
        photoPath = await uploadTo(basePath + '/photo.' + fileExt(photoFile.name), photoFile)
      }

      // Upload docs
      var docList = []
      for (var i = 0; i < DOC_TYPES.length; i++) {
        var dt = DOC_TYPES[i]
        var f = docFiles[dt.key]
        if (!f) continue
        var p = basePath + '/docs/' + dt.key + '.' + fileExt(f.name)
        await uploadTo(p, f)
        var docRec = { doc_key: dt.key, file_path: p }
        if (docExpiries[dt.key]) docRec.expiry_date = docExpiries[dt.key]
        docList.push(docRec)
      }

      var payload = {
        source_reference: sourceRef.trim() || null,
        full_name: fullName.trim(),
        father_name: fatherName.trim() || null,
        dob: dob || null,
        gender: gender || null,
        contact_number: mobile.trim(),
        personal_email: email.trim() || null,
        aadhaar_number: aadhaar.replace(/\s/g, ''),
        pan_number: pan.trim().toUpperCase(),
        present_address: curAddr.trim(),
        present_pincode: curPin.trim() || null,
        permanent_same_as_current: permSame,
        permanent_address: permSame ? curAddr.trim() : (permAddr.trim() || null),
        permanent_pincode: permSame ? (curPin.trim() || null) : (permPin.trim() || null),
        emergency_contact_name: emgName.trim(),
        emergency_contact_relationship: emgRel.trim(),
        emergency_contact_number: emgMob.trim(),
        bank_name: bankName.trim() || null,
        branch_name: branchName.trim() || null,
        bank_account_number: acctNum.trim() || null,
        ifsc_code: ifsc.trim().toUpperCase() || null,
        night_wage_rupees: nightWage ? Number(nightWage) : null,
        prev_drawn_salary_rupees: prevSalary ? Number(prevSalary) : null,
        photo_file_path: photoPath,
        docs: docList,
        declaration_accepted: true,
        honey_field: honeyRef.current ? honeyRef.current.value : ''
      }

      var res = await supabase.functions.invoke('submit-employee', { body: payload })
      if (res.error) {
        var msg = res.error.message || 'Submission failed'
        try {
          var body = res.error.context && res.error.context.body
          if (body) {
            var parsed = typeof body === 'string' ? JSON.parse(body) : body
            if (parsed && parsed.error) msg = parsed.error
          }
        } catch (e) {}
        throw new Error(msg)
      }
      if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Submission failed')
      setDone({ ref: res.data.reference_code })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
          <div className="text-green-600 text-5xl mb-4">✓</div>
          <h1 className="text-xl font-semibold mb-2">Submission Received</h1>
          <p className="text-gray-600 text-sm mb-4">Your reference number:</p>
          <p className="font-mono text-lg bg-gray-100 rounded py-2 mb-4">{done.ref}</p>
          <p className="text-xs text-gray-500">Please share this reference with HR. Someone will contact you for next steps.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold mb-1">New Employee Joining Form</h1>
        <p className="text-gray-500 text-sm mb-6">कर्मचारी ज्वाइनिंग फॉर्म</p>

        {/* Honeypot - hidden from users, bots may fill */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }} aria-hidden="true">
          <input ref={honeyRef} type="text" name="website" tabIndex="-1" autoComplete="off" />
        </div>

        <div>
          {/* Section 1 */}
          <h2 className="text-lg font-semibold mb-3 mt-2">1. Personal Details</h2>
          <Field label="Source / Reference by">
            <TextInput value={sourceRef} onChange={function (e) { setSourceRef(e.target.value) }} />
          </Field>
          <Field label="Employee Photo">
            <input type="file" accept="image/*" onChange={function (e) { setPhotoFile(e.target.files[0] || null) }} />
          </Field>
          <Field label="Full Name" required>
            <TextInput value={fullName} onChange={function (e) { setFullName(e.target.value) }} />
          </Field>
          <Field label="Father's Name">
            <TextInput value={fatherName} onChange={function (e) { setFatherName(e.target.value) }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of Birth">
              <TextInput type="date" value={dob} onChange={function (e) { setDob(e.target.value) }} />
            </Field>
            <Field label="Gender">
              <select value={gender} onChange={function (e) { setGender(e.target.value) }}
                className="w-full border border-gray-300 rounded px-3 py-2" style={{ fontSize: '16px' }}>
                <option value="">-- Select --</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Mobile Number" required>
            <TextInput type="tel" value={mobile} onChange={function (e) { setMobile(e.target.value) }} />
          </Field>
          <Field label="Email ID">
            <TextInput type="email" value={email} onChange={function (e) { setEmail(e.target.value) }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Aadhaar Number" required>
              <TextInput value={aadhaar} onChange={function (e) { setAadhaar(e.target.value.replace(/\s/g, '')) }} maxLength="12" />
            </Field>
            <Field label="PAN Card Number" required>
              <TextInput value={pan} onChange={function (e) { setPan(e.target.value.toUpperCase()) }} maxLength="10" />
            </Field>
          </div>

          {/* Section 2 */}
          <h2 className="text-lg font-semibold mb-3 mt-6">2. Address</h2>
          <Field label="Current Address" required>
            <TextArea rows="2" value={curAddr} onChange={function (e) { setCurAddr(e.target.value) }} />
          </Field>
          <Field label="Current Pin Code">
            <TextInput value={curPin} onChange={function (e) { setCurPin(e.target.value) }} maxLength="10" />
          </Field>
          <label className="flex items-center gap-2 mb-3">
            <input type="checkbox" checked={permSame} onChange={function (e) { setPermSame(e.target.checked) }} />
            <span className="text-sm">Permanent address same as current</span>
          </label>
          {!permSame ? (
            <div>
              <Field label="Permanent Address">
                <TextArea rows="2" value={permAddr} onChange={function (e) { setPermAddr(e.target.value) }} />
              </Field>
              <Field label="Permanent Pin Code">
                <TextInput value={permPin} onChange={function (e) { setPermPin(e.target.value) }} maxLength="10" />
              </Field>
            </div>
          ) : null}

          {/* Section 3 */}
          <h2 className="text-lg font-semibold mb-3 mt-6">3. Emergency Contact</h2>
          <Field label="Contact Person Name" required>
            <TextInput value={emgName} onChange={function (e) { setEmgName(e.target.value) }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relationship" required>
              <TextInput value={emgRel} onChange={function (e) { setEmgRel(e.target.value) }} />
            </Field>
            <Field label="Mobile Number" required>
              <TextInput type="tel" value={emgMob} onChange={function (e) { setEmgMob(e.target.value) }} />
            </Field>
          </div>

          {/* Section 4 */}
          <h2 className="text-lg font-semibold mb-3 mt-6">4. Bank Details (optional)</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank Name">
              <TextInput value={bankName} onChange={function (e) { setBankName(e.target.value) }} />
            </Field>
            <Field label="Branch Name">
              <TextInput value={branchName} onChange={function (e) { setBranchName(e.target.value) }} />
            </Field>
            <Field label="Account Number">
              <TextInput value={acctNum} onChange={function (e) { setAcctNum(e.target.value.replace(/\D/g, '')) }} />
            </Field>
            <Field label="IFSC Code">
              <TextInput value={ifsc} onChange={function (e) { setIfsc(e.target.value.toUpperCase()) }} maxLength="11" />
            </Field>
          </div>

          {/* Section 5 - Employment */}
          <h2 className="text-lg font-semibold mb-3 mt-6">5. Employment Details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nightly Wages (₹)">
              <TextInput type="number" min="0" step="1" value={nightWage} onChange={function (e) { setNightWage(e.target.value) }} />
            </Field>
            <Field label="Previous Drawn Salary (₹)">
              <TextInput type="number" min="0" step="1" value={prevSalary} onChange={function (e) { setPrevSalary(e.target.value) }} />
            </Field>
          </div>

          {/* Section 6 - Documents */}
          <h2 className="text-lg font-semibold mb-3 mt-6">6. Documents</h2>
          <p className="text-xs text-gray-500 mb-3">Aadhaar and PAN uploads are mandatory. Other uploads optional.</p>
          {DOC_TYPES.map(function (dt) {
            var f = docFiles[dt.key]
            return (
              <div key={dt.key} className="mb-3 border border-gray-200 rounded p-3">
                <div className="text-sm mb-2">
                  {dt.label}{dt.required ? <span className="text-red-500"> *</span> : null}
                </div>
                <input type="file" accept="image/*,application/pdf"
                  onChange={function (e) { setDocFile(dt.key, e.target.files[0] || null) }} />
                {f ? <div className="text-xs text-gray-500 mt-1">Selected: {f.name}</div> : null}
              </div>
            )
          })}

          {/* Section 7 - Declaration */}
          <h2 className="text-lg font-semibold mb-3 mt-6">7. Declaration</h2>
          <label className="flex items-start gap-2 mb-4">
            <input type="checkbox" checked={declared} onChange={function (e) { setDeclared(e.target.checked) }} className="mt-1" />
            <span className="text-sm text-gray-700">
              I declare that all information provided is correct and true to the best of my knowledge.
              (मैं घोषणा करता/करती हूँ कि ऊपर दी गई सभी जानकारी सही है।)
            </span>
          </label>

          {error ? <div className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div> : null}

          <button onClick={handleSubmit} disabled={saving}
            className={'w-full py-3 rounded font-medium text-white ' + (saving ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700')}>
            {saving ? 'Submitting...' : 'Submit Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PublicEmployeeForm