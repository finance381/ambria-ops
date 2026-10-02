// supabase/functions/send-push/index.ts
// Sends a Web Push notification to every device a user has subscribed on.
// Service-role only — called from DB triggers (via pg_net) and from
// wa-webhook server-to-server, same trusted-caller shape as wa-send's
// auto-reply path. Never called directly by a browser client: a notification
// has to reach someone who isn't the one performing the action (a dept head,
// a transfer recipient), so nothing here can be "the acting user's own
// client calls it" the way wa-send's main path is.
//
// { user_id, title, body, link } — inserts nothing itself (the caller
// already wrote the notifications row; this is purely best-effort OS
// delivery on top of that reliable record). A dead subscription (404/410
// from the push service) is deleted so it stops being tried.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import webpush from "npm:web-push@3.6.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function bad(status, code, msg) {
  if (status >= 500) console.error("send-push bad " + status + " " + code + ": " + msg)
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
    var VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")
    var VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")
    var VAPID_CONTACT_EMAIL = Deno.env.get("VAPID_CONTACT_EMAIL") || "mailto:ops@ambria.in"
    if (!SUPABASE_URL || !SERVICE_ROLE || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return bad(500, "server_misconfigured", "Missing required env vars")
    }

    // Service-role only — never a logged-in user's own session, since this
    // always fires on someone ELSE's behalf, not the caller's own.
    var authHeader = req.headers.get("authorization")
    var bearerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : ""
    if (bearerToken !== SERVICE_ROLE) return bad(401, "unauthorized", "Service role only")

    var body
    try { body = await req.json() }
    catch (e) { return bad(400, "invalid_json", "Body must be JSON") }

    var userId = body.user_id
    var title = body.title
    if (!userId || !title) return bad(400, "missing_fields", "user_id and title are required")

    var supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

    var subsRes = await supa.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId)
    if (subsRes.error) return bad(500, "db_error", subsRes.error.message)
    var subs = subsRes.data || []
    if (subs.length === 0) return ok({ sent: 0, reason: "no_subscriptions" })

    webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    var payload = JSON.stringify({ title: title, body: body.body || "", link: body.link || "/ambria-ops/" })
    var sent = 0
    var deadIds = []
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i]
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
        sent++
      } catch (err) {
        // 404/410 means the browser/OS has dropped this subscription —
        // nothing will ever succeed against it again, so stop trying.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) deadIds.push(s.id)
        else console.error("send-push: delivery failed for subscription " + s.id + ": " + (err && err.message))
      }
    }

    if (deadIds.length > 0) await supa.from("push_subscriptions").delete().in("id", deadIds)

    return ok({ sent: sent, total: subs.length, pruned: deadIds.length })
  } catch (e) {
    return bad(500, "unexpected", e && e.message ? e.message : String(e))
  }
})
