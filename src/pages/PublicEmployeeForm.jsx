import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { prepUpload } from '../lib/uploadHelper'

var DOC_TYPES = [
  { key: 'aadhaar', label: 'Aadhaar Card', required: true },
  { key: 'pan', label: 'PAN Card', required: true },
  { key: 'bank_proof', label: 'Bank Passbook / Cheque', required: false },
  { key: 'passport', label: 'Passport', required: false },
  { key: 'driving_license', label: 'Driving Licence', required: false }
]

function fileExt(name) {
  var i = name.lastIndexOf('.')
  return i > 0 ? name.substring(i + 1).toLowerCase() : 'bin'
}

function humanSize(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

function Section(props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6 mb-4">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">{props.n}</div>
        <div>
          <h2 className="text-base md:text-lg font-semibold text-gray-900">{props.title}</h2>
          {props.subtitle ? <p className="text-xs text-gray-500 mt-0.5">{props.subtitle}</p> : null}
        </div>
      </div>
      {props.children}
    </div>
  )
}

function Field(props) {
  return (
    <label className={'block ' + (props.className || 'mb-4')}>
      <span className="text-xs font-medium text-gray-600 block mb-1.5 uppercase tracking-wide">
        {props.label}{props.required ? <span className="text-red-500"> *</span> : null}
      </span>
      {props.children}
    </label>
  )
}

var inputBase = 'w-full border border-gray-200 rounded-lg px-3.5 py-2.5 bg-gray-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition'

function TextInput(props) {
  return <input {...props} style={Object.assign({ fontSize: '16px' }, props.style || {})}
    className={inputBase + ' ' + (props.className || '')} />
}

function TextArea(props) {
  return <textarea {...props} style={Object.assign({ fontSize: '16px' }, props.style || {})}
    className={inputBase + ' resize-none ' + (props.className || '')} />
}

function SelectInput(props) {
  return <select {...props} style={Object.assign({ fontSize: '16px' }, props.style || {})}
    className={inputBase + ' ' + (props.className || '')}>{props.children}</select>
}

