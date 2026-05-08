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
    body: { loggeduserid: "", entertain_search: "", source_search: "", lead_type_search: "", entertain_venue_search: "", priority_search: "", fromdate: "", uptodated: "", entertain_assginee_search: "", entertain_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    h: "dhc_", d: "dhcd_",
    entryNo: "dhc_entry_no",
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
const MAX_PAGES = Infinity // no cap — loop stops when API returns empty

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

function mapRow(e: any, dep: typeof DEPARTMENTS[0]): any {
  const h = dep.h  // header prefix
  const d = dep.d  // detail prefix

  const entryNo = (e[dep.entryNo] || "").trim()
  const funcCode = e[dep.funcCode] || e.headid || e.id || ""

  return {
    // Dedup key: Dept_EntryNo_FunctionCode (matches old pattern)
    lms_event_id: dep.name + "_" + entryNo + "_" + funcCode,
    contract_no: entryNo || null,
    contract_date: e[h + "contract_date"] || null,
    department: dep.name,
    contract_type: e.functionname || null,
    venue_name: normalizeVenue(e.venue1 || "", dep.name),
    location: e[h + "location"] || null,
    contact_person: null,
    contact_number: e[dep.contactNo] || null,
    event_name: (e.functionname || "").trim(),
    client_name: e[h + "guest_name"] || null,
    session: e[d + "session"] || null,
    catering: e[d + "catering"] || e[d + "menu"] || null,
    total_plates: dep.pax ? safeInt(e[dep.pax] || 0) : 0,
    complementary_plates: dep.freePax ? safeInt(e[dep.freePax] || 0) : 0,
    extra_plates_charge: dep.extraPlate ? safePaise(e[dep.extraPlate] || 0) : 0,
    balance_received: safePaise(e[h + "advance_cash"] || 0) + safePaise(e[h + "advance_chq"] || 0),
    balance_bank: 0,
    balance_amount: safePaise(e[h + "balance"] || 0),
    created_user_name: e.username || null,
    synced_at: new Date().toISOString(),
    // New fields
    ppt_link: e.pptLink || null,
    pdf_link: e.pdfLink || null,
    secondary_contact: e[h + "secondary_contact"] || null,
    bride_name: e[h + "bride_name"] || null,
    groom_name: e[h + "groom_name"] || null,
    enquiry_mode: e[h + "enquiry_mode"] || null,
    priority: e[h + "priority"] || null,
    address: e[h + "address"] || null,
    function_date: e[dep.functionDate] || null,
    total_amount_paise: safePaise(e[h + "total_amt"] || 0),
    net_amount_paise: safePaise(e[h + "net_amt"] || 0),
    advance_paise: safePaise(e[h + "advance_cash"] || 0) + safePaise(e[h + "advance_chq"] || 0),
    lms_head_id: safeInt(e.headid || e.id || 0) || null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
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

    // Verify caller role
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

    const lmsUserId = Deno.env.get("LMS_USER_ID") || "1"
    let totalSynced = 0
    let totalFetched = 0
    const errors: string[] = []

    for (const dep of DEPARTMENTS) {
      try {
        const allRows: any[] = []
        let page = 1

        // Paginate until empty
        while (page <= MAX_PAGES) {
          const reqBody = { ...dep.body, loggeduserid: lmsUserId, page_limit: String(page) }
          const lmsRes = await fetch(BASE_URL + dep.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          })

          if (!lmsRes.ok) {
            errors.push(dep.name + ": HTTP " + lmsRes.status)
            break
          }

          const lmsData = await lmsRes.json()
          const contracts = lmsData.Contractinfo || []

          if (contracts.length === 0) break

          for (const c of contracts) {
            const row = mapRow(c, dep)
            if (!row.function_date && dep.name === "Venue") {
              console.log("VNULL " + row.contract_no + " raw=" + String(c[dep.functionDate]) + " type=" + String(c["fiscd_function_type"]) + " head=" + String(c.headid))
            }
            allRows.push(row)
          }

          // If less than PAGE_SIZE, we've reached the end
          if (contracts.length < PAGE_SIZE) break
          page++
        }

        // Deduplicate by lms_event_id — prefer row with function_date
        const seen = new Map()
        for (const row of allRows) {
          const existing = seen.get(row.lms_event_id)
          if (!existing || (!existing.function_date && row.function_date)) {
            seen.set(row.lms_event_id, row)
          }
        }
        const uniqueRows = Array.from(seen.values())

        console.log(dep.name + ": " + allRows.length + " fetched, " + uniqueRows.length + " unique (" + page + " pages)")
        totalFetched += uniqueRows.length

        // Batch upsert in chunks of 200
        for (let i = 0; i < uniqueRows.length; i += 200) {
          const chunk = uniqueRows.slice(i, i + 200)
          const { error, count } = await supabase
            .from("events")
            .upsert(chunk, { onConflict: "lms_event_id", count: "exact" })

          if (error) {
            console.log("Upsert error " + dep.name + " chunk " + i + ":", error.message)
            errors.push(dep.name + ": upsert - " + error.message)
          } else {
            totalSynced += count || chunk.length
          }
        }
      } catch (depErr) {
        console.log("Error " + dep.name + ":", (depErr as Error).message)
        errors.push(dep.name + ": " + (depErr as Error).message)
      }
    }

    console.log("Synced " + totalSynced + " of " + totalFetched)
    return new Response(JSON.stringify({
      synced: totalSynced,
      total: totalFetched,
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