import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authToken = (req.headers.get("authorization") || "").replace("Bearer ", "")
    if (authToken !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

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
      .select("venue_idx, venue_name, event_date, date_category, slot, pax, food_pref, is_wedding, menu_idx, menu_label, per_head_rate, decor_idx, dj_idx, ttd_idx, total_q_paise, total_t_paise, total_f_paise, deal_value_paise, status, created_at")
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

    // ── LMS Lead Intelligence (venue leads, last 60 days) ──
    let leadSummary = "Unavailable"
    try {
      const lmsBase = Deno.env.get("LMS_API_BASE") || "https://gyv.inqcrm.in"
      const lmsUser = Deno.env.get("LMS_API_USER") || "1"
      const ld30 = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0]
      const ldRes = await fetch(lmsBase + "/api/v1/processerp_api/get_venue_information_list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loggeduserid: lmsUser,
          fromdate: ld30,
          uptodated: today,
          search_date_type: "entry",
          page_limit: "500",
        }),
      })
      if (ldRes.ok) {
        const ldData = await ldRes.json()
        const leads = ldData.leadinfo || []
        console.log("LMS leads fetched: " + leads.length)

        if (leads.length > 0) {
          // Aggregate — zero PII leaves this function
          const byStatus: Record<string, number> = {}
          const byMode: Record<string, number> = {}
          const byPriority: Record<string, number> = {}
          const byVenue: Record<string, number> = {}
          const dealValues: number[] = []
          const paxValues: number[] = []
          const sessionCount: Record<string, number> = {}
          let visited = 0, totalWithDate = 0
          const lmsDemand: Record<string, number> = {}

          for (const l of leads) {
            const st = (l.fis_status || "unknown").toLowerCase()
            byStatus[st] = (byStatus[st] || 0) + 1
            const mode = l.fis_enq_mode || "unknown"
            byMode[mode] = (byMode[mode] || 0) + 1
            const pri = l.fis_priority || "unknown"
            byPriority[pri] = (byPriority[pri] || 0) + 1
            const ven = l.venuename || "unknown"
            byVenue[ven] = (byVenue[ven] || 0) + 1
            if (l.fis_total_amt > 0) dealValues.push(l.fis_total_amt)
            if (l.fisd_pax_no > 0) paxValues.push(l.fisd_pax_no)
            const sess = l.fisd_session || ""
            if (sess) sessionCount[sess] = (sessionCount[sess] || 0) + 1
            if (l.fis_visit_status === "Y") visited++
            if (l.fisd_function_date) {
              totalWithDate++
              const fd = l.fisd_function_date.substring(0, 10)
              if (fd >= today) lmsDemand[fd] = (lmsDemand[fd] || 0) + 1
            }
          }

          const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
          const med = (arr: number[]) => {
            if (!arr.length) return 0
            const s = arr.slice().sort((a, b) => a - b)
            const m = Math.floor(s.length / 2)
            return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
          }

          const lmsHotDates = Object.entries(lmsDemand)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([d, c]) => d + ":" + c)
            .join(", ")

          leadSummary = `Total: ${leads.length} leads (last 60d)
Status: ${JSON.stringify(byStatus)}
Inquiry mode: ${JSON.stringify(byMode)}
Priority: ${JSON.stringify(byPriority)}
By venue: ${JSON.stringify(byVenue)}
Deal values (where >0): avg ₹${avg(dealValues)}, median ₹${med(dealValues)}, count ${dealValues.length}
Pax (where >0): avg ${avg(paxValues)}, median ${med(paxValues)}, range ${Math.min(...paxValues) || 0}-${Math.max(...paxValues) || 0}
Sessions: ${JSON.stringify(sessionCount)}
Visit rate: ${visited}/${leads.length} (${leads.length ? Math.round(visited / leads.length * 100) : 0}%)
Leads with function date: ${totalWithDate}
LMS hot dates (future): ${lmsHotDates || "none"}`
        }
      } else {
        console.log("LMS API returned " + ldRes.status)
      }
    } catch (lmsErr) {
      console.log("LMS lead fetch skipped: " + (lmsErr as Error).message)
    }

    const prompt = `You maintain a business knowledge base for Ambria, a wedding/banquet venue company.

PREVIOUS DYNAMIC PATTERNS:
${currentDynamic || "(none yet)"}

NEW QUOTE DATA (last 30 days, ${(quotes || []).length} quotes, PII already stripped):
${JSON.stringify(quotes || [], null, 1)}

DEMAND SNAPSHOT (next 60 days, from QuoteCalc):
Hot dates: ${hotDates.join(", ") || "none"}
Per-venue demand: ${JSON.stringify(venueDemand)}

LMS LEAD PIPELINE (from CRM, PII stripped, pre-aggregated):
${leadSummary}

TASK:
Generate a fresh dynamic patterns file from the quote data. Rules:
1. ONLY output data-backed patterns. Never invent or extrapolate beyond the data.
2. Every number must trace back to the quote data above. If unsure, omit.
3. Sections to include:
   - DEMAND FORECAST: hot dates, per-venue demand for next 60 days
   - RECENT QUOTE PATTERNS: avg quote values by venue, popular menus, common pax ranges, conversion rates (status=accepted vs total)
   - PRICING INTELLIGENCE: deal values closing at vs quoted, TTD discount usage
   - LMS PIPELINE: lead volume trends, inquiry source conversion, priority distribution, visit-to-deal conversion, pax/session patterns. Compare LMS deal values to QuoteCalc quoted values where overlap exists.
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