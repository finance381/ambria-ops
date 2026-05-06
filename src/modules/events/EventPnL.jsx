import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/format'

function EventPnL({ eventId, profile, cachedData }) {
  var [data, setData] = useState(cachedData || null)
  var [loading, setLoading] = useState(!cachedData)
  var [error, setError] = useState('')

  useEffect(function () { if (!cachedData) loadPnL() }, [eventId])

  async function loadPnL() {
    setLoading(true)
    setError('')
    var { data: result, error: err } = await supabase.rpc('event_pnl', { p_event_id: eventId })
    if (err) { setError(err.message); setLoading(false); return }
    setData(result)
    setLoading(false)
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-3">Loading P&L...</p>
  if (error) return <p className="text-xs text-red-500 py-2">{error}</p>
  if (!data) return null
  if (profile?.role !== 'admin' && profile?.role !== 'auditor') return null

  var revenue = data.revenue_paise || 0
  var totalCost = data.total_cost_paise || 0
  var profit = data.profit_paise || 0
  var hasData = revenue > 0 || totalCost > 0

  if (!hasData) {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Event P&L</h4>
        <p className="text-sm text-gray-400 text-center py-3">No financial data linked yet</p>
        <p className="text-[10px] text-gray-400 text-center">Link quotes, requisitions, production orders, and manpower to see P&L</p>
      </div>
    )
  }

  var costLines = [
    { label: 'Procurement', value: data.procurement_paise || 0, icon: '🛒' },
    { label: 'Production', value: data.production_paise || 0, icon: '🔧' },
    { label: 'Repairs', value: data.repair_paise || 0, icon: '🔩' },
    { label: 'Manpower', value: data.manpower_paise || 0, icon: '👷' },
  ].filter(function (l) { return l.value > 0 })

  var margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Event P&L</h4>
        <button onClick={loadPnL} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium">↻ Refresh</button>
      </div>

      {/* Summary bar */}
      <div className={"rounded-lg p-4 " + (profit >= 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200")}>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-bold">Revenue</p>
            <p className="text-sm font-bold text-gray-800">{formatPaise(revenue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-bold">Total Cost</p>
            <p className="text-sm font-bold text-gray-800">{formatPaise(totalCost)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-bold">Profit</p>
            <p className={"text-sm font-bold " + (profit >= 0 ? "text-green-700" : "text-red-700")}>
              {profit < 0 ? '−' : ''}{formatPaise(Math.abs(profit))}
              {revenue > 0 && <span className="text-[10px] font-medium ml-1">({margin}%)</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Cost breakdown */}
      {costLines.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-400 uppercase font-bold">Cost Breakdown</p>
          {costLines.map(function (line) {
            var pct = totalCost > 0 ? Math.round((line.value / totalCost) * 100) : 0
            return (
              <div key={line.label} className="flex items-center gap-3">
                <span className="text-sm w-5 text-center">{line.icon}</span>
                <span className="text-xs text-gray-600 w-24">{line.label}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-400 h-2 rounded-full transition-all" style={{ width: pct + '%' }} />
                </div>
                <span className="text-xs font-bold text-gray-700 w-24 text-right">{formatPaise(line.value)}</span>
                <span className="text-[10px] text-gray-400 w-10 text-right">{pct}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default EventPnL
