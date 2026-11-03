// Fnbapp -> Ops: "Sync to Ops" on the store-issuing screen creates one real
// Store Requisition here per station/day, as if a store person had filled
// in the form by hand -- same tables, same stock deduction. Mirrors
// catering-inventory-decrement's own shape exactly: shared-secret bearer
// auth (not a user JWT -- there is no Ops user signed in on Fnbapp's side),
// service_role client, one RPC does the real work.
//
// Payload: { sync_ref, issued_by, entry_date, event_id?, section_name,
//            items: [{ item_source, item_id, item_name, unit, qty }] }
// Fnbapp resolves item_id/item_source/item_name/unit itself via its own
// ingredient_item_map before calling -- this function does not do any
// fuzzy item matching. rate_paise is deliberately NOT accepted from the
// caller: Ops looks up fn_item_latest_rate server-side, the same price a
// person filling the form in by hand would get.
//
// sync_ref is the idempotency key -- a retried call with the same ref
// returns the existing requisition's id rather than creating a duplicate.

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

  if (!payload?.sync_ref || !payload?.entry_date || !payload?.section_name || !Array.isArray(payload?.items) || payload.items.length === 0) {
    return json({ error: "sync_ref, entry_date, section_name, items[] required" }, 400)
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data, error } = await supa.rpc("fn_fnb_store_requisition_sync", { p_payload: payload })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 400 : 500
    return json({ error: error.message, code: error.code }, status)
  }
  return json({ requisition_id: data }, 201)
})
