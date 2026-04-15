import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import StatCard from '../../components/ui/StatCard'
import { formatPaise } from '../../lib/format'

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(function () {
    loadStats()
  }, [])

  async function loadStats() {
    var [itemsRes, eventsRes, boxesRes, expensesRes, purchaseRes] = await Promise.all([
      supabase.from('inventory_items').select('id, qty, blocked, type'),
      supabase.from('events').select('id'),
      supabase.from('boxes').select('id'),
      supabase.from('expenses').select('id, amount_paise, status'),
      supabase.from('purchase_requests').select('id, status'),
    ])

    var items = itemsRes.data || []
    var totalStock = 0
    var totalBlocked = 0
    var budgetedCount = 0
    var premiumCount = 0
    var lowStock = 0

    items.forEach(function (item) {
      totalStock += item.qty
      totalBlocked += item.blocked
      if (item.type === 'Budgeted') budgetedCount++
      if (item.type === 'Premium') premiumCount++
      if (item.qty - item.blocked <= 2) lowStock++
    })

    var expenses = expensesRes.data || []
    var pendingExpenses = expenses.filter(function (e) { return e.status === 'pending' }).length
    var approvedTotal = 0
    expenses.forEach(function (e) {
      if (e.status === 'approved') approvedTotal += e.amount_paise
    })

    var purchases = purchaseRes.data || []
    var pendingPurchases = purchases.filter(function (p) { return p.status === 'Pending' }).length

    setStats({
      items: items.length,
      totalStock: totalStock,
      available: totalStock - totalBlocked,
      blocked: totalBlocked,
      budgeted: budgetedCount,
      premium: premiumCount,
      lowStock: lowStock,
      events: (eventsRes.data || []).length,
      boxes: (boxesRes.data || []).length,
      pendingExpenses: pendingExpenses,
      approvedExpenseTotal: approvedTotal,
      pendingPurchases: pendingPurchases,
    })
    setLoading(false)
  }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading dashboard...</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={stats.items} icon="📦" color="indigo" />
        <StatCard label="Total Stock" value={stats.totalStock} icon="📊" color="blue" />
        <StatCard label="Available" value={stats.available} icon="✅" color="green" />
        <StatCard label="Blocked" value={stats.blocked} icon="🔒" color="amber" />
        <StatCard label="Budgeted" value={stats.budgeted} icon="$" color="blue" />
        <StatCard label="Premium" value={stats.premium} icon="★" color="purple" />
        <StatCard label="Low Stock" value={stats.lowStock} icon="⚠️" color="red" />
        <StatCard label="Events" value={stats.events} icon="📅" color="pink" />
        <StatCard label="Boxes" value={stats.boxes} icon="📋" color="gray" />
        <StatCard label="Pending Expenses" value={stats.pendingExpenses} icon="💰" color="amber" />
        <StatCard label="Approved Spend" value={formatPaise(stats.approvedExpenseTotal)} icon="💵" color="green" />
        <StatCard label="Pending Purchases" value={stats.pendingPurchases} icon="🛒" color="indigo" />
      </div>

      {stats.lowStock > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-red-800">⚠️ Low Stock Alert</h3>
          <p className="text-sm text-red-600 mt-1">
            {stats.lowStock} item{stats.lowStock > 1 ? 's' : ''} with 2 or fewer available
          </p>
        </div>
      )}
    </div>
  )
}

export default Dashboard