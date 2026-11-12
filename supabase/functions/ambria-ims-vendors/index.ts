// supabase/functions/ambria-ims-vendors/index.ts
// Read-only vendor catalog for Ambria IMS (decor studio app), reusing the
// same AMBRIA_IMS_TO_OPS_SECRET as ambria-ims-expenses.
//
// Vendors here are NOT tagged by a department column -- they carry
// expense_sub_type_ids (bigint[]), and expense_sub_types roll up to
// expense_types.department_id (the `departments` table; Decor = id 16 on
// this project -- confirmed live, not assumed). Decor's expense_types are
// one row per IMS sub-category, named "<PREFIX>-<label>" (e.g.
// "FRN-Furniture (ADD)"), the exact same prefix vocabulary
// ambria-ims-expenses' DECOR_PREFIX_TO_DEPT already resolves allocations
// into. `category` here takes the same 7 names for consistency.
//
// IMPORTANT caveat for IMS: there is no single "Casual Labour" sub-type --
// confirmed live, each of the 6 applicable categories (all but Transport)
// has its OWN "<PREFIX>-Casual Labour Expenses" row (ids differ per
// category), so `category` is required, not optional, to get a determinate
// vendor list. Querying with no category match (e.g. Transport, which has
// no casual-labour row at all) returns [].
//
// Vendor <-> expense-record matching caveat: vendors.id (returned here as
// `id`) is NOT currently present on ambria-ims-expenses' response -- that
// endpoint only returns a resolved display-text `vendorName`, because
// expenses.vendor_name is a legacy text column and the actual vendor_id
// picked on an expense lives inside expenses.metadata under a per-sub-type
// lookup field key (see ExpenseForm.jsx "Resolve legacy vendor_name
// column"), not a stable column. So today, a vendor picked from this
// catalog can only be cross-referenced against a logged expense by NAME,
// not id, despite what IMS's prompt assumed. Flagged back to IMS rather
// than silently building around it -- a `vendorId` field can be added to
// ambria-ims-expenses as a separate follow-up if they need exact-id
// matching, by resolving that metadata key server-side the same way the
// form does.

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

// Same 7 names ambria-ims-expenses' DECOR_PREFIX_TO_DEPT resolves allocation
// rows into -> the expense_sub_types.name prefix for that category under the
// Decor department (department_id 16, confirmed live).
const CATEGORY_TO_PREFIX: Record<string, string> = {
  Furniture: "FRN",
  Floral: "FLR",
  Structure: "STR",
  Tenting: "TNT",
  Transport: "TRN",
  Lighting: "LGT",
  Fabric: "FBR",
}
const DECOR_DEPARTMENT_ID = 16

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\bexpenses?\b/g, "").replace(/[\s_-]+/g, "_").replace(/^_+|_+$/g, "")
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405)
  if (!authOk(req)) return json({ error: "unauthorized" }, 401)

  const url = new URL(req.url)
  const category = (url.searchParams.get("category") || "").trim()
  const subType = (url.searchParams.get("sub_type") || "").trim()
  const prefix = CATEGORY_TO_PREFIX[category]
  if (!prefix) {
    return json({ error: "category must be one of: " + Object.keys(CATEGORY_TO_PREFIX).join(", ") }, 400)
  }
  if (!subType) return json({ error: "sub_type required" }, 400)

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: expenseType, error: etErr } = await supa
    .from("expense_types")
    .select("id")
    .eq("department_id", DECOR_DEPARTMENT_ID)
    .ilike("name", prefix + "-%")
    .eq("active", true)
    .maybeSingle()
  if (etErr) return json({ error: etErr.message }, 500)
  if (!expenseType) return json([], 200)

  const { data: subTypes, error: stErr } = await supa
    .from("expense_sub_types")
    .select("id, name")
    .eq("expense_type_id", expenseType.id)
    .eq("active", true)
  if (stErr) return json({ error: stErr.message }, 500)

  const wanted = normalize(subType)
  const matchIds = (subTypes || [])
    .filter((s: any) => {
      const dash = s.name.indexOf("-")
      const suffix = dash > 0 ? s.name.slice(dash + 1) : s.name
      return normalize(suffix) === wanted
    })
    .map((s: any) => String(s.id))
  if (matchIds.length === 0) return json([], 200)

  // expense_sub_type_ids is bigint[] -- PostgREST serializes its elements as
  // JSON strings, same gotcha as vendorGating.js/Vendors.jsx. The overlap
  // check below compares as strings on both sides for that reason, and is
  // done in JS (not a Postgres `&&` filter) to sidestep the bigint[]/
  // integer[] cast mismatch that tripped the equivalent raw-SQL version of
  // this query.
  const { data: vendors, error: vErr } = await supa
    .from("vendors")
    .select("id, name, phone, active, expense_sub_type_ids")
    .eq("active", true)
  if (vErr) return json({ error: vErr.message }, 500)

  const result = (vendors || [])
    .filter((v: any) => {
      const tags = (v.expense_sub_type_ids || []).map(String)
      return matchIds.some((id) => tags.indexOf(id) !== -1)
    })
    .map((v: any) => ({ id: String(v.id), name: v.name, phone: v.phone, active: v.active }))

  return json({ vendors: result }, 200)
})
