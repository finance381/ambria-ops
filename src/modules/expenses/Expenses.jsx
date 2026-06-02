import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import ExpenseFormMulti from './ExpenseForm'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import WalletManager from './WalletManager'
import ExpenseTypeMaster from './ExpenseTypeMaster'
import AllExpenses from './AllExpenses'
import ExpenseEditForm from './ExpenseEditForm'
import ExpenseDetail from './ExpenseDetail'
import ExpenseReport from './ExpenseReport'
import { pushBack, goBack as navBack } from '../../lib/backnav'

var PAGE_SIZE = 20

function Expenses({ profile, masterMode }) {
  var [view, setView] = useState('list') // list | form | detail | approve
  var [myExpenses, setMyExpenses] = useState([])
  var [approvalExpenses, setApprovalExpenses] = useState([])
  var [myHasMore, setMyHasMore] = useState(false)
  var [approvalHasMore, setApprovalHasMore] = useState(false)
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  var [detailExp, setDetailExp] = useState(null)
  var [statusFilter, setStatusFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [expSearch, setExpSearch] = useState('')
  var [expSearchDebounced, setExpSearchDebounced] = useState('')
  var [reportView, setReportView] = useState(false)
  var [allExpView, setAllExpView] = useState(false)
  var [editExp, setEditExp] = useState(null)
  var [walletBalance, setWalletBalance] = useState(0)
  var [pendingReceiveCount, setPendingReceiveCount] = useState(0)
  var [myWallet, setMyWallet] = useState(null)
  var [showWallet, setShowWallet] = useState(false)
  var [subCatMap, setSubCatMap] = useState({})
  var [typesModal, setTypesModal] = useState(false)


  var isAdmin = profile?.role === 'admin' || (profile?.permissions && profile.permissions.indexOf('expense_approve') >= 0)
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var hasExpenseApprove = (profile?.permissions || []).indexOf('expense_approve') !== -1
  var showApproveTab = isAdmin || isAuditor || hasExpenseApprove

  useEffect(function () {
    var timer = setTimeout(function () { setExpSearchDebounced(expSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [expSearch])

  useEffect(function () {
    supabase.from('sub_categories').select('id, name').then(function (res) {
      var map = {}
      ;(res.data || []).forEach(function (sc) { map[sc.id] = sc.name })
      setSubCatMap(map)
    })
  }, [])

   useEffect(function () {
    supabase.from('wallets').select('id, balance_paise, user_id').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        setWalletBalance(res.data?.balance_paise || 0)
        if (res.data) setMyWallet(res.data)
      })
    supabase.from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('type', 'credit')
      .then(function (res) { setPendingReceiveCount(res.count || 0) })
    supabase.from('wallet_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('to_user_id', profile.id)
      .eq('status', 'pending')
      .then(function (res) { setPendingReceiveCount(function (prev) { return prev + (res.count || 0) }) })
    loadMyExpenses(false)
    loadApprovalExpenses(false)
  }, [statusFilter, dateFrom, dateTo, expSearchDebounced])
  async function loadMyExpenses(append) {
    var offset = append ? myExpenses.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var query = supabase.from('expenses')
      .select('id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, categories(name), expense_types(name, extra_fields), events(event_name)')
      .eq('user_id', profile.id)
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (statusFilter) query = query.eq('status', statusFilter)
    if (dateFrom) query = query.gte('expense_date', dateFrom)
    if (dateTo) query = query.lte('expense_date', dateTo)
    if (expSearchDebounced) query = query.ilike('description', '%' + expSearchDebounced + '%')

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

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, categories(name), expense_types(name, extra_fields), events(event_name)')
      .neq('user_id', profile.id)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

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
    pushBack(function () { setView('list'); setDetailExp(null); setEditExp(null) })
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
    var headers = ['Date', 'Category', 'Sub-Category', 'Amount (pts)', 'Description', 'Status', 'Created']
    var rows = myExpenses.map(function (e) {
      return [
        e.expense_date || '',
        e.categories?.name || '',
        subCatMap[e.sub_category_id] || '',
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
  if (masterMode) {
    return <ExpenseTypeMaster />
  }
  if (allExpView && (isAdmin || isAuditor)) {
    return (
      <AllExpenses
        subCatMap={subCatMap}
        onBack={function () { setAllExpView(false) }}
        onOpenDetail={function (exp) { setDetailExp(exp); setView('detail') }}
      />
    )
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
    if (editExp) {
      return (
        <ExpenseEditForm
          profile={profile}
          editExp={editExp}
          walletBalance={walletBalance}
          onCancel={function () { setView('list'); setEditExp(null) }}
          onSaved={handleFormDone}
        />
      )
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Expenses</h2>
          <button onClick={function () { setView('list') }} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
        </div>
        <ExpenseFormMulti profile={profile} onDone={handleFormDone} />
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
        subCatMap={subCatMap}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onBack={function () { navBack() }}
        onUpdated={function () { loadMyExpenses(false); loadApprovalExpenses(false); if (allExpView) { setView('list'); setDetailExp(null); return } setView(detailExp._fromApprove ? 'approve' : 'list'); setDetailExp(null) }}
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
  // WALLET MANAGER
  // ═══════════════════════════════════════════════
  function refreshWalletInfo() {
    supabase.from('wallets').select('id, balance_paise, user_id').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        setWalletBalance(res.data?.balance_paise || 0)
        if (res.data) setMyWallet(res.data)
      })
    setPendingReceiveCount(0)
    supabase.from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('type', 'credit')
      .then(function (res) { setPendingReceiveCount(res.count || 0) })
    supabase.from('wallet_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('to_user_id', profile.id)
      .eq('status', 'pending')
      .then(function (res) { setPendingReceiveCount(function (prev) { return prev + (res.count || 0) }) })
  }

  if (showWallet) {
    return (
      <WalletManager
        profile={profile}
        isAdmin={isAdmin}
        isAuditor={isAuditor}
        myWallet={myWallet}
        walletBalance={walletBalance}
        onClose={function () { setShowWallet(false); refreshWalletInfo() }}
        onBalanceChange={setWalletBalance}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // LIST / APPROVE VIEW
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Two cards: Wallet + Expenses */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={"rounded-xl p-4 border cursor-pointer active:scale-[0.98] transition-transform relative " + (walletBalance < 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200")}
          onClick={function () { setShowWallet(true) }}>
          {pendingReceiveCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pendingReceiveCount}</span>
          )}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Wallet</p>
          <p className={"text-xl font-bold mt-1 " + (walletBalance < 0 ? "text-red-700" : "text-green-700")}>{formatPoints(walletBalance)}</p>
          {(isAdmin || isAuditor) && <p className="text-[10px] text-indigo-600 font-medium mt-1">Manage →</p>}
          {!(isAdmin || isAuditor) && pendingReceiveCount > 0 && <p className="text-[10px] text-amber-600 font-medium mt-1">{pendingReceiveCount} pending →</p>}
          {!(isAdmin || isAuditor) && pendingReceiveCount === 0 && <p className="text-[10px] text-gray-400 font-medium mt-1">View history →</p>}
        </div>
        <div className="rounded-xl p-4 border border-gray-200 bg-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expenses</p>
          <p className="text-xl font-bold mt-1 text-gray-800">{myExpenses.length}</p>
          <p className="text-[10px] text-gray-400 mt-1">{myTotal > 0 ? formatPoints(myTotal) + ' total' : 'No expenses yet'}</p>
        </div>
      </div>

      {/* Admin shortcuts */}
      {(isAdmin || isAuditor) && (
        <div className="flex gap-2 md:hidden">
          <button onClick={function () { setReportView(true) }}
            className="flex-1 py-2.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
            📊 Reports
          </button>
          <button onClick={function () { setAllExpView(true) }}
            className="flex-1 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
            📋 All Expenses
          </button>
          {(profile?.permissions || []).indexOf('admin_masters') !== -1 && (
            <button onClick={function () { setTypesModal(true) }}
              className="flex-1 py-2.5 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
              ⚙ Types
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">My Expenses</h2>
          <p className="text-xs text-gray-400">
            {view === 'approve'
              ? approvalExpenses.length + ' pending review'
              : myExpenses.length + ' expenses' + (myTotal > 0 ? ' · ' + formatPoints(myTotal) + ' total' : '')}
          </p>
        </div>
        <div className="flex gap-2">
          {(isAdmin || isAuditor) && (
            <div className="hidden md:flex gap-2">
              <button onClick={function () { setReportView(true) }}
                className="px-3 py-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
                📊 Reports
              </button>
              <button onClick={function () { setAllExpView(true) }}
                className="px-3 py-2 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                📋 All
              </button>
              {(profile?.permissions || []).indexOf('admin_masters') !== -1 && (
                <button onClick={function () { setTypesModal(true) }}
                  className="px-3 py-2 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
                  ⚙ Types
                </button>
              )}
            </div>
          )}
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

      {/* Tabs */}
      {showApproveTab && (
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={function () { setView('list'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (view === 'list' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            My Expenses
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
        </div>
      )}

      {/* Status filter — My Expenses only */}
      {view === 'list' && (
        <div className="flex gap-2 flex-wrap">
          {['', 'recorded', 'acknowledged', 'flagged', 'penalized'].map(function (s) {
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
      )}
      {/* Search */}
      {view === 'list' && (
        <input type="text" value={expSearch} onChange={function (e) { setExpSearch(e.target.value) }}
          placeholder="Search expenses..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
      )}

      {/* Date range filter */}
      {view === 'list' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
            <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
            <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={function () { setDateFrom(''); setDateTo('') }}
              className="self-end px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-px">
              Clear
            </button>
          )}
        </div>
      )}

      {/* List */}
      {displayList.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{view === 'approve' ? 'No pending reviews' : 'No expenses yet'}</p>
        </div>
      )}

      <div className="space-y-3">
        {displayList.map(function (exp) {
          return (
            <div key={exp.id}
              onClick={function () {
                var e = Object.assign({}, exp, { _fromApprove: view === 'approve' })
                openDetail(e)
              }}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{exp.description || 'Expense'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {view === 'approve' ? (exp.profiles?.name || '—') + ' · ' : ''}
                    {exp.expense_types?.name ? exp.expense_types.name + ' · ' : ''}
                    {exp.categories?.name || '—'}
                    {exp.sub_category_id && subCatMap[exp.sub_category_id] ? ' > ' + subCatMap[exp.sub_category_id] : ''}
                    {' · ' + formatDate(exp.expense_date)}
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
              {exp.receipt_path && (
                <span className="text-[10px] text-green-600 font-medium">📎 Receipt attached</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Load More */}
      {displayHasMore && (
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