import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// v_review_queue only unions the 3 stateful domains (inventory, item_receipt,
// requisition) — expense and vendor_payment are read-only audit domains with no
// "pending" concept, so they never appear in the queue or contribute to counts.
// Their tabs read directly from expenses / ledger_entries via their own adapter
// (see adapters/expense.js, adapters/vendorPayment.js).
var QUEUE_DOMAINS = ['inventory', 'item_receipt', 'requisition']
var ALL_DOMAINS = ['inventory', 'item_receipt', 'expense', 'requisition', 'vendor_payment']

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
  var [counts, setCounts] = useState(emptyCounts)

  function setDomain(d) {
    setSelection(new Set())
    setDomainRaw(d)
  }

  async function refresh() {
    setLoading(true)
    setError('')
    if (QUEUE_DOMAINS.indexOf(domain) === -1) {
      setItems([])
      setLoading(false)
      return
    }
    var res = await supabase.from('v_review_queue').select('*')
      .eq('domain', domain)
      .order('priority', { ascending: false })
      .order('submitted_at', { ascending: false })
    if (res.error) {
      setError(res.error.message)
      setItems([])
      setLoading(false)
      return
    }
    var rows = res.data || []
    if (venueFilter) rows = rows.filter(function (r) { return String(r.venue_id) === String(venueFilter) })
    if (myTagsOnly) rows = rows.filter(function (r) { return matchesMyTags(r, domain, profile && profile.review_scopes) })
    setItems(rows)
    setLoading(false)
  }

  useEffect(function () {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, venueFilter, myTagsOnly])

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
    selection: selection, toggleSelect: toggleSelect, clearSelection: clearSelection, selectAll: selectAll,
    refresh: function () { refresh(); loadCounts() },
    pending: { loading: loading, error: error },
    counts: counts,
    venueFilter: venueFilter, setVenueFilter: setVenueFilter,
    myTagsOnly: myTagsOnly, setMyTagsOnly: setMyTagsOnly,
  }
}

export default useReviewQueue
export { QUEUE_DOMAINS, ALL_DOMAINS, selectionKey }
