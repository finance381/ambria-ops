import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEP_CODES = [
  { code: "VENUE", name: "Venue" },
  { code: "CD", name: "Catering" },
  { code: "FD", name: "Decor" },
  { code: "EE", name: "Entertainment" },
]

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    let totalSynced = 0
    let totalEvents = 0
    const errors: string[] = []

    for (const dep of DEP_CODES) {
      try {
        const lmsRes = await fetch("https://gyv.inqcrm.in/api/v1/processerp_api/get_event_with_contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loggeduserid: "1",
            depcode: dep.code,
            dated: "",
            vebuid: "",
            contractno: ""
          })
        })

        if (!lmsRes.ok) {
          const txt = await lmsRes.text()
          console.log("LMS error for " + dep.code + ":", lmsRes.status, txt)
          errors.push(dep.code + ": " + lmsRes.status)
          continue
        }

        const lmsText = await lmsRes.text()
        const lmsData = JSON.parse(lmsText)
        const events = lmsData.data || []
        console.log(dep.code + " returned " + events.length + " events")
        totalEvents += events.length

        const rows = events.map((e: any) => ({
          lms_event_id: dep.code + '_' + (e.ContractNo || '') + '_' + (e.EventId || ''),
          contract_no: e.ContractNo || null,
          contract_date: e.ContractDate || null,
          department: dep.name,
          contract_type: e.ContractType || null,
          venue_name: e.VenueName || null,
          location: e.Location || null,
          contact_person: e.ContactPerson || null,
          contact_number: e.ContactNumber || null,
          event_name: (e.EventName || "").trim(),
          client_name: e.ClientName || null,
          session: e.Session || null,
          catering: e.Catering || null,
          total_plates: e.TotalPlates || 0,
          complementary_plates: e.ComplementryPlates || 0,
          extra_plates_charge: Math.round((e.ExtraPlatesCharge || 0) * 100),
          balance_received: Math.round((e.Balances?.factor_payment_received_sum || 0) * 100),
          balance_bank: Math.round((e.Balances?.bank_payment || 0) * 100),
          balance_amount: Math.round((e.Balances?.balance_amount || 0) * 100),
          created_user_name: e.CreatedUserName || null,
          synced_at: new Date().toISOString(),
        }))

        // Batch upsert in chunks of 200
        const CHUNK = 200
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK)
          const { error, count } = await supabase
            .from("events")
            .upsert(chunk, { onConflict: "lms_event_id", count: "exact" })

          if (error) {
            console.log("Batch upsert error for " + dep.code + " chunk " + i + ":", error.message)
          } else {
            totalSynced += count || chunk.length
          }
        }
      } catch (depErr) {
        console.log("Error syncing " + dep.code + ":", (depErr as Error).message)
        errors.push(dep.code + ": " + (depErr as Error).message)
      }
    }

    console.log("Synced " + totalSynced + " of " + totalEvents + " across all departments")
    return new Response(JSON.stringify({
      synced: totalSynced,
      total: totalEvents,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (err) {
    console.log("Function error:", (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})