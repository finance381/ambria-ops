import { useState, useEffect, useMemo } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatDate, formatPaise } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'

function InventoryLedger({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = profile && (profile.role === 'admin' || profile.role === 'auditor')
  var canView = isAdmin || perms.indexOf('feature_inventory_ledger') !== -1

  var [items, setItems] = useState([])
  var [history, setHistory] = useState([])
  var [loading, setLoading] = useState(true)
  var [selectedItem, setSelectedItem] = useState(null)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')
  var [sourceFilter, setSourceFilter] = useState('')

  useEffect(function () {
    if (canView) loadAll()
    else setLoading(false)
  }, [])

  useRealtime(['inventory_items', 'catering_store_items', 'purchase_order_items', 'expenses'], function () {
    if (canView) loadAll()
  })

  async function loadAll() {
    setLoading(true)
    try {
      var results = await Promise.all([
        fetchAll(supabase.from('inventory_items')
          .select('id, name, inventory_id, rate_paise, categories(id, name), sub_categories(id, name), venue_allocations(qty)')
          .order('name', { ascending: true })),
        fetchAll(supabase.from('catering_store_items')
          .select('id, name, inventory_id, rate_paise, categories(id, name), sub_categories(id, name), cs_venue_allocations(qty)')
          .order('name', { ascending: true })),
        fetchAll(supabase.from('v_item_purchase_history')
          .select('item_id, item_source, vendor_name, qty, unit, rate_paise, amount_paise, txn_date, source_type, source_ref'))
      ])
      var invRes = results[0] || []
      var csRes = results[1] || []
      var histRes = results[2] || []

      var merged = []
      invRes.forEach(function (r) {
        var qty = (r.venue_allocations || []).reduce(function (s, a) { return s + Number(a.qty || 0) }, 0)
        merged.push({
          _key: 'inventory:' + r.id,
          _source: 'inventory',
          id: r.id,
          name: r.name || '',
          code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '',
          subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0,
          live_qty: qty
        })
      })
      csRes.forEach(function (r) {
        var qty = (r.cs_venue_allocations || []).reduce(function (s, a) { return s + Number(a.qty || 0) }, 0)
        merged.push({
          _key: 'catering_store:' + r.id,
          _source: 'catering_store',
          id: r.id,
          name: r.name || '',
          code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '',
          subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0,
          live_qty: qty
        })
      })
      merged.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })

      setItems(merged)
      setHistory(histRes)
    } catch (e) {
      console.error('INVENTORY_LEDGER_LOAD_FAIL', e)
    }
    setLoading(false)
  }

  var historyByItem = useMemo(function () {
    var m = {}
    history.forEach(function (h) {
      var k = h.item_source + ':' + h.item_id
      if (!m[k]) m[k] = []
      m[k].push(h)
    })
    Object.keys(m).forEach(function (k) {
      m[k].sort(function (a, b) {
        var da = a.txn_date || '0000-00-00'
        var db = b.txn_date || '0000-00-00'
        return db.localeCompare(da)
      })
    })
    return m
  }, [history])

  function aggregateItem(item) {
    var rows = historyByItem[item._key] || []
    var vendors = []
    var totalSpend = 0
    var totalQty = 0
    var bestRate = null
    rows.forEach(function (r) {
      if (r.vendor_name && vendors.indexOf(r.vendor_name) === -1) vendors.push(r.vendor_name)
      totalSpend += Number(r.amount_paise || 0)
      totalQty += Number(r.qty || 0)
      if (r.rate_paise != null && (bestRate == null || r.rate_paise < bestRate)) bestRate = r.rate_paise
    })
    var avgRate = totalQty > 0 ? Math.round(totalSpend / totalQty) : null
    return {
      vendors: vendors,
      last3: rows.slice(0, 3),
      totalSpend: totalSpend,
      totalQty: totalQty,
      txnCount: rows.length,
      avgRate: avgRate,
      bestRate: bestRate,
      allRows: rows
    }
  }

  var allCats = useMemo(function () {
    var s = {}
    items.forEach(function (i) { if (i.cat) s[i.cat] = true })
    return Object.keys(s).sort()
  }, [items])

  var allSubCats = useMemo(function () {
    var s = {}
    items.forEach(function (i) {
      if (i.subcat && (!catFilter || i.cat === catFilter)) s[i.subcat] = true
    })
    return Object.keys(s).sort()
  }, [items, catFilter])

  var filteredItems = useMemo(function () {
    var q = search.trim().toLowerCase()
    return items.filter(function (i) {
      if (sourceFilter && i._source !== sourceFilter) return false
      if (catFilter && i.cat !== catFilter) return false
      if (subCatFilter && i.subcat !== subCatFilter) return false
      if (q) {
        var hay = (i.name + ' ' + (i.code || '') + ' ' + (i.cat || '') + ' ' + (i.subcat || '')).toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      return true
    })
  }, [items, search, catFilter, subCatFilter, sourceFilter])

  if (!canView) {
    return <div className="text-center py-12 text-sm text-gray-500">You don't have permission to view the Inventory Ledger.</div>
  }

  if (loading) return <div className="text-center py-12 text-sm text-gray-400">Loading...</div>

  if (selectedItem) {
    var agg = aggregateItem(selectedItem)
    return (
      <div>
        <button onClick={function () { setSelectedItem(null) }}
          className="text-sm text-indigo-600 hover:text-indigo-800 mb-3 font-semibold">← Back to items</button>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex items-start justify-between pb-3 border-b border-gray-100 flex-wrap gap-2">
            <div>
              <div className="text-lg font-bold text-gray-900">{selectedItem.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {selectedItem.code}
                {selectedItem.cat && <span> · {selectedItem.cat}{selectedItem.subcat ? ' › ' + selectedItem.subcat : ''}</span>}
                {selectedItem.rate_paise > 0 && <span> · Master rate: {formatPaise(selectedItem.rate_paise)}</span>}
                {selectedItem._source === 'catering_store' && <span className="ml-1 text-purple-600 font-semibold">· Catering</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Total spend (all-time)</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{formatPaise(agg.totalSpend)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Transactions</div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">{agg.txnCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Total qty purchased</div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">{agg.totalQty || 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Avg rate</div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">{agg.avgRate != null ? formatPaise(agg.avgRate) : '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Best rate</div>
              <div className="text-sm font-semibold text-green-700 mt-0.5">{agg.bestRate != null ? formatPaise(agg.bestRate) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-200">Purchase history</div>
          {agg.allRows.length === 0 && <div className="text-center text-sm text-gray-400 py-8">No purchase history for this item.</div>}
          {agg.allRows.length > 0 && (
            <div>
              <div className="grid grid-cols-[90px_1fr_70px_90px_100px_90px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-100">
                <div>Date</div><div>Vendor</div><div className="text-right">Qty</div><div className="text-right">Rate</div><div className="text-right">Amount</div><div className="text-right">Source</div>
              </div>
              {agg.allRows.map(function (h, i) {
                var srcColor = h.source_type === 'po' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'
                return (
                  <div key={i} className="grid grid-cols-[90px_1fr_70px_90px_100px_90px] gap-2 px-4 py-2 text-xs border-b border-gray-50 items-center">
                    <div className="text-gray-600">{h.txn_date ? formatDate(h.txn_date) : '—'}</div>
                    <div className="font-semibold text-gray-900 truncate">{h.vendor_name || '—'}</div>
                    <div className="text-right font-semibold text-gray-900">{Number(h.qty || 0)}{h.unit ? ' ' + h.unit : ''}</div>
                    <div className="text-right font-semibold text-gray-900">{formatPaise(h.rate_paise || 0)}</div>
                    <div className="text-right font-semibold text-gray-900">{formatPaise(h.amount_paise || 0)}</div>
                    <div className="text-right"><span className={"inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold " + srcColor}>{h.source_ref}</span></div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 space-y-2">
        <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search items, code, category..."
          style={{ fontSize: '16px' }}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <select value={sourceFilter} onChange={function (e) { setSourceFilter(e.target.value) }}
            style={{ fontSize: '16px' }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">All sources</option>
            <option value="inventory">Inventory</option>
            <option value="catering_store">Catering Store</option>
          </select>
          <select value={catFilter} onChange={function (e) { setCatFilter(e.target.value); setSubCatFilter('') }}
            style={{ fontSize: '16px' }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">All categories</option>
            {allCats.map(function (c) { return <option key={c} value={c}>{c}</option> })}
          </select>
          <select value={subCatFilter} onChange={function (e) { setSubCatFilter(e.target.value) }}
            style={{ fontSize: '16px' }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">All sub-categories</option>
            {allSubCats.map(function (s) { return <option key={s} value={s}>{s}</option> })}
          </select>
          <div className="px-3 py-2 text-xs text-gray-500 flex items-center">
            {filteredItems.length} of {items.length} items
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {filteredItems.slice(0, 200).map(function (item) {
          var a = aggregateItem(item)
          var value = (item.live_qty || 0) * (item.rate_paise || 0)
          return (
            <button key={item._key} onClick={function () { setSelectedItem(item) }}
              className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_70px_90px_100px] gap-2 lg:gap-3 items-center">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {item.code}
                    {item.cat && <span> · {item.cat}{item.subcat ? ' › ' + item.subcat : ''}</span>}
                    {item._source === 'catering_store' && <span className="ml-1 text-purple-600 font-semibold">· Catering</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Qty</div>
                  <div className="text-sm font-semibold text-gray-900">{item.live_qty || 0}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Rate</div>
                  <div className="text-sm font-semibold text-gray-900">{item.rate_paise > 0 ? formatPaise(item.rate_paise) : '—'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Value</div>
                  <div className="text-sm font-semibold text-gray-900">{value > 0 ? formatPaise(value) : '—'}</div>
                </div>
              </div>

              {a.txnCount > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3 lg:gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Vendors ({a.vendors.length})</div>
                    <div>
                      {a.vendors.slice(0, 4).map(function (v) {
                        return <span key={v} className="inline-block text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded mr-1 mb-1 font-semibold">{v}</span>
                      })}
                      {a.vendors.length > 4 && <span className="text-[10px] text-gray-400 font-semibold">+{a.vendors.length - 4}</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Last 3 purchases</div>
                    {a.last3.map(function (h, i) {
                      return (
                        <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] py-0.5 items-baseline">
                          <span className="font-semibold text-gray-900 truncate">{h.vendor_name || '—'}</span>
                          <span className="font-semibold text-gray-900">{formatPaise(h.rate_paise || 0)}</span>
                          <span className="text-[10px] text-gray-400">{h.txn_date ? formatDate(h.txn_date) : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {a.txnCount === 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-400">No purchase history</div>
              )}
            </button>
          )
        })}
        {filteredItems.length > 200 && (
          <div className="text-center text-xs text-gray-500 py-3">Showing first 200 items. Refine filters to narrow down.</div>
        )}
        {filteredItems.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">No items match your filters.</div>
        )}
      </div>
    </div>
  )
}

export default InventoryLedger