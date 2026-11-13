import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, formatPointsPlain } from '../../lib/format'
import { computePlateSummary } from '../../lib/plateInfo'
import { cateringMenuLabel } from '../../lib/constants'
import { generateStoreRequisitionReportPdf } from '../../lib/pdf'
import Icon from '../../components/ui/Icon'
import DescriptionNote from '../../components/ui/DescriptionNote'

var CARD = 'bg-white border border-slate-200 rounded-2xl'

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
  // the department just opened: brought into view and briefly outlined, so
  // the jump from the one that closed above it is easy to follow
  var [flashKey, setFlashKey] = useState(null)
  var rowRefs = useRef({})

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
        'store_requisition_casuals(id, casual_type, qty, rate_paise, amount_paise), ' +
        'store_requisition_expense_adjustments(id, amount_paise, remarks, expense_types(name), expense_sub_types(name))')
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
      if (!byKey[k]) { byKey[k] = { key: k, label: deptRowLabel(dr), rows: [], items: [], casuals: [], credits: [], remarks: [] }; order.push(k) }
      var g = byKey[k]
      g.rows.push(dr)
      ;(dr.store_requisition_items || []).forEach(function (it) { g.items.push(it) })
      ;(dr.store_requisition_casuals || []).forEach(function (c) { g.casuals.push(c) })
      ;(dr.store_requisition_expense_adjustments || []).forEach(function (a) { g.credits.push(a) })
      var rk = (dr.remarks || '').trim()
      if (rk && g.remarks.indexOf(rk) === -1) g.remarks.push(rk)
    })
    return order.map(function (k) { return byKey[k] }).map(function (g) {
      var itemsTotal = g.items.reduce(function (s, it) { return s + (it.amount_paise || 0) }, 0)
      var casualsTotal = g.casuals.reduce(function (s, c) { return s + (c.amount_paise || 0) }, 0)
      var creditsTotal = g.credits.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
      return Object.assign({}, g, { itemsTotal: itemsTotal, casualsTotal: casualsTotal, creditsTotal: creditsTotal, rowTotal: itemsTotal + casualsTotal - creditsTotal })
    }).sort(function (a, b) { return a.label.localeCompare(b.label) })
  })()

  var grandTotal = groups.reduce(function (s, g) { return s + g.rowTotal }, 0)
  var totalItems = groups.reduce(function (s, g) { return s + g.items.length }, 0)
  var totalCasuals = groups.reduce(function (s, g) { return s + g.casuals.length }, 0)
  var totalCredits = groups.reduce(function (s, g) { return s + g.credits.length }, 0)

  // one department open at a time: opening another closes the last
  function toggleGroup(k) {
    var opening = !openGroups[k]
    setOpenGroups(opening ? { [k]: true } : {})
    setFlashKey(opening ? k : null)
  }
  useEffect(function () {
    if (!flashKey) return
    var raf = requestAnimationFrame(function () {
      var el = rowRefs.current[flashKey]
      if (!el) return
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    })
    var t = setTimeout(function () { setFlashKey(null) }, 1400)
    return function () { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [flashKey])

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

  var TH = 'px-4 py-2.5 text-[12px] font-medium text-slate-500 whitespace-nowrap'

  // one kind of line (inventory or casual) of an opened department, as a slip
  function linesTable(bar, title, cols, rows, renderRow, subtotal, empty, subtotalText, subtotalTone) {
    return (
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <p className="relative px-3 pt-2.5 pb-2 pl-5 text-[13px] font-bold text-slate-900">
          <span aria-hidden="true" className={'absolute left-3 top-3 bottom-2.5 w-[3px] rounded-full ' + bar} />
          {title} {rows.length > 0 && <span className="font-medium text-slate-500">{rows.length}</span>}
        </p>
        {rows.length === 0 ? (
          <p className="px-3 pb-3 text-[12.5px] text-slate-500">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-slate-100">
                  {cols.map(function (c, i) { return <th key={c} className={'px-3 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap ' + (i === 0 ? 'text-left' : 'text-right')}>{c}</th> })}
                </tr>
              </thead>
              <tbody>{rows.map(renderRow)}</tbody>
              <tfoot>
                <tr className="border-t border-dashed border-slate-300">
                  <td colSpan={cols.length - 1} className="px-3 py-2 text-[12.5px] font-medium text-slate-500">Subtotal</td>
                  <td className={'px-3 py-2 text-right text-[13.5px] font-bold tabular-nums ' + (subtotalTone || 'text-slate-900')}>{subtotalText || formatPointsPlain(subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold text-slate-900 tracking-[-0.01em]">
            {dateFrom === dateTo ? formatDate(dateFrom) : (formatDate(dateFrom) + ' – ' + formatDate(dateTo))}
          </h2>
          <p className="text-[12.5px] text-slate-500">
            Period report of {linkFilter === 'linked' ? 'linked' : 'not linked'} requisitions: {reqs.length} merged into one view
          </p>
        </div>
        <button onClick={exportPdf} disabled={exporting || loading}
          className="shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13.5px] font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 shadow-[0_8px_20px_-10px_rgba(109,40,217,0.7)] hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-colors">
          <Icon name="download" size={15} />
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {reqs.length === 0 ? (
        <div className={CARD + ' p-8 text-center'}><p className="text-slate-500 text-sm">No store requisitions match these filters.</p></div>
      ) : loading ? (
        <p className="text-slate-400 text-sm text-center py-8">Loading…</p>
      ) : (
        <>
          {/* Plates on the left, the total as the one dark block (as on a single requisition) */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className={CARD + ' p-4'}>
              {plateLoading ? (
                <p className="text-sm text-slate-400 py-2">Loading plate counts…</p>
              ) : plateSummary ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[['Booked plates', plateSummary.booking, false], ['Extra plates', plateSummary.extra, false], ['Returned plates', plateSummary.balance, false], ['Actual plates', plateSummary.actual, true]].map(function (st) {
                    return (
                      <div key={st[0]} className={'rounded-xl px-3.5 py-2.5 ' + (st[2] ? 'bg-violet-50 border border-violet-100' : 'bg-slate-50')}>
                        <p className={'text-[12px] font-medium ' + (st[2] ? 'text-violet-700' : 'text-slate-500')}>{st[0]}</p>
                        <p className={'mt-0.5 text-[22px] font-bold tabular-nums leading-tight ' + (st[2] ? 'text-violet-800' : 'text-slate-900')}>{st[1]}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-2">No functions linked in this period, so there are no plate counts.</p>
              )}
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-[#2A2550] to-[#3A3170] px-5 py-4 text-white flex flex-col justify-center shadow-[0_12px_30px_-14px_rgba(42,37,80,0.6)]">
              <p className="text-[12.5px] font-medium text-white/70">Total</p>
              <p className="text-[26px] font-bold tabular-nums leading-tight">{formatPoints(totalPaise)}</p>
              <p className="mt-1 text-[12px] text-white/60">{reqs.length} requisition{reqs.length === 1 ? '' : 's'}, {groups.length} dept{groups.length === 1 ? '' : 's'}</p>
            </div>
          </div>

          {linkedEvents.length > 0 && (
            <div className={CARD + ' p-4'}>
              <p className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
                <Icon name="link" size={15} className="text-emerald-600" />
                Linked functions <span className="font-medium text-slate-500">{linkedEvents.length}</span>
              </p>
              {/* An even grid of same-size cards: name and menu on one line, venue and date under it */}
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {linkedEvents.map(function (e) {
                  var menu = cateringMenuLabel(e.catering)
                  return (
                    <div key={e.id} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <p className="min-w-0 truncate text-[13px] font-bold text-slate-900" title={e.event_name || e.client_name || ''}>{e.event_name || e.client_name || 'Event #' + e.id}</p>
                        {menu && <span className="shrink-0 max-w-[55%] truncate text-[11.5px] font-semibold text-amber-800 bg-amber-50 rounded px-1.5 py-0.5" title={menu}>{menu}</span>}
                      </div>
                      <p className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-slate-500">
                        <span className="min-w-0 truncate">{e.venue_name || '—'}</span>
                        <span className="shrink-0 tabular-nums">{e.function_date ? formatDate(e.function_date) : ''}</span>
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <div className={CARD + ' p-8 text-center'}><p className="text-slate-500 text-sm">No department rows in this period.</p></div>
          ) : (
            <div className={CARD + ' overflow-hidden'}>
              <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
                <p className="text-[15px] font-bold text-slate-900">Department breakdown</p>
                <p className="text-[12px] text-slate-500">Open a department to see its lines</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-y border-slate-100">
                      <th className={TH + ' text-left'}>Department</th>
                      <th className={TH + ' text-right'}>Amount</th>
                      <th className={TH + ' text-right'}>Per actual plate</th>
                      <th className={TH + ' text-right'}>Per booked plate</th>
                      <th className={TH + ' text-right'}>Items</th>
                      <th className={TH + ' text-right'}>Casuals</th>
                      <th className={TH + ' text-right'}>Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(function (g) {
                      var isOpen = !!openGroups[g.key]
                      return (
                        <React.Fragment key={g.key}>
                          <tr ref={function (el) { rowRefs.current[g.key] = el }} onClick={function () { toggleGroup(g.key) }} aria-expanded={isOpen}
                            className={'cursor-pointer scroll-mt-24 border-b transition-[background-color,box-shadow] duration-500 ' +
                              (isOpen ? 'bg-violet-100/80 border-violet-200 ' : 'border-slate-100 hover:bg-slate-50 ') +
                              (flashKey === g.key ? 'shadow-[inset_0_0_0_2px_rgb(139,92,246)]' : '')}>
                            <td className={'relative px-4 py-3 text-[13.5px] font-semibold ' + (isOpen ? 'text-violet-900' : 'text-slate-900')}>
                              {isOpen && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-violet-600" />}
                              <span className="inline-flex items-center gap-2 flex-wrap">
                                <Icon name="chevronRight" size={13} className={'text-slate-400 transition-transform ' + (isOpen ? 'rotate-90 text-violet-600' : '')} />
                                {g.label}
                                {g.rows.length > 1 && (
                                  <span className="text-[11.5px] font-medium text-violet-700 bg-violet-100/70 rounded-md px-1.5 py-0.5">{g.rows.length} entries merged</span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-[14px] font-bold text-violet-700 tabular-nums">{formatPointsPlain(g.rowTotal)}</td>
                            <td className="px-4 py-3 text-right text-[13px] text-slate-600 tabular-nums">{plateSummary ? rateOrDash(g.rowTotal, plateSummary.actual) : '—'}</td>
                            <td className="px-4 py-3 text-right text-[13px] text-slate-600 tabular-nums">{plateSummary ? rateOrDash(g.rowTotal, plateSummary.booking) : '—'}</td>
                            <td className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700 tabular-nums">{g.items.length}</td>
                            <td className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700 tabular-nums">{g.casuals.length}</td>
                            <td className={'px-4 py-3 text-right text-[13px] font-semibold tabular-nums ' + (g.credits.length ? 'text-emerald-700' : 'text-slate-700')}>{g.credits.length}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-slate-100">
                              <td colSpan={7} className="relative px-4 py-3.5 bg-violet-50/40 border-b-2 border-violet-200">
                                <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-violet-600" />
                                {g.remarks.length > 0 && (
                                  <DescriptionNote text={g.remarks.join(' · ')} label="Remarks" truncate={false} className="mb-3" />
                                )}
                                <div className="space-y-3">
                                  {linesTable('bg-violet-500', 'Inventory', ['Item', 'Qty', 'Rate', 'Amount'], g.items, function (it) {
                                    return (
                                      <tr key={it.id} className="border-b border-slate-100 last:border-0">
                                        <td className="px-3 py-2">
                                          <p className="text-[13px] font-semibold text-slate-900">{it.item_name}</p>
                                          {it.item_source === 'inventory' && <p className="text-[11.5px] text-slate-500">Inventory</p>}
                                        </td>
                                        <td className="px-3 py-2 text-right text-[12.5px] text-slate-700 tabular-nums whitespace-nowrap">{it.qty} <span className="text-slate-500">{it.unit}</span></td>
                                        <td className="px-3 py-2 text-right text-[12.5px] text-slate-600 tabular-nums">{it.rate_paise ? formatPointsPlain(it.rate_paise) : '—'}</td>
                                        <td className="px-3 py-2 text-right text-[13.5px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(it.amount_paise)}</td>
                                      </tr>
                                    )
                                  }, g.itemsTotal, 'No inventory taken out.')}
                                  <div className="grid gap-3 xl:grid-cols-2">
                                    {linesTable('bg-sky-500', 'Casual labour', ['Role', 'Qty', 'Rate', 'Amount'], g.casuals, function (c) {
                                      return (
                                        <tr key={c.id} className="border-b border-slate-100 last:border-0">
                                          <td className="px-3 py-2 text-[13px] font-semibold text-slate-900">{c.casual_type}</td>
                                          <td className="px-3 py-2 text-right text-[12.5px] text-slate-700 tabular-nums">{c.qty}</td>
                                          <td className="px-3 py-2 text-right text-[12.5px] text-slate-600 tabular-nums">{formatPointsPlain(c.rate_paise)}</td>
                                          <td className="px-3 py-2 text-right text-[13.5px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(c.amount_paise)}</td>
                                        </tr>
                                      )
                                    }, g.casualsTotal, 'No casual labour on this department.')}
                                    {linesTable('bg-emerald-500', 'Expense credits', ['Expense', 'Remarks', 'Credit'], g.credits, function (cr) {
                                      var type = (cr.expense_types && cr.expense_types.name) || 'Expense'
                                      var sub = cr.expense_sub_types && cr.expense_sub_types.name
                                      return (
                                        <tr key={cr.id} className="border-b border-slate-100 last:border-0">
                                          <td className="px-3 py-2">
                                            <p className="text-[13px] font-semibold text-slate-900">{type}</p>
                                            {sub && <p className="text-[11.5px] text-slate-500">{sub}</p>}
                                          </td>
                                          <td className="px-3 py-2 text-right text-[12.5px] text-slate-600">{cr.remarks || '—'}</td>
                                          <td className="px-3 py-2 text-right text-[13.5px] font-bold text-emerald-700 tabular-nums">−{formatPointsPlain(cr.amount_paise)}</td>
                                        </tr>
                                      )
                                    }, g.creditsTotal, 'No expense credits on this department.', '−' + formatPointsPlain(g.creditsTotal), 'text-emerald-700')}
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
                    <tr className="border-t border-dashed border-slate-300">
                      <td className="px-4 py-3 text-[13.5px] font-bold text-slate-900">Total</td>
                      <td className="px-4 py-3 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(grandTotal)}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{plateSummary ? rateOrDash(grandTotal, plateSummary.actual) : '—'}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{plateSummary ? rateOrDash(grandTotal, plateSummary.booking) : '—'}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{totalItems}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{totalCasuals}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{totalCredits}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StoreRequisitionReport
