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
    // LMS already computes these per Venue contract — see migration 00094.
    // Only present under this department's own fiscd_ fields, nowhere else.
    menuRate: "fiscd_menu_rate",
    venueValue: "fiscd_venue_value",
    decorLumpsum: "fiscd_decoration_lumpsum",
    entertainLumpsum: "fiscd_entertainment_lumpsum",
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
    menuRate: null, venueValue: null, decorLumpsum: null, entertainLumpsum: null,
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
    menuRate: null, venueValue: null, decorLumpsum: null, entertainLumpsum: null,
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
    menuRate: null, venueValue: null, decorLumpsum: null, entertainLumpsum: null,
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

// LMS's Venue-contract API (get_venue_contract_information_list) has no
// usable sub-venue name field — confirmed directly against a live pull of
// every page: fiscd_venue2/fiscd_address2 (what every other department uses
// for this) don't exist on this endpoint at all, and fiscd_location_name is
// always blank. All it gives is a bare numeric fiscd_location_id. This is
// the same id -> name mapping already hand-maintained in our own
// quote_config ("lms_locations", edited via the Quote Calculator's own
// Location/Hall picker — see lms-push/index.ts's fisd_location_id, which
// writes these exact ids back into LMS the other direction), copied here
// so sync-events can resolve a name without a round trip to that table.
// Flat by design: every id below is unique across all four venues.
const VENUE_LOCATION_NAMES: Record<string, string> = {
  "21": "Amber Lawn + Glass House", "22": "Amber Lawn", "23": "Glass House",
  "24": "Carnelian Deck", "25": "Villa",
  "26": "Emerald Lawn", "27": "Emerald Lawn + Glass House",
  "28": "Emerald + Glass House + Alstonia", "29": "Alstonia Lawn",
  "30": "Glass House", "31": "Banana Tree Lawn", "32": "Villa",
  "41": "Banana Tree Lawn + Glasshouse + Emerald Lawn",
  "47": "Alstonia + Banana Tree Lawn", "53": "Emerald Lawn + Banana Tree Lawn",
  "36": "Aura Lawn + Pandal", "37": "Aura Lawn", "38": "Aura Pandal",
  "39": "Valencia Glass House", "40": "Villa", "46": "Valencia Glass House + Lawn",
  "51": "Valencia Swimming Pool + Lawn", "52": "Full Venue",
  "42": "Restaurant Cafe", "43": "Restro Lawn", "44": "Glass House",
  "45": "Restro Rooftop", "48": "Restro Lawn + Restro Glass House",
  "49": "Glass House Front Area", "50": "Glass House Back Area",
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

// LMS records package/pricing figures (total/net package value, and the
// Venue contract's menu rate / venue rental / decor / entertainment split)
// at half their real value — the same halving lms-push deliberately applies
// when it writes a deal INTO LMS (paiseToHalfRupees there: "stores half the
// real figure"). Applies across every department, not just Venue. Payment-
// tracking fields (balance, advance, tax, cash/cheque split) are real money
// actually received and are NOT halved — safePaise as-is for those.
function safePackagePaise(val: any): number {
  return safePaise(val) * 2
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
  // Third attempt at this key — the first two each fixed one failure mode
  // and opened another:
  //  1. headid (the CONTRACT's id, shared by every function under it) --
  //     collapsed a multi-function contract down to its last-seen function,
  //     because every sibling function landed on the identical key.
  //  2. e.id (LMS's own per-function-detail-row id) -- fixed #1, but it
  //     turns out LMS regenerates this id on a plain resave of a contract
  //     that didn't actually change (confirmed live: same contract, same
  //     function_date/session, old id cancelled and a brand new id synced
  //     two days later). Every resave orphaned that row's manually-entered
  //     data (tally_entered_by, manual_plate_rate_paise, ...) onto a now-
  //     cancelled row instead of updating it in place -- reported as
  //     previously-"entered" contracts reverting to "not entered".
  // function type + function date + session is stable across a resave (none
  // of the three change just because LMS re-persisted the row) while still
  // telling apart real siblings -- confirmed on 3 live multi-function
  // contracts, every sibling differed in at least one of these three.
  // Falls back to the old id/headid chain only when a row has no function
  // date at all to key on (no better signal exists for that case).
  const funcDate = (e[dep.functionDate] || "").trim()
  const funcSignature = funcDate
    ? (e[dep.funcCode] || "").trim() + "-" + funcDate + "-" + (e[d + "session"] || "").trim()
    : ""
  const detailId = funcSignature || e.id || e.headid || ""
  const entryById = dep.entryBy && e[dep.entryBy] ? String(e[dep.entryBy]).trim() : ""
  const createdName = entryById ? (lmsUserMap[entryById] || null) : null

  // Venue contracts carry no venue2/address2 at all (see VENUE_LOCATION_NAMES'
  // comment) — only a bare fiscd_location_id, resolved against that map.
  // Every other department keeps the existing venue2+address2 text, which
  // genuinely is populated for them (confirmed live for Catering).
  const location = dep.name === "Venue"
    ? (VENUE_LOCATION_NAMES[String(e.fiscd_location_id || "").trim()] || null)
    : (e[dep.d + "venue2"] ? ((e[dep.d + "venue2"] || "") + " " + (e[dep.d + "address2"] || "")).trim() || null : null)

  return {
    // Dedup key: Dept_EntryNo_DetailId (unique per function within a contract)
    lms_event_id: dep.name + "_" + entryNo + "_" + detailId,
    contract_no: entryNo || null,
    contract_date: e[h + "contract_date"] || null,
    department: dep.name,
    contract_type: e[dep.d + "lead_type"] || null,
    venue_name: normalizeVenue(e.venue1 || "", dep.name),
    location: location,
    contact_person: null,
    contact_number: e[dep.contactNo] || null,
    event_name: (e.functionname || FUNC_NAMES[String(e[dep.funcCode])] || "").trim(),
    client_name: e[h + "guest_name"] || null,
    session: e[d + "session"] || null,
    catering: e[d + "catering"] || e[d + "menu"] || null,
    // total_plates is the free quota (Extra Plate Collect charges only past
    // it) — confirmed the paying pax and free pax are additive on the
    // contract (150 pax + 10 free = 160 covered), not 10 carved out of 150.
    total_plates: dep.pax ? safeInt(e[dep.pax] || 0) + (dep.freePax ? safeInt(e[dep.freePax] || 0) : 0) : 0,
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
    total_amount_paise: safePackagePaise(e[h + "total_amt"] || 0),
    net_amount_paise: safePackagePaise(e[h + "net_amt"] || 0),
    // LMS-computed, Venue contracts only (see migration 00094) — null for
    // every other department, same convention as pax/freePax/extraPlate above.
    menu_rate_paise: dep.menuRate ? safePackagePaise(e[dep.menuRate] || 0) : null,
    venue_rental_paise: dep.venueValue ? safePackagePaise(e[dep.venueValue] || 0) : null,
    decor_amount_paise: dep.decorLumpsum ? safePackagePaise(e[dep.decorLumpsum] || 0) : null,
    entertainment_amount_paise: dep.entertainLumpsum ? safePackagePaise(e[dep.entertainLumpsum] || 0) : null,
    lms_head_id: safeInt(e.headid || e.id || 0) || null,
    // Any row LMS actively returns (uncancelled) this run is, by definition,
    // not cancelled -- clears a flag a previous run may have set if LMS
    // un-cancelled it since.
    lms_cancelled_at: null,
  }
}

// Notifies admin-configured subscribers (lms_sync_notification_subscribers)
// that new contracts were just synced in. Mirrors wa-webhook/index.ts's
// notifyInboxSubscribers: insert a reliable notifications row per
// subscriber, then a best-effort server-to-server call to send-push on top.
// One notification per sync run (not per contract) — a quiet period
// followed by a backlog of genuinely new contracts shouldn't flood anyone.
async function notifyNewContractsSynced(supa: any, SUPABASE_URL: string, SERVICE_ROLE: string, newRows: any[]) {
  var subsRes = await supa.from("lms_sync_notification_subscribers").select("user_id")
  var userIds = (subsRes.data || []).map(function (r: any) { return r.user_id })
  if (userIds.length === 0) return

  var byDept: Record<string, number> = {}
  newRows.forEach(function (r: any) { byDept[r.department] = (byDept[r.department] || 0) + 1 })
  var deptSummary = Object.keys(byDept).map(function (d) { return byDept[d] + " " + d }).join(", ")

  var title = newRows.length === 1 ? "New contract synced" : newRows.length + " new contracts synced"
  var body = newRows.length === 1
    ? (newRows[0].event_name || newRows[0].client_name || newRows[0].contract_no || "A new contract") + " (" + newRows[0].department + ")"
    : deptSummary
  // A single new contract has one obvious place to send the click — straight
  // to that row in the Contracts list, not just the tab in general. A batch
  // of several has no single target, so it still lands on the tab at large.
  var link = (newRows.length === 1 && newRows[0].id) ? ("contracts:" + newRows[0].id) : "events"

  for (var i = 0; i < userIds.length; i++) {
    var uid = userIds[i]
    var insRes = await supa.from("notifications").insert({
      user_id: uid, type: "lms_sync", title: title, body: body, link: link,
    })
    if (insRes.error) { console.log("sync-events: notification insert failed: " + insRes.error.message); continue }
    try {
      await fetch(SUPABASE_URL + "/functions/v1/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SERVICE_ROLE },
        body: JSON.stringify({ user_id: uid, title: title, body: body, link: link }),
      })
    } catch (pushErr) {
      console.log("sync-events: send-push call failed")
    }
  }
}

