// Fnbapp -> Ops: syncs an Fnbapp-only function (no LMS contract behind it --
// a manual "Add Event" or a converted proposal, their own FP-.../PROP-... id)
// to a lightweight Ops-side "tentative event", so its requisitions can
// finally carry a real event_id instead of none at all. Mirrors
// fnb-store-requisition-sync's shape exactly: shared-secret bearer auth (no
// Ops user signed in on Fnbapp's side), service_role client, one RPC does
// the real work.
//
// Payload: { external_ref, client_name, venue_name, function_date, pax?,
//            function_type }
// external_ref is the upsert key -- a repeat call with the same ref (as the
// booking is edited before the function date) updates the same event
// instead of creating a new one, same idempotency pattern sync_ref already
// uses on the requisition side. venue_name is plain text (Fnbapp has no
// visibility into Ops' venue ids) -- resolved against the venues master by
// exact name match server-side, falling back to free text otherwise.
//
// Returns the Ops-side event id to use as event_id in subsequent
// fnb-store-requisition-sync calls. If the event has since been merged into
// a real LMS-synced one (an Ops admin action), returns THAT event's id
// instead and stops accepting edits to it -- it's LMS's to own from there.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } })
}
function authOk(req: Request): boolean {
  const expected = Deno.env.get("FNB_TO_OPS_REQ_SECRET") || ""
  return !!expected && (req.headers.get("Authorization") || "") === "Bearer " + expected
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405)
  if (!authOk(req))             return json({ error: "unauthorized" }, 401)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: "bad_json" }, 400) }

  if (!payload?.external_ref || !payload?.client_name || !payload?.venue_name || !payload?.function_date || !payload?.function_type) {
    return json({ error: "external_ref, client_name, venue_name, function_date, function_type required" }, 400)
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data, error } = await supa.rpc("fn_fnb_tentative_event_sync", { p_payload: payload })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 400 : 500
    return json({ error: error.message, code: error.code }, status)
  }
  return json({ event_id: data }, 200)
})
