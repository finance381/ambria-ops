// supabase/functions/lms-payment-collections/index.ts
// Read-only proxy to LMS's get_all_payment_collection (GYV_NEW_API_7_OCT_26.txt,
// API #2) — lets the Wallet's Collect flow show what LMS itself already has on
// record for a contract (collected by anyone, through any channel) alongside
// our own fn_event_balance figure, which only ever reflects collections made
// through Ambria Ops' own wallet. Kept server-side (not called directly from
// the browser) so the LMS host/path stays out of client code, same reasoning
// as every other LMS call in this codebase (sync-events, lms-push).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("authorization")
    if (!authHeader) throw new Error("No auth header")

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) throw new Error("Unauthorized")

    const body = await req.json().catch(() => ({}))
    const contractNo = (body.contract_no || "").toString().trim()
    if (!contractNo) throw new Error("Missing contract_no")

    const lmsBase = Deno.env.get("LMS_API_BASE") || "https://gyv.inqcrm.in"
    const lmsUser = Deno.env.get("LMS_API_USER") || Deno.env.get("LMS_USER_ID") || "1"

    // Confirmed by hand against the live API: pay_contractno alone returns
    // nothing, even for a contract with real records — this endpoint silently
    // requires a non-empty date range to actually apply the contract filter.
    // A booking's advance can land months before the event and a final
    // settlement after it, so the window needs real margin on both sides
    // rather than hugging the event date.
    function lmsDate(d: Date): string {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
      return String(d.getDate()).padStart(2, "0") + "-" + months[d.getMonth()] + "-" + d.getFullYear()
    }
    const today = new Date()
    const fromDate = new Date(today); fromDate.setFullYear(fromDate.getFullYear() - 2)
    const uptoDate = new Date(today); uptoDate.setDate(uptoDate.getDate() + 14)

    const lmsRes = await fetch(lmsBase + "/api/v1/createcommon_api/get_all_payment_collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pay_contractno: contractNo,
        pay_from_date: lmsDate(fromDate),
        pay_pay_upto: lmsDate(uptoDate),
        pay_pay_mode: "",
        pay_pay_dept: "",
        pay_pay_user: "",
        pay_guest_filter: "",
        pay_perpage: "",
        loggeduserid: lmsUser,
      }),
    })
    if (!lmsRes.ok) throw new Error("LMS request failed: HTTP " + lmsRes.status)
    const lmsData = await lmsRes.json().catch(() => ({}))

    // LMS reports amounts as plain rupee decimals ("25000.0") — converted to
    // paise here so this matches the unit every other figure in Ambria Ops
    // already uses (formatPoints et al. all expect paise).
    const rows = Array.isArray(lmsData.data) ? lmsData.data : []
    const mapped = rows.map(function (r: any) {
      return {
        receive_id: r.pr_receive_id || null,
        date: r.pr_date || null,
        amount_paise: Math.round(Number(r.pr_amount || 0) * 100),
        deduct_paise: Math.round(Number(r.pr_deduct || 0) * 100),
        net_amount_paise: Math.round(Number(r.pr_netamount || 0) * 100),
        pay_mode: r.pr_paymode || null,
        receive_type: r.pr_receive_typ || null,
        remarks: r.pr_remarks || null,
        status: r.pr_status || null,
        guest_name: r.guestname || null,
        entry_by: r.entryby || null,
        order_no: r.pr_order_no || null,
        receipt_url: r.attachpath || null,
      }
    })

    return new Response(
      JSON.stringify({ data: mapped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (e) {
    console.error("lms-payment-collections error:", e.message)
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