function PhotoUpload(props) {
  var camRef = useRef(null)
  var galRef = useRef(null)
  var f = props.file
  var previewUrl = f ? URL.createObjectURL(f) : null
  function pickCam(e) { e.stopPropagation(); if (camRef.current) camRef.current.click() }
  function pickGal(e) { e.stopPropagation(); if (galRef.current) galRef.current.click() }
  function clear(e) { e.stopPropagation(); props.onChange(null); if (camRef.current) camRef.current.value = ''; if (galRef.current) galRef.current.value = '' }
  return (
    <div>
      <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden"
        onChange={function (e) { props.onChange(e.target.files[0] || null) }} />
      <input ref={galRef} type="file" accept="image/*" className="hidden"
        onChange={function (e) { props.onChange(e.target.files[0] || null) }} />

      {previewUrl ? (
        <div className="flex items-center gap-4 border-2 border-dashed border-gray-200 rounded-xl p-4">
          <img src={previewUrl} alt="Photo" className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">Photo added</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">{f.name + ' • ' + humanSize(f.size)}</div>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={pickCam} className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium">Retake</button>
              <button type="button" onClick={pickGal} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium">Choose different</button>
              <button type="button" onClick={clear} className="text-xs px-2 py-1 rounded text-red-500 hover:text-red-600 font-medium ml-auto">Remove</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">Add employee photo</div>
              <div className="text-xs text-gray-500 mt-0.5">Take a selfie or choose from gallery</div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={pickCam}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition">
              📷 Camera
            </button>
            <button type="button" onClick={pickGal}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              🖼️ Gallery
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocUpload(props) {
  var inputRef = useRef(null)
  var f = props.file
  function pick() { if (inputRef.current) inputRef.current.click() }
  function clear(e) { e.stopPropagation(); props.onChange(null); if (inputRef.current) inputRef.current.value = '' }
  return (
    <div className={'border rounded-xl p-4 transition ' + (f ? 'border-green-300 bg-green-50/40' : 'border-gray-200 bg-gray-50/40 hover:border-indigo-300 hover:bg-indigo-50/30')}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={function (e) { props.onChange(e.target.files[0] || null) }} />
      <div onClick={pick} className="cursor-pointer flex items-center gap-3">
        <div className={'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ' + (f ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-400')}>
          {f ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            {props.label}{props.required ? <span className="text-red-500">*</span> : null}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">
            {f ? (f.name + ' • ' + humanSize(f.size)) : 'Tap to upload (image or PDF)'}
          </div>
        </div>
        {f ? (
          <button type="button" onClick={clear} className="text-xs text-red-500 hover:text-red-600 font-medium shrink-0">Remove</button>
        ) : null}
      </div>
    </div>
  )
}

function PublicEmployeeForm() {
  // Bail out if opened inside installed PWA — form is for external users, needs browser.
  var isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
  if (isStandalone) {
    var browserUrl = window.location.href
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full text-center">
          <div className="text-3xl mb-3">🌐</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Open in Browser</h2>
          <p className="text-sm text-gray-600 mb-4">This joining form is meant for a web browser, not the Ambria Ops app. Please copy the link and paste it into Chrome / Safari.</p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 break-all mb-3">{browserUrl}</div>
          <button type="button"
            onClick={function () {
              try { navigator.clipboard.writeText(browserUrl) } catch (_) {}
              alert('Link copied. Now paste into your browser.')
            }}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
            Copy Link
          </button>
        </div>
      </div>
    )
  }

  var [saving, setSaving] = useState(false)
  var [done, setDone] = useState(null)
  var [error, setError] = useState('')
  var [uploadProgress, setUploadProgress] = useState('')

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

  var [curAddr, setCurAddr] = useState('')
  var [curPin, setCurPin] = useState('')
  var [permSame, setPermSame] = useState(false)
  var [permAddr, setPermAddr] = useState('')
  var [permPin, setPermPin] = useState('')

  var [emgName, setEmgName] = useState('')
  var [emgRel, setEmgRel] = useState('')
  var [emgMob, setEmgMob] = useState('')

  var [bankName, setBankName] = useState('')
  var [branchName, setBranchName] = useState('')
  var [acctNum, setAcctNum] = useState('')
  var [ifsc, setIfsc] = useState('')

  var [nightWage, setNightWage] = useState('')
  var [prevSalary, setPrevSalary] = useState('')

  var [docFiles, setDocFiles] = useState({})
  var [declared, setDeclared] = useState(false)

  var honeyRef = useRef(null)

  function setDocFile(k, f) {
    var next = Object.assign({}, docFiles)
    next[k] = f
    setDocFiles(next)
  }

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault()
    if (saving) return
    setError('')

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
      setUploadProgress('Preparing submission...')
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
        declaration_accepted: true,
        honey_field: honeyRef.current ? honeyRef.current.value : ''
      }

      var fd = new FormData()
      fd.append('payload', JSON.stringify(payload))
      if (photoFile) {
        setUploadProgress('Compressing photo...')
        var photoF = await prepUpload(photoFile, 100)
        fd.append('photo', photoF, 'photo.' + fileExt(photoF.name))
      }
      for (var i = 0; i < DOC_TYPES.length; i++) {
        var dt = DOC_TYPES[i]
        var f = docFiles[dt.key]
        if (!f) continue
        setUploadProgress('Compressing ' + dt.label + '...')
        var prepped = await prepUpload(f, 200)
        fd.append('doc_' + dt.key, prepped, dt.key + '.' + fileExt(prepped.name))
      }

      setUploadProgress('Uploading...')
      var res = await supabase.functions.invoke('submit-employee', { body: fd })
      if (res.error) {
        var msg = res.error.message || 'Submission failed'
        try {
          var body = res.error.context && res.error.context.body
          if (body) {
            var parsed = typeof body === 'string' ? JSON.parse(body) : body
            if (parsed && parsed.error) msg = parsed.error
          }
        } catch (ex) {}
        throw new Error(msg)
      }
      if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Submission failed')
      setDone({ ref: res.data.reference_code })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
      setUploadProgress('')
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-5">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Submission Received</h1>
          <p className="text-gray-500 text-sm mb-6">Your details have been submitted successfully.</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="text-xs text-gray-500 mb-1">Reference Number</div>
            <div className="font-mono text-lg font-semibold text-gray-900">{done.ref}</div>
          </div>
          <p className="text-xs text-gray-500">Please share this reference with HR. Someone will contact you for next steps.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
          <h1 className="text-2xl md:text-3xl font-bold">New Employee Joining Form</h1>
          <p className="text-indigo-100 text-sm mt-1">कर्मचारी ज्वाइनिंग फॉर्म • Fill in your details to join</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 pb-32">
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }} aria-hidden="true">
          <input ref={honeyRef} type="text" name="website" tabIndex="-1" autoComplete="off" />
        </div>

        <Section n="1" title="Personal Details" subtitle="व्यक्तिगत जानकारी">
          <Field label="Employee Photo" className="mb-5">
            <PhotoUpload file={photoFile} onChange={setPhotoFile} />
          </Field>
          <Field label="Source / Reference by">
            <TextInput value={sourceRef} onChange={function (e) { setSourceRef(e.target.value) }} placeholder="Who referred you?" />
          </Field>
          <Field label="Full Name" required>
            <TextInput value={fullName} onChange={function (e) { setFullName(e.target.value) }} placeholder="As per Aadhaar" />
          </Field>
          <Field label="Father's Name">
            <TextInput value={fatherName} onChange={function (e) { setFatherName(e.target.value) }} />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Date of Birth">
              <TextInput type="date" value={dob} onChange={function (e) { setDob(e.target.value) }} />
            </Field>
            <Field label="Gender">
              <SelectInput value={gender} onChange={function (e) { setGender(e.target.value) }}>
                <option value="">-- Select --</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </SelectInput>
            </Field>
          </div>
          <Field label="Mobile Number" required>
            <TextInput type="tel" value={mobile} onChange={function (e) { setMobile(e.target.value) }} placeholder="10-digit number" />
          </Field>
          <Field label="Email ID">
            <TextInput type="email" value={email} onChange={function (e) { setEmail(e.target.value) }} placeholder="you@example.com" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Aadhaar Number" required>
              <TextInput value={aadhaar} onChange={function (e) { setAadhaar(e.target.value.replace(/\s/g, '')) }} maxLength="12" placeholder="12 digits" />
            </Field>
            <Field label="PAN Number" required>
              <TextInput value={pan} onChange={function (e) { setPan(e.target.value.toUpperCase()) }} maxLength="10" placeholder="AAAAA9999A" />
            </Field>
          </div>
        </Section>

        <Section n="2" title="Address" subtitle="पता">
          <Field label="Current Address" required>
            <TextArea rows="2" value={curAddr} onChange={function (e) { setCurAddr(e.target.value) }} placeholder="House / Street / City / State" />
          </Field>
          <Field label="Current Pin Code">
            <TextInput value={curPin} onChange={function (e) { setCurPin(e.target.value.replace(/\D/g, '')) }} maxLength="10" />
          </Field>
          <label className="flex items-center gap-2.5 mb-4 cursor-pointer select-none py-1">
            <input type="checkbox" checked={permSame} onChange={function (e) { setPermSame(e.target.checked) }}
              className="w-4 h-4 accent-indigo-600" />
            <span className="text-sm text-gray-700">Permanent address same as current</span>
          </label>
          {!permSame ? (
            <div>
              <Field label="Permanent Address">
                <TextArea rows="2" value={permAddr} onChange={function (e) { setPermAddr(e.target.value) }} />
              </Field>
              <Field label="Permanent Pin Code" className="mb-0">
                <TextInput value={permPin} onChange={function (e) { setPermPin(e.target.value.replace(/\D/g, '')) }} maxLength="10" />
              </Field>
            </div>
          ) : null}
        </Section>

        <Section n="3" title="Emergency Contact" subtitle="आपातकालीन संपर्क">
          <Field label="Contact Person Name" required>
            <TextInput value={emgName} onChange={function (e) { setEmgName(e.target.value) }} />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Relationship" required>
              <TextInput value={emgRel} onChange={function (e) { setEmgRel(e.target.value) }} placeholder="Father / Spouse / etc" />
            </Field>
            <Field label="Mobile Number" required className="mb-0">
              <TextInput type="tel" value={emgMob} onChange={function (e) { setEmgMob(e.target.value) }} />
            </Field>
          </div>
        </Section>

        <Section n="4" title="Bank Details" subtitle="Optional — for salary transfer">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bank Name">
              <TextInput value={bankName} onChange={function (e) { setBankName(e.target.value) }} />
            </Field>
            <Field label="Branch">
              <TextInput value={branchName} onChange={function (e) { setBranchName(e.target.value) }} />
            </Field>
            <Field label="Account Number">
              <TextInput value={acctNum} onChange={function (e) { setAcctNum(e.target.value.replace(/\D/g, '')) }} />
            </Field>
            <Field label="IFSC Code" className="mb-0">
              <TextInput value={ifsc} onChange={function (e) { setIfsc(e.target.value.toUpperCase()) }} maxLength="11" placeholder="ABCD0123456" />
            </Field>
          </div>
        </Section>

        <Section n="5" title="Employment Details" subtitle="Wages information">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nightly Wages (₹)">
              <TextInput type="number" min="0" step="1" value={nightWage} onChange={function (e) { setNightWage(e.target.value) }} placeholder="0" />
            </Field>
            <Field label="Previous Drawn Salary (₹)" className="mb-0">
              <TextInput type="number" min="0" step="1" value={prevSalary} onChange={function (e) { setPrevSalary(e.target.value) }} placeholder="0" />
            </Field>
          </div>
        </Section>

        <Section n="6" title="Documents" subtitle="Aadhaar and PAN mandatory">
          <div className="space-y-3">
            {DOC_TYPES.map(function (dt) {
              return (
                <DocUpload key={dt.key} label={dt.label} required={dt.required}
                  file={docFiles[dt.key]}
                  onChange={function (f) { setDocFile(dt.key, f) }} />
              )
            })}
          </div>
        </Section>

        <Section n="7" title="Declaration" subtitle="घोषणा">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={declared} onChange={function (e) { setDeclared(e.target.checked) }}
              className="mt-1 w-4 h-4 accent-indigo-600 shrink-0" />
            <span className="text-sm text-gray-700 leading-relaxed">
              I declare that all information provided is correct and true to the best of my knowledge.
              <span className="block text-gray-500 mt-1">(मैं घोषणा करता/करती हूँ कि ऊपर दी गई सभी जानकारी सही है।)</span>
            </span>
          </label>
        </Section>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-4 flex items-start gap-2">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-3xl mx-auto">
          {saving && uploadProgress ? (
            <div className="text-xs text-gray-500 mb-2 text-center">{uploadProgress}</div>
          ) : null}
          <button onClick={handleSubmit} disabled={saving}
            className={'w-full py-3.5 rounded-xl font-semibold text-white shadow-md transition ' + (saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 hover:shadow-lg active:scale-[0.99]')}>
            {saving ? 'Submitting...' : 'Submit Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PublicEmployeeForm