import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import ExpenseFormMulti from './ExpenseForm'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import ExpenseTypeMaster from './ExpenseTypeMaster'
import FilterDropdown from '../../components/ui/FilterDropdown'
import AllExpenses from './AllExpenses'
import ExpenseDetail from './ExpenseDetail'
import { useRealtime } from '../../lib/useRealtime'
import ExpenseReport from './ExpenseReport'
import { pushBack, goBack as navBack } from '../../lib/backNav'

var PAGE_SIZE = 20

function Expenses({ profile, masterMode }) {
  var [view, setView] = useState('list') // list | form | detail | approve
  var [myExpenses, setMyExpenses] = useState([])
  var [approvalExpenses, setApprovalExpenses] = useState([])
  var [myHasMore, setMyHasMore] = useState(false)
  var [approvalHasMore, setApprovalHasMore] = useState(false)
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  useRealtime(['expenses', 'expense_allocations'], function () { loadMyExpenses(false); loadApprovalExpenses(false) })
  var [detailExp, setDetailExp] = useState(null)
  var [statusFilter, setStatusFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [expSearch, setExpSearch] = useState('')
  var [expSearchDebounced, setExpSearchDebounced] = useState('')
  var [reportView, setReportView] = useState(false)
  var [editExp, setEditExp] = useState(null)
  var [walletBalance, setWalletBalance] = useState(0)
  var [subDeptMap, setSubDeptMap] = useState({})
  var [typesModal, setTypesModal] = useState(false)

  // Filter panel state
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [deptFilter, setDeptFilter] = useState('')
  var [subDeptFilter, setSubDeptFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [amountMin, setAmountMin] = useState('')
  var [amountMax, setAmountMax] = useState('')

  // Filter lookups
  var [deptOptions, setDeptOptions] = useState([])
  var [subDeptOptions, setSubDeptOptions] = useState([])
  var [venueOptions, setVenueOptions] = useState([])
  var [userOptions, setUserOptions] = useState([])

  var isAdmin = profile?.role === 'admin' || (profile?.permissions && profile.permissions.indexOf('expense_approve') >= 0)
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var hasExpenseApprove = (profile?.permissions || []).indexOf('expense_approve') !== -1
  var showApproveTab = isAdmin || isAuditor || hasExpenseApprove

  useEffect(function () {
    var timer = setTimeout(function () { setExpSearchDebounced(expSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [expSearch])

  var [collapsedGroups, setCollapsedGroups] = useState({})

  useEffect(function () {
    Promise.all([
      supabase.from('sub_departments').select('id, name, department_id').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
    ]).then(function (res) {
      var sds = res[0].data || []
      var map = {}
      sds.forEach(function (sd) { map[sd.id] = sd.name })
      setSubDeptMap(map)
      setSubDeptOptions(sds)
      setDeptOptions(res[1].data || [])
      setVenueOptions(res[2].data || [])
    })
    if (showApproveTab) {
      supabase.from('profiles').select('id, name').order('name').then(function (res) {
        setUserOptions(res.data || [])
      })
    }
  }, [])

   useEffect(function () {
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    loadMyExpenses(false)
    loadApprovalExpenses(false)
  }, [statusFilter, dateFrom, dateTo, expSearchDebounced, deptFilter, subDeptFilter, venueFilter, userFilter, amountMin, amountMax])
  async function loadMyExpenses(append) {
    var offset = append ? myExpenses.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var hasAllocFilter = !!(deptFilter || subDeptFilter || venueFilter)
    var allocEmbed = hasAllocFilter
      ? 'expense_allocations!inner(department, department_id, venue_id, amount_paise)'
      : 'expense_allocations(department, department_id, venue_id, amount_paise)'

    var query = supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed)
      .eq('user_id', profile.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (statusFilter) query = query.eq('status', statusFilter)
    if (dateFrom) query = query.gte('expense_date', dateFrom)
    if (dateTo) query = query.lte('expense_date', dateTo)
    if (expSearchDebounced) query = query.ilike('description', '%' + expSearchDebounced + '%')
    if (deptFilter) query = query.eq('expense_allocations.department_id', Number(deptFilter))
    if (venueFilter) query = query.eq('expense_allocations.venue_id', Number(venueFilter))
    if (amountMin) query = query.gte('amount_paise', Math.round(Number(amountMin) * 100))
    if (amountMax) query = query.lte('amount_paise', Math.round(Number(amountMax) * 100))

    var { data, error } = await query
    if (error) { alert('Failed to load: ' + error.message); setLoading(false); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setMyExpenses(function (prev) { return prev.concat(rows) })
    } else {
      setMyExpenses(rows)
    }
    setMyHasMore(hasMore)
    setLoading(false)
    setLoadingMore(false)
  }

  async function loadApprovalExpenses(append) {
    if (!showApproveTab) { setApprovalExpenses([]); return }

    var offset = append ? approvalExpenses.length : 0
    if (append) setLoadingMore(true)

    var statuses = ['recorded', 'flagged']

    var hasAllocFilter2 = !!(deptFilter || subDeptFilter || venueFilter)
    var allocEmbed2 = hasAllocFilter2
      ? 'expense_allocations!inner(department, department_id, venue_id, amount_paise)'
      : 'expense_allocations(department, department_id, venue_id, amount_paise)'

    var query = supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed2)
      .neq('user_id', profile.id)
      .in('status', statuses)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (dateFrom) query = query.gte('expense_date', dateFrom)
    if (dateTo) query = query.lte('expense_date', dateTo)
    if (expSearchDebounced) query = query.ilike('description', '%' + expSearchDebounced + '%')
    if (userFilter) query = query.eq('user_id', userFilter)
    if (deptFilter) query = query.eq('expense_allocations.department_id', Number(deptFilter))
    if (venueFilter) query = query.eq('expense_allocations.venue_id', Number(venueFilter))
    if (amountMin) query = query.gte('amount_paise', Math.round(Number(amountMin) * 100))
    if (amountMax) query = query.lte('amount_paise', Math.round(Number(amountMax) * 100))

    var { data, error } = await query
    if (error) { alert('Failed to load approvals: ' + error.message); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    // Resolve submitter names
    var eUserIds = []
    rows.forEach(function (r) { if (r.user_id && eUserIds.indexOf(r.user_id) === -1) eUserIds.push(r.user_id) })
    if (eUserIds.length > 0) {
      var { data: eNames } = await supabase.rpc('get_profile_names', { p_ids: eUserIds })
      var eMap = {}
      ;(eNames || []).forEach(function (n) { eMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: eMap[r.user_id] || null } }) })
    }
    if (append) {
      setApprovalExpenses(function (prev) { return prev.concat(rows) })
    } else {
      setApprovalExpenses(rows)
    }
    setApprovalHasMore(hasMore)
    setLoadingMore(false)
  }

  function openDetail(exp) {
    var returnTo = exp._fromApprove ? 'approve' : exp._fromAll ? 'all' : 'list'
    pushBack(function () { setView(returnTo); setDetailExp(null); setEditExp(null) })
    setDetailExp(exp)
    setView('detail')
  }

  function handleFormDone() {
    setView('list')
    setEditExp(null)
    loadMyExpenses(false)
    loadApprovalExpenses(false)
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
  }

  function exportExpenseCSV() {
    if (!myExpenses.length) return
    var headers = ['Date', 'Department', 'Sub-Department', 'Amount (pts)', 'Description', 'Status', 'Created']
    var rows = myExpenses.map(function (e) {
      var firstAlloc = (e.expense_allocations && e.expense_allocations[0]) || {}
      var deptName = firstAlloc.department || ''
      var subDeptName = firstAlloc.sub_department_id ? (subDeptMap[firstAlloc.sub_department_id] || '') : ''
      return [
        e.expense_date || '',
        deptName,
        subDeptName,
        e.amount_paise ? (e.amount_paise / 100) : 0,
        (e.description || '').replace(/,/g, ';'),
        e.status || '',
        e.created_at ? e.created_at.split('T')[0] : '',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my_expenses_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }


  var displayList = view === 'approve' ? approvalExpenses : myExpenses
  var displayHasMore = view === 'approve' ? approvalHasMore : myHasMore

  // Total points for my expenses
  var myTotal = myExpenses.reduce(function (sum, e) { return sum + (e.amount_paise || 0) }, 0)
  var monthPrefix = new Date().toISOString().slice(0, 7)
  var myMonthExps = myExpenses.filter(function (e) { return (e.expense_date || '').slice(0, 7) === monthPrefix })
  var monthCount = myMonthExps.length
  var monthTotal = myMonthExps.reduce(function (sum, e) { return sum + (e.amount_paise || 0) }, 0)
  if (masterMode) {
    return <ExpenseTypeMaster />
  }
  if (reportView && (isAdmin || isAuditor)) {
    return <ExpenseReport onBack={function () { setReportView(false) }} />
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  // ═══════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════
  if (view === 'form') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{editExp ? 'Edit Expense' : 'New Expenses'}</h2>
          <button onClick={function () { setView('list'); setEditExp(null) }} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
        </div>
        <ExpenseFormMulti profile={profile} walletBalance={walletBalance} editExp={editExp} onDone={handleFormDone} />
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && detailExp) {
    return (
      <ExpenseDetail
        exp={detailExp}
        profile={profile}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onBack={function () { navBack() }}
        onUpdated={function () { loadMyExpenses(false); loadApprovalExpenses(false); setView(detailExp._fromApprove ? 'approve' : detailExp._fromAll ? 'all' : 'list'); setDetailExp(null) }}
        onEdit={function () { setEditExp(detailExp); setView('form') }}
      />
    )
  }


  // ═══════════════════════════════════════════════
  // EXPENSE TYPES — Admin config
  // ═══════════════════════════════════════════════
  if (typesModal) {
    return <ExpenseTypeMaster onBack={function () { setTypesModal(false) }} />
  }

  // ═══════════════════════════════════════════════
  // LIST / APPROVE VIEW
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Expenses</h2>
          <p className="text-xs text-gray-400">
            {view === 'approve'
              ? approvalExpenses.length + ' pending review'
              : view === 'all'
                ? 'All users (admin view)'
                : monthCount + ' this month' + (monthTotal > 0 ? ' · ' + formatPoints(monthTotal) : '')}
          </p>
        </div>
        <div className="flex gap-2">
          {view === 'list' && myExpenses.length > 0 && (
            <button onClick={exportExpenseCSV}
              className="px-3 py-2 text-sm font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
              📥 CSV
            </button>
          )}
          <button onClick={function () { setEditExp(null); setView('form') }}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
            + New
          </button>
        </div>
      </div>

      {/* Admin shortcuts — Reports / Types */}
      {(isAdmin || isAuditor) && (
        <div className="flex gap-2 md:max-w-md">
          <button onClick={function () { setReportView(true) }}
            className="flex-1 py-2.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
            📊 Reports
          </button>
          {(profile?.permissions || []).indexOf('admin_masters') !== -1 && (
            <button onClick={function () { setTypesModal(true) }}
              className="flex-1 py-2.5 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
              ⚙ Types
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      {showApproveTab && (
        <div className="flex bg-gray-100 rounded-lg p-0.5 md:max-w-md">
          <button onClick={function () { setView('list'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (view === 'list' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            Mine
          </button>
          <button onClick={function () { setView('approve'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors relative " + (view === 'approve' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            Review
            {approvalExpenses.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {approvalExpenses.length}
              </span>
            )}
          </button>
          {(isAdmin || isAuditor || isDeptApprover) && (
            <button onClick={function () { setView('all'); setStatusFilter('') }}
              className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (view === 'all' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
              {(isAdmin || isAuditor) ? 'All' : 'Dept'}
            </button>
          )}
        </div>
      )}

      {/* All Expenses body — admin/auditor sees everything; dept approver sees only their scoped depts */}
      {view === 'all' && (isAdmin || isAuditor || isDeptApprover) && (
        <AllExpenses
          embedded
          scopeDeptIds={(isAdmin || isAuditor) ? null : (profile?.event_dept_ids || [])}
          onOpenDetail={function (exp) { openDetail(Object.assign({}, exp, { _fromAll: true })) }}
        />
      )}

      {/* Search */}
      {(view === 'list' || view === 'approve') && (
        <input type="text" value={expSearch} onChange={function (e) { setExpSearch(e.target.value) }}
          placeholder="Search expenses..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
      )}

      {/* Filters button + panel */}
      {(view === 'list' || view === 'approve') && (function () {
        var count = 0
        if (view === 'list' && statusFilter) count++
        if (dateFrom) count++
        if (dateTo) count++
        if (deptFilter) count++
        if (subDeptFilter) count++
        if (venueFilter) count++
        if (view === 'approve' && userFilter) count++
        if (amountMin) count++
        if (amountMax) count++
        function resetFilters() {
          setStatusFilter(''); setDateFrom(''); setDateTo('')
          setDeptFilter(''); setSubDeptFilter(''); setVenueFilter('')
          setUserFilter(''); setAmountMin(''); setAmountMax('')
        }
        var subDeptFiltered = deptFilter
          ? subDeptOptions.filter(function (sd) { return String(sd.department_id) === deptFilter })
          : subDeptOptions
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={function () { setFiltersOpen(!filtersOpen) }}
                className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " + (filtersOpen ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                {filtersOpen ? '▲' : '▼'} Filters{count > 0 ? ' · ' + count : ''}
              </button>
              {count > 0 && (
                <button onClick={resetFilters}
                  className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  Reset
                </button>
              )}
            </div>
            {filtersOpen && (
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                {view === 'list' && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
                    <div className="flex gap-2 flex-wrap">
                      {['', 'recorded', 'acknowledged', 'flagged', 'deducted'].map(function (s) {
                        var label = s ? APPROVAL_STATUS_LABELS[s] : 'All'
                        return (
                          <button key={s} onClick={function () { setStatusFilter(s === statusFilter ? '' : s) }}
                            className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                              (statusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {view === 'approve' && userOptions.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">User</label>
                    <FilterDropdown value={userFilter} placeholder="All users"
                      options={userOptions.map(function (u) { return { label: u.name || '—', value: String(u.id) } })}
                      onChange={setUserFilter} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Department</label>
                    <FilterDropdown value={deptFilter} placeholder="All departments"
                      options={deptOptions.map(function (d) { return { label: d.name, value: String(d.id) } })}
                      onChange={function (v) { setDeptFilter(v); setSubDeptFilter('') }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sub-Dept</label>
                    <FilterDropdown value={subDeptFilter} placeholder="All sub-depts"
                      options={subDeptFiltered.map(function (sd) { return { label: sd.name, value: String(sd.id) } })}
                      onChange={setSubDeptFilter} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Venue</label>
                    <FilterDropdown value={venueFilter} placeholder="All venues"
                      options={venueOptions.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })}
                      onChange={setVenueFilter} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Min (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMin}
                      onChange={function (e) { setAmountMin(e.target.value) }}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Max (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMax}
                      onChange={function (e) { setAmountMax(e.target.value) }}
                      placeholder="∞"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
                    <input type="date" value={dateFrom}
                      onChange={function (e) { setDateFrom(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
                    <input type="date" value={dateTo}
                      onChange={function (e) { setDateTo(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* List */}
      {view !== 'all' && displayList.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 md:p-12 text-center">
          <div className="text-4xl mb-3">{view === 'approve' ? '✅' : '💸'}</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">{view === 'approve' ? 'Nothing to review' : 'No expenses yet'}</p>
          <p className="text-xs text-gray-400 mb-4">{view === 'approve' ? 'Pending submissions will appear here' : 'Log your first expense to get started'}</p>
          {view === 'list' && (
            <button onClick={function () { setEditExp(null); setView('form') }}
              className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
              + Add First Expense
            </button>
          )}
        </div>
      )}

      {view !== 'all' && <div className="space-y-3">
        {(function () {
          // Group by batch_id (submission unit); legacy null-batch rows are singleton groups
          var groups = {}
          var orderKeys = []
          displayList.forEach(function (exp) {
            var key = exp.batch_id || ('solo_' + exp.id)
            if (!groups[key]) {
              groups[key] = { items: [], total: 0, submitter: exp.profiles?.name || '', latest: exp.created_at || '' }
              orderKeys.push(key)
            }
            groups[key].items.push(exp)
            groups[key].total += (exp.amount_paise || 0)
            if (exp.created_at && exp.created_at > groups[key].latest) groups[key].latest = exp.created_at
          })
          return orderKeys.map(function (gk) {
            var grp = groups[gk]
            var isCollapsed = collapsedGroups[gk]
            var isSingleton = grp.items.length === 1
            return (
              <div key={gk} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button onClick={function () { if (isSingleton) { openDetail(Object.assign({}, grp.items[0], { _fromApprove: view === 'approve' })); return } setCollapsedGroups(function (p) { var n = Object.assign({}, p); n[gk] = !p[gk]; return n }) }}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 transition-colors border-b border-indigo-100">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs">{isSingleton ? '›' : (isCollapsed ? '▶' : '▼')}</span>
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-sm font-bold text-indigo-800 truncate">
                        {view === 'approve' && grp.submitter ? grp.submitter + ' · ' : ''}
                        {isSingleton ? (grp.items[0].description || 'Expense') : (grp.items.length + ' entries')}
                      </p>
                      <p className="text-[10px] text-indigo-500 font-medium">{grp.latest ? formatDate(grp.latest) : ''}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-indigo-700 flex-shrink-0 ml-2">{formatPoints(grp.total)}</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {grp.items.map(function (exp) {
                      return (
                        <div key={exp.id}
                          onClick={function () {
                            var e = Object.assign({}, exp, { _fromApprove: view === 'approve' })
                            openDetail(e)
                          }}
                          className="p-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {exp.expense_types?.name
                      ? exp.expense_types.name + (exp.expense_sub_types?.name ? ' > ' + exp.expense_sub_types.name : '')
                      : 'Expense'}
                  </p>
                  {exp.description && (
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{exp.description}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {(function () {
                      var a = (exp.expense_allocations && exp.expense_allocations[0]) || null
                      if (!a) return ''
                      var d = a.department || ''
                      var sd = a.sub_department_id ? (subDeptMap[a.sub_department_id] || '') : ''
                      return (d + (sd ? ' › ' + sd : '') + (d || sd ? ' · ' : ''))
                    })()}
                    {formatDate(exp.expense_date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                  <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
                    {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
                  </span>
                </div>
              </div>
              {exp.status === 'rejected' && exp.rejection_reason && (
                <p className="text-[11px] text-red-500 mt-1 line-clamp-1">Reason: {exp.rejection_reason}</p>
              )}
              {exp.status === 'deducted' && (
                <div className="mt-1.5 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-red-600 font-medium">💰 Deduction</span>
                    <span className="text-sm font-bold text-red-700">{formatPoints(exp.penalty_paise || 0)}</span>
                  </div>
                  {exp.flag_reason && <p className="text-[11px] text-red-500 mt-0.5 line-clamp-2">{exp.flag_reason}</p>}
                </div>
              )}
              {exp.status === 'flagged' && exp.flag_reason && (
                <div className="mt-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-amber-600 font-medium">⚠ Flagged</p>
                  <p className="text-[11px] text-amber-500 mt-0.5 line-clamp-2">{exp.flag_reason}</p>
                </div>
              )}
              {(function () {
                var paths = (exp.receipt_paths && exp.receipt_paths.length > 0) ? exp.receipt_paths : (exp.receipt_path ? [exp.receipt_path] : [])
                if (paths.length === 0) return null
                return <span className="text-[10px] text-green-600 font-medium mt-1">📎 {paths.length > 1 ? paths.length + ' receipts attached' : 'Receipt attached'}</span>
              })()}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        })()}
      </div>}

      {/* Load More */}
      {view !== 'all' && displayHasMore && (
        <button onClick={function () {
          if (view === 'approve') loadApprovalExpenses(true)
          else loadMyExpenses(true)
        }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

export default Expenses