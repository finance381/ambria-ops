// supabase/functions/lms-leads-pull/index.ts
//
// Pulls CURRENT leads (not just confirmed contracts) from the LMS's 4
// per-department "list leads" endpoints, straight from the LMS itself —
// unlike lms-contacts-pull.ts (which reads the local `events` table as a
// stand-in for contracts), there is no local mirror of leads to substitute,
// so this one really does call gyv.inqcrm.in, same as sync-events.ts already
// does for contracts. Endpoint names, response wrapper key ("leadinfo", not
// "Contractinfo"), field prefixes, and per-department filter-field names are
// all taken verbatim from LMS_Lead_Fetch_Guide.md / gyv_all_lead_api_02_may_2026.txt
// (added to the repo root) — do not "fix" the misspelled entertainment
// endpoint or the "assginee"/"infromation" typos, they're real on the LMS side.
//
// "Not dead or waste": the guide's only documented lead-disposition filter is
// cancel_remarks (section 8) — there's no enumerated "dead"/"waste" status
// value anywhere in the guide or sample response, and no such column is
// separately exposed. So "current" here means "not cancelled" (non-empty
// `<h>cancel_remarks`), mirroring sync-events.ts's own contract-cancellation
// filter exactly. If "dead"/"waste" means something more specific in the LMS
// UI (e.g. a particular *_status_search value), this needs revisiting with
// that exact value — flagged rather than guessed.
//
// Auth: same dual-client pattern as lms-contacts-pull.ts — verifies the
// caller's session, then calls rpc_wa_contact_upsert_bulk through an
// AUTH-SCOPED client so that RPC's own permission check runs against the
// real caller's JWT.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("lms-leads-pull bad " + status + " " + code + ": " + msg)
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

function normalizePhone(raw) {
  if (!raw) return null
  var digits = String(raw).replace(/[\s\-()]/g, "")
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits
  var onlyDigits = digits.replace(/\D/g, "")
  if (onlyDigits.length === 10) return "+91" + onlyDigits
  if (onlyDigits.length === 12 && onlyDigits.indexOf("91") === 0) return "+" + onlyDigits
  return digits
}

var BASE_URL = "https://gyv.inqcrm.in/api/v1/processerp_api/"
var PAGE_SIZE = 10
var FETCH_TIMEOUT_MS = 10000

// Per LMS_Lead_Fetch_Guide.md §1/§3/§5 — endpoint, request-body filter field
// names (per-department, not shared), header/detail field prefixes.
var DEPARTMENTS = [
  {
    name: "Venue",
    endpoint: "get_venue_information_list",
    body: { fis_search: "", source_search: "", lead_type_search: "", priority_search: "", fromdate: "", uptodated: "", fis_assginee_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "fis_", d: "fisd_",
    entryNo: "fis_entryno", guestName: "fis_guest_name", contactNo: "fis_client_mobile",
    functionDate: "fisd_function_date", funcType: "fisd_function_type",
  },
  {
    name: "Catering",
    endpoint: "get_catering_information_list",
    body: { catering_search: "", source_search: "", lead_type_search: "", cater_venue_search: "", priority_searchc: "", fromdate: "", uptodated: "", cater_assginee_search: "", catering_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "ch_", d: "chd_",
    entryNo: "ch_entry_no", guestName: "ch_guest_name", contactNo: "ch_contact_no",
    functionDate: "chd_date", funcType: "chd_function",
  },
  {
    name: "Decor",
    endpoint: "get_decor_information_list",
    body: { decor_search: "", source_search: "", lead_type_search: "", priority_search: "", decor_venue_search: "", fromdate: "", uptodated: "", decor_assginee_search: "", decor_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "dh_", d: "dhd_",
    entryNo: "dh_entry_no", guestName: "dh_guest_name", contactNo: "dh_contact_no",
    functionDate: "dhd_date", funcType: "dhd_function",
  },
  {
    // Endpoint spelling ("infromation") is the LMS's own typo — verbatim, per the guide.
    name: "Entertainment",
    endpoint: "get_entertain_infromation_list",
    body: { entertain_search: "", source_search: "", lead_type_search: "", entertain_venue_search: "", priority_search: "", fromdate: "", uptodated: "", entertain_assginee_search: "", entertain_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "eh_", d: "ehd_",
    entryNo: "eh_entry_no", guestName: "eh_guest_name", contactNo: "eh_contact_no",
    functionDate: "ehd_date", funcType: "ehd_function",
  },
]

async function fetchRetry(url, opts, retries) {
  retries = retries == null ? 1 : retries
  for (var attempt = 0; attempt <= retries; attempt++) {
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, FETCH_TIMEOUT_MS)
    try {
      var res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }))
      clearTimeout(timer)
      if (res.ok || attempt === retries) return res
      if (res.status < 500) return res
      await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)) })
    } catch (err) {
      clearTimeout(timer)
      if (attempt === retries) throw err
      await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)) })
    }
  }
  throw new Error("fetchRetry exhausted")
}

// One dept's leads, paginated to a short/empty page (page_limit is the PAGE
// NUMBER, not a page size — guide §4), cancelled rows skipped, deduped by
// Dept_EntryNo_FunctionType preferring the row that has a function_date.
async function pullDept(dep, lmsUserId) {
  var allRows = []
  var page = 1
  var errors = []

  while (true) {
    var reqBody = Object.assign({}, dep.body, { loggeduserid: lmsUserId, page_limit: String(page) })
    var res
    try {
      res = await fetchRetry(BASE_URL + dep.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      })
    } catch (err) {
      errors.push(dep.name + ": " + (err && err.message || String(err)))
      break
    }
    if (!res.ok) { errors.push(dep.name + ": HTTP " + res.status); break }

    var data
    try { data = await res.json() } catch (_) { errors.push(dep.name + ": invalid JSON page " + page); break }

    var leads = data.leadinfo || []
    if (leads.length === 0) break

    for (var i = 0; i < leads.length; i++) {
      var row = leads[i]
      var cancelRemarks = (row[dep.h + "cancel_remarks"] || "").toString().trim()
      if (cancelRemarks) continue
      var entryNo = (row[dep.entryNo] || "").toString().trim()
      var funcType = row[dep.funcType] != null ? String(row[dep.funcType]) : ""
      allRows.push({
        dedupKey: dep.name + "_" + entryNo + "_" + funcType,
        function_date: row[dep.functionDate] || null,
        phone: normalizePhone(row[dep.contactNo] || row[dep.h + "secondary_mobileno"]),
        name: (row[dep.guestName] || "").toString().trim() || null,
        entry_no: entryNo || null,
        department: dep.name,
      })
    }

    if (leads.length < PAGE_SIZE) break
    page++
  }

  var seen = new Map()
  for (var r = 0; r < allRows.length; r++) {
    var cur = allRows[r]
    var existing = seen.get(cur.dedupKey)
    if (!existing || (!existing.function_date && cur.function_date)) seen.set(cur.dedupKey, cur)
  }
  return { rows: Array.from(seen.values()), errors: errors }
}

serve(async function (req) {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only")

    var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    var ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) return bad(500, "server_misconfigured", "Missing env")

    var authHeader = req.headers.get("authorization")
    if (!authHeader) return bad(401, "unauthorized", "No auth header")

    var authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    var authRes = await authClient.auth.getUser()
    if (authRes.error || !authRes.data.user) return bad(401, "unauthorized", "Invalid session")

    var lmsUserId = Deno.env.get("LMS_USER_ID") || "1"

    var deptResults = await Promise.all(DEPARTMENTS.map(function (dep) { return pullDept(dep, lmsUserId) }))

    var byPhone = new Map()
    var errors = []
    deptResults.forEach(function (r, idx) {
      errors = errors.concat(r.errors)
      r.rows.forEach(function (row) {
        if (!row.phone) return
        // Same guest can be a lead in more than one department (venue + catering
        // + decor + entertainment for one function) — one contact row per phone.
        if (!byPhone.has(row.phone)) byPhone.set(row.phone, row)
      })
    })

    var rows = Array.from(byPhone.values()).map(function (r) {
      return {
        phone: r.phone,
        name: r.name,
        source: "lms",
        tags: ["lead"],
        external_ids: { department: r.department, entry_no: r.entry_no },
      }
    })

    if (rows.length === 0) {
      return ok({ inserted: 0, updated: 0, skipped_invalid_phone: 0, total_candidates: 0, errors: errors.length > 0 ? errors : undefined })
    }

    var upsertRes = await authClient.rpc("rpc_wa_contact_upsert_bulk", { p_rows: rows })
    if (upsertRes.error) return bad(403, "upsert_failed", upsertRes.error.message)

    var summary = upsertRes.data || {}
    return ok({
      inserted: summary.inserted || 0,
      updated: summary.updated || 0,
      skipped_invalid_phone: summary.skipped_invalid_phone || 0,
      total_candidates: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (uncaught) {
    console.error("lms-leads-pull uncaught: " + (uncaught && uncaught.stack ? uncaught.stack : String(uncaught)))
    return bad(500, "uncaught_exception", (uncaught && uncaught.message) || String(uncaught))
  }
})
