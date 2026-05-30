import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ORIGIN = Deno.env.get("SEASON_EXPORT_ORIGIN") || "*"
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const key = Deno.env.get("SEASON_EXPORT_KEY")
  if (!key || req.headers.get("x-api-key") !== key) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )
    const { data, error } = await supabase
      .from("quote_config")
      .select("key, value, updated_at")
      .in("key", ["season_dates", "categories"])
    if (error) throw new Error(error.message)

    const map: Record<string, any> = {}
    let updatedAt = ""
    for (const r of (data || [])) {
      map[r.key] = r.value
      if (r.updated_at > updatedAt) updatedAt = r.updated_at
    }

    const DEFAULT_CATS = [
      { label: "King's" }, { label: "Perfect" }, { label: "Filler" },
    ]
    const cats = Array.isArray(map.categories) ? map.categories : DEFAULT_CATS
    const labels = cats.map((c: any) => c.label)
    const raw = map.season_dates || {}
    const dates: Record<string, string> = {}
    for (const mmdd of Object.keys(raw)) {
      const idx = raw[mmdd]
      if (labels[idx]) dates[mmdd] = labels[idx]
    }

    return new Response(JSON.stringify({
      updated_at: updatedAt,
      categories: labels,
      default_category: labels.length ? labels[labels.length - 1] : null,
      dates,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})