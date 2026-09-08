import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// v_review_queue unions 5 stateful domains (inventory, item_receipt, requisition,
// category, sub_category) — expense and vendor_payment are read-only audit domains
// with no "pending" concept, so they never appear in the queue or contribute to
// counts. Their tabs read directly from expenses / ledger_entries via their own
// adapter (see adapters/expense.jsx, adapters/vendorPayment.jsx).
var QUEUE_DOMAINS = ['inventory', 'item_receipt', 'requisition', 'category', 'sub_category']
var ALL_DOMAINS = ['inventory', 'item_receipt', 'expense', 'requisition', 'vendor_payment', 'category', 'sub_category']
// Only these 3 have a persistent rejected/approved state worth browsing back to
// (reject on category/sub_category hard-deletes the row — nothing to browse).
var STATUS_BROWSABLE_DOMAINS = ['inventory', 'item_receipt', 'requisition']

// v_review_queue only ever returns 'pending'/'changes_requested' rows (that's its
// job — the action queue). Browsing 'rejected'/'approved' bypasses the view and
// queries the base table directly, normalized into the same item shape.
var BASE_TABLE = {
  inventory: { table: 'inventory_items', titleCol: 'name', submittedByCol: 'submitted_by', tagCols: 'category_id, sub_category_id, department, image_path' },
  item_receipt: { table: 'catering_store_items', titleCol: 'name', submittedByCol: 'submitted_by', tagCols: 'category_id, sub_category_id, department, image_path' },
  requisition: { table: 'requisitions', titleCol: 'purpose', submittedByCol: 'requested_by', tagCols: 'category_id, sub_category_id, department, expense_type_id, expense_sub_type_id, req_type, expense_amount_paise' },
}

function emptyCounts() {
  var c = {}
  ALL_DOMAINS.forEach(function (d) { c[d] = 0 })
  return c
}

function selectionKey(item) {
  return item.domain + ':' + item.source_id
}

// review_scopes tag match for the "my tags only" narrowing toggle — this is a
// client-side convenience filter on top of whatever RLS already restricted the
// rows to (relevant mainly for admin/auditor, who see every row and may want to
// focus on just their own assigned area). Empty/missing scope arrays = no filter,
// same "empty = see all" rule the server side uses.
function matchesMyTags(item, domain, reviewScopes) {
  var scopes = reviewScopes || {}
  var tags = item.tags || {}
  if (domain === 'inventory' || domain === 'item_receipt') {
    var categories = scopes.categories || []
    if (categories.length === 0) return true
    return categories.indexOf(tags.category_id) !== -1
  }
  if (domain === 'requisition') {
    var depts = scopes.departments || []
    var cats2 = scopes.categories || []
    var deptOk = depts.length === 0 || depts.indexOf(tags.department) !== -1
    var catOk = cats2.length === 0 || tags.category_id == null || cats2.indexOf(tags.category_id) !== -1
    return deptOk && catOk
  }
  return true
}

