import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, formatPointsPlain } from '../../lib/format'
import { computePlateSummary } from '../../lib/plateInfo'
import { cateringMenuLabel } from '../../lib/constants'
import { generateStoreRequisitionReportPdf } from '../../lib/pdf'
import Icon from '../../components/ui/Icon'
import DescriptionNote from '../../components/ui/DescriptionNote'

var CARD = 'bg-white border border-gray-200 rounded-2xl'

function rateOrDash(amountPaise, plateCount) {
  if (!plateCount) return '—'
  return formatPointsPlain(Math.round(amountPaise / plateCount))
}

function deptRowLabel(dr) {
  var dept = (dr.departments && dr.departments.name) || 'Unknown dept'
  var sub = dr.sub_departments && dr.sub_departments.name
  var label = sub ? dept + ' – ' + sub : dept
  if (dr.section) label += ' (' + dr.section + ')'
  return label
}

// The team was asked to put one department's entries in one row, but nothing
// stopped a second slip for the same department landing in its own row —
// this groups every store_requisition_dept_row in the selected period back
// down to one row per (department, sub-department, section), the same triple
// deptRowLabel already renders as a single label. Deliberately NOT also
// summing same-named inventory lines within a group: two "Egg (Anda)" lines
// a week apart can carry different rates, and silently adding their
// quantities together would hide that instead of showing it. Every original
// line stays visible; only the department-level row collapses.
function groupKey(dr) {
  return (dr.department_id || '') + '|' + (dr.sub_department_id || '') + '|' + (dr.section || '')
}

function StoreRequisitionReport({ reqs, dateFrom, dateTo, linkFilter }) {
  var [loading, setLoading] = useState(true)
  var [deptRows, setDeptRows] = useState([])
  var [plateSummary, setPlateSummary] = useState(null)
  var [plateLoading, setPlateLoading] = useState(false)
  var [linkedEvents, setLinkedEvents] = useState([])
  var [openGroups, setOpenGroups] = useState({})
  var [exporting, setExporting] = useState(false)

  var reqIds = reqs.map(function (r) { return r.id })
  var reqIdsKey = reqIds.slice().sort().join(',')

  var allEventIds = []
  reqs.forEach(function (r) {
    (r.event_ids || []).forEach(function (id) { if (allEventIds.indexOf(id) === -1) allEventIds.push(id) })
  })
  var allEventIdsKey = allEventIds.slice().sort().join(',')

  useEffect(function () {
    if (reqIds.length === 0) { setDeptRows([]); setLoading(false); return }
    setLoading(true)
    supabase.from('store_requisition_dept_rows')
      .select('id, store_requisition_id, department_id, sub_department_id, section, remarks, departments(name), sub_departments(name), ' +
        'store_requisition_items(id, item_name, item_source, unit, qty, rate_paise, amount_paise), ' +
        'store_requisition_casuals(id, casual_type, qty, rate_paise, amount_paise)')
      .in('store_requisition_id', reqIds)
      .then(function (res) {
        setDeptRows(res.data || [])
        setLoading(false)
      })
  }, [reqIdsKey])

  useEffect(function () {
    if (allEventIds.length === 0) { setPlateSummary(null); setLinkedEvents([]); return }
    setPlateLoading(true)
    Promise.all([
      computePlateSummary(allEventIds),
      supabase.from('events_safe').select('id, event_name, client_name, venue_name, function_date, catering').in('id', allEventIds),
    ]).then(function (res) {
      setPlateSummary(res[0])
      setLinkedEvents((res[1].data || []).slice().sort(function (a, b) {
        return new Date(a.function_date || 0) - new Date(b.function_date || 0)
      }))
      setPlateLoading(false)
    })
  }, [allEventIdsKey])

  var totalPaise = reqs.reduce(function (s, r) { return s + (r.total_paise || 0) }, 0)

  var groups = (function () {
    var byKey = {}
    var order = []
    deptRows.forEach(function (dr) {
      var k = groupKey(dr)
      if (!byKey[k]) { byKey[k] = { key: k, label: deptRowLabel(dr), rows: [], items: [], casuals: [], remarks: [] }; order.push(k) }
      var g = byKey[k]
      g.rows.push(dr)
      ;(dr.store_requisition_items || []).forEach(function (it) { g.items.push(it) })
      ;(dr.store_requisition_casuals || []).forEach(function (c) { g.casuals.push(c) })
      var rk = (dr.remarks || '').trim()
      if (rk && g.remarks.indexOf(rk) === -1) g.remarks.push(rk)
    })
    return order.map(function (k) { return byKey[k] }).map(function (g) {
      var itemsTotal = g.items.reduce(function (s, it) { return s + (it.amount_paise || 0) }, 0)
      var casualsTotal = g.casuals.reduce(function (s, c) { return s + (c.amount_paise || 0) }, 0)
      return Object.assign({}, g, { rowTotal: itemsTotal + casualsTotal })
    }).sort(function (a, b) { return a.label.localeCompare(b.label) })
  })()

  var grandTotal = groups.reduce(function (s, g) { return s + g.rowTotal }, 0)
  var totalItems = groups.reduce(function (s, g) { return s + g.items.length }, 0)
  var totalCasuals = groups.reduce(function (s, g) { return s + g.casuals.length }, 0)

  function toggleGroup(k) { setOpenGroups(function (prev) { return Object.assign({}, prev, { [k]: !prev[k] }) }) }

  async function exportPdf() {
    setExporting(true)
    try {
      await generateStoreRequisitionReportPdf({
        dateFrom: dateFrom, dateTo: dateTo, linkFilter: linkFilter,
        reqCount: reqs.length, totalPaise: totalPaise,
        plateSummary: plateSummary, linkedEvents: linkedEvents, groups: groups,
      })
    } catch (e) { alert('Export failed: ' + e.message) }
    setExporting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Period report</p>
          <h2 className="text-lg font-bold text-gray-900">
            {dateFrom === dateTo ? formatDate(dateFrom) : (formatDate(dateFrom) + ' – ' + formatDate(dateTo))}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {linkFilter === 'linked' ? 'Linked' : 'Unlinked'} requisitions only · {reqs.length} requisition{reqs.length === 1 ? '' : 's'} merged into this report
          </p>
        </div>
        <button onClick={exportPdf} disabled={exporting || loading}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0">
          <Icon name="download" size={14} />
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {reqs.length === 0 ? (
        <div className={CARD + ' p-8 text-center'}><p className="text-gray-400 text-sm">No store requisitions match these filters.</p></div>
      ) : loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : (
        <>
          <div className={CARD + ' p-4'}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Requisitions</p><p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{reqs.length}</p></div>
              <div><p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Total</p><p className="text-lg font-bold text-indigo-600 tabular-nums mt-0.5">{formatPoints(totalPaise)}</p></div>
              {plateLoading ? (
                <div className="col-span-2 sm:col-span-1 lg:col-span-4"><p className="text-xs text-gray-400 mt-2.5">Loading plate counts…</p></div>
              ) : plateSummary ? (
                <>
                  <div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Booking plate</p><p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.booking}</p></div>
                  <div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Extra plate</p><p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.extra}</p></div>
                  <div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Returned</p><p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.balance}</p></div>
                  <div><p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Actual plate</p><p className="text-lg font-bold text-indigo-600 tabular-nums mt-0.5">{plateSummary.actual}</p></div>
                </>
              ) : (
                <div className="col-span-2 sm:col-span-1 lg:col-span-4"><p className="text-xs text-gray-400 mt-2.5">No linked contracts in this period — plate counts unavailable.</p></div>
              )}
            </div>
          </div>

          {linkedEvents.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Linked functions · {linkedEvents.length}</p>
              <div className="flex flex-wrap gap-1.5">
                {linkedEvents.map(function (e) {
                  var menu = cateringMenuLabel(e.catering)
                  return (
                    <div key={e.id} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11.5px]">
                      <span className="font-bold text-gray-900">{e.event_name || e.client_name || 'Event #' + e.id}</span>
                      <span className="text-gray-400"> · {e.venue_name || '—'}{e.function_date ? ' · ' + formatDate(e.function_date) : ''}{menu ? ' · ' + menu : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-gray-800">Department breakdown</p>
            <p className="text-xs text-gray-400">Tap a row to see its merged inventory and casual-labour lines</p>
          </div>

          {groups.length === 0 ? (
            <div className={CARD + ' p-8 text-center'}><p className="text-gray-400 text-sm">No department rows in this period.</p></div>
          ) : (
            <div className={CARD + ' overflow-x-auto'}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3.5 py-2.5 text-left text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Department</th>
                    <th className="px-3.5 py-2.5 text-right text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Amount</th>
                    <th className="px-3.5 py-2.5 text-right text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">pts / actual plate</th>
                    <th className="px-3.5 py-2.5 text-right text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">pts / booked plate</th>
                    <th className="px-3.5 py-2.5 text-right text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Items</th>
                    <th className="px-3.5 py-2.5 text-right text-[10.5px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Casuals</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(function (g) {
                    var isOpen = !!openGroups[g.key]
                    return (
                      <React.Fragment key={g.key}>
                        <tr onClick={function () { toggleGroup(g.key) }}
                          className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-3.5 py-2.5 text-sm font-semibold text-gray-900">
                            <span className="inline-flex items-center gap-1.5">
                              <Icon name="chevronRight" size={11} className={'text-gray-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                              {g.label}
                              {g.rows.length > 1 && (
                                <span className="text-[9.5px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5">
                                  merged · {g.rows.length} entries
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right text-sm font-bold text-indigo-600 tabular-nums">{formatPointsPlain(g.rowTotal)}</td>
                          <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular-nums">{plateSummary ? rateOrDash(g.rowTotal, plateSummary.actual) : '—'}</td>
                          <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular-nums">{plateSummary ? rateOrDash(g.rowTotal, plateSummary.booking) : '—'}</td>
                          <td className="px-3.5 py-2.5 text-right"><span className="inline-flex items-center h-5 px-2 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{g.items.length}</span></td>
                          <td className="px-3.5 py-2.5 text-right"><span className="inline-flex items-center h-5 px-2 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{g.casuals.length}</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-gray-100 last:border-0 bg-gray-50/60">
                            <td colSpan={6} className="px-3.5 py-3">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div>
                                  {g.remarks.length > 0 && (
                                    <DescriptionNote text={g.remarks.join(' · ')} label="Remarks" truncate={false} className="mb-3" />
                                  )}
                                  {g.items.length > 0 ? (
                                    <>
                                      <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Inventory items</p>
                                      <div className="space-y-1.5">
                                        {g.items.map(function (it) {
                                          return (
                                            <div key={it.id} className="flex items-start justify-between gap-2 border-t border-gray-100 pt-1.5 first:border-0 first:pt-0">
                                              <div className="min-w-0">
                                                <p className="text-xs font-semibold text-gray-800 truncate">{it.item_name}</p>
                                                <p className="text-[10.5px] text-gray-400">{(it.item_source === 'inventory' ? 'Inventory' : 'Catering Store') + ' · ' + it.unit + ' · qty ' + it.qty}</p>
                                              </div>
                                              <p className="shrink-0 text-xs font-bold text-gray-900 tabular-nums">{formatPointsPlain(it.amount_paise)}</p>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </>
                                  ) : (
                                    <p className="text-xs text-gray-400">No inventory items.</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Casual labour</p>
                                  {g.casuals.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {g.casuals.map(function (c) {
                                        return (
                                          <div key={c.id} className="flex items-start justify-between gap-2 border-t border-gray-100 pt-1.5 first:border-0 first:pt-0">
                                            <div className="min-w-0">
                                              <p className="text-xs font-semibold text-gray-800 truncate">{c.casual_type}</p>
                                              <p className="text-[10.5px] text-gray-400">{'qty ' + c.qty + ' · ' + formatPointsPlain(c.rate_paise) + ' each'}</p>
                                            </div>
                                            <p className="shrink-0 text-xs font-bold text-gray-900 tabular-nums">{formatPointsPlain(c.amount_paise)}</p>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-gray-400">No casual labour.</p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-3.5 py-2.5 text-sm font-bold text-gray-800">Total</td>
                    <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-900 tabular-nums">{formatPointsPlain(grandTotal)}</td>
                    <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">{plateSummary ? rateOrDash(grandTotal, plateSummary.actual) : '—'}</td>
                    <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">{plateSummary ? rateOrDash(grandTotal, plateSummary.booking) : '—'}</td>
                    <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">{totalItems}</td>
                    <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">{totalCasuals}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StoreRequisitionReport
