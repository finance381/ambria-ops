import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function authOk(req: Request): boolean {
  const expected = Deno.env.get("FNB_TO_OPS_SECRET") || ""
  if (!expected) return false
  const auth = req.headers.get("Authorization") || ""
  return auth === "Bearer " + expected
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405)
  if (!authOk(req))             return json({ error: "unauthorized" }, 401)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: "bad_json" }, 400) }

  if (!payload?.requested_by || !payload?.venue_id || !Array.isArray(payload?.items)) {
    return json({ error: "requested_by, venue_id, items[] required" }, 400)
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data, error } = await supa.rpc("fn_catering_requisition_create", { p_payload: payload })
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 400 : 500
    return json({ error: error.message, code: error.code }, status)
  }
  return json(data, 201)
})