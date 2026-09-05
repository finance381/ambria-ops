import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Shared cache for small master tables that dozens of screens were each
// independently re-fetching on every mount (venues, expense_types,
// expense_sub_types, and a narrow non-PII slice of employees for dropdowns).
// Fetched once per session, kept fresh via realtime subscription. Consumers
// filter/project client-side (e.g. .filter(v => v.active)) instead of
// re-querying Supabase — the underlying tables are all small enough that
// fetching every row/column once is cheaper than N repeated network round trips.
var ReferenceDataContext = createContext(null)

export function ReferenceDataProvider({ children }) {
  var [venues, setVenues] = useState([])
  var [expenseTypes, setExpenseTypes] = useState([])
  var [expenseSubTypes, setExpenseSubTypes] = useState([])
  var [employees, setEmployees] = useState([])
  var [refDataLoading, setRefDataLoading] = useState(true)
  var timerRef = useRef(null)

  async function load() {
    var results = await Promise.all([
      supabase.from('venues').select('*').order('code'),
      supabase.from('expense_types').select('*').order('sort_order').order('name'),
      supabase.from('expense_sub_types').select('*').order('sort_order').order('name'),
      supabase.from('employees').select('id, employee_code, full_name, designation, status, profile_id, job_department_ids').order('full_name'),
    ])
    setVenues(results[0].data || [])
    setExpenseTypes(results[1].data || [])
    setExpenseSubTypes(results[2].data || [])
    setEmployees(results[3].data || [])
    setRefDataLoading(false)
  }

  useEffect(function () {
    load()
    function debounced() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(load, 500)
    }
    var channel = supabase.channel('rt-refdata')
    ;['venues', 'expense_types', 'expense_sub_types', 'employees'].forEach(function (t) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, debounced)
    })
    channel.subscribe()
    return function () {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [])

  var value = {
    venues: venues,
    expenseTypes: expenseTypes,
    expenseSubTypes: expenseSubTypes,
    employees: employees,
    refDataLoading: refDataLoading,
    refreshRefData: load,
  }

  // Block the subtree until the first fetch resolves — consumers read venues/
  // expenseTypes/etc. inside mount-time effects, and child effects fire before
  // this provider's own effect, so rendering children early would let them
  // capture the empty initial state instead of the real data.
  if (refDataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <ReferenceDataContext.Provider value={value}>
      {children}
    </ReferenceDataContext.Provider>
  )
}

export function useReferenceData() {
  return useContext(ReferenceDataContext)
}
