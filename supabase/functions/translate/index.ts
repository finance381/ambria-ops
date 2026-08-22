import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Unofficial Google endpoint: fast and free, but it rate-limits by caller IP,
// and every deployment of this function shares one egress IP. When it starts
// refusing, MyMemory takes over so the UI still switches to Hindi.
const GT_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=en&tl=hi&q="
const MM_URL = "https://api.mymemory.translated.net/get?langpair=en|hi&q="

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function sleep(ms: number) {
  return new Promise(function (r) { setTimeout(r, ms) })
}

// Google translates the whole batch in one call: the strings go up joined by
// newlines and come back as segments that keep those newlines, so the joined
// translation splits back into the same number of lines. (Repeated &q= params
// do not work here — only the first one is translated.)
async function translateViaGoogle(texts: string[]): Promise<Record<string, string>> {
  const joined = texts.join("\n")
  let res = await fetch(GT_URL + encodeURIComponent(joined))
  if (!res.ok) {
    // one retry: the throttle is often a short burst limit
    await sleep(600)
    res = await fetch(GT_URL + encodeURIComponent(joined))
  }
  if (!res.ok) throw new Error("google " + res.status)

  const data = await res.json()
  let full = ""
  if (data && data[0]) {
    for (const part of data[0]) {
      if (part && part[0]) full += part[0]
    }
  }
  const parts = full.split("\n")
  // A mismatched line count means the segments did not line up with the input,
  // and mapping them by index would put the wrong Hindi on the wrong string.
  if (parts.length < texts.length) throw new Error("google misaligned")

  const out: Record<string, string> = {}
  for (let i = 0; i < texts.length; i++) {
    const t = (parts[i] || "").trim()
    if (t && t.toLowerCase() !== texts[i].toLowerCase()) out[texts[i]] = t
  }
  return out
}

// One request per string, so this is the slow path — kept to a small pool.
async function translateViaMyMemory(texts: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const POOL = 5
  let quotaGone = false

  for (let i = 0; i < texts.length; i += POOL) {
    if (quotaGone) break
    const slice = texts.slice(i, i + POOL)
    await Promise.all(slice.map(async function (text) {
      try {
        const res = await fetch(MM_URL + encodeURIComponent(text))
        if (!res.ok) return
        const data = await res.json()
        if (data && data.quotaFinished) { quotaGone = true; return }
        const t = (data && data.responseData && data.responseData.translatedText || "").trim()
        // MyMemory answers with its own warnings in the text field when it fails
        if (!t || /MYMEMORY|QUOTA|LIMIT|INVALID/i.test(t)) return
        if (t.toLowerCase() !== text.toLowerCase()) out[text] = t
      } catch (_e) { /* one string failing must not sink the batch */ }
    }))
  }
  return out
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (!req.headers.get("Authorization")) {
      return json({ error: "Unauthorized" }, 401)
    }

    const { texts } = await req.json()
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return json({ error: "texts array required" }, 400)
    }

    // Cap the batch, and strip embedded newlines so the join/split stays aligned
    const list = texts.slice(0, 50).map(function (t: string) {
      return String(t).replace(/[\r\n]+/g, " ").trim()
    }).filter(function (t: string) { return t.length > 0 })

    if (list.length === 0) return json({ results: {} })

    let results: Record<string, string> = {}
    let provider = "google"
    let note = ""

    try {
      results = await translateViaGoogle(list)
    } catch (gErr) {
      // Report which provider answered instead of returning a silent empty 200:
      // the old version swallowed Google's 429 and looked like "nothing to
      // translate", so the client had no way to tell failure from success.
      note = String(gErr && (gErr as Error).message || gErr)
      provider = "mymemory"
      results = await translateViaMyMemory(list)
    }

    const missing = list.filter(function (t) { return !results[t] })
    return json({
      results,
      provider,
      requested: list.length,
      translated: Object.keys(results).length,
      failed: missing.length,
      note,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
