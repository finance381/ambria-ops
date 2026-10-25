// supabase/functions/ambria-ims-expenses/index.ts
// Read-only endpoint for the separate Ambria IMS app. IMS already stores the
// LMS entry number for each deal (client_ledger.lmsLeadId) and we store the
// exact same raw value, untransformed, as events.contract_no (see
// sync-events/index.ts: `const entryNo = (e[dep.entryNo] || "").trim()` ->
// `contract_no: entryNo || null` for every department). That shared value is
// the join key — no new column or form field needed on our side.
//
// contract_no is NOT globally unique: each LMS department (Venue/Catering/
// Decor/Entertainment) numbers its own contracts independently (see the same
// gotcha documented in lms-payment-collections/index.ts), so a bare
// contract_no can match more than one unrelated real-world deal. Callers
// should pass lms_department whenever they know it (IMS does, since it
// already distinguishes "venue booking" vs "decor contract" by which raw LMS
// field the number came from) to disambiguate at the events lookup.
//
// Pools every event row sharing contract_no (+lms_department if given),
// including LMS-resync-superseded duplicates -- expenses may be attached to
// an id that a later resync marked lms_cancelled_at on, same lesson as
// EventLedger.jsx's _buildContractGroup/contractBalance.js's pool.
//
// expense_allocations.department does NOT carry Ambria IMS's 7 department
// names (Furniture/Floral/Structure/Tenting/Transport/Lighting/Fabric) -- it
// only ever holds Venue/Catering/Decor/Department (the same LMS contract-type
// vocabulary as events.department). The real per-department breakdown IMS
// wants lives one level down, as a 3-letter prefix on expense_sub_types.name
// for allocations booked under department = 'Decor' (confirmed against live
// data: FRN-/FLR-/STR-/TNT-/TRN-/LGT-/FBR- prefixes cover exactly IMS's 7).
// Anything else (ADD-, TRP-, KTM-, etc.) is Decor overhead that doesn't map
// to one of the 7 and is surfaced with its raw sub-type name untouched.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } })
}
function authOk(req: Request): boolean {
  const expected = Deno.env.get("AMBRIA_IMS_TO_OPS_SECRET") || ""
  return !!expected && (req.headers.get("Authorization") || "") === "Bearer " + expected
}

// expense_sub_types.name prefix (text before the first "-") -> Ambria IMS
// department name, for allocations booked under expense_allocations.department
// = 'Decor'. Confirmed against live data (see commit message / session notes).
const DECOR_PREFIX_TO_DEPT: Record<string, string> = {
  FRN: "Furniture",
  FLR: "Floral",
  STR: "Structure",
  TNT: "Tenting",
  TRN: "Transport",
  LGT: "Lighting",
  FBR: "Fabric",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405)
  if (!authOk(req)) return json({ error: "unauthorized" }, 401)

  const url = new URL(req.url)
  const contractNo = (url.searchParams.get("contract_no") || "").trim()
  const lmsDepartment = (url.searchParams.get("lms_department") || "").trim() // Venue|Catering|Decor|Entertainment
  const department = (url.searchParams.get("department") || "").trim() // ops dept, e.g. Furniture — filters expense_allocations only
  if (!contractNo) return json({ error: "contract_no required" }, 400)

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  let eventsQuery = supa.from("events").select("id").eq("contract_no", contractNo).is("merged_into_id", null)
  if (lmsDepartment) eventsQuery = eventsQuery.eq("department", lmsDepartment)
  const { data: events, error: eventsErr } = await eventsQuery
  if (eventsErr) return json({ error: eventsErr.message }, 500)
  if (!events || events.length === 0) return json([], 200)
  const eventIds = events.map((e: any) => e.id)

  const { data: expenses, error: expErr } = await supa
    .from("expenses")
    .select("id, expense_date, user_id")
    .in("event_id", eventIds)
  if (expErr) return json({ error: expErr.message }, 500)
  if (!expenses || expenses.length === 0) return json([], 200)
  const expenseIds = expenses.map((e: any) => e.id)
  const expenseById: Record<string, any> = {}
  expenses.forEach((e: any) => { expenseById[e.id] = e })

  // No department filter pushed into SQL here -- the real department for a
  // 'Decor' allocation is only knowable after resolving its sub-type prefix
  // below, so filtering happens in JS once that resolution is done.
  const { data: allocations, error: allocErr } = await supa
    .from("expense_allocations")
    .select("expense_id, department, amount_paise, remarks, expense_sub_type_id")
    .in("expense_id", expenseIds)
  if (allocErr) return json({ error: allocErr.message }, 500)
  if (!allocations || allocations.length === 0) return json([], 200)

  const userIds = [...new Set(expenses.map((e: any) => e.user_id).filter(Boolean))]
  const { data: profiles } = await supa.from("profiles").select("id, name").in("id", userIds)
  const nameById: Record<string, string> = {}
  ;(profiles || []).forEach((p: any) => { nameById[p.id] = p.name })

  const subTypeIds = [...new Set(allocations.map((a: any) => a.expense_sub_type_id).filter(Boolean))]
  const { data: subTypes } = await supa.from("expense_sub_types").select("id, name").in("id", subTypeIds)
  const subTypeNameById: Record<string, string> = {}
  ;(subTypes || []).forEach((s: any) => { subTypeNameById[s.id] = s.name })

  const result = allocations.map((a: any) => {
    const exp = expenseById[a.expense_id]
    const subTypeName = subTypeNameById[a.expense_sub_type_id] || ""
    const dashIdx = subTypeName.indexOf("-")
    const prefix = dashIdx > 0 ? subTypeName.slice(0, dashIdx).trim() : ""
    const suffix = dashIdx > 0 ? subTypeName.slice(dashIdx + 1).trim() : subTypeName
    const resolvedDept = a.department === "Decor" && DECOR_PREFIX_TO_DEPT[prefix]
      ? DECOR_PREFIX_TO_DEPT[prefix]
      : a.department
    return {
      department: resolvedDept,
      amount: Math.round(Number(a.amount_paise) || 0) / 100,
      label: a.remarks || suffix || "Expense",
      date: exp ? exp.expense_date : null,
      loggedBy: exp ? (nameById[exp.user_id] || null) : null,
    }
  }).filter((r: any) => !department || r.department === department)

  return json(result, 200)
})