function useReviewQueue(profile) {
  var [domain, setDomainRaw] = useState('inventory')
  var [items, setItems] = useState([])
  var [selection, setSelection] = useState(function () { return new Set() })
  var [loading, setLoading] = useState(true)
  var [error, setError] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [myTagsOnly, setMyTagsOnly] = useState(true)
  var [search, setSearch] = useState('')
  var [categoryFilter, setCategoryFilter] = useState('')
  var [subCategoryFilter, setSubCategoryFilter] = useState('')
  var [departmentFilter, setDepartmentFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('pending') // 'pending' | 'rejected' | 'approved'
  var [submitterNames, setSubmitterNames] = useState({})
  var [counts, setCounts] = useState(emptyCounts)

  function setDomain(d) {
    setSelection(new Set())
    setSearch(''); setCategoryFilter(''); setSubCategoryFilter(''); setDepartmentFilter(''); setStatusFilter('pending')
    setDomainRaw(d)
  }

  async function resolveSubmitterNames(rows) {
    var ids = Array.from(new Set(rows.map(function (r) { return r.submitted_by }).filter(Boolean)))
    if (ids.length === 0) { setSubmitterNames({}); return {} }
    var res = await supabase.from('profiles').select('id, name, email').in('id', ids)
    var names = {}
    ;(res.data || []).forEach(function (p) { names[p.id] = { name: p.name, email: p.email } })
    setSubmitterNames(names)
    return names
  }

  async function refresh() {
    setLoading(true)
    setError('')
    if (QUEUE_DOMAINS.indexOf(domain) === -1) {
      setItems([])
      setLoading(false)
      return
    }

    var rows
    if (statusFilter === 'pending' || STATUS_BROWSABLE_DOMAINS.indexOf(domain) === -1) {
      var res = await supabase.from('v_review_queue').select('*')
        .eq('domain', domain)
        .order('priority', { ascending: false })
        .order('submitted_at', { ascending: false })
      if (res.error) { setError(res.error.message); setItems([]); setLoading(false); return }
      rows = res.data || []
    } else {
      // Browsing rejected/approved — bypass v_review_queue (it only ever returns
      // pending/changes_requested rows) and query the base table directly.
      var cfg = BASE_TABLE[domain]
      var bres = await supabase.from(cfg.table)
        .select('id, ' + cfg.titleCol + ', ' + cfg.submittedByCol + ', created_at, status, ' + cfg.tagCols)
        .eq('status', statusFilter)
        .order('created_at', { ascending: false })
        .limit(500)
      if (bres.error) { setError(bres.error.message); setItems([]); setLoading(false); return }
      rows = (bres.data || []).map(function (r) {
        return {
          domain: domain,
          source_id: r.id,
          title: r[cfg.titleCol],
          amount_paise: domain === 'requisition' && r.req_type === 'expense' ? r.expense_amount_paise : null,
          vendor_name: null,
          primary_tag: r.category_id != null ? r.category_id : null,
          tags: { category_id: r.category_id, sub_category_id: r.sub_category_id, department: r.department, expense_type_id: r.expense_type_id, expense_sub_type_id: r.expense_sub_type_id, image_path: r.image_path },
          submitted_by: r[cfg.submittedByCol],
          submitted_at: r.created_at,
          venue_id: null,
          status: statusFilter,
          priority: 'normal',
        }
      })
    }

    if (venueFilter) rows = rows.filter(function (r) { return String(r.venue_id) === String(venueFilter) })
    if (myTagsOnly) rows = rows.filter(function (r) { return matchesMyTags(r, domain, profile && profile.review_scopes) })
    if (categoryFilter) rows = rows.filter(function (r) { return String((r.tags || {}).category_id) === categoryFilter })
    if (subCategoryFilter) rows = rows.filter(function (r) { return String((r.tags || {}).sub_category_id) === subCategoryFilter })
    if (departmentFilter) rows = rows.filter(function (r) { return (r.tags || {}).department === departmentFilter })

    var resolvedNames = await resolveSubmitterNames(rows)

    if (search) {
      var q = search.toLowerCase()
      rows = rows.filter(function (r) {
        var s = resolvedNames[r.submitted_by]
        return (r.title || '').toLowerCase().indexOf(q) !== -1
          || (s && s.name && s.name.toLowerCase().indexOf(q) !== -1)
          || (s && s.email && s.email.toLowerCase().indexOf(q) !== -1)
      })
    }

    setItems(rows)
    setLoading(false)
  }

  useEffect(function () {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, venueFilter, myTagsOnly, categoryFilter, subCategoryFilter, departmentFilter, statusFilter, search])

  async function loadCounts() {
    var res = await supabase.from('v_review_queue').select('domain')
    if (res.error) return
    var next = emptyCounts()
    ;(res.data || []).forEach(function (r) { if (next[r.domain] != null) next[r.domain] += 1 })
    setCounts(next)
  }

  useEffect(function () {
    loadCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleSelect(item) {
    var key = selectionKey(item)
    setSelection(function (prev) {
      var next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function clearSelection() { setSelection(new Set()) }
  function selectAll() {
    setSelection(new Set(items.map(selectionKey)))
  }

  return {
    domain: domain, setDomain: setDomain,
    items: items,
    submitterNames: submitterNames,
    selection: selection, toggleSelect: toggleSelect, clearSelection: clearSelection, selectAll: selectAll,
    refresh: function () { refresh(); loadCounts() },
    pending: { loading: loading, error: error },
    counts: counts,
    venueFilter: venueFilter, setVenueFilter: setVenueFilter,
    myTagsOnly: myTagsOnly, setMyTagsOnly: setMyTagsOnly,
    search: search, setSearch: setSearch,
    categoryFilter: categoryFilter, setCategoryFilter: setCategoryFilter,
    subCategoryFilter: subCategoryFilter, setSubCategoryFilter: setSubCategoryFilter,
    departmentFilter: departmentFilter, setDepartmentFilter: setDepartmentFilter,
    statusFilter: statusFilter, setStatusFilter: setStatusFilter,
  }
}

export default useReviewQueue
export { QUEUE_DOMAINS, ALL_DOMAINS, STATUS_BROWSABLE_DOMAINS, selectionKey }
