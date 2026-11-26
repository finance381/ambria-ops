// supabase/functions/lms-leads-sync/index.ts
//
// Mirrors LMS leads (all four departments) into public.lms_leads for the
// Analytics page. One row per lead ENTRY (department + entry no): LMS returns
// one row per function of a lead, but status / priority / follow-up / visit /
// contract no are header fields shared by every function, so they are read
// once and the functions are folded into first/last date, count and names.
//
// Endpoints, wrapper key ("leadinfo"), per-department filter names and field
// prefixes come from gyv_all_lead_api_02_may_2026.txt / LMS_Lead_Fetch_Guide.md
// (the "infromation" and "assginee" typos are LMS's own -- keep them).
//
// Callers: the hourly cron (x-cron-secret = SYNC_CRON_SECRET, same as
// sync-events) or a signed-in user with admin.analytics / admin / auditor
// (the "Sync now" button). Writes use the service role.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
}

function json(status: number, payload: any) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
  })
}

var BASE_URL = "https://gyv.inqcrm.in/api/v1/processerp_api/"
// page_limit is the PAGE NUMBER (LMS returns 20 leads a page as of Nov 2026)
// LMS answers one request at a time (~3.5s a page, measured Nov 2026: 4
// parallel calls take ~13.5s, 8 take ~27s), so more parallel calls don't
// speed anything up -- they only risk timeouts. 2 keeps it busy, no more.
var CONCURRENCY = 2
var FETCH_TIMEOUT_MS = 25000
var RETRIES = 3
// A full Venue pass is hundreds of pages -- more than one run's wall clock.
// Each run works for this long, saves where it got to (lms_leads_sync_state
// .cursor) and the next run carries on from there.
var RUN_BUDGET_MS = 100000
var QUICK_PAGES = 1   // pages per department on a quick (button) sync

var FUNC_NAMES: Record<string, string> = {
  "1": "RING CEREMONY", "2": "BIRTHDAY", "3": "WEDDING", "4": "RECEPTION",
  "5": "KUA POOJAN", "6": "ANNIVERSARY", "7": "LAGAN", "8": "SAGAN",
  "9": "COCKTAIL", "10": "RELIGIOUS", "11": "CORPORATE", "12": "PROPOSAL CEREMONY",
  "14": "HALDI", "15": "MEHENDI", "16": "ROKA CEREMONY", "17": "RESIDENTIAL WEDDING",
  "18": "DESTINATION WEDDING", "19": "KOTHI BOOKING", "20": "SANGEET", "21": "BABY SHOWER",
  "22": "ENGAGEMENT", "23": "TENDER", "24": "BARAT ASSEMBLY", "25": "HOUSE PARTY",
  "26": "LUNCH FUNCTION", "27": "BREAKFAST FUNCTION", "28": "DINNER FUNCTION", "29": "BREAKFAST",
  "30": "LUNCH", "31": "KITTY PARTY", "32": "RESTAURANT SALE", "33": "LOHRI",
  "34": "DIWALI PARTY", "35": "GET TOGETHER", "36": "MATA KI CHOWKI",
}

type Dept = {
  name: string, endpoint: string, body: Record<string, string>, h: string,
  entryNo: string, guest: string, phone: string, entryDate: string, entryBy: string,
  funcDate: string, funcCode: string, leadType: string, pax: string | null, enqMode: string,
}

// Field names verified against gyv_all_lead_api_02_may_2026.txt. Note the
// Entertainment entry date/by really are eh_decor_entry_date / eh_decor_entryby.
var DEPARTMENTS: Dept[] = [
  {
    name: "Venue", endpoint: "get_venue_information_list", h: "fis_",
    body: { fis_search: "", source_search: "", lead_type_search: "", priority_search: "", fromdate: "", uptodated: "", fis_assginee_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    entryNo: "fis_entryno", guest: "fis_guest_name", phone: "fis_client_mobile",
    entryDate: "fis_entrydate", entryBy: "fis_entryby",
    funcDate: "fisd_function_date", funcCode: "fisd_function_type", leadType: "fisd_lead_type", pax: "fisd_pax_no",
    enqMode: "fis_enq_mode",
  },
  {
    name: "Catering", endpoint: "get_catering_information_list", h: "ch_",
    body: { catering_search: "", source_search: "", lead_type_search: "", cater_venue_search: "", priority_searchc: "", fromdate: "", uptodated: "", cater_assginee_search: "", catering_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    entryNo: "ch_entry_no", guest: "ch_guest_name", phone: "ch_contact_no",
    entryDate: "ch_cater_entry_date", entryBy: "ch_cater_entryby",
    funcDate: "chd_date", funcCode: "chd_function", leadType: "chd_lead_type", pax: "chd_pax",
    enqMode: "ch_enquiry_mode",
  },
  {
    name: "Decor", endpoint: "get_decor_information_list", h: "dh_",
    body: { decor_search: "", source_search: "", lead_type_search: "", priority_search: "", decor_venue_search: "", fromdate: "", uptodated: "", decor_assginee_search: "", decor_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    entryNo: "dh_entry_no", guest: "dh_guest_name", phone: "dh_contact_no",
    entryDate: "dh_decor_entry_date", entryBy: "dh_decor_entryby",
    funcDate: "dhd_date", funcCode: "dhd_function", leadType: "dhd_lead_type", pax: null,
    enqMode: "dh_enquiry_mode",
  },
  {
    name: "Entertainment", endpoint: "get_entertain_infromation_list", h: "eh_",
    body: { entertain_search: "", source_search: "", lead_type_search: "", entertain_venue_search: "", priority_search: "", fromdate: "", uptodated: "", entertain_assginee_search: "", entertain_status_search: "", search_date_type: "", visited_search: "", follow_dated: "" },
    entryNo: "eh_entry_no", guest: "eh_guest_name", phone: "eh_contact_no",
    entryDate: "eh_decor_entry_date", entryBy: "eh_decor_entryby",
    funcDate: "ehd_date", funcCode: "ehd_function", leadType: "ehd_lead_type", pax: null,
    enqMode: "eh_enquiry_mode",
  },
]

function str(v: any): string { return v == null ? "" : String(v).trim() }
// LMS sends "2026-09-08" on most fields but "08-Sep-2026" on some (Decor's
// dh_decor_entry_date) -- both become YYYY-MM-DD.
var MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" }
function dateOrNull(v: any): string | null {
  var s = str(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  var m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s)
  if (m && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + MONTHS[m[2].toLowerCase()] + "-" + m[1].padStart(2, "0")
  return null
}
// LMS writes department names in mixed case ("VENUE", "Venue") -> ours
function deptName(v: string): string | null {
  var t = str(v).toLowerCase()
  if (!t) return null
  if (t.indexOf("venue") === 0) return "Venue"
  if (t.indexOf("cater") === 0) return "Catering"
  if (t.indexOf("decor") === 0) return "Decor"
  if (t.indexOf("entertain") === 0) return "Entertainment"
  return str(v)
}
// last 10 digits -- "+91 98100-10860", "9810010860" and "09810010860" match
function phoneKey(v: any): string {
  var d = str(v).replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : ""
}
function intOrNull(v: any): number | null {
  var n = Number(v)
  return isFinite(n) && str(v) !== "" ? Math.round(n) : null
}

async function fetchPage(dep: Dept, page: number, lmsUserId: string): Promise<any[]> {
  var body = JSON.stringify(Object.assign({}, dep.body, { loggeduserid: lmsUserId, page_limit: String(page) }))
  var lastErr: any = null
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(function () { controller.abort() }, FETCH_TIMEOUT_MS)
    try {
      var res = await fetch(BASE_URL + dep.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body, signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error("HTTP " + res.status)
      var data = await res.json()
      return data.leadinfo || []
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)) })
    }
  }
  var msg = (lastErr && lastErr.name === "AbortError") ? "LMS did not answer in " + (FETCH_TIMEOUT_MS / 1000) + "s" : ((lastErr && lastErr.message) || String(lastErr))
  throw new Error("page " + page + ": " + msg)
}

// Reads pages from `start`, CONCURRENCY at a time, until a short/empty page
// (end of list), `stopAt` (if given) or the deadline. A page that still
// fails after retries stops the read there -- rows already read are kept.
async function pullPages(dep: Dept, lmsUserId: string, start: number, deadline: number, stopAt?: number) {
  var rows: any[] = []
  var page = start
  var reachedEnd = false
  var error: string | null = null
  while (Date.now() < deadline && (!stopAt || page <= stopAt)) {
    var pages: number[] = []
    for (var i = 0; i < CONCURRENCY && (!stopAt || page + i <= stopAt); i++) pages.push(page + i)
    var settled = await Promise.allSettled(pages.map(function (p) { return fetchPage(dep, p, lmsUserId) }))
    var stop = false
    for (var j = 0; j < settled.length; j++) {
      var s = settled[j]
      if (s.status === "rejected") { error = (s.reason && s.reason.message) || String(s.reason); stop = true; break }
      rows = rows.concat(s.value)
      page = pages[j] + 1
      // end of list = an empty page (page size has changed in LMS before)
      if (s.value.length === 0) { reachedEnd = true; stop = true; break }
    }
    if (stop) break
  }
  return { rows: rows, nextPage: page, reachedEnd: reachedEnd, error: error }
}

function buildLeads(dep: Dept, raw: any[], names: Record<string, string>) {
  var h = dep.h
  var byEntry = new Map<string, any>()
  raw.forEach(function (r) {
    var entryNo = str(r[dep.entryNo])
    if (!entryNo) return
    var key = dep.name + "_" + entryNo
    var fDate = dateOrNull(r[dep.funcDate])
    var fName = str(r.functionname || r.functionName) || FUNC_NAMES[str(r[dep.funcCode])] || ""
    var lead = byEntry.get(key)
    if (!lead) {
      var fu = r.latest_followup && typeof r.latest_followup === "object" ? r.latest_followup : null
      var cancelRemarks = str(r[h + "cancel_remarks"])
      var contractNo = str(r[h + "contract_no"])
      var assigned = str(r[h + "user_assigned"])
      var entryBy = str(r[dep.entryBy])
      var lastFu = fu ? dateOrNull(fu.FLLW_Date) : null
      var nextFu = dateOrNull(r[h + "flwup_dt"]) || (fu ? dateOrNull(fu.FLLW_Next_Date) : null)
      var total = Number(r[h + "total_amt"] || 0)
      lead = {
        lead_key: key,
        department: dep.name,
        entry_no: entryNo,
        guest_name: str(r[dep.guest]) || null,
        phone: str(r[dep.phone]) || null,
        entry_date: dateOrNull(r[dep.entryDate]) || dateOrNull(r.created_at),
        first_function_date: null, last_function_date: null,
        function_count: 0, _funcs: new Set<string>(), _names: new Set<string>(),
        venue_name: str(r.venuename || r.venue1) || null,
        lead_type: str(r[dep.leadType]) || null,
        pax: dep.pax ? intOrNull(r[dep.pax]) : null,
        priority: str(r[h + "priority"]) || null,
        enquiry_mode: str(r[dep.enqMode]) || null,
        status: str(r[h + "status"]) || null,
        assigned_lms_id: assigned || null,
        assigned_name: assigned ? (names[assigned] || null) : null,
        entry_by_lms_id: entryBy || null,
        entry_by_name: entryBy ? (names[entryBy] || null) : null,
        // a real follow-up entry; flwup_dt is just the next planned date and
        // is set on every lead from the start
        followed_up: !!fu,
        last_followup_date: lastFu,
        next_followup_date: nextFu,
        followup_status: str(r[h + "flwup_sts"]) || (fu ? str(fu.FLLW_Status) : "") || null,
        followup_remarks: str(r[h + "flwup_rmrk"]) || (fu ? str(fu.FLLW_Next_Remarks) : "") || null,
        visited: str(r[h + "visit_status"]).toUpperCase() === "Y",
        food_tasting: ["", "0", "0.0", "N"].indexOf(str(r[h + "food_taste_no"]).toUpperCase()) === -1,
        visit_date: dateOrNull(r[h + "visit_date"]),
        contract_no: contractNo || null,
        converted: !!contractNo,
        // LMS's total_amt is the real figure (sync-events dropped its x2,
        // confirmed against LMS's own UI, Nov 2026)
        quoted_paise: isFinite(total) ? Math.round(total * 100) : null,
        cancelled: !!cancelRemarks,
        cancel_remarks: cancelRemarks || null,
        // passed on from another department (e.g. "Forwarded from Venue
        // (00848) by Sahaj"); the forwarder is filled in after, from that
        // contract's creator
        forwarded_from: deptName(str(r[h + "forward_dept"]) || str(r[h + "forward_leaddept"])),
        forwarded_contract_no: str(r[h + "forward_contractno"]) || null,
        forwarded_date: dateOrNull(r[h + "forward_date"]) || dateOrNull(r[h + "forward_leaddate"]),
        forwarded_by_lms_id: null,
        synced_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        closed: false,
        closed_at: null,
      }
      byEntry.set(key, lead)
    }
    var fKey = str(r[dep.funcCode]) + "|" + (fDate || "") + "|" + str(r[h.replace("_", "d_") + "session"])
    if (fDate || str(r[dep.funcCode])) lead._funcs.add(fKey)
    if (fName) lead._names.add(fName)
    if (fDate) {
      if (!lead.first_function_date || fDate < lead.first_function_date) lead.first_function_date = fDate
      if (!lead.last_function_date || fDate > lead.last_function_date) lead.last_function_date = fDate
    }
  })
  return Array.from(byEntry.values()).map(function (l) {
    l.function_count = l._funcs.size
    l.function_names = Array.from(l._names).join(", ") || null
    delete l._funcs
    delete l._names
    return l
  })
}

serve(async function (req) {
  var startedAt = Date.now()
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" })

  try {
    var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
    var SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    var ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
    var admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    var cronSecret = req.headers.get("x-cron-secret")
    var cronExpected = Deno.env.get("SYNC_CRON_SECRET")
    var isCron = !!(cronSecret && cronExpected && cronSecret === cronExpected)

    if (!isCron) {
      var authHeader = req.headers.get("authorization")
      if (!authHeader) return json(401, { ok: false, error: "Unauthorized" })
      var userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      var userRes = await userClient.auth.getUser()
      if (userRes.error || !userRes.data.user) return json(401, { ok: false, error: "Invalid session" })
      // fn_analytics_contracts runs the same admin.analytics / admin / auditor
      // check and raises 'Not allowed' otherwise -- an empty-range call is a
      // cheap way to ask the database itself, as this caller.
      var canRes = await userClient.rpc("fn_analytics_contracts", { p_from: "1900-01-01", p_to: "1900-01-01", p_basis: "contract" })
      if (canRes.error) return json(403, { ok: false, error: "Analytics access required" })
    }

    var body = await req.json().catch(function () { return {} })
    // optional: { departments: ['Venue', ...] } or { department: 'Venue' }
    var wanted: string[] = Array.isArray(body.departments) ? body.departments.map(str) : (str(body.department) ? [str(body.department)] : [])
    var depts = wanted.length ? DEPARTMENTS.filter(function (d) { return wanted.indexOf(d.name) !== -1 }) : DEPARTMENTS
    // { quick: true } -- the Sync button. LMS's first pages hold the newest /
    // most recently touched leads, so read just those, leave the full-pass
    // cursor alone and mark nothing closed (that needs a whole pass, which
    // the 15-minute cron does). One LMS page can take 5-15s.
    var quick = !!body.quick

    var lmsUserId = Deno.env.get("LMS_USER_ID") || "1"
    var profRows = await admin.from("profiles").select("lms_user_id, name").not("lms_user_id", "is", null)
    var names: Record<string, string> = {}

    // LMS's own user list (one call, ~80 users, no paging) -> lms_users, so
    // Analytics can name a creator nobody has mapped to a profile yet, and
    // fn_map_profiles_to_lms can map profiles by phone. Best effort.
    // A quick sync reads the saved list instead of waiting on LMS.
    if (quick) {
      var lu = await admin.from("lms_users").select("id, full_name")
      ;(lu.data || []).forEach(function (u: any) { if (u.full_name) names[String(u.id)] = u.full_name })
    } else try {
      var ures = await fetch("https://gyv.inqcrm.in/api/v1/createcommon_api/get_user_list", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search_byuserid: "" }),
      })
      var udata = ures.ok ? await ures.json() : null
      var users = ((udata && udata.userdata) || []).filter(function (u: any) { return u && u.id != null }).map(function (u: any) {
        var full = (str(u.firstname) + " " + str(u.lastname)).trim()
        return {
          id: Number(u.id), username: str(u.username) || null, full_name: full || str(u.username) || null,
          phone: str(u.phonenumber) || null, email: str(u.email) || null,
          active: str(u.userstatus).toUpperCase() !== "N", departments: str(u.sewdepart) || null,
          synced_at: new Date().toISOString(),
        }
      })
      if (users.length) {
        var uu = await admin.from("lms_users").upsert(users, { onConflict: "id" })
        if (uu.error) console.error("lms-leads-sync lms_users: " + uu.error.message)
        users.forEach(function (u: any) { if (u.full_name) names[String(u.id)] = u.full_name })
      }
    } catch (uerr) {
      console.error("lms-leads-sync user list: " + ((uerr as Error).message || String(uerr)))
    }
    // a mapped profile's name wins over the LMS name
    ;(profRows.data || []).forEach(function (p: any) { names[String(p.lms_user_id)] = p.name })

    // Live contracts by department + last 10 phone digits -> contract no.
    var contractsByPhone: Record<string, Record<string, { no: string, date: string }[]>> = {}
    var creatorByContract: Record<string, string> = {}   // "Venue|00848" -> LMS user id
    for (var off = 0; ; off += 1000) {
      var ev = await admin.from("events").select("department, contact_number, contract_no, contract_date, created_by_lms_id")
        .is("lms_cancelled_at", null).not("contract_no", "is", null)
        .order("id", { ascending: true }).range(off, off + 999)
      if (ev.error) { console.error("lms-leads-sync events read: " + ev.error.message); break }
      ;(ev.data || []).forEach(function (e: any) {
        if (e.created_by_lms_id != null && e.contract_no) creatorByContract[e.department + "|" + e.contract_no] = String(e.created_by_lms_id)
        var k = phoneKey(e.contact_number)
        if (!k || !e.contract_no) return
        var m = contractsByPhone[e.department] = contractsByPhone[e.department] || {}
        var list = m[k] = m[k] || []
        if (!list.some(function (c) { return c.no === e.contract_no })) list.push({ no: e.contract_no, date: str(e.contract_date).slice(0, 10) })
      })
      if (!ev.data || ev.data.length < 1000) break
    }

    var deadline = startedAt + RUN_BUDGET_MS
    var summary = await Promise.all(depts.map(async function (dep) {
      try {
        var st = await admin.from("lms_leads_sync_state").select("cursor, cycle_started_at").eq("department", dep.name).maybeSingle()
        var cursor = Math.max(1, Number((st.data && st.data.cursor) || 1))
        // a pass that starts at page 1 is a new full pass
        var cycleStartedAt = cursor === 1 || !(st.data && st.data.cycle_started_at) ? new Date().toISOString() : st.data.cycle_started_at
        var raw: any[] = []
        var fetchErr: string | null = null
        var res = await pullPages(dep, lmsUserId, quick ? 1 : cursor, deadline, quick ? QUICK_PAGES : undefined)
        raw = raw.concat(res.rows)
        fetchErr = fetchErr || res.error
        var leads = buildLeads(dep, raw, names)
        // LMS leaves the lead's contract_no empty even after it converts, so
        // conversion also comes from the lead's own "Confirmed" status and
        // from a contract we already have for the same phone + department.
        var byPhone = contractsByPhone[dep.name] || {}
        leads.forEach(function (l: any) {
          if (l.forwarded_from && l.forwarded_contract_no) l.forwarded_by_lms_id = creatorByContract[l.forwarded_from + "|" + l.forwarded_contract_no] || null
          // only a contract signed on/after the lead came in -- a repeat
          // guest's old contract is not this lead converting
          var cands = (l.phone && byPhone[phoneKey(l.phone)]) || []
          var match = cands.filter(function (c) { return !l.entry_date || !c.date || c.date >= l.entry_date })
            .sort(function (a, b) { return a.date < b.date ? -1 : 1 })[0]
          if (!l.contract_no && match) l.contract_no = match.no
          l.converted = !!l.contract_no || str(l.status).toLowerCase() === "confirmed"
        })
        for (var i = 0; i < leads.length; i += 500) {
          var up = await admin.from("lms_leads").upsert(leads.slice(i, i + 500), { onConflict: "lead_key" })
          if (up.error) throw new Error("upsert: " + up.error.message)
        }
        if (quick) {
          // stamp the time only -- the full pass's cursor stays where it is
          if (!res.error) await admin.from("lms_leads_sync_state").upsert({ department: dep.name, synced_at: new Date().toISOString(), error: null })
          return { department: dep.name, leads: leads.length, quick: true, done: true, error: res.error }
        }
        var nowIso = new Date().toISOString()
        var state: any = { department: dep.name, cursor: res.reachedEnd ? 1 : res.nextPage, synced_at: nowIso, fetched: leads.length, error: fetchErr, cycle_started_at: cycleStartedAt }
        var closedNow = 0
        if (res.reachedEnd && !fetchErr) {
          state.cycle_done_at = nowIso
          // Read the whole list: every open lead was seen since the pass
          // began. One not seen has left the list -- closed in LMS
          // (Confirmed / Dead / Waste; the API lists open leads only).
          var cl = await admin.from("lms_leads").update({ closed: true, closed_at: nowIso })
            .eq("department", dep.name).eq("closed", false).lt("last_seen_at", cycleStartedAt).select("lead_key")
          if (cl.error) throw new Error("close: " + cl.error.message)
          closedNow = (cl.data || []).length
        }
        await admin.from("lms_leads_sync_state").upsert(state)
        return { department: dep.name, leads: leads.length, from_page: cursor, next_page: res.nextPage, done: res.reachedEnd, closed: closedNow, error: fetchErr }
      } catch (err) {
        var msg = (err && (err as Error).message) || String(err)
        console.error("lms-leads-sync " + dep.name + ": " + msg)
        await admin.from("lms_leads_sync_state").upsert({ department: dep.name, error: msg })
        return { department: dep.name, error: msg }
      }
    }))

    return json(200, { ok: true, summary: summary })
  } catch (uncaught) {
    console.error("lms-leads-sync uncaught: " + ((uncaught as Error).stack || String(uncaught)))
    return json(500, { ok: false, error: (uncaught as Error).message || String(uncaught) })
  }
})
