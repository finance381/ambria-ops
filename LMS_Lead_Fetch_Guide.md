# LMS Lead Fetch — Reference & Gotchas

Pulling **lead** data (not contracts) from `gyv.inqcrm.in` into an external tool.

---

## 1. Endpoints (all `POST`)

Base: `https://gyv.inqcrm.in/api/v1/processerp_api/`

| Department | Endpoint |
|---|---|
| Venue | `get_venue_information_list` |
| Catering | `get_catering_information_list` |
| Decor | `get_decor_information_list` |
| Entertainment | `get_entertain_infromation_list` |

⚠️ Entertainment endpoint is misspelled in the API itself — **`infromation`**, not `information`. Copy it verbatim. Do not "fix" it.

---

## 2. Response wrapper — most common bug

Lead lists return rows under **`leadinfo`** (lowercase).
Contract lists return **`Contractinfo`** (capital C).

```js
const rows = json.leadinfo || []      // LEADS
const rows = json.Contractinfo || []  // CONTRACTS — different key
```

If a fetch "returns nothing," check the wrapper key first. Wrong wrapper = empty array, no error.

---

## 3. Request body — per-department, not shared

Only `loggeduserid` is mandatory (default `"1"`). Every other field is an optional search filter — but the **filter names differ by department**, so you cannot reuse one body object for all four.

| Field role | Venue | Catering | Decor | Entertainment |
|---|---|---|---|---|
| text search | `fis_search` | `catering_search` | `decor_search` | `entertain_search` |
| venue filter | — | `cater_venue_search` | `decor_venue_search` | `entertain_venue_search` |
| priority | `priority_search` | `priority_searchc` | `priority_search` | `priority_search` |
| status | — | `catering_status_search` | `decor_status_search` | `entertain_status_search` |
| assignee | `fis_assginee_search` | `cater_assginee_search` | `decor_assginee_search` | `entertain_assginee_search` |

⚠️ Catering priority is **`priority_searchc`** (trailing `c`). Also note LMS spells it `assginee` (typo) everywhere — match it.

Common body (send all per-dept keys empty):
```json
{ "loggeduserid": "1", "page_limit": "1", ...dept_filters_empty }
```

---

## 4. Pagination — `page_limit` is the PAGE NUMBER

Despite the name, `page_limit` is **which page**, not page size.

- Page size is fixed at **10 rows**.
- Increment `page_limit` ("1", "2", "3"…) until a page returns **< 10 rows or empty**, then stop.
- **No `MAX_PAGES` cap.** Terminate naturally on short page. A hard cap silently drops leads once volume grows.

```js
let page = 1
while (true) {
  body.page_limit = String(page)
  const rows = (await post(endpoint, body)).leadinfo || []
  if (rows.length === 0) break
  all.push(...rows)
  if (rows.length < 10) break   // last page
  page++
}
```

---

## 5. Field prefixes

| Department | Header | Detail |
|---|---|---|
| Venue | `fis_` | `fisd_` |
| Catering | `ch_` | `chd_` |
| Decor | `dh_` | `dhd_` |
| Entertainment | `eh_` | `ehd_` |

Venue leads embed detail fields in the same row. Function date lives in **detail**:
- Venue lead function date = **`fisd_function_date`**

⚠️ Never assume a date/field name. The lead field is `fisd_function_date`; the **venue contract** field is `fiscd_function_date`; the **catering** one is `chcd_date`. Same concept, three different keys. Read the doc for the exact department + lead/contract combo before mapping. (This exact assumption cost a deploy cycle before — `fiscd_function_date` vs `fiscd_date`.)

---

## 6. Money

All amounts are **rupees as floats** (e.g. `850000.0`, `fis_total_amt`, `fis_advance_cash`, `fis_balance`).

- Multiply by 100 and round to store as **integer paise**.
- No float math anywhere near money.
```js
const paise = Math.round(Number(val || 0) * 100)
```

---

## 7. Lead-specific fields worth capturing

Leads carry CRM data that contracts don't:

- `fis_status` — lead temperature (`mild`, etc.)
- `fis_flwup_dt` / `fis_flwup_tm` / `fis_flwup_rmrk` — last follow-up
- `latest_followup` — **nested object** with the most recent follow-up (`FLLW_Next_Date`, `FLLW_Next_Remarks`, …). Parse separately.
- `fis_contract_no` — **empty until the lead converts to a contract**. Use it to link lead → contract and to detect conversion.
- `fis_visit_status` / `fis_visit_date` — site-visit tracking.
- `fis_priority` (Silver/Gold/etc.), `fis_enq_mode` (Walk-in/etc.).

---

## 8. Cancelled-lead filtering

Skip any row where the header `*_cancel_remarks` is non-empty:
```js
if ((row[h + "cancel_remarks"] || "").trim()) continue
```

---

## 9. Dedup

LMS can return the same lead twice (header/detail join fan-out).

- Dedup key: `Dept_EntryNo_FunctionType`.
- On collision, **prefer the row that has a `function_date`** — the other is usually a partial/blank-detail duplicate.

---

## 10. CORS / where to call from

The browser **cannot** call `gyv.inqcrm.in` directly (CORS). Route through a server proxy:

- Use a Supabase **Edge Function** as the proxy.
- Edge function verifies the caller's role (admin/auditor) before fetching.
- Writes use the service-role key; never expose LMS calls or keys to the client.
- `loggeduserid` comes from an env var, not hardcoded.

---

## Quick checklist when a fetch fails

1. Wrapper key — `leadinfo` vs `Contractinfo`?
2. Right endpoint spelling — `infromation` for entertainment?
3. Body using the correct per-dept filter names (`priority_searchc`, `assginee`)?
4. `loggeduserid` present?
5. Paginating on `page_limit` as page number, stopping on < 10 rows?
6. CORS — calling via proxy, not browser?
7. Field name verified against doc for this exact dept + lead/contract?

---

*Source: `gyv_all_lead_api_02_may_2026.txt`, `GYV_ALL_CONTRACT_API_4_MAY_2026.txt`, working `sync-events.ts`. Last updated May 2026.*
