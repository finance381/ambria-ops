import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ═══ Per-department config ═══
const DEPARTMENTS = [
  {
    name: "Venue",
    endpoint: "get_venue_contract_information_list",
    body: { loggeduserid: "", search_venue_contract: "", priority_search: "", venue_datetype: "", source_search: "", venue_search: "", balance_pending: "", contract_venue_search: "", contract_assginee_search: "", leadtype_search: "", report_fac: "", fromdate: "", uptodated: "" },
    h: "fisc_", d: "fiscd_",
    entryNo: "fisc_entryno",
    entryBy: "fisc_entryby",
    contactNo: "fisc_client_mobile",
    functionDate: "fiscd_function_date",
    funcCode: "fiscd_function_type",
    pax: "fiscd_pax_no",
    freePax: "fiscd_free_pax_no",
    extraPlate: "fiscd_extra_plate_charge",
  },
  {
    name: "Catering",
    endpoint: "get_catering_contract_information_list",
    body: { loggeduserid: "", search_catering_contract: "", priority_search: "", cater_datetype: "", source_search: "", balance_pending: "", contract_catering_search: "", contract_assginee_search: "", leadtype_search: "", report_fac: "", fromdate: "", uptodated: "" },
    h: "chc_", d: "chcd_",
    entryNo: "chc_entry_no",
    entryBy: "chc_cater_entryby",
    contactNo: "chc_contact_no",
    functionDate: "chcd_date",
    funcCode: "chcd_function",
    pax: "chcd_pax",
    freePax: "chcd_freepax",
    extraPlate: "chcd_extra_plate",
  },
  {
    name: "Decor",
    endpoint: "get_decor_contract_information_list",
    body: { loggeduserid: "", decor_search: "", source_search: "", lead_type_search: "", decor_venue_search: "", priority_search: "", fromdate: "", uptodated: "", decor_assginee_search: "", decor_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "dhc_", d: "dhcd_",
    entryNo: "dhc_entry_no",
    entryBy: "dhc_decor_entryby",
    contactNo: "dhc_contact_no",
    functionDate: "dhcd_date",
    funcCode: "dhcd_function",
    pax: null,
    freePax: null,
    extraPlate: null,
  },
  {
    name: "Entertainment",
    endpoint: "get_entertain_contract_information_list",
    body: { loggeduserid: "", fromdate: "", uptodated: "", search_entertain_contract: "", source_search: "", contract_venue_searche: "", balance_pending: "", contract_assginee_search: "", entertain_datetype: "", leadtype_search: "", report_fac: "" },
    h: "ehc_", d: "ehcd_",
    entryNo: "ehc_entry_no",
    entryBy: "ehc_entertain_entryby",
    contactNo: "ehc_contact_no",
    functionDate: "ehcd_date",
    funcCode: "ehcd_function",
    pax: null,
    freePax: null,
    extraPlate: null,
  },
]

const BASE_URL = "https://gyv.inqcrm.in/api/v1/processerp_api/"
const PAGE_SIZE = 10

const FUNC_NAMES: Record<string, string> = {
  "1": "RING CEREMONY", "2": "BIRTHDAY", "3": "WEDDING", "4": "RECEPTION",
  "5": "KUA POOJAN", "6": "ANNIVERSARY", "7": "LAGAN", "8": "SAGAN",
  "9": "COCKTAIL", "10": "RELIGIOUS", "11": "CORPORATE", "14": "HALDI",
  "15": "MEHENDI", "16": "ROKA CEREMONY", "17": "RESIDENTIAL WEDDING",
  "19": "KOTHI BOOKING", "20": "SANGEET", "21": "BABY SHOWER",
  "12": "PROPOSAL CEREMONY", "18": "DESTINATION WEDDING",
  "22": "ENGAGEMENT", "23": "TENDER", "24": "BARAT ASSEMBLY", "25": "HOUSE PARTY",
  "26": "LUNCH FUNCTION", "27": "BREAKFAST FUNCTION", "28": "DINNER FUNCTION", "29": "BREAKFAST", "30": "LUNCH",
  "31": "KITTY PARTY", "32": "RESTAURANT SALE", "33": "LOHRI",
  "34": "DIWALI PARTY", "35": "GET TOGETHER", "36": "MATA KI CHOWKI",
}

function normalizeVenue(venueName: string, department: string): string {
  const v = (venueName || "").toLowerCase().trim()
  if (v.indexOf("pushpanjali") !== -1) return "Ambria Pushpanjali"
  if (v.indexOf("manaktala") !== -1 || v.indexOf("emerald") !== -1) return "Ambria Manaktala"
  if (v.indexOf("exotica") !== -1) return "Ambria Exotica"
  if (v.indexOf("restro") !== -1) return "Ambria Restro"
  const dept = (department || "").toLowerCase().trim()
  if (dept.indexOf("catering") !== -1) return "Outdoor Catering"
  if (dept.indexOf("venue") !== -1) return "Outdoor Venue"
  if (dept.indexOf("entertainment") !== -1) return "Outdoor Entertainment"
  return "Outdoor Decor"
}

function safeInt(val: any): number {
  const n = Number(val)
  return isNaN(n) ? 0 : Math.round(n)
}

function safePaise(val: any): number {
  const n = Number(val)
  return isNaN(n) ? 0 : Math.round(n * 100)
}

const FETCH_TIMEOUT_MS = 10000

async function fetchRetry(url: string, opts: RequestInit, retries = 1): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    var controller = new AbortController()
    var timer = setTimeout(function() { controller.abort() }, FETCH_TIMEOUT_MS)
    try {
      var res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }))
      clearTimeout(timer)
      if (res.ok || attempt === retries) return res
      if (res.status < 500) return res
      await new Promise(function(r) { setTimeout(r, 1000 * (attempt + 1)) })
    } catch (err) {
      clearTimeout(timer)
      if (attempt === retries) throw err
      await new Promise(function(r) { setTimeout(r, 1000 * (attempt + 1)) })
    }
  }
  throw new Error("fetchRetry exhausted")
}

