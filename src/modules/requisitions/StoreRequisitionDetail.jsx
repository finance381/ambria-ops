import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, formatPointsPlain } from '../../lib/format'
import { computePlateSummary } from '../../lib/plateInfo'
import { cateringMenuLabel } from '../../lib/constants'
import Icon from '../../components/ui/Icon'
import DescriptionNote from '../../components/ui/DescriptionNote'

// Read-only drill-in from the Store Requisition list — picked Variant B
// (dense table + a side detail panel) over an expandable-row list after
// reviewing both as mockups: a table reads every department's totals at a
// glance, and clicking a row swaps the panel instead of pushing the page
// around the way an inline-expanding card list would with ~7+ departments.
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

function StoreRequisitionDetail({ id, onBack }) {
  var [loading, setLoading] = useState(true)
  var [header, setHeader] = useState(null)
  var [createdByName, setCreatedByName] = useState(null)
  var [deptRows, setDeptRows] = useState([])
  var [plateSummary, setPlateSummary] = useState(null)
  var [plateLoading, setPlateLoading] = useState(false)
  var [selectedId, setSelectedId] = useState(null)
  var [linkedEvents, setLinkedEvents] = useState([])
  var [linkedEventsLoading, setLinkedEventsLoading] = useState(false)

  useEffect(function () {
    setLoading(true)
    setPlateSummary(null)
    Promise.all([
      supabase.from('store_requisitions')
        .select('id, date_from, date_to, requisition_no, event_ids, total_paise, created_by, created_at')
        .eq('id', id).single(),
      supabase.from('store_requisition_dept_rows')
        .select('id, section, remarks, sort_order, departments(name), sub_departments(name), ' +
          'store_requisition_items(id, item_name, item_source, unit, qty, rate_paise, amount_paise), ' +
          'store_requisition_casuals(id, casual_type, qty, rate_paise, amount_paise), ' +
          'store_requisition_expense_adjustments(id, amount_paise, remarks, expense_types(name), expense_sub_types(name))')
        .eq('store_requisition_id', id)
        .order('sort_order'),
    ]).then(function (res) {
      var reqRow = res[0].data
      var drRows = res[1].data || []
      setHeader(reqRow)
      setDeptRows(drRows)
      setSelectedId(drRows.length > 0 ? drRows[0].id : null)
      setLoading(false)

      if (reqRow && reqRow.created_by) {
        supabase.rpc('get_profile_names', { p_ids: [reqRow.created_by] }).then(function (nameRes) {
          var n = (nameRes.data || [])[0]
          setCreatedByName(n ? n.name : null)
        })
      }
      if (reqRow && reqRow.event_ids && reqRow.event_ids.length > 0) {
        setPlateLoading(true)
        computePlateSummary(reqRow.event_ids).then(function (s) { setPlateSummary(s); setPlateLoading(false) })
        setLinkedEventsLoading(true)
        supabase.from('events_safe').select('id, event_name, client_name, venue_name, function_date, catering')
          .in('id', reqRow.event_ids)
          .then(function (evRes) { setLinkedEvents(evRes.data || []); setLinkedEventsLoading(false) })
      } else {
        setLinkedEvents([])
        setLinkedEventsLoading(false)
      }
    })
  }, [id])

  if (loading) return <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
  if (!header) return <p className="text-gray-400 text-sm text-center py-8">Requisition not found.</p>

  var enriched = deptRows.map(function (dr) {
    var items = dr.store_requisition_items || []
    var casuals = dr.store_requisition_casuals || []
    var itemsTotal = items.reduce(function (s, it) { return s + (it.amount_paise || 0) }, 0)
    var casualsTotal = casuals.reduce(function (s, c) { return s + (c.amount_paise || 0) }, 0)
    var credits = dr.store_requisition_expense_adjustments || []
    var creditsTotal = credits.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
    // a credit comes off the department's amount, as it does off the requisition total
    return Object.assign({}, dr, {
      label: deptRowLabel(dr),
      items: items, casuals: casuals, credits: credits,
      itemsTotal: itemsTotal, casualsTotal: casualsTotal, creditsTotal: creditsTotal,
      rowTotal: itemsTotal + casualsTotal - creditsTotal,
    })
  })

  var selected = enriched.find(function (d) { return d.id === selectedId; }) || null

  var d0 = new Date((header.date_from || '') + 'T00:00:00')
  var hasDate = !isNaN(d0.getTime())
  var isRange = header.date_to && header.date_to !== header.date_from
  var TH = 'px-4 py-2.5 text-[12px] font-medium text-slate-500 whitespace-nowrap'
  var itemCount = enriched.reduce(function (s, d) { return s + d.items.length }, 0)
  var casualCount = enriched.reduce(function (s, d) { return s + d.casuals.length }, 0)
  var creditCount = enriched.reduce(function (s, d) { return s + d.credits.length }, 0)

  return (
    <div className="space-y-4">
      {/* Head: back, the day as a calendar leaf (as in the list), who logged it, and the functions it is for */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} aria-label="Back to Store Requisitions"
          className="shrink-0 w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:text-slate-900">
          <Icon name="arrowLeft" size={16} />
        </button>
        <div className="shrink-0 w-12 h-12 rounded-xl bg-violet-50 border border-violet-100 flex flex-col items-center justify-center leading-none">
          <span className="text-[18px] font-bold text-violet-800 tabular-nums">{hasDate ? d0.getDate() : '—'}</span>
          <span className="mt-0.5 text-[11px] font-semibold text-violet-600">{hasDate ? d0.toLocaleString('en-IN', { month: 'short' }) : ''}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 flex-wrap text-[20px] font-bold text-slate-900 tracking-[-0.01em]">
            {isRange ? (formatDate(header.date_from) + ' – ' + formatDate(header.date_to)) : formatDate(header.date_from)}
            {header.requisition_no && (
              <span className="text-[12px] font-semibold text-violet-700 bg-violet-50 rounded-md px-2 py-0.5">#{header.requisition_no}</span>
            )}
          </h2>
          <p className="text-[12.5px] text-slate-500">Store requisition by <span className="font-semibold text-slate-700">{createdByName || '—'}</span>, submitted {formatDate(header.created_at)}</p>
        </div>
      </div>

      {header.event_ids && header.event_ids.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 h-8 text-[12.5px] font-semibold text-emerald-700"><Icon name="link" size={14} />Linked to</span>
          {linkedEventsLoading ? (
            <span className="h-8 inline-flex items-center text-[12.5px] text-slate-400">Loading…</span>
          ) : linkedEvents.length === 0 ? (
            <span className="h-8 inline-flex items-center text-[12.5px] text-slate-500">The linked function couldn't be found. It may have been cancelled or merged in a later sync.</span>
          ) : linkedEvents.map(function (e) {
            var menu = cateringMenuLabel(e.catering)
            return (
              <span key={e.id} className="inline-flex items-center gap-2 min-h-8 px-3 py-1 rounded-lg border border-slate-200 bg-white text-[12.5px]">
                <span className="font-bold text-slate-900">{e.event_name || e.client_name || 'Event #' + e.id}</span>
                {(e.venue_name || e.function_date) && (
                  <span className="text-slate-500">{[e.venue_name, e.function_date ? formatDate(e.function_date) : ''].filter(Boolean).join(', ')}</span>
                )}
                {menu && <span className="text-[11.5px] font-semibold text-amber-800 bg-amber-50 rounded px-1.5 py-0.5">{menu}</span>}
              </span>
            )
          })}
        </div>
      )}

      {/* Plates on the left, the total as the one dark block on the right */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className={CARD + ' p-4'}>
          {plateLoading ? (
            <p className="text-sm text-slate-400 py-2">Loading plate counts…</p>
          ) : !header.event_ids || header.event_ids.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">Not linked to a function, so there are no plate counts.</p>
          ) : !plateSummary ? (
            <p className="text-sm text-slate-500 py-2">The linked function couldn't be found.</p>
          ) : (
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
          )}
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-[#2A2550] to-[#3A3170] px-5 py-4 text-white flex flex-col justify-center shadow-[0_12px_30px_-14px_rgba(42,37,80,0.6)]">
          <p className="text-[12.5px] font-medium text-white/70">Total</p>
          <p className="text-[26px] font-bold tabular-nums leading-tight">{formatPoints(header.total_paise || 0)}</p>
          <p className="mt-1 text-[12px] text-white/60">{enriched.length} dept{enriched.length === 1 ? '' : 's'}, {itemCount} item{itemCount === 1 ? '' : 's'}, {casualCount} casual{casualCount === 1 ? '' : 's'}</p>
        </div>
      </div>

      {enriched.length === 0 ? (
        <div className={CARD + ' p-8 text-center'}><p className="text-slate-500 text-sm">No department rows on this requisition.</p></div>
      ) : (
        <div className="space-y-4">

          <div className={CARD + ' min-w-0 overflow-hidden'}>
            <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
              <p className="text-[15px] font-bold text-slate-900">Department breakdown</p>
              <p className="text-[12px] text-slate-500">{enriched.length > 1 ? 'Pick a department to see its lines below' : ''}</p>
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
                  {enriched.map(function (dr) {
                    var isSel = dr.id === selectedId
                    return (
                      <tr key={dr.id} onClick={function () { setSelectedId(dr.id) }} aria-selected={isSel}
                        className={'cursor-pointer border-b border-slate-100 last:border-0 transition-colors ' + (isSel ? 'bg-violet-50/70' : 'hover:bg-slate-50')}>
                        <td className={'relative px-4 py-3 text-[13.5px] font-semibold text-slate-900'}>
                          {isSel && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-violet-500" />}
                          {dr.label}
                          {dr.remarks && <span className="block text-[12px] font-normal text-slate-500 mt-0.5">{dr.remarks}</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-[14px] font-bold text-violet-700 tabular-nums">{formatPointsPlain(dr.rowTotal)}</td>
                        <td className="px-4 py-3 text-right text-[13px] text-slate-600 tabular-nums">{plateSummary ? rateOrDash(dr.rowTotal, plateSummary.actual) : '—'}</td>
                        <td className="px-4 py-3 text-right text-[13px] text-slate-600 tabular-nums">{plateSummary ? rateOrDash(dr.rowTotal, plateSummary.booking) : '—'}</td>
                        <td className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700 tabular-nums">{dr.items.length}</td>
                        <td className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700 tabular-nums">{dr.casuals.length}</td>
                        <td className={'px-4 py-3 text-right text-[13px] font-semibold tabular-nums ' + (dr.credits.length ? 'text-emerald-700' : 'text-slate-700')}>{dr.credits.length}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-dashed border-slate-300">
                    <td className="px-4 py-3 text-[13.5px] font-bold text-slate-900">Total</td>
                    <td className="px-4 py-3 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(header.total_paise || 0)}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{plateSummary ? rateOrDash(header.total_paise || 0, plateSummary.actual) : '—'}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{plateSummary ? rateOrDash(header.total_paise || 0, plateSummary.booking) : '—'}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{itemCount}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{casualCount}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{creditCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* The picked department's lines, full width under the breakdown:
              a table per kind, amounts in one right-hand column. */}
          {selected && (
            <div className={CARD + ' min-w-0 overflow-hidden'}>
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-violet-50 border-b border-violet-100">
                <p className="min-w-0 flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  <Icon name="list" size={16} className="shrink-0 text-violet-600" />
                  <span className="truncate">{selected.label}</span>
                </p>
              </div>

              {selected.remarks && (
                <div className="px-4 pt-3">
                  <DescriptionNote text={selected.remarks} label="Remarks" truncate={false} className="" />
                </div>
              )}

              <div className="overflow-x-auto">
                  <p className="relative mx-4 mt-3.5 mb-1.5 pl-2.5 text-[13.5px] font-bold text-slate-900">
                    <span aria-hidden="true" className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full bg-violet-500" />
                    Inventory {selected.items.length > 0 && <span className="font-medium text-slate-500">{selected.items.length}</span>}
                  </p>
                {selected.items.length === 0 ? (
                  <p className="px-4 pb-3 text-[12.5px] text-slate-500">No inventory taken out.</p>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-y border-slate-100">
                        <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-left">Item</th>
                        <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-left w-36">From</th>
                        <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-28">Qty</th>
                        <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-28">Rate</th>
                        <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-32">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map(function (it) {
                        return (
                          <tr key={it.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-4 py-2.5 text-[13.5px] font-semibold text-slate-900">{it.item_name}</td>
                            <td className="px-4 py-2.5 text-[12.5px] text-slate-500 whitespace-nowrap">{it.item_source === 'inventory' ? 'Inventory' : 'Catering Store'}</td>
                            <td className="px-4 py-2.5 text-right text-[13px] text-slate-700 tabular-nums whitespace-nowrap">{it.qty} <span className="text-slate-500">{it.unit}</span></td>
                            <td className="px-4 py-2.5 text-right text-[13px] text-slate-600 tabular-nums">{it.rate_paise ? formatPointsPlain(it.rate_paise) : '—'}</td>
                            <td className="px-4 py-2.5 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(it.amount_paise)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-dashed border-slate-300">
                        <td colSpan={4} className="px-4 py-2.5 text-[12.5px] font-medium text-slate-500">Inventory subtotal</td>
                        <td className="px-4 py-2.5 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(selected.itemsTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              <div className="grid xl:grid-cols-2 border-t border-slate-200 xl:divide-x divide-slate-200">
                <div className="overflow-x-auto min-w-0">
                  <p className="relative mx-4 mt-3.5 mb-1.5 pl-2.5 text-[13.5px] font-bold text-slate-900">
                    <span aria-hidden="true" className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full bg-sky-500" />
                    Casual labour {selected.casuals.length > 0 && <span className="font-medium text-slate-500">{selected.casuals.length}</span>}
                  </p>
                  {selected.casuals.length === 0 ? (
                    <p className="px-4 pb-3 text-[12.5px] text-slate-500">No casual labour on this department.</p>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-y border-slate-100">
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-left">Role</th>
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-28">Qty</th>
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-28">Rate</th>
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right w-32">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.casuals.map(function (c) {
                          return (
                            <tr key={c.id} className="border-b border-slate-100 last:border-0">
                              <td className="px-4 py-2.5 text-[13.5px] font-semibold text-slate-900">{c.casual_type}</td>
                              <td className="px-4 py-2.5 text-right text-[13px] text-slate-700 tabular-nums">{c.qty}</td>
                              <td className="px-4 py-2.5 text-right text-[13px] text-slate-600 tabular-nums">{formatPointsPlain(c.rate_paise)}</td>
                              <td className="px-4 py-2.5 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(c.amount_paise)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-dashed border-slate-300">
                          <td colSpan={3} className="px-4 py-2.5 text-[12.5px] font-medium text-slate-500">Casual subtotal</td>
                          <td className="px-4 py-2.5 text-right text-[14px] font-bold text-slate-900 tabular-nums">{formatPointsPlain(selected.casualsTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                <div className="overflow-x-auto min-w-0 border-t border-slate-200 xl:border-t-0">
                  <p className="relative mx-4 mt-3.5 mb-1.5 pl-2.5 text-[13.5px] font-bold text-slate-900">
                    <span aria-hidden="true" className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full bg-emerald-500" />
                    Expense credits {selected.credits.length > 0 && <span className="font-medium text-slate-500">{selected.credits.length}</span>}
                  </p>
                  {selected.credits.length === 0 ? (
                    <p className="px-4 pb-3 text-[12.5px] text-slate-500">No expense credits on this department.</p>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-y border-slate-100">
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-left">Expense</th>
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-left">Remarks</th>
                          <th className="px-4 py-2 text-[12px] font-medium text-slate-500 whitespace-nowrap text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.credits.map(function (cr) {
                          return (
                            <tr key={cr.id} className="border-b border-slate-100 last:border-0">
                              <td className="px-4 py-2.5">
                                <p className="text-[13.5px] font-semibold text-slate-900">{(cr.expense_types && cr.expense_types.name) || 'Expense'}</p>
                                {cr.expense_sub_types && cr.expense_sub_types.name && <p className="text-[12px] text-slate-500">{cr.expense_sub_types.name}</p>}
                              </td>
                              <td className="px-4 py-2.5 text-[12.5px] text-slate-600">{cr.remarks || '—'}</td>
                              <td className="px-4 py-2.5 text-right text-[14px] font-bold text-emerald-700 tabular-nums">−{formatPointsPlain(cr.amount_paise)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-dashed border-slate-300">
                          <td colSpan={2} className="px-4 py-2.5 text-[12.5px] font-medium text-slate-500">Total credit</td>
                          <td className="px-4 py-2.5 text-right text-[14px] font-bold text-emerald-700 tabular-nums">−{formatPointsPlain(selected.creditsTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

export default StoreRequisitionDetail
