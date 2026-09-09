// supabase/functions/wa-webhook/index.ts
// Public endpoint, no user auth — Meta calls this directly. GET is the
// subscription handshake; POST delivers message/status/template events.
// Signature-verified via X-Hub-Signature-256 (HMAC-SHA256 of the raw body
// with WA_APP_SECRET) before anything is parsed or written.
//
// Never logs phone numbers or message bodies to console.
//
// Not verified live (no test webhook deliveries possible without the Meta
// secrets + a registered webhook URL yet) — the message_template_status_update
// field names below are Meta's documented shape, but should be checked
// against a real payload once the WABA is wired up.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var STATUS_MAP = { approved: "approved", rejected: "rejected", paused: "paused", disabled: "disabled", pending: "pending" }

async function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader) return false
  var prefix = "sha256="
  if (signatureHeader.indexOf(prefix) !== 0) return false
  var providedHex = signatureHeader.substring(prefix.length)
  var key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  var computedHex = Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0") }).join("")
  return computedHex === providedHex
}

async function handleInboundMessage(supa, value, msg) {
  var fromPhone = "+" + String(msg.from || "").replace(/^\+/, "")
  if (fromPhone === "+") return

  var contactsMeta = value.contacts || []
  var waProfile = contactsMeta[0] || {}
  var displayName = waProfile.profile ? waProfile.profile.name : null

  var bodyText = null
  if (msg.type === "text" && msg.text) bodyText = msg.text.body
  else if (msg.type === "button" && msg.button) bodyText = msg.button.text
  else if (msg.type === "interactive" && msg.interactive) {
    bodyText = (msg.interactive.button_reply && msg.interactive.button_reply.title)
      || (msg.interactive.list_reply && msg.interactive.list_reply.title) || null
  }

  var contactRes = await supa.from("wa_contacts").select("id").eq("phone_e164", fromPhone).maybeSingle()
  var contactId = contactRes.data ? contactRes.data.id : null
  if (!contactId) {
    var insContact = await supa.from("wa_contacts").insert({
      phone_e164: fromPhone, name: displayName, source: "inbound", opt_status: "implied",
    }).select("id").single()
    if (insContact.error) { console.error("wa-webhook: contact insert failed"); return }
    contactId = insContact.data.id
  }

  // The wa_messages_after_insert + wa_stop_keyword_handler triggers (migration
  // 00030) handle the conversation upsert, session window, and any STOP
  // auto-opt-out from here — nothing else to do in this function.
  var insMsg = await supa.from("wa_messages").insert({
    contact_id: contactId, direction: "in", wa_message_id: msg.id,
    rendered_body: bodyText, status: "delivered",
  })
  if (insMsg.error) console.error("wa-webhook: inbound message insert failed: " + insMsg.error.message)
}

async function handleStatusUpdate(supa, status) {
  var waMessageId = status.id
  var newStatus = status.status
  if (["sent", "delivered", "read", "failed"].indexOf(newStatus) === -1) return

  var nowIso = new Date().toISOString()
  var patch = { status: newStatus }
  if (newStatus === "delivered") patch.delivered_at = nowIso
  if (newStatus === "read") patch.read_at = nowIso
  if (newStatus === "failed") {
    patch.failed_at = nowIso
    if (status.errors && status.errors[0]) {
      patch.error_code = String(status.errors[0].code)
      patch.error_message = status.errors[0].message
    }
  }

  var msgRes = await supa.from("wa_messages").update(patch).eq("wa_message_id", waMessageId).select("id, campaign_id").maybeSingle()
  if (msgRes.error || !msgRes.data || !msgRes.data.campaign_id) return

  // Bump the owning campaign's delivered/read counters. replied_count is
  // deliberately NOT incremented here — there's no specified rule for
  // attributing a later inbound message back to a specific campaign, and
  // guessing one risks misleading analytics. Flagged for Phase 9 design.
  var col = newStatus === "delivered" ? "delivered_count" : (newStatus === "read" ? "read_count" : null)
  if (!col) return
  var campRes = await supa.from("wa_campaigns").select(col).eq("id", msgRes.data.campaign_id).maybeSingle()
  var current = (campRes.data && campRes.data[col]) || 0
  var patch2 = {}
  patch2[col] = current + 1
  await supa.from("wa_campaigns").update(patch2).eq("id", msgRes.data.campaign_id)
}

async function handleTemplateStatusUpdate(supa, value) {
  var metaTemplateId = value.message_template_id != null ? String(value.message_template_id) : null
  var templateName = value.message_template_name
  var mapped = STATUS_MAP[String(value.event || "").toLowerCase()]
  if (!mapped) return

  var nowIso = new Date().toISOString()
  var patch = { meta_status: mapped, updated_at: nowIso }
  if (mapped === "approved") patch.approved_at = nowIso
  if (mapped === "rejected" && value.reason) patch.meta_rejection_reason = value.reason
  if (metaTemplateId) patch.meta_id = metaTemplateId

  var query = supa.from("wa_templates").update(patch)
  if (metaTemplateId) query = query.eq("meta_id", metaTemplateId)
  else if (templateName) query = query.eq("name", templateName)
  else return
  var res = await query
  if (res.error) console.error("wa-webhook: template status update failed: " + res.error.message)
}

serve(async function (req) {
  var WA_WEBHOOK_VERIFY_TOKEN = Deno.env.get("WA_WEBHOOK_VERIFY_TOKEN")
  var WA_APP_SECRET = Deno.env.get("WA_APP_SECRET")
  var SUPABASE_URL = Deno.env.get("SUPABASE_URL")
  var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (req.method === "GET") {
    if (!WA_WEBHOOK_VERIFY_TOKEN) return new Response("Forbidden", { status: 403 })
    var url = new URL(req.url)
    var mode = url.searchParams.get("hub.mode")
    var token = url.searchParams.get("hub.verify_token")
    var challenge = url.searchParams.get("hub.challenge")
    if (mode === "subscribe" && token === WA_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } })
    }
    return new Response("Forbidden", { status: 403 })
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

  if (!WA_APP_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error("wa-webhook: server misconfigured (missing env)")
    return new Response("EVENT_RECEIVED", { status: 200 }) // still 200 — don't let Meta retry-storm a config issue
  }

  var rawBody = await req.text()
  var sigHeader = req.headers.get("x-hub-signature-256")
  var validSig = await verifySignature(rawBody, sigHeader, WA_APP_SECRET)
  if (!validSig) {
    console.error("wa-webhook: signature verification failed")
    return new Response("Forbidden", { status: 403 })
  }

  var payload
  try { payload = JSON.parse(rawBody) }
  catch (e) { return new Response("Bad Request", { status: 400 }) }

  var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  try {
    var entries = payload.entry || []
    for (var e = 0; e < entries.length; e++) {
      var changes = entries[e].changes || []
      for (var c = 0; c < changes.length; c++) {
        var field = changes[c].field
        var value = changes[c].value || {}

        if (field === "message_template_status_update") {
          await handleTemplateStatusUpdate(supa, value)
          continue
        }

        var messages = value.messages || []
        for (var m = 0; m < messages.length; m++) await handleInboundMessage(supa, value, messages[m])

        var statuses = value.statuses || []
        for (var s = 0; s < statuses.length; s++) await handleStatusUpdate(supa, statuses[s])
      }
    }
  } catch (procErr) {
    console.error("wa-webhook: processing error: " + (procErr && procErr.message))
  }

  return new Response("EVENT_RECEIVED", { status: 200 })
})
