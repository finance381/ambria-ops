import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ═══ Static maps ═══

const VENUE_ID_MAP: Record<number, string> = {
  0: "3", 1: "6", 2: "6", 3: "19", 4: "19",
}

const VENUE_NAME_MAP: Record<number, string> = {
  0: "Ambria Pushpanjali", 1: "Manaktala Farm", 2: "Manaktala Farm",
  3: "Ambria Exotica", 4: "Ambria Exotica",
}

const MENU_ID_MAP: Record<string, string> = {
  "0-0": "2", "0-1": "3",   // Magnum veg/nv
  "1-0": "4", "1-1": "5",   // Double Magnum
  "2-0": "6", "2-1": "7",   // Multi Cuisine
  "3-0": "8", "3-1": "9",   // Luxury
}

const FUNC_TYPE_MAP: Record<string, string> = {
  "Wedding": "3", "Reception": "4", "Engagement": "22", "Birthday": "2",
  "Anniversary": "6", "Cocktail": "9", "Corporate": "11", "Ring Ceremony": "1",
  "Haldi": "14", "Mehendi": "15", "Sangeet": "20", "Sagan": "8", "Lagan": "7",
  "Baby Shower": "21", "Roka Ceremony": "16", "Religious": "10", "Kua Poojan": "5",
  "House Party": "25", "Kitty Party": "31", "Get Together": "35",
  "Proposal Ceremony": "12", "Residential Wedding": "17", "Destination Wedding": "18",
  "Kothi Booking": "19", "Barat Assembly": "24", "Lunch Function": "26",
  "Breakfast Function": "27", "Dinner Function": "28", "Breakfast": "29",
  "Lunch": "30", "Restaurant Sale": "32", "Lohri": "33",
  "Diwali Party": "34", "Mata Ki Chowki": "36",
}

const SLOT_TIMING: Record<number, string> = {
  0: "18:00", 1: "16:00", 2: "12:00",  // Dinner, Sundowner, Lunch
}

const DECOR_LABELS: Record<number, string> = {
  0: "Premium", 1: "Standard", 2: "Banquet",
}

const DJ_LABELS: Record<number, string> = {
  0: "DJ + LED", 1: "Std DJ - No LED",
}

// Converts paise to half-rupees for LMS (stores half the real figure).
// Amounts ≥1L: ceil to nearest 0.5L first (matches UI fmtRound), then halve.
// Amounts <1L: exact halve (matches UI fmtK display in K).
function paiseToRupees(p: number | null): string {
  if (p == null) return "0"
  const lakhs = p / 10000000
  if (lakhs >= 1) {
    const rounded = Math.ceil(lakhs * 2) / 2
    return String(Math.round(rounded * 50000))
  }
  return String(Math.round(p / 200))
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("authorization")
    if (!authHeader) throw new Error("No auth header")

    const { quote_id } = await req.json()
    if (!quote_id) throw new Error("Missing quote_id")

    // Auth client to get user identity
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) throw new Error("Unauthorized")

    // Service role client for DB ops
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Load profile for lms_user_id
    const { data: profile, error: profErr } = await db
      .from("profiles")
      .select("lms_user_id, name")
      .eq("id", user.id)
      .single()
    if (profErr || !profile) throw new Error("Profile not found")
    if (!profile.lms_user_id) throw new Error("LMS user not mapped for " + profile.name)

    // Load quote
    const { data: q, error: qErr } = await db
      .from("quotes")
      .select("*")
      .eq("id", quote_id)
      .single()
    if (qErr || !q) throw new Error("Quote not found")

    // Duplicate guard
    if (q.lms_ref) throw new Error("Already pushed as lead " + q.lms_ref)

    // Validate required fields
    if (!q.location_id) throw new Error("Location not selected")
    if (!q.guest_name) throw new Error("Guest name required")
    if (!q.event_date) throw new Error("Event date required")
    const phone = (q.guest_phone || "").replace(/\D/g, "").slice(-10)
    if (!phone || phone.length < 10) throw new Error("Valid 10-digit phone required")

    // Build LMS payload
    const venueIdx = q.venue_idx ?? 0
    const menuKey = (q.menu_idx ?? 3) + "-" + (q.food_pref ?? 0)
    const funcType = FUNC_TYPE_MAP[q.event_type] || "3"
    const slotTiming = SLOT_TIMING[q.slot ?? 0] || "18:00"
    const venueId = VENUE_ID_MAP[venueIdx] || "3"
    const venueName = VENUE_NAME_MAP[venueIdx] || "Ambria Pushpanjali"

    // Use deal breakdowns when negotiated, else quote tier
    const hasDeal = q.deal_value_paise != null && q.deal_value_paise > 0
    const vmPaise = Math.max(0, hasDeal && q.deal_vm_paise != null ? q.deal_vm_paise : (q.vm_q_paise || 0))
    const decorPaise = Math.max(0, hasDeal && q.deal_decor_paise != null ? q.deal_decor_paise : (q.decor_q_paise || 0))
    const djPaise = Math.max(0, hasDeal && q.deal_ent_paise != null ? q.deal_ent_paise : (q.dj_q_paise || 0))
    const menuValueRupees = paiseToRupees(vmPaise)
    const extraPlateRupees = (vmPaise && q.pax) ? String(Math.round(vmPaise / q.pax / 200)) : "0"
    const decorRupees = paiseToRupees(decorPaise)
    const djRupees = paiseToRupees(djPaise)
    const totalRupees = paiseToRupees(q.deal_value_paise || (vmPaise + (q.include_decor !== false ? decorPaise : 0) + (q.include_dj !== false ? djPaise : 0)) || q.total_q_paise)

    const body: Record<string, string | number> = {
      loggeduserid: String(profile.lms_user_id),
      fisd_function_date: q.event_date,
      fisd_function_timings: slotTiming,
      fisd_function_type: funcType,
      fisd_lead_type: "I",
      fisd_venue_id: venueId,
      fisd_location_id: q.location_id,
      fisd_venue_name: venueName,
      fisd_location_name: q.location_name || "-",
      fisd_menu: MENU_ID_MAP[menuKey] || "8",
      fisd_pax_no: String(q.pax || 0),
      fisd_free_pax_no: "1",
      fisd_menu_type: "Lumpsum",
      fisd_menu_rate: "0",
      fisd_extra_plate_charge: extraPlateRupees,
      fisd_menu_value: menuValueRupees,
      fisd_session: ["Dinner", "Sundowner", "Lunch"][q.slot ?? 0] || "Dinner",
      fisd_venue_value: "0",
      fisd_decoration_lumpsum: decorRupees,
      fisd_decor_type: "Enpaneled",
      fisd_decoration_remarks: DECOR_LABELS[q.decor_idx ?? 0] || "Premium",
      fisd_entertainment_lumpsum: djRupees,
      fisd_entertain_type: "Enpaneled",
      fisd_entertainment_remarks: DJ_LABELS[q.dj_idx ?? 0] || "DJ + LED",
      fis_guest_name: q.guest_name,
      fis_client_mobile: phone,
      fis_address: q.guest_address || "-",
      fis_state: "1483",
      fis_city: "delhi",
      fis_venue: venueId,
      fis_priority: q.priority || "Silver",
      fis_enq_mode: q.inquiry_mode || "Walk-in",
      fis_total_amt: totalRupees,
    }

    // POST to LMS
    const lmsBase = Deno.env.get("LMS_API_BASE") || "https://gyv.inqcrm.in"
    console.log("LMS push:", JSON.stringify({ quote_id, venue: venueId, func: funcType, pax: body.fisd_pax_no }))
    const lmsRes = await fetch(
      lmsBase + "/api/v1/createcommon_api/create_venue_lead_detail",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    )
    const lmsData = await lmsRes.json()
    console.log("LMS response:", JSON.stringify(lmsData))

    if (!lmsData.status) throw new Error("LMS rejected: " + (lmsData.message || "Unknown error"))

    const entryNo = lmsData.fis_entryno || null

    // Write back
    const { error: upErr } = await db
      .from("quotes")
      .update({ lms_ref: entryNo, lms_pushed_at: new Date().toISOString(), status: "sent" })
      .eq("id", quote_id)
    if (upErr) console.error("Writeback failed:", upErr.message)

    return new Response(
      JSON.stringify({ success: true, fis_entryno: entryNo }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (e) {
    console.error("lms-push error:", e.message)
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})