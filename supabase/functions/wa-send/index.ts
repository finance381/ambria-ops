// supabase/functions/wa-send/index.ts
// Sends queued wa_messages rows to Meta's WhatsApp Cloud API.
// Two invocation modes (client calls this right after the RPC that queued
// the row(s) succeeds):
//   { message_id }  — single message (quick-send, conversation reply)
//   { campaign_id } — one batch (default 100, see BATCH_SIZE below) of
//     'queued' rows for that campaign, 100ms apart
//
// A campaign send used to pull every queued row and loop over all of them in
// one call — fine at a few hundred recipients, but a 4,800-recipient send
// at ~1s/message (the fn_wa_can_send round trip + the Meta call + two more
// DB writes + the 100ms throttle) runs 60-90 minutes, and Supabase kills an
// Edge Function invocation at a ~150s wall-clock limit ("Request idle
// timeout limit (150s) reached" — seen in production on exactly this kind
// of send). Only ever processing one bounded batch per call, and reporting
// how many are still queued, is what lets the caller (CampaignBuilder.jsx)
// keep calling this in a loop until the whole campaign is through — each
// individual call now always finishes well inside the platform's limit.
// sent_count/failed_count/blocked_count on wa_campaigns accumulate across
// calls rather than being overwritten, and wa_campaigns only moves out of
// 'sending' once a batch reports zero remaining.
//
// Never logs phone numbers or message bodies to console — only message/
// contact/campaign ids. Request/response payloads ARE stored in
// wa_send_events (that table's entire purpose is a DB-side debug audit
// trail, admin-only RLS) — that's storage, not console logging, so it's not
// a PII-in-logs violation the way console.log would be.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

var STATUS_BY_BLOCK_REASON = {
  opted_out: "opted_out_blocked",
  freq_cap: "freq_cap_blocked",
  window_blocked: "window_blocked",
  invalid_phone: "failed",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("wa-send bad " + status + " " + code + ": " + msg)
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

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

serve(async function (req) {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only")

    var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    var ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
    var WA_PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID")
    var WA_ACCESS_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")
    var WA_API_VERSION = Deno.env.get("WA_API_VERSION") || "v21.0"
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY || !WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      return bad(500, "server_misconfigured", "Missing required env vars")
    }

    var authHeader = req.headers.get("authorization")
    if (!authHeader) return bad(401, "unauthorized", "No auth header")
    // Two callers: a real logged-in user (Campaigns/Inbox, existing path) OR
    // wa-webhook triggering an auto-reply server-to-server — the service role
    // key is never exposed to a client, only ever readable by another Edge
    // Function's own env, so accepting it here as a second valid bearer is a
    // trusted-caller check, not a public bypass.
    var bearerToken = authHeader.replace(/^Bearer\s+/i, "")
    if (bearerToken !== SERVICE_ROLE) {
      var authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      var authRes = await authClient.auth.getUser()
      if (authRes.error || !authRes.data.user) return bad(401, "unauthorized", "Invalid session")
    }

    var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

    var body
    try { body = await req.json() }
    catch (e) { return bad(400, "invalid_json", "Body must be JSON") }

    var apiBase = "https://graph.facebook.com/" + WA_API_VERSION + "/" + WA_PHONE_NUMBER_ID + "/messages"

    async function logEvent(messageId, eventType, requestPayload, responsePayload, httpStatus, errorText) {
      try {
        await supa.from("wa_send_events").insert({
          message_id: messageId, event_type: eventType,
          request_payload: requestPayload || null, response_payload: responsePayload || null,
          http_status: httpStatus || null, error_text: errorText || null,
        })
      } catch (e) {}
    }

    // Sends one wa_messages row. Returns 'sent' | 'failed' | 'blocked'.
    async function sendOne(row) {
      var category = row.wa_templates ? row.wa_templates.category : "utility"

      var checkRes = await supa.rpc("fn_wa_can_send", { p_contact_id: row.contact_id, p_template_category: category })
      var check = (checkRes.data && checkRes.data[0]) || { ok: false, reason: "check_failed" }
      if (checkRes.error) check = { ok: false, reason: "check_failed" }

      if (!check.ok) {
        var blockedStatus = STATUS_BY_BLOCK_REASON[check.reason] || "failed"
        await supa.from("wa_messages").update({
          status: blockedStatus, error_code: check.reason, failed_at: new Date().toISOString(),
        }).eq("id", row.id)
        await logEvent(row.id, "error", null, null, null, "blocked: " + check.reason)
        return "blocked"
      }

      var phone = row.wa_contacts.phone_e164
      var metaPayload
      if (row.template_id) {
        if (!row.wa_templates) {
          await supa.from("wa_messages").update({ status: "failed", error_code: "template_missing", failed_at: new Date().toISOString() }).eq("id", row.id)
          return "failed"
        }
        var params = Array.isArray(row.template_params) ? row.template_params : []
        if (row.wa_templates.variable_count > 0 && params.length !== row.wa_templates.variable_count) {
          // See migration 00033: rpc_wa_conversation_reply's template path doesn't
          // populate template_params yet — fail loudly rather than send wrong values.
          await supa.from("wa_messages").update({ status: "failed", error_code: "template_params_missing", failed_at: new Date().toISOString() }).eq("id", row.id)
          return "failed"
        }
        var components = params.length > 0
          ? [{ type: "body", parameters: params.map(function (v) { return { type: "text", text: String(v) } }) }]
          : []
        metaPayload = {
          messaging_product: "whatsapp", to: phone, type: "template",
          template: { name: row.wa_templates.name, language: { code: row.wa_templates.language || "en" }, components: components },
        }
      } else {
        metaPayload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: row.rendered_body || "" } }
      }

      var metaRes, metaData
      try {
        metaRes = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + WA_ACCESS_TOKEN },
          body: JSON.stringify(metaPayload),
        })
        metaData = await metaRes.json()
      } catch (fetchErr) {
        await supa.from("wa_messages").update({ status: "failed", error_message: "network_error", failed_at: new Date().toISOString() }).eq("id", row.id)
        await logEvent(row.id, "error", metaPayload, null, null, String(fetchErr && fetchErr.message))
        return "failed"
      }

      await logEvent(row.id, "response", metaPayload, metaData, metaRes.status, null)

      if (metaRes.ok && metaData.messages && metaData.messages[0] && metaData.messages[0].id) {
        await supa.from("wa_messages").update({
          wa_message_id: metaData.messages[0].id, status: "sent", sent_at: new Date().toISOString(),
        }).eq("id", row.id)
        return "sent"
      }

      var errCode = metaData.error ? String(metaData.error.code) : "unknown"
      var errMsg = metaData.error ? metaData.error.message : "Unknown Meta error"
      await supa.from("wa_messages").update({
        status: "failed", error_code: errCode, error_message: errMsg, failed_at: new Date().toISOString(),
      }).eq("id", row.id)

      // Meta error code 131047 = message failed because the recipient hasn't
      // messaged in 24h and this isn't a template (or similar re-engagement
      // requirement) — treat as an implicit opt-out signal per spec.
      if (errCode === "131047") {
        try { await supa.rpc("rpc_wa_contact_opt_out", { p_phone: phone, p_reason: "meta_error_131047", p_source: "inbound_report" }) } catch (e) {}
      }

      return "failed"
    }

    if (body.message_id) {
      var msgRes = await supa.from("wa_messages")
        .select("*, wa_contacts(phone_e164), wa_templates(name, language, category, variable_count)")
        .eq("id", body.message_id).maybeSingle()
      if (msgRes.error || !msgRes.data) return bad(404, "message_not_found", "Message not found")
      if (msgRes.data.status !== "queued") return bad(409, "not_queued", "Message is not in queued state")

      var outcome = await sendOne(msgRes.data)
      return ok({ outcome: outcome })
    }

    if (body.campaign_id) {
      // Conservative default: fn_wa_can_send + the Meta call + two more DB
      // writes + the 100ms throttle can run close to 1s/message under real
      // network latency, and 100 * ~1s sits safely under the 150s platform
      // limit even on a slow batch. Clamped so a client can't accidentally
      // request a batch large enough to time out again.
      var BATCH_SIZE = Math.min(Math.max(parseInt(body.batch_size, 10) || 100, 1), 300)

      var queueRes = await supa.from("wa_messages")
        .select("*, wa_contacts(phone_e164), wa_templates(name, language, category, variable_count)")
        .eq("campaign_id", body.campaign_id).eq("status", "queued")
        .order("id", { ascending: true }).limit(BATCH_SIZE)
      if (queueRes.error) return bad(500, "queue_fetch_failed", queueRes.error.message)

      var rows = queueRes.data || []
      var sent = 0, failed = 0, blocked = 0
      for (var i = 0; i < rows.length; i++) {
        var result = await sendOne(rows[i])
        if (result === "sent") sent += 1
        else if (result === "blocked") blocked += 1
        else failed += 1
        if (i < rows.length - 1) await sleep(100)
      }

      // blocked_count already has the send-time resolve_audience count from
      // rpc_wa_campaign_send; sent/failed/blocked here are read-then-add so
      // repeated calls across batches accumulate instead of overwriting.
      var campRes = await supa.from("wa_campaigns")
        .select("sent_count, failed_count, blocked_count").eq("id", body.campaign_id).maybeSingle()
      var newSent = ((campRes.data && campRes.data.sent_count) || 0) + sent
      var newFailed = ((campRes.data && campRes.data.failed_count) || 0) + failed
      var newBlocked = ((campRes.data && campRes.data.blocked_count) || 0) + blocked

      var remainingRes = await supa.from("wa_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", body.campaign_id).eq("status", "queued")
      var remaining = remainingRes.count || 0

      var campUpdate = { sent_count: newSent, failed_count: newFailed, blocked_count: newBlocked }
      if (remaining === 0) {
        campUpdate.status = newFailed > 0 ? "partial" : "sent"
        campUpdate.completed_at = new Date().toISOString()
      }
      await supa.from("wa_campaigns").update(campUpdate).eq("id", body.campaign_id)

      return ok({ sent: newSent, failed: newFailed, blocked: newBlocked, batch_total: rows.length, remaining: remaining })
    }

    return bad(400, "missing_target", "message_id or campaign_id required")
  } catch (uncaught) {
    console.error("wa-send uncaught: " + (uncaught && uncaught.stack ? uncaught.stack : String(uncaught)))
    return bad(500, "uncaught_exception", (uncaught && uncaught.message) || String(uncaught))
  }
})