function mapRow(e: any, dep: typeof DEPARTMENTS[0], lmsUserMap: Record<string, string>): any {
  const h = dep.h  // header prefix
  const d = dep.d  // detail prefix

  const entryNo = (e[dep.entryNo] || "").trim()
  const headId = e.headid || e.id || ""
  const entryById = dep.entryBy && e[dep.entryBy] ? String(e[dep.entryBy]).trim() : ""
  const createdName = entryById ? (lmsUserMap[entryById] || null) : null

  return {
    // Dedup key: Dept_EntryNo_HeadId (unique per contract row)
    lms_event_id: dep.name + "_" + entryNo + "_" + headId,
    contract_no: entryNo || null,
    contract_date: e[h + "contract_date"] || null,
    department: dep.name,
    contract_type: e[dep.d + "lead_type"] || null,
    venue_name: normalizeVenue(e.venue1 || "", dep.name),
    location: e[dep.d + "venue2"] ? ((e[dep.d + "venue2"] || "") + " " + (e[dep.d + "address2"] || "")).trim() || null : null,
    contact_person: null,
    contact_number: e[dep.contactNo] || null,
    event_name: (e.functionname || FUNC_NAMES[String(e[dep.funcCode])] || "").trim(),
    client_name: e[h + "guest_name"] || null,
    session: e[d + "session"] || null,
    catering: e[d + "catering"] || e[d + "menu"] || null,
    total_plates: dep.pax ? safeInt(e[dep.pax] || 0) : 0,
    complementary_plates: dep.freePax ? safeInt(e[dep.freePax] || 0) : 0,
    extra_plates_charge: dep.extraPlate ? safePaise(e[dep.extraPlate] || 0) : 0,
    balance_received: safePaise(e[h + "advance_cash"] || 0) + safePaise(e[h + "advance_chq"] || 0),
    balance_bank: 0,
    balance_amount: safePaise(e[h + "balance"] || 0),
    agreed_cash_paise: safePaise(e[h + "cash_part"] || 0),
    agreed_bank_paise: safePaise(e[h + "cheque"] || 0),
    tax_amount_paise: safePaise(e[h + "tax_amt"] || 0),
    lms_advance_cash_paise: safePaise(e[h + "advance_cash"] || 0),
    lms_advance_bank_paise: safePaise(e[h + "advance_chq"] || 0),
    created_user_name: createdName,
    created_by_lms_id: entryById ? safeInt(entryById) : null,
    synced_at: new Date().toISOString(),
    // New fields
    ppt_link: e.pptLink || null,
    pdf_link: e.pdfLink || null,
    secondary_contact: e[h + "secondary_mobileno"] || null,
    enquiry_mode: e[h + "enq_mode"] || null,
    priority: e[h + "priority"] || null,
    address: e[h + "address"] || null,
    function_date: e[dep.functionDate] || null,
    total_amount_paise: safePaise(e[h + "total_amt"] || 0),
    net_amount_paise: safePaise(e[h + "net_amt"] || 0),
    lms_head_id: safeInt(e.headid || e.id || 0) || null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Cron bypass — allow scheduled invocations via secret header (skips user auth)
    const cronSecret = req.headers.get("x-cron-secret")
    const cronExpected = Deno.env.get("SYNC_CRON_SECRET")
    const isCron = !!(cronSecret && cronExpected && cronSecret === cronExpected)

    // Auth check — only admin/auditor can trigger
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Skip user role check for cron
    if (!isCron) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } }
      })
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      if (!profile || (profile.role !== "admin" && profile.role !== "auditor")) {
        return new Response(JSON.stringify({ error: "Admin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }
    }

    const lmsUserId = Deno.env.get("LMS_USER_ID") || "1"
    let totalSynced = 0
    let totalFetched = 0
    const errors: string[] = []

    // Build LMS user id → profile name map (once per sync run)
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("lms_user_id, name")
      .not("lms_user_id", "is", null)
    const lmsUserMap: Record<string, string> = {}
    ;(profileRows || []).forEach(function (p: any) {
      if (p.lms_user_id) lmsUserMap[String(p.lms_user_id)] = p.name
    })

    // Parallel sync all departments
    var syncStartedAt = new Date().toISOString()

    async function syncDept(dep: typeof DEPARTMENTS[0]) {
      var result = { synced: 0, fetched: 0, stale: 0, errors: [] as string[] }
      var allRows: any[] = []
      var page = 1

      while (true) {
        var reqBody = Object.assign({}, dep.body, { loggeduserid: lmsUserId, page_limit: String(page) })
        var lmsRes = await fetchRetry(BASE_URL + dep.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        })

        if (!lmsRes.ok) {
          result.errors.push(dep.name + ": HTTP " + lmsRes.status)
          break
        }

        var lmsData: any
        try {
          lmsData = await lmsRes.json()
        } catch (_) {
          result.errors.push(dep.name + ": invalid JSON page " + page)
          break
        }

        var contracts = lmsData.Contractinfo || []
        if (contracts.length === 0) break

        for (var ci = 0; ci < contracts.length; ci++) {
          var c = contracts[ci]
          var cancelRemarks = (c[dep.h + "cancel_remarks"] || "").trim()
          if (cancelRemarks) continue
          allRows.push(mapRow(c, dep, lmsUserMap))
        }

        if (contracts.length < PAGE_SIZE) break
        page++
      }

      // Deduplicate — prefer row with function_date
      var seen = new Map()
      for (var ri = 0; ri < allRows.length; ri++) {
        var row = allRows[ri]
        var existing = seen.get(row.lms_event_id)
        if (!existing || (!existing.function_date && row.function_date)) {
          seen.set(row.lms_event_id, row)
        }
      }
      var uniqueRows = Array.from(seen.values())
      result.fetched = uniqueRows.length

      console.log(dep.name + ": " + allRows.length + " raw, " + uniqueRows.length + " unique (" + page + " pages)")

      // Batch upsert
      for (var i = 0; i < uniqueRows.length; i += 200) {
        var chunk = uniqueRows.slice(i, i + 200)
        var { error, count } = await supabase
          .from("events")
          .upsert(chunk, { onConflict: "lms_event_id", count: "exact" })

        if (error) {
          console.log("Upsert error " + dep.name + " chunk " + i + ":", error.message)
          result.errors.push(dep.name + ": upsert - " + error.message)
        } else {
          result.synced += count || chunk.length
        }
      }

      // Stale detection — rows not touched by this sync
      var { count: staleCount } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .like("lms_event_id", dep.name + "_%")
        .lt("synced_at", syncStartedAt)

      result.stale = staleCount || 0
      if (result.stale > 0) {
        console.log(dep.name + ": " + result.stale + " stale rows (possibly cancelled in LMS)")
      }

      return result
    }

    var deptResults = await Promise.allSettled(DEPARTMENTS.map(function(dep) { return syncDept(dep) }))

    for (var di = 0; di < deptResults.length; di++) {
      var r = deptResults[di]
      if (r.status === "fulfilled") {
        totalSynced += r.value.synced
        totalFetched += r.value.fetched
        errors.push.apply(errors, r.value.errors)
      } else {
        errors.push(DEPARTMENTS[di].name + ": " + r.reason)
      }
    }

    var staleTotal = deptResults.reduce(function(sum, r) { return sum + (r.status === "fulfilled" ? r.value.stale : 0) }, 0)
    console.log("Synced " + totalSynced + " of " + totalFetched + ", stale: " + staleTotal)
    return new Response(JSON.stringify({
      synced: totalSynced,
      total: totalFetched,
      stale: staleTotal || undefined,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.log("Function error:", (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})