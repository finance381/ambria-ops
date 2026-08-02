// supabase/functions/submit-employee/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

var RATE_LIMIT_MAX = 5
var RATE_LIMIT_WINDOW_MIN = 60
var ALLOWED_DOC_KEYS = ["aadhaar", "pan", "bank_proof", "passport", "driving_license"]
var MANDATORY_DOC_KEYS = ["aadhaar", "pan"]
var GENDER_VALUES = ["Male", "Female", "Other"]
var MAX_FIELD_LEN = 500
var MAX_ADDRESS_LEN = 1000
var MAX_DOCS = 8

function bad(status, code, msg) {
  return new Response(
    JSON.stringify({ ok: false, code: code, error: msg }),
    { status: status, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
  )
}

function ok(payload) {
  return new Response(
    JSON.stringify(Object.assign({ ok: true }, payload)),
    { status: 200, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
  )
}

async function sha256Hex(input) {
  var buf = new TextEncoder().encode(input)
  var hash = await crypto.subtle.digest("SHA-256", buf)
  var arr = Array.from(new Uint8Array(hash))
  return arr.map(function (b) { return b.toString(16).padStart(2, "0") }).join("")
}

function clean(v, max) {
  if (v == null) return null
  var s = String(v).trim()
  if (!s) return null
  if (max && s.length > max) s = s.substring(0, max)
  return s
}

function validPath(p) {
  if (!p || typeof p !== "string") return false
  if (p.indexOf("submissions/") !== 0) return false
  if (p.indexOf("..") >= 0) return false
  if (p.length > 500) return false
  return true
}

serve(async function (req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only")

  var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
  var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  var IP_SALT = Deno.env.get("IP_HASH_SALT")
  if (!SUPABASE_URL || !SERVICE_ROLE || !IP_SALT) {
    return bad(500, "server_misconfigured", "Missing env")
  }

  var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  var ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown"
  ip = ip.split(",")[0].trim()
  var ipHash = await sha256Hex(ip + "|" + IP_SALT)

  var body
  try { body = await req.json() }
  catch (e) { return bad(400, "invalid_json", "Body must be JSON") }

  // Honeypot: silent fake-success on bot
  if (clean(body.honey_field, 100)) {
    try {
      await supa.from("employee_submission_log").insert({ ip_hash: ipHash, outcome: "honeypot" })
    } catch (e) {}
    return ok({ reference_code: "SUB-" + crypto.randomUUID().substring(0, 8).toUpperCase() })
  }

  // Rate limit
  var since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString()
  var rlRes = await supa
    .from("employee_submission_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("submitted_at", since)
  if (rlRes.error) return bad(500, "rate_check_failed", rlRes.error.message)
  if ((rlRes.count || 0) >= RATE_LIMIT_MAX) {
    try { await supa.from("employee_submission_log").insert({ ip_hash: ipHash, outcome: "rate_limited" }) } catch (e) {}
    return bad(429, "rate_limited", "Too many submissions. Try again later.")
  }

  // Validate & extract fields — hard whitelist. Never trust client for salary computations, but we do accept them per requirement.
  var fullName = clean(body.full_name, MAX_FIELD_LEN)
  if (!fullName) return bad(400, "invalid_full_name", "Full Name required")

  var fatherName = clean(body.father_name, MAX_FIELD_LEN)
  var dob = clean(body.dob, 20)
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return bad(400, "invalid_dob", "DOB must be YYYY-MM-DD")

  var gender = clean(body.gender, 20)
  if (gender && GENDER_VALUES.indexOf(gender) < 0) return bad(400, "invalid_gender", "Gender invalid")

  var mobile = clean(body.contact_number, 20)
  if (!mobile || !/^[0-9+\-\s]{7,20}$/.test(mobile)) return bad(400, "invalid_mobile", "Mobile invalid")

  var email = clean(body.personal_email, 200)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(400, "invalid_email", "Email invalid")

  var aadhaar = clean(body.aadhaar_number, 20)
  if (aadhaar) aadhaar = aadhaar.replace(/\s/g, "")
  if (!aadhaar || !/^[0-9]{12}$/.test(aadhaar)) return bad(400, "invalid_aadhaar", "Aadhaar must be 12 digits")

  var pan = clean(body.pan_number, 20)
  if (pan) pan = pan.toUpperCase()
  if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return bad(400, "invalid_pan", "PAN format invalid")

  var srcRef = clean(body.source_reference, MAX_FIELD_LEN)

  // Address
  var presentAddr = clean(body.present_address, MAX_ADDRESS_LEN)
  var presentPin = clean(body.present_pincode, 10)
  if (!presentAddr) return bad(400, "invalid_address", "Current address required")
  if (presentPin && !/^[0-9]{4,10}$/.test(presentPin)) return bad(400, "invalid_pincode", "Pincode invalid")
  var presentFull = presentAddr + (presentPin ? " - " + presentPin : "")

  var permSame = !!body.permanent_same_as_current
  var permAddr = permSame ? presentAddr : clean(body.permanent_address, MAX_ADDRESS_LEN)
  var permPin = permSame ? presentPin : clean(body.permanent_pincode, 10)
  if (permPin && !/^[0-9]{4,10}$/.test(permPin)) return bad(400, "invalid_perm_pincode", "Permanent pincode invalid")
  var permFull = permAddr ? (permAddr + (permPin ? " - " + permPin : "")) : null

  // Emergency contact — mandatory
  var emgName = clean(body.emergency_contact_name, MAX_FIELD_LEN)
  var emgRel = clean(body.emergency_contact_relationship, MAX_FIELD_LEN)
  var emgMob = clean(body.emergency_contact_number, 20)
  if (!emgName || !emgRel || !emgMob) return bad(400, "invalid_emergency", "Emergency contact fields required")
  if (!/^[0-9+\-\s]{7,20}$/.test(emgMob)) return bad(400, "invalid_emergency_mobile", "Emergency mobile invalid")
  var emergencyText = emgName + " (" + emgRel + ") - " + emgMob

  // Bank (optional)
  var bankName = clean(body.bank_name, MAX_FIELD_LEN)
  var branchName = clean(body.branch_name, MAX_FIELD_LEN)
  var acctNum = clean(body.bank_account_number, 30)
  var ifsc = clean(body.ifsc_code, 20)
  if (ifsc) ifsc = ifsc.toUpperCase()
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return bad(400, "invalid_ifsc", "IFSC format invalid")
  if (acctNum && !/^[0-9]{6,20}$/.test(acctNum)) return bad(400, "invalid_account", "Account number invalid")
  var bankNameFull = bankName ? (bankName + (branchName ? " — " + branchName : "")) : null

  // Salary
  function toPaise(v) {
    if (v == null || v === "") return null
    var n = Number(v)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n * 100)
  }
  var nightWageP = toPaise(body.night_wage_rupees)
  var prevSalP = toPaise(body.prev_drawn_salary_rupees)

  // Photo
  var photoPath = clean(body.photo_file_path, 500)
  if (photoPath && !validPath(photoPath)) return bad(400, "invalid_photo_path", "Photo path invalid")

  // Docs
  var docs = Array.isArray(body.docs) ? body.docs : []
  if (docs.length > MAX_DOCS) return bad(400, "too_many_docs", "Too many documents")
  var seenKeys = {}
  var cleanDocs = []
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i] || {}
    var k = clean(d.doc_key, 50)
    var p = clean(d.file_path, 500)
    var ex = clean(d.expiry_date, 20)
    if (!k || ALLOWED_DOC_KEYS.indexOf(k) < 0) return bad(400, "invalid_doc_key", "Doc key invalid: " + k)
    if (seenKeys[k]) return bad(400, "duplicate_doc", "Duplicate doc: " + k)
    seenKeys[k] = 1
    if (!validPath(p)) return bad(400, "invalid_doc_path", "Doc path invalid for " + k)
    if (ex && !/^\d{4}-\d{2}-\d{2}$/.test(ex)) return bad(400, "invalid_expiry", "Expiry invalid for " + k)
    cleanDocs.push({ key: k, path: p, expiry: ex })
  }
  for (var i2 = 0; i2 < MANDATORY_DOC_KEYS.length; i2++) {
    if (!seenKeys[MANDATORY_DOC_KEYS[i2]]) return bad(400, "missing_mandatory_doc", "Missing: " + MANDATORY_DOC_KEYS[i2])
  }

  // Declaration
  if (!body.declaration_accepted) return bad(400, "declaration_required", "Declaration must be accepted")

  // Resolve doc_type_id from key catalog
  var typesRes = await supa.from("employee_document_types").select("id, key").eq("active", true)
  if (typesRes.error) return bad(500, "type_lookup_failed", typesRes.error.message)
  var keyToId = {}
  ;(typesRes.data || []).forEach(function (r) { keyToId[r.key] = r.id })
  for (var j = 0; j < cleanDocs.length; j++) {
    if (!keyToId[cleanDocs[j].key]) return bad(400, "unknown_doc_type", "Unknown: " + cleanDocs[j].key)
  }

  // Insert employee (pending)
  var empPayload = {
    full_name: fullName,
    father_name: fatherName,
    dob: dob,
    gender: gender,
    contact_number: mobile,
    personal_email: email,
    aadhaar_number: aadhaar,
    pan_number: pan,
    present_address: presentFull,
    permanent_address: permFull,
    emergency_contact: emergencyText,
    bank_name: bankNameFull,
    bank_account_number: acctNum,
    ifsc_code: ifsc,
    night_wage_paise: nightWageP,
    prev_drawn_salary_paise: prevSalP,
    photo_file_path: photoPath,
    source_reference: srcRef,
    status: "pending",
    submitted_via: "public_form",
    job_department_ids: [],
    monthly_cash_paise: 0,
    monthly_bank_paise: 0,
  }

  var insEmp = await supa.from("employees").insert(empPayload).select("id").single()
  if (insEmp.error) {
    var msg = insEmp.error.message || ""
    if (msg.indexOf("check_aadhaar_format") >= 0) return bad(400, "aadhaar_dup_or_bad", "Aadhaar failed check")
    if (msg.indexOf("check_pan_format") >= 0) return bad(400, "pan_bad", "PAN failed check")
    if (msg.indexOf("unique") >= 0 || msg.indexOf("duplicate") >= 0) return bad(409, "duplicate_submission", "Already submitted")
    return bad(500, "insert_failed", msg)
  }
  var newEmpId = insEmp.data.id

  // Insert docs
  if (cleanDocs.length > 0) {
    var docRows = cleanDocs.map(function (d) {
      return { employee_id: newEmpId, doc_type: d.key, file_path: d.path, expiry_date: d.expiry }
    })
    var insDocs = await supa.from("employee_documents").insert(docRows)
    if (insDocs.error) {
      // Best-effort rollback: delete the employee row so submission can be retried
      await supa.from("employees").delete().eq("id", newEmpId)
      return bad(500, "doc_insert_failed", insDocs.error.message)
    }
  }

  // Log successful submission
  try {
    await supa.from("employee_submission_log").insert({
      ip_hash: ipHash, outcome: "success", employee_id: newEmpId
    })
  } catch (e) {}

  var refCode = "SUB-" + String(newEmpId).substring(0, 8).toUpperCase()
  return ok({ reference_code: refCode })
})