// supabase/functions/wa-account-info/index.ts
// Admin-only, on-demand: fetches the WABA/phone-number's current display
// name, quality rating and tier from Meta and upserts wa_accounts, then
// returns the row for Settings.jsx's read-only WABA info card.
//
// quota_used_today is NOT fetched here — Meta has no simple single-field
// "quota used today" endpoint; that column stays whatever the DB already has
// (nothing currently writes it — flagged as deferred, same as automations).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("wa-account-info bad " + status + " " + code + ": " + msg)
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

serve(async function (req) {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only")

    var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    var ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
    var WA_WABA_ID = Deno.env.get("WA_WABA_ID")
    var WA_PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID")
    var WA_ACCESS_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")
    var WA_API_VERSION = Deno.env.get("WA_API_VERSION") || "v21.0"
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY || !WA_WABA_ID || !WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      return bad(500, "server_misconfigured", "Missing required env vars")
    }

    var authHeader = req.headers.get("authorization")
    if (!authHeader) return bad(401, "unauthorized", "No auth header")
    var authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    var authRes = await authClient.auth.getUser()
    if (authRes.error || !authRes.data.user) return bad(401, "unauthorized", "Invalid session")

    var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
    var profRes = await supa.from("profiles").select("role").eq("id", authRes.data.user.id).maybeSingle()
    if (!profRes.data || profRes.data.role !== "admin") return bad(403, "admin_only", "Admin only")

    var metaRes, metaData
    try {
      metaRes = await fetch(
        "https://graph.facebook.com/" + WA_API_VERSION + "/" + WA_PHONE_NUMBER_ID +
        "?fields=display_phone_number,quality_rating,verified_name,messaging_limit_tier",
        { headers: { "Authorization": "Bearer " + WA_ACCESS_TOKEN } }
      )
      metaData = await metaRes.json()
    } catch (fetchErr) {
      return bad(502, "meta_unreachable", String(fetchErr && fetchErr.message))
    }
    if (!metaRes.ok) return bad(502, "meta_fetch_failed", (metaData.error && metaData.error.message) || "Meta fetch failed")

    var upsertRes = await supa.from("wa_accounts").upsert({
      waba_id: WA_WABA_ID,
      phone_number_id: WA_PHONE_NUMBER_ID,
      display_phone: metaData.display_phone_number || "",
      quality_rating: metaData.quality_rating || null,
      tier: metaData.messaging_limit_tier || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "waba_id" }).select().single()

    if (upsertRes.error) return bad(500, "upsert_failed", upsertRes.error.message)
    return ok({ account: upsertRes.data })
  } catch (uncaught) {
    console.error("wa-account-info uncaught: " + (uncaught && uncaught.stack ? uncaught.stack : String(uncaught)))
    return bad(500, "uncaught_exception", (uncaught && uncaught.message) || String(uncaught))
  }
})
