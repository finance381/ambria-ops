import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )
    const geminiKey = Deno.env.get("GEMINI_API_KEY")
    if (!geminiKey) throw new Error("GEMINI_API_KEY not set")

    // Fetch quotes from last 30 days — PII stripped
    const since = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
    const { data: quotes, error: qErr } = await supabase
      .from("quotes")
      .select("venue_idx, venue_name, event_date, date_category, slot, pax, food_pref, is_wedding, menu_idx, menu_label, per_head_rate, decor_idx, dj_idx, ttd_idx, total_q_paise, total_t_paise, total_f_paise, deal_value_paise, status, notes, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200)

    if (qErr) throw new Error("Quote fetch failed: " + qErr.message)
    console.log("Fetched " + (quotes || []).length + " quotes from last 30 days")

    // Fetch current knowledge
    let currentDynamic = ""
    try {
      const { data } = await supabase.storage.from("knowledge").download("knowledge-dynamic.md")
      if (data) currentDynamic = await data.text()
    } catch { console.log("No existing knowledge-dynamic.md") }

    // Fetch demand snapshot — next 60 days
    const today = new Date().toISOString().split("T")[0]
    const sixtyDays = new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0]
    const { data: upcoming } = await supabase
      .from("quotes")
      .select("event_date, venue_idx, status")
      .gte("event_date", today)
      .lte("event_date", sixtyDays)

    // Aggregate demand by date
    const demandMap: Record<string, number> = {}
    const venueDemand: Record<string, Record<string, number>> = {}
    for (const q of (upcoming || [])) {
      if (!q.event_date) continue
      demandMap[q.event_date] = (demandMap[q.event_date] || 0) + 1
      const vk = q.venue_idx + ""
      if (!venueDemand[vk]) venueDemand[vk] = {}
      venueDemand[vk][q.event_date] = (venueDemand[vk][q.event_date] || 0) + 1
    }

    // Sort by demand desc, top 15 dates
    const hotDates = Object.entries(demandMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([date, count]) => date + ": " + count + " quotes")

    const prompt = `You maintain a business knowledge base for Ambria, a wedding/banquet venue company.

PREVIOUS DYNAMIC PATTERNS:
${currentDynamic || "(none yet)"}

NEW QUOTE DATA (last 30 days, ${(quotes || []).length} quotes, PII already stripped):
${JSON.stringify(quotes || [], null, 1)}

DEMAND SNAPSHOT (next 60 days):
Hot dates: ${hotDates.join(", ") || "none"}
Per-venue demand: ${JSON.stringify(venueDemand)}

TASK:
Generate a fresh dynamic patterns file from the quote data. Rules:
1. ONLY output data-backed patterns. Never invent or extrapolate beyond the data.
2. Every number must trace back to the quote data above. If unsure, omit.
3. Sections to include:
   - DEMAND FORECAST: hot dates, per-venue demand for next 60 days
   - RECENT QUOTE PATTERNS: avg quote values by venue, popular menus, common pax ranges, conversion rates (status=accepted vs total)
   - PRICING INTELLIGENCE: deal values closing at vs quoted, TTD discount usage
   - REP INSIGHTS: recurring themes from sales rep notes (special requests, negotiation patterns, objections raised)
4. Do NOT repeat any information from the base knowledge file — this file supplements it.
5. Strip any PII. No guest names, phones, emails.
6. Keep total output under 4000 words.
7. Use markdown format.
8. Include "Last updated: ${new Date().toISOString().split("T")[0]}" at top.
9. If data is insufficient for a section, write "Insufficient data" instead of guessing.

Respond ONLY with the updated markdown content. No code fences. No explanation.`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    )

    if (!res.ok) {
      const errText = await res.text()
      throw new Error("Gemini error: " + res.status + " " + errText.substring(0, 200))
    }

    const gemData = await res.json()
    const parts = gemData.candidates?.[0]?.content?.parts || []
    let updated = ""
    for (const p of parts) {
      if (p.text && !p.thought) updated += p.text
    }
    if (!updated) updated = parts.map((p: any) => p.text || "").join("")

    // Strip markdown fences if present
    updated = updated.replace(/```markdown\n?/g, "").replace(/```\n?/g, "").trim()

    // Size cap: 50KB
    if (updated.length > 50000) {
      updated = updated.substring(0, 50000) + "\n\n(truncated at 50KB limit)"
    }

    console.log("Updated knowledge: " + updated.length + " chars")

    // Upload back to storage (upsert)
    const blob = new Blob([updated], { type: "text/markdown" })
    const { error: upErr } = await supabase.storage
      .from("knowledge")
      .upload("knowledge-dynamic.md", blob, { upsert: true, contentType: "text/markdown" })

    if (upErr) throw new Error("Upload failed: " + upErr.message)

    return new Response(JSON.stringify({
      status: "ok",
      quotes_processed: (quotes || []).length,
      knowledge_size: updated.length,
      hot_dates: hotDates.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.log("knowledge-builder error:", (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})