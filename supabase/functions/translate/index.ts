import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const GT_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=en&tl=hi&q="

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { texts } = await req.json()

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(JSON.stringify({ error: "texts array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Cap at 50 strings per request
    const toTranslate = texts.slice(0, 50)

    // Join with newlines — Google Translate preserves them
    const joined = toTranslate.join("\n")

    const res = await fetch(GT_URL + encodeURIComponent(joined))
    const data = await res.json()

    // Extract translated text from Google's response format
    // Response: [[["translated","original",null,null,null],...]]
    let fullTranslated = ""
    if (data && data[0]) {
      for (const part of data[0]) {
        if (part && part[0]) fullTranslated += part[0]
      }
    }

    const parts = fullTranslated.split("\n")
    const results: Record<string, string> = {}

    for (let i = 0; i < toTranslate.length; i++) {
      const translated = (parts[i] || "").trim()
      if (translated && translated.toLowerCase() !== toTranslate[i].toLowerCase()) {
        results[toTranslate[i]] = translated
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
