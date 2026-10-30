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
    // Moved off quote_config's jsonb to real tables (Phase 3 of the quote
    // pricing migration) — date_categories.id is the same position index
    // season_dates.date_category_id and this endpoint's own label lookup
    // already assumed.
    const [{ data: catRows, error: catErr }, { data: dateRows, error: dateErr }] = await Promise.all([
      supabase.from("quote_date_categories").select("id, label, updated_at").order("sort_order"),
      supabase.from("quote_season_dates").select("year, month, day, date_category_id, updated_at"),
    ])
    if (catErr) throw new Error(catErr.message)
    if (dateErr) throw new Error(dateErr.message)

    const DEFAULT_CATS = [
      { id: 0, label: "King's" }, { id: 1, label: "Perfect" }, { id: 2, label: "Filler" },
    ]
    const cats = (catRows && catRows.length) ? catRows : DEFAULT_CATS
    const labels = cats.map((c: any) => c.label)
    const labelById: Record<number, string> = {}
    cats.forEach((c: any) => { labelById[c.id] = c.label })

    var updatedAt = ""
    for (const r of (catRows || []).concat(dateRows || [])) {
      if (r.updated_at && r.updated_at > updatedAt) updatedAt = r.updated_at
    }

    const pad2 = (n: number) => (n < 10 ? "0" + n : "" + n)
    const dates: Record<string, string> = {}
    for (const r of (dateRows || [])) {
      // Same key shape the old jsonb already mixed together and this
      // endpoint exported as-is: a year-less row is the legacy "MM-DD"
      // recurring entry, a row with a year is a specific-date override —
      // both can be present side by side, same as before.
      const key = r.year ? (r.year + "-" + pad2(r.month) + "-" + pad2(r.day)) : (pad2(r.month) + "-" + pad2(r.day))
      const label = labelById[r.date_category_id]
      if (label) dates[key] = label
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