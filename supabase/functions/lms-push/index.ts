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
}

const SLOT_TIMING: Record<number, string> = {
  0: "18:00", 1: "16:00", 2: "12:00",  // Dinner, Sundowner, Lunch
}

function paiseToRupees(p: number | null): string {
  if (!p) return "0"
  return String(Math.round(p / 100))
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

    // Build LMS payload
    const venueIdx = q.venue_idx ?? 0
    const menuKey = (q.menu_idx ?? 3) + "-" + (q.food_pref ?? 0)
    const funcType = FUNC_TYPE_MAP[q.event_type] || "3"
    const slotTiming = SLOT_TIMING[q.slot ?? 0] || "18:00"
    const venueId = VENUE_ID_MAP[venueIdx] || "3"
    const venueName = VENUE_NAME_MAP[venueIdx] || "Ambria Pushpanjali"

    const perHeadRupees = q.per_head_rate ? String(Math.round(q.per_head_rate / 100)) : "0"
    const menuValueRupees = paiseToRupees(q.vm_q_paise)
    const decorRupees = paiseToRupees(q.decor_q_paise)
    const djRupees = paiseToRupees(q.dj_q_paise)
    const rentalRupees = paiseToRupees(q.rental_q_paise)
    const totalRupees = paiseToRupees(q.deal_value_paise || q.total_q_paise)

    const body: Record<string, string> = {
      loggeduserid: String(profile.lms_user_id),
      footerid: "",
      fisd_function_date: q.event_date,
      fisd_function_timings: slotTiming,
      fisd_function_type: funcType,
      fisd_lead_type: "I",
      fisd_venue_id: venueId,
      fisd_location_id: q.location_id,
      fisd_venue_name: venueName,
      fisd_location_name: q.location_name || "",
      fisd_menu: MENU_ID_MAP[menuKey] || "8",
      fisd_menu_type: "",
      fisd_session: "",
      fisd_pax_no: String(q.pax || 0),
      fisd_free_pax_no: "0",
      fisd_menu_rate: perHeadRupees,
      fisd_menu_value: menuValueRupees,
      fisd_decoration_lumpsum: decorRupees,
      fisd_decoration_remarks: "",
      fisd_entertainment_lumpsum: djRupees,
      fisd_entertainment_remarks: "",
      fisd_entertain_type: "",
      fisd_decor_type: "",
      fisd_venue_value: totalRupees,
      fisd_rent: rentalRupees,
      fisd_extra_plate_charge: "0",
      mid: "",
      fis_entryno: "",
      current_contact: "",
      current_zone: "",
      current_branch: "",
      fis_proposal: q.proposal_text || "",
      fis_flwup_dt: "",
      fis_flwup_rmrk: "",
      fis_flwup_sts: "",
      fis_function_date_from: q.event_date,
      fis_function_date_upto: q.event_date,
      fis_total_amt: totalRupees,
      fis_cash_part: "",
      fis_cheque: "",
      fis_tax_c_amt: "",
      fis_tax_d_amt: "",
      fis_tax_percent_c: "",
      fis_tax_percent_d: "",
      fis_tax_percent: "",
      fis_tax_amt: "",
      fis_net_amt: "",
      fis_advance_cash: "",
      fis_balance: "",
      fis_advance_chq: "",
      fis_guestinfo_id: "",
      fis_priority: "Silver",
      fis_secondary_mobileno: "",
      fis_venue: venueId,
      fis_guest_name: q.guest_name,
      fis_client_mobile: q.guest_phone || "",
      fis_address: q.guest_address || "",
      fis_state: "1483",
      fis_city: "delhi",
      fis_pin: "",
      fis_client_email: "",
      fis_enq_mode: "",
      fis_reference_name: "",
      fis_reference_mobile: "",
      fis_addon: "",
      fis_charges: "",
      fis_food_taste_no: "",
      fis_food_tax: "",
      fis_addtional_remrks: q.notes || "",
      fis_factor_zero: "",
    }

    // POST to LMS
    const lmsBase = Deno.env.get("LMS_API_BASE") || "https://gyv.inqcrm.in"
    const lmsRes = await fetch(
      lmsBase + "/api/v1/createcommon_api/create_venue_lead_detail",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    )
    const lmsData = await lmsRes.json()

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