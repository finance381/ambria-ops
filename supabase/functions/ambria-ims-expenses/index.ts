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
//
// Response shape: one object per expense_allocations row (an expense split
// across departments produces one row per split), with every column IMS
// asked for passed through as-is -- no new columns, no new capture UI, just
// stop trimming. `department`/`amount`/`date`/`loggedBy` keep their existing
// meaning for backward compatibility. `label` is REMOVED (breaking change --
// coordinate with IMS before/at deploy): it used to silently collapse
// `category` and `remarks` into one field with fallback logic that made the
// two indistinguishable; they're now separate, un-merged fields. `remarks`
// is null when nothing was typed -- no fallback to the category name.
// receipt_path/receipt_paths are passed through as raw storage paths (the
// `receipts` bucket is private) -- signed URLs are a separate ask if IMS
// needs to actually display/download them.

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
    .select([
      "id", "expense_date", "user_id", "description", "vendor_name",
      "travel_from", "travel_to", "travel_mode",
      "status", "reviewed_by", "reviewed_at", "dept_approved_by", "dept_approved_at",
      "rejection_reason", "flag_reason",
      "penalty_paise", "penalized_by", "penalized_at",
      "acknowledged_by", "acknowledged_at",
      "deduction_type", "tax_paise", "batch_id", "item_receipt_status",
      "receipt_path", "receipt_paths",
      "deleted_at", "deleted_by", "delete_reason",
      "payment_cash_paise", "payment_credit_paise", "payment_credit_mode", "due_date",
      "payment_credit_cash_paise", "payment_credit_bank_paise", "cash_due_date", "bank_due_date",
      "checked_by", "checked_at", "tally_entered_by", "tally_entered_at",
      "event_id", "extra_event_ids", "metadata",
      "expense_type_id", "expense_sub_type_id",
    ].join(", "))
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
    .select("id, expense_id, department, department_id, amount_paise, remarks, expense_type_id, expense_sub_type_id, venue_id, sub_venue_id, source")
    .in("expense_id", expenseIds)
  if (allocErr) return json({ error: allocErr.message }, 500)
  if (!allocations || allocations.length === 0) return json([], 200)

  // Every UUID actor column on expenses, resolved to a name the same way
  // loggedBy (expenses.user_id) already was -- raw UUIDs aren't useful to a
  // consumer with no access to our profiles table.
  const ACTOR_COLS = ["user_id", "reviewed_by", "dept_approved_by", "penalized_by", "acknowledged_by", "checked_by", "tally_entered_by", "deleted_by"]
  const userIds = [...new Set(expenses.flatMap((e: any) => ACTOR_COLS.map((c) => e[c])).filter(Boolean))]
  const { data: profiles } = await supa.from("profiles").select("id, name").in("id", userIds)
  const nameById: Record<string, string> = {}
  ;(profiles || []).forEach((p: any) => { nameById[p.id] = p.name })
  const nameOf = (id: string | null) => (id ? (nameById[id] || null) : null)

  const subTypeIds = [...new Set(allocations.map((a: any) => a.expense_sub_type_id).filter(Boolean))]
  const { data: subTypes } = await supa.from("expense_sub_types").select("id, name").in("id", subTypeIds)
  const subTypeNameById: Record<string, string> = {}
  ;(subTypes || []).forEach((s: any) => { subTypeNameById[s.id] = s.name })

  const toAmount = (paise: unknown) => (paise == null ? null : Math.round(Number(paise)) / 100)

  const result = allocations.map((a: any) => {
    const exp = expenseById[a.expense_id] || {}
    const subTypeName = subTypeNameById[a.expense_sub_type_id] || ""
    const dashIdx = subTypeName.indexOf("-")
    const prefix = dashIdx > 0 ? subTypeName.slice(0, dashIdx).trim() : ""
    const suffix = dashIdx > 0 ? subTypeName.slice(dashIdx + 1).trim() : subTypeName
    const resolvedDept = a.department === "Decor" && DECOR_PREFIX_TO_DEPT[prefix]
      ? DECOR_PREFIX_TO_DEPT[prefix]
      : a.department
    return {
      // Unchanged from before.
      department: resolvedDept,
      amount: toAmount(a.amount_paise),
      date: exp.expense_date || null,
      loggedBy: nameOf(exp.user_id),

      // `label`'s two real values, split and un-merged.
      category: suffix || null,
      remarks: a.remarks || null,

      // expense_allocations, passed through as-is.
      allocationId: a.id,
      expenseId: a.expense_id,
      departmentId: a.department_id,
      expenseTypeId: a.expense_type_id,
      expenseSubTypeId: a.expense_sub_type_id,
      expenseSubTypeName: subTypeName || null,
      venueId: a.venue_id,
      subVenueId: a.sub_venue_id,
      allocationSource: a.source,

      // expenses, passed through as-is.
      userId: exp.user_id || null,
      description: exp.description,
      vendorName: exp.vendor_name,
      travelFrom: exp.travel_from,
      travelTo: exp.travel_to,
      travelMode: exp.travel_mode,
      status: exp.status,
      reviewedBy: nameOf(exp.reviewed_by),
      reviewedAt: exp.reviewed_at,
      deptApprovedBy: nameOf(exp.dept_approved_by),
      deptApprovedAt: exp.dept_approved_at,
      rejectionReason: exp.rejection_reason,
      flagReason: exp.flag_reason,
      penaltyAmount: toAmount(exp.penalty_paise),
      penalizedBy: nameOf(exp.penalized_by),
      penalizedAt: exp.penalized_at,
      acknowledgedBy: nameOf(exp.acknowledged_by),
      acknowledgedAt: exp.acknowledged_at,
      deductionType: exp.deduction_type,
      taxAmount: toAmount(exp.tax_paise),
      batchId: exp.batch_id,
      itemReceiptStatus: exp.item_receipt_status,
      receiptPath: exp.receipt_path,
      receiptPaths: exp.receipt_paths,
      deletedAt: exp.deleted_at,
      deletedBy: nameOf(exp.deleted_by),
      deleteReason: exp.delete_reason,
      paymentCashAmount: toAmount(exp.payment_cash_paise),
      paymentCreditAmount: toAmount(exp.payment_credit_paise),
      paymentCreditMode: exp.payment_credit_mode,
      dueDate: exp.due_date,
      paymentCreditCashAmount: toAmount(exp.payment_credit_cash_paise),
      paymentCreditBankAmount: toAmount(exp.payment_credit_bank_paise),
      cashDueDate: exp.cash_due_date,
      bankDueDate: exp.bank_due_date,
      checkedBy: nameOf(exp.checked_by),
      checkedAt: exp.checked_at,
      tallyEnteredBy: nameOf(exp.tally_entered_by),
      tallyEnteredAt: exp.tally_entered_at,
      eventId: exp.event_id,
      extraEventIds: exp.extra_event_ids,
      metadata: exp.metadata,
      // expenses.expense_type_id/expense_sub_type_id are separate columns
      // from the allocation's own (above) -- kept distinct rather than
      // guessing they mean the same thing.
      expenseRecordExpenseTypeId: exp.expense_type_id,
      expenseRecordExpenseSubTypeId: exp.expense_sub_type_id,
    }
  }).filter((r: any) => !department || r.department === department)

  return json(result, 200)
})
