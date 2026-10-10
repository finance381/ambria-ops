import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, formatPointsPlain } from '../../lib/format'
import { computePlateSummary } from '../../lib/plateInfo'
import Icon from '../../components/ui/Icon'

// Read-only drill-in from the Store Requisition list — picked Variant B
// (dense table + a side detail panel) over an expandable-row list after
// reviewing both as mockups: a table reads every department's totals at a
// glance, and clicking a row swaps the panel instead of pushing the page
// around the way an inline-expanding card list would with ~7+ departments.
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

function StoreRequisitionDetail({ id, onBack }) {
  var [loading, setLoading] = useState(true)
  var [header, setHeader] = useState(null)
  var [createdByName, setCreatedByName] = useState(null)
  var [deptRows, setDeptRows] = useState([])
  var [plateSummary, setPlateSummary] = useState(null)
  var [plateLoading, setPlateLoading] = useState(false)
  var [selectedId, setSelectedId] = useState(null)

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
          'store_requisition_casuals(id, casual_type, qty, rate_paise, amount_paise)')
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
    return Object.assign({}, dr, {
      label: deptRowLabel(dr),
      items: items, casuals: casuals,
      itemsTotal: itemsTotal, casualsTotal: casualsTotal,
      rowTotal: itemsTotal + casualsTotal,
    })
  })

  var selected = enriched.find(function (d) { return d.id === selectedId; }) || null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Back to Store Requisitions"
            className="w-9 h-9 rounded-lg border border-gray-300 bg-white flex items-center justify-center hover:bg-gray-50">
            <Icon name="arrowLeft" size={15} />
          </button>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Store Requisition</p>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 flex-wrap">
              {formatDate(header.date_from)} – {formatDate(header.date_to)}
              {header.requisition_no && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                  #{header.requisition_no}
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{createdByName || '—'} · submitted {formatDate(header.created_at)}</p>
          </div>
        </div>
      </div>

      <div className={CARD + ' p-5 flex items-center gap-7 flex-wrap'}>
        {plateLoading ? (
          <p className="text-sm text-gray-400">Loading plate counts…</p>
        ) : !header.event_ids || header.event_ids.length === 0 ? (
          <p className="text-sm text-gray-400">No contracts linked to this requisition — plate counts unavailable.</p>
        ) : !plateSummary ? (
          <p className="text-sm text-gray-400">Linked contract(s) not found.</p>
        ) : (
          <div className="flex items-stretch divide-x divide-gray-100 flex-1 min-w-0">
            <div className="px-5 first:pl-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Booking plate</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.booking}</p>
            </div>
            <div className="px-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Extra plate</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.extra}</p>
            </div>
            <div className="px-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Balance plate</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{plateSummary.balance}</p>
            </div>
            <div className="px-5">
              <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Actual plate</p>
              <p className="text-xl font-bold text-indigo-600 tabular-nums mt-0.5">{plateSummary.actual}</p>
            </div>
          </div>
        )}
        <div className="text-right shrink-0 border-l border-gray-100 pl-7">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatPoints(header.total_paise || 0)}</p>
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-gray-800">Department breakdown</p>
        <p className="text-xs text-gray-400">Click a row to see its inventory and casual-labour lines</p>
      </div>

      {enriched.length === 0 ? (
        <div className={CARD + ' p-8 text-center'}><p className="text-gray-400 text-sm">No department rows on this requisition.</p></div>
      ) : (
        <div className="flex gap-4 items-start flex-wrap lg:flex-nowrap">

          <div className={CARD + ' flex-1 min-w-0 w-full overflow-x-auto'}>
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
                {enriched.map(function (dr) {
                  var isSel = dr.id === selectedId
                  return (
                    <tr key={dr.id} onClick={function () { setSelectedId(dr.id) }}
                      className={'cursor-pointer border-b border-gray-100 last:border-0 transition-colors ' + (isSel ? 'bg-indigo-50' : 'hover:bg-gray-50')}>
                      <td className="px-3.5 py-2.5 text-sm font-semibold text-gray-900">
                        {dr.label}
                        {dr.remarks && <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{dr.remarks}</span>}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-sm font-bold text-indigo-600 tabular-nums">{formatPointsPlain(dr.rowTotal)}</td>
                      <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular-nums">{plateSummary ? rateOrDash(dr.rowTotal, plateSummary.actual) : '—'}</td>
                      <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular-nums">{plateSummary ? rateOrDash(dr.rowTotal, plateSummary.booking) : '—'}</td>
                      <td className="px-3.5 py-2.5 text-right">
                        <span className="inline-flex items-center h-5 px-2 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{dr.items.length}</span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <span className="inline-flex items-center h-5 px-2 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{dr.casuals.length}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3.5 py-2.5 text-sm font-bold text-gray-800">Total</td>
                  <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-900 tabular-nums">{formatPointsPlain(header.total_paise || 0)}</td>
                  <td className="px-3.5 py-2.5"></td>
                  <td className="px-3.5 py-2.5"></td>
                  <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">
                    {enriched.reduce(function (s, d) { return s + d.items.length }, 0)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-sm font-bold text-gray-700 tabular-nums">
                    {enriched.reduce(function (s, d) { return s + d.casuals.length }, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={CARD + ' flex-none w-full lg:w-[380px] p-4 space-y-4 lg:sticky lg:top-4'}>
            {!selected ? (
              <p className="text-sm text-gray-400 text-center py-6">Select a department row to see its line items.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Selected department</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{selected.label}</p>
                  </div>
                  <p className="shrink-0 text-base font-bold text-indigo-600 tabular-nums">{formatPointsPlain(selected.rowTotal)}</p>
                </div>

                {selected.remarks && (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">{selected.remarks}</p>
                )}

                {selected.items.length > 0 && (
                  <div>
                    <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Inventory items</p>
                    <div className="space-y-1.5">
                      {selected.items.map(function (it) {
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
                  </div>
                )}

                {selected.casuals.length > 0 && (
                  <div>
                    <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Casual labour</p>
                    <div className="space-y-1.5">
                      {selected.casuals.map(function (c) {
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
                  </div>
                )}

                {selected.items.length === 0 && selected.casuals.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No line items recorded for this row.</p>
                )}
              </>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

export default StoreRequisitionDetail
