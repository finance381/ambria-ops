// supabase/functions/lms-contacts-pull/index.ts
//
// Design decision (flagged, not silent): the spec asked this to hit a
// dedicated LMS "list leads" endpoint, but no such endpoint has any
// precedent anywhere in this codebase — only "create one lead"
// (lms-push.ts) and "list confirmed CONTRACTS" (sync-events.ts,
// get_venue_contract_information_list etc.) exist. Per the user's own
// choice to use the contract-list data as a stand-in: rather than
// re-implementing sync-events' whole per-department LMS pagination a
// second time here, this function reads the LOCAL `events` table instead
// — it's already populated from those exact same LMS endpoints by
// sync-events, so the data is identical and this avoids a second redundant
// external HTTP integration. This also means Phase 5's separately-planned
// "Pull from contracts" (local query) and "Pull from LMS" (this function)
// buttons would return the same rows — worth collapsing into one Import
// action when Contacts.jsx is built, rather than offering both.
//
// Auth: verifies the caller has a valid session (like lms-push.ts), reads
// `events` via the service-role client, but calls rpc_wa_contact_upsert_bulk
// through an AUTH-SCOPED client so that RPC's own internal
// user_can('broadcast.contacts.import') check runs against the real
// caller's JWT — no separate permission check duplicated here.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("lms-contacts-pull bad " + status + " " + code + ": " + msg)
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

// Indian-number normalization per spec: strip spaces/dashes, 10 digits -> +91-prefixed.
// Anything else is passed through as-is and left for rpc_wa_contact_upsert_bulk's own
// E.164 check to reject — no point duplicating that validation here.
function normalizePhone(raw) {
  if (!raw) return null
  var digits = String(raw).replace(/[\s\-()]/g, "")
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits
  var onlyDigits = digits.replace(/\D/g, "")
  if (onlyDigits.length === 10) return "+91" + onlyDigits
  if (onlyDigits.length === 12 && onlyDigits.indexOf("91") === 0) return "+" + onlyDigits
  return digits
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

    var body
    try { body = await req.json() } catch (e) { body = {} }

    var fromDate = body.from_date || null
    var toDate = body.to_date || null
    var department = body.department || null
    var venueName = body.venue_name || null

    var db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

    var query = db.from("events")
      .select("id, lms_event_id, contract_no, client_name, contact_person, contact_number, venue_name, department, function_date")
      .not("contact_number", "is", null)
      .neq("contact_number", "")

    if (fromDate) query = query.gte("function_date", fromDate)
    if (toDate) query = query.lte("function_date", toDate)
    if (department) query = query.eq("department", department)
    if (venueName) query = query.eq("venue_name", venueName)

    var eventsRes = await query
    if (eventsRes.error) return bad(500, "events_query_failed", eventsRes.error.message)

    var events = eventsRes.data || []
    if (events.length === 0) return ok({ inserted: 0, updated: 0, skipped_invalid_phone: 0, total_candidates: 0 })

    var rows = events.map(function (e) {
      return {
        phone: normalizePhone(e.contact_number),
        name: e.contact_person || e.client_name || null,
        source: "contract",
        external_ids: { event_id: e.id, lms_event_id: e.lms_event_id, contract_no: e.contract_no },
      }
    })

    var upsertRes = await authClient.rpc("rpc_wa_contact_upsert_bulk", { p_rows: rows })
    if (upsertRes.error) return bad(403, "upsert_failed", upsertRes.error.message)

    var summary = upsertRes.data || {}
    return ok({
      inserted: summary.inserted || 0,
      updated: summary.updated || 0,
      skipped_invalid_phone: summary.skipped_invalid_phone || 0,
      total_candidates: rows.length,
    })
  } catch (uncaught) {
    console.error("lms-contacts-pull uncaught: " + (uncaught && uncaught.stack ? uncaught.stack : String(uncaught)))
    return bad(500, "uncaught_exception", (uncaught && uncaught.message) || String(uncaught))
  }
})