// Logs every stale-sweep cancellation to lms_sync_anomalies (durable history
// of this specific known LMS-side gap — see the big comment above the sweep
// itself) and notifies the same subscriber list as new-contract syncs, so an
// admin finds out within minutes instead of someone noticing by accident
// days later (as happened with contract #00773 -- cancelled, then missed by
// every sync for 6 days before anyone looked at it). A contract that's
// genuinely cancelled in LMS shows up here too; the admin screen is where
// that gets told apart from an actual LMS listing gap and dismissed.
async function notifyStaleAnomalies(supa: any, SUPABASE_URL: string, SERVICE_ROLE: string, staleRows: any[]) {
  var insRes = await supa.from("lms_sync_anomalies").insert(staleRows.map(function (r: any) {
    return {
      event_id: r.id, lms_event_id: r.lms_event_id, contract_no: r.contract_no,
      department: r.department, client_name: r.client_name, venue_name: r.venue_name,
      function_date: r.function_date,
    }
  }))
  if (insRes.error) { console.log("sync-events: lms_sync_anomalies insert failed: " + insRes.error.message); return }

  var subsRes = await supa.from("lms_sync_notification_subscribers").select("user_id")
  var userIds = (subsRes.data || []).map(function (r: any) { return r.user_id })
  if (userIds.length === 0) return

  var title = staleRows.length === 1 ? "A contract dropped out of LMS sync" : staleRows.length + " contracts dropped out of LMS sync"
  var body = staleRows.length === 1
    ? (staleRows[0].client_name || staleRows[0].contract_no || "A contract") + " (" + staleRows[0].department + ") — check Events → Sync Issues"
    : "Check Events → Sync Issues to review them"
  var link = "events:sync_issues"

  for (var i = 0; i < userIds.length; i++) {
    var uid = userIds[i]
    var insNotif = await supa.from("notifications").insert({
      user_id: uid, type: "lms_sync_anomaly", title: title, body: body, link: link,
    })
    if (insNotif.error) { console.log("sync-events: anomaly notification insert failed: " + insNotif.error.message); continue }
    try {
      await fetch(SUPABASE_URL + "/functions/v1/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SERVICE_ROLE },
        body: JSON.stringify({ user_id: uid, title: title, body: body, link: link }),
      })
    } catch (pushErr) {
      console.log("sync-events: anomaly send-push call failed")
    }
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
      var result = { synced: 0, fetched: 0, stale: 0, errors: [] as string[], newRows: [] as any[], staleAnomalies: [] as any[] }
      var allRows: any[] = []
      // LMS's own positive cancellation signal -- rows carrying a non-empty
      // cancel_remarks are a real "this was cancelled in LMS" fact, unlike
      // a row merely being absent from the list (which LMS's own listing
      // bug can also cause -- see the stale-candidate block below).
      var explicitlyCancelledIds: string[] = []
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
          if (cancelRemarks) { explicitlyCancelledIds.push(mapRow(c, dep, lmsUserMap).lms_event_id); continue }
          allRows.push(mapRow(c, dep, lmsUserMap))
        }

        if (contracts.length < PAGE_SIZE) break
        page++
      }

      if (explicitlyCancelledIds.length > 0) {
        var { data: justCancelled } = await supabase
          .from("events")
          .update({ lms_cancelled_at: new Date().toISOString() })
          .in("lms_event_id", explicitlyCancelledIds)
          .is("lms_cancelled_at", null)
          .select("id")
        if (justCancelled && justCancelled.length > 0) {
          console.log(dep.name + ": " + justCancelled.length + " rows cancelled in LMS (cancel_remarks)")
        }
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

      // Batch upsert — a pre-upsert existence check per chunk is what lets us
      // tell a genuinely new contract apart from an update to one we already
      // have (upsert's own response only reports a combined affected count).
      for (var i = 0; i < uniqueRows.length; i += 200) {
        var chunk = uniqueRows.slice(i, i + 200)
        var chunkIds = chunk.map(function (r: any) { return r.lms_event_id })

        var { data: existingRows } = await supabase
          .from("events")
          .select("lms_event_id")
          .in("lms_event_id", chunkIds)
        var existingSet = new Set((existingRows || []).map(function (r: any) { return r.lms_event_id }))

        var { data: upsertedRows, error, count } = await supabase
          .from("events")
          .upsert(chunk, { onConflict: "lms_event_id", count: "exact" })
          .select("id, lms_event_id")

        if (error) {
          console.log("Upsert error " + dep.name + " chunk " + i + ":", error.message)
          result.errors.push(dep.name + ": upsert - " + error.message)
        } else {
          result.synced += count || chunk.length
          // The upsert payload itself has no `id` (assigned by Postgres) — pull
          // it back off the upsert's own response so a single-new-contract
          // notification can deep-link straight to that row.
          var idByLms: Record<string, number> = {}
          ;(upsertedRows || []).forEach(function (r: any) { idByLms[r.lms_event_id] = r.id })
          for (var ci2 = 0; ci2 < chunk.length; ci2++) {
            if (!existingSet.has(chunk[ci2].lms_event_id)) {
              result.newRows.push(Object.assign({}, chunk[ci2], { id: idByLms[chunk[ci2].lms_event_id] }))
            }
          }
        }
      }

      // Stale candidates — not touched by this sync, which (since this
      // department's fetch loop ran clean start to finish, see the
      // error-count guard below) normally means LMS genuinely cancelled or
      // removed them. But it is only ever an INFERENCE from absence, and
      // absence has a second, confirmed cause that has nothing to do with
      // real cancellation:
      //
      // Confirmed live (contract #00674 / Venue_00674_676, "Sanjay Kumar" /
      // HALDI, contract #00773, and others since): LMS's own list endpoint
      // returns 841 rows across 85 pages with only 784 distinct headids — 57
      // duplicates from the page window shifting under concurrent edits —
      // and a handful of contracts are simply never in that list at all, in
      // repeated independent scans minutes apart, while still fully visible
      // and editable in LMS's own UI. #00773 sat auto-cancelled by this
      // exact step for 6 days before anyone noticed, because absence used to
      // be treated as equivalent to a real cancellation.
      //
      // Genuine cancellation is now detected directly above, from LMS's own
      // cancel_remarks field — a real positive signal. This block no longer
      // touches lms_cancelled_at at all: it only flags a candidate into
      // lms_sync_anomalies for a human to confirm one way or the other in
      // Events -> Sync Issues (fn_resolve_lms_sync_anomaly). Only done when
      // the fetch had zero errors this run — a partial page failure would
      // make perfectly live contracts look stale just because we never
      // reached them. lms_stale_exempt (set via Dismiss on that screen) opts
      // a known-flaky contract out of repeat alerts; the grace window gives
      // a genuinely transient miss a few hours to self-recover before it's
      // even raised.
      var staleGraceCutoff = new Date(Date.parse(syncStartedAt) - 3 * 60 * 60 * 1000).toISOString()
      if (result.errors.length === 0) {
        var { data: candidateRows } = await supabase
          .from("events")
          .select("id, lms_event_id, contract_no, department, client_name, venue_name, function_date")
          .like("lms_event_id", dep.name + "_%")
          .lt("synced_at", staleGraceCutoff)
          .is("lms_cancelled_at", null)
          .eq("lms_stale_exempt", false)
        var candidates = candidateRows || []
        if (candidates.length > 0) {
          var { data: alreadyFlagged } = await supabase
            .from("lms_sync_anomalies")
            .select("lms_event_id")
            .in("lms_event_id", candidates.map(function (r: any) { return r.lms_event_id }))
            .is("resolved_at", null)
          var flaggedSet = new Set((alreadyFlagged || []).map(function (r: any) { return r.lms_event_id }))
          candidates = candidates.filter(function (r: any) { return !flaggedSet.has(r.lms_event_id) })
        }
        result.stale = candidates.length
        result.staleAnomalies = candidates
        if (result.stale > 0) {
          console.log(dep.name + ": " + result.stale + " rows missing from LMS's list, flagged for review")
        }
      }

      return result
    }

    var deptResults = await Promise.allSettled(DEPARTMENTS.map(function(dep) { return syncDept(dep) }))

    var allNewRows: any[] = []
    for (var di = 0; di < deptResults.length; di++) {
      var r = deptResults[di]
      if (r.status === "fulfilled") {
        totalSynced += r.value.synced
        totalFetched += r.value.fetched
        errors.push.apply(errors, r.value.errors)
        allNewRows.push.apply(allNewRows, r.value.newRows)
      } else {
        errors.push(DEPARTMENTS[di].name + ": " + r.reason)
      }
    }

    var staleTotal = deptResults.reduce(function(sum, r) { return sum + (r.status === "fulfilled" ? r.value.stale : 0) }, 0)
    console.log("Synced " + totalSynced + " of " + totalFetched + ", stale: " + staleTotal)

    if (allNewRows.length > 0) {
      try {
        await notifyNewContractsSynced(supabase, supabaseUrl, supabaseKey, allNewRows)
      } catch (notifyErr) {
        console.log("notifyNewContractsSynced failed:", (notifyErr as Error).message)
      }
    }

    var allStaleAnomalies: any[] = []
    for (var dj = 0; dj < deptResults.length; dj++) {
      var rj = deptResults[dj]
      if (rj.status === "fulfilled") allStaleAnomalies.push.apply(allStaleAnomalies, rj.value.staleAnomalies)
    }
    if (allStaleAnomalies.length > 0) {
      try {
        await notifyStaleAnomalies(supabase, supabaseUrl, supabaseKey, allStaleAnomalies)
      } catch (notifyErr) {
        console.log("notifyStaleAnomalies failed:", (notifyErr as Error).message)
      }
    }
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