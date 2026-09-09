// supabase/functions/wa-template-meta/index.ts
//
// Closes a gap flagged during Phase 1 (DB migration 00029): rpc_wa_template_submit
// and rpc_wa_template_sync only do DB bookkeeping — there's no precedent anywhere
// in this codebase for Postgres making outbound HTTP calls (no pg_net), so the
// actual Meta Create-Message-Template / template-status-fetch calls have to live
// in an Edge Function. Not part of the original spec's named 3 functions, but
// without this, Templates.jsx's Submit/Sync buttons would be non-functional stubs.
//
// { action: 'submit', template_id } — POSTs the template to Meta for review.
//   Only proceeds if the row's meta_status is already 'pending' (set by
//   rpc_wa_template_submit, which is where the broadcast.templates.submit
//   permission is actually enforced — this function only executes on rows a
//   permitted user already flipped to pending).
// { action: 'sync', template_id } — re-fetches current status from Meta by
//   the stored meta_id.
//
// Never logs template body text to console — only ids/status.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("wa-template-meta bad " + status + " " + code + ": " + msg)
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

function buildComponents(t) {
  var components = []
  if (t.header_type && t.header_type !== "null" && t.header_content) {
    if (t.header_type === "text") components.push({ type: "HEADER", format: "TEXT", text: t.header_content })
    else components.push({ type: "HEADER", format: t.header_type.toUpperCase() })
  }
  components.push({ type: "BODY", text: t.body_text })
  if (t.footer_text) components.push({ type: "FOOTER", text: t.footer_text })
  var buttons = Array.isArray(t.buttons_json) ? t.buttons_json : []
  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map(function (b) {
        if (b.type === "url") return { type: "URL", text: b.text, url: b.url }
        return { type: "QUICK_REPLY", text: b.text }
      }),
    })
  }
  return components
}

serve(async function (req) {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only")

    var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    var ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
    var WA_WABA_ID = Deno.env.get("WA_WABA_ID")
    var WA_ACCESS_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")
    var WA_API_VERSION = Deno.env.get("WA_API_VERSION") || "v21.0"
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY || !WA_WABA_ID || !WA_ACCESS_TOKEN) {
      return bad(500, "server_misconfigured", "Missing required env vars")
    }

    var authHeader = req.headers.get("authorization")
    if (!authHeader) return bad(401, "unauthorized", "No auth header")
    var authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    var authRes = await authClient.auth.getUser()
    if (authRes.error || !authRes.data.user) return bad(401, "unauthorized", "Invalid session")

    var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

    var body
    try { body = await req.json() } catch (e) { return bad(400, "invalid_json", "Body must be JSON") }
    var action = body.action
    var templateId = body.template_id
    if (!templateId || ["submit", "sync"].indexOf(action) === -1) {
      return bad(400, "invalid_request", "action must be 'submit' or 'sync', template_id required")
    }

    var tRes = await supa.from("wa_templates").select("*").eq("id", templateId).maybeSingle()
    if (tRes.error || !tRes.data) return bad(404, "template_not_found", "Template not found")
    var t = tRes.data

    if (action === "submit") {
      if (t.meta_status !== "pending") {
        return bad(409, "not_pending", "Call rpc_wa_template_submit first to mark this template pending")
      }

      var metaBody = {
        name: t.name,
        language: t.language || "en",
        category: (t.category || "").toUpperCase(),
        components: buildComponents(t),
      }

      var metaRes, metaData
      try {
        metaRes = await fetch("https://graph.facebook.com/" + WA_API_VERSION + "/" + WA_WABA_ID + "/message_templates", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + WA_ACCESS_TOKEN },
          body: JSON.stringify(metaBody),
        })
        metaData = await metaRes.json()
      } catch (fetchErr) {
        return bad(502, "meta_unreachable", String(fetchErr && fetchErr.message))
      }

      if (!metaRes.ok) {
        var rejMsg = (metaData.error && metaData.error.message) || "Meta rejected the template"
        await authClient.rpc("rpc_wa_template_sync", {
          p_template_id: templateId, p_meta_status: "rejected", p_meta_id: null, p_rejection_reason: rejMsg,
        })
        return bad(422, "meta_rejected", rejMsg)
      }

      var newStatus = String(metaData.status || "pending").toLowerCase()
      await authClient.rpc("rpc_wa_template_sync", {
        p_template_id: templateId,
        p_meta_status: newStatus,
        p_meta_id: metaData.id != null ? String(metaData.id) : null,
        p_rejection_reason: null,
      })
      return ok({ meta_id: metaData.id, status: newStatus })
    }

    // action === "sync"
    if (!t.meta_id) return bad(409, "not_submitted", "Template has no meta_id yet — submit it first")

    var syncRes, syncData
    try {
      syncRes = await fetch("https://graph.facebook.com/" + WA_API_VERSION + "/" + t.meta_id + "?fields=status,rejected_reason", {
        headers: { "Authorization": "Bearer " + WA_ACCESS_TOKEN },
      })
      syncData = await syncRes.json()
    } catch (fetchErr) {
      return bad(502, "meta_unreachable", String(fetchErr && fetchErr.message))
    }
    if (!syncRes.ok) {
      return bad(502, "meta_fetch_failed", (syncData.error && syncData.error.message) || "Meta fetch failed")
    }

    var syncedStatus = String(syncData.status || "pending").toLowerCase()
    await authClient.rpc("rpc_wa_template_sync", {
      p_template_id: templateId,
      p_meta_status: syncedStatus,
      p_meta_id: t.meta_id,
      p_rejection_reason: syncData.rejected_reason || null,
    })
    return ok({ status: syncedStatus })
  } catch (uncaught) {
    console.error("wa-template-meta uncaught: " + (uncaught && uncaught.stack ? uncaught.stack : String(uncaught)))
    return bad(500, "uncaught_exception", (uncaught && uncaught.message) || String(uncaught))
  }
})
