import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { quote } = await req.json()
    if (!quote) throw new Error("Missing quote data")
    console.log("Demand data:", JSON.stringify(quote.demand || "MISSING"))

    const geminiKey = Deno.env.get("GEMINI_API_KEY")
    if (!geminiKey) throw new Error("GEMINI_API_KEY not set")

    // Fetch knowledge from storage
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )
    let base = "", dynamic = ""
    try {
      const { data: b } = await supabase.storage.from("knowledge").download("knowledge-base.md")
      if (b) base = await b.text()
    } catch { console.log("No knowledge-base.md") }
    try {
      const { data: d } = await supabase.storage.from("knowledge").download("knowledge-dynamic.md")
      if (d) dynamic = await d.text()
    } catch { console.log("No knowledge-dynamic.md") }

    const prompt = `You are a senior sales strategist for Ambria, a wedding/banquet venue company. Analyze this quote for the sales team.

RULES:
- CRITICAL: avg_deal/avg partial payment in knowledge = advances collected, roughly 30-50% of total contract. A ₹30L quote having ₹1.5L avg partial payment is NORMAL. Never flag this as a discrepancy.
- Per-head rate (₹/plate) and pax count are unrelated metrics. Never compare them.
- Per-head rate (₹/plate) and avg deal value (₹L) are unrelated metrics. Never compare them. Per-head is price per person. Avg deal is total partial payment.
- Every point must be under 15 words. No filler.
- Give specific numbers, venue names, rupee amounts. No generic advice.
- Suggestions must be actions the salesperson can do TODAY.
- Reference seasonal demand, event type mix, and venue-specific patterns from knowledge.
- Compare Q/T/F tiers: if package is between Target and Floor, flag margin risk.
- If no package value set, say so — it means negotiation hasn't started.

${base ? "BASE KNOWLEDGE (authoritative, always trust):\n" + base + "\n\n" : ""}${dynamic ? "DYNAMIC PATTERNS (AI-generated, use as supplementary):\n" + dynamic + "\n\n" : ""}QUOTE DATA:
${JSON.stringify(quote, null, 2)}

FIELD GUIDE:
- total.q / total.t / total.f = Quote / Target / Floor in ₹L (Quote=asking, Target=ideal, Floor=minimum acceptable)
- rental/vm/decor/dj = component breakdowns in ₹L with q/t/f each
- per_head = per-plate rate in ₹
- package_value = negotiated deal in ₹L (null = not yet negotiated)
- ttd = time-to-date discount applied to rental
- demand.same_date = total quotes across all venues for this exact date
- demand.same_date_same_venue = quotes for same date AND same venue
- demand.same_week = quotes within 7-day window
- notes = sales rep remarks, special requests, negotiation context (may be null)

DEMAND RULES:
- 5+ same-date quotes = HIGH demand. Hold Quote price, no discounts. Mention scarcity.
- 2-4 same-date quotes = MEDIUM. Standard negotiation, Target is acceptable.
- 0-1 same-date quotes = LOW. Consider TTD discount or flexible pricing to fill the date.
- 3+ same-venue-same-date = venue nearly contested. Create urgency — "other clients are quoting same date".
- Always mention demand numbers in summary or risks.

Respond ONLY with this JSON, no markdown, no explanation:
{
  "summary": "1-line, max 20 words",
  "strengths": ["max 4 points, each under 15 words"],
  "risks": ["max 3 points, each under 15 words"],
  "suggestions": ["max 3 actionable items, each under 20 words"],
  "closing_tip": "1 specific negotiation tactic under 20 words"
}`

    // Retry with backoff
    let res: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      )
      if (res.status !== 429) break
      console.log("Rate limited, retry " + (attempt + 1))
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000))
    }

    if (!res || !res.ok) {
      const errText = await res?.text() || "no response"
      console.log("Gemini error:", res?.status, errText)
      throw new Error("Gemini API error: " + (res?.status || "unknown"))
    }

    if (!res.ok) {
      const errText = await res.text()
      console.log("Gemini error:", res.status, errText)
      throw new Error("Gemini API error: " + res.status)
    }

    const gemData = await res.json()
    console.log("Gemini raw:", JSON.stringify(gemData).substring(0, 2000))
    
    const parts = gemData.candidates?.[0]?.content?.parts || []
    let raw = ""
    for (const p of parts) {
      if (p.text && !p.thought) raw += p.text
    }
    if (!raw) raw = parts.map((p: any) => p.text || "").join("")
    
    console.log("Extracted text:", raw.substring(0, 500))
    
    const stripped = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "")
    let jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      // Try fixing truncated JSON
      const partial = stripped.match(/\{[\s\S]*/)
      if (partial) {
        let fix = partial[0]
        const openBraces = (fix.match(/\{/g) || []).length
        const closeBraces = (fix.match(/\}/g) || []).length
        const openBrackets = (fix.match(/\[/g) || []).length
        const closeBrackets = (fix.match(/\]/g) || []).length
        fix += '"]'.repeat(Math.max(0, openBrackets - closeBrackets))
        fix += '}'.repeat(Math.max(0, openBraces - closeBraces))
        jsonMatch = [fix]
      } else {
        throw new Error("No JSON found. Raw: " + raw.substring(0, 200))
      }
    }
    const analysis = JSON.parse(jsonMatch[0])

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.log("quote-assist error:", (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})