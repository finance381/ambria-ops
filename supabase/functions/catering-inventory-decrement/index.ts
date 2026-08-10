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
  const expected = Deno.env.get("FNB_TO_OPS_SECRET") || ""
  return !!expected && (req.headers.get("Authorization") || "") === "Bearer " + expected
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405)
  if (!authOk(req))             return json({ error: "unauthorized" }, 401)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: "bad_json" }, 400) }

  if (!payload?.fnb_event_id || !payload?.close_token || !payload?.closed_by || !Array.isArray(payload?.items)) {
    return json({ error: "fnb_event_id, close_token, closed_by, items[] required" }, 400)
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data, error } = await supa.rpc("fn_catering_inventory_decrement", { p_payload: payload })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 400 : 500
    return json({ error: error.message, code: error.code }, status)
  }
  // 200 for applied + 200 for already_closed (idempotent success)
  return json(data, 200)
})