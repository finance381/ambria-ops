import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { filterUserCategories } from '../../lib/categories'
import ExpenseFormMulti from './ExpenseForm'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import BottomSheet from '../../components/ui/BottomSheet'
import WalletManager from './WalletManager'
import ExpenseTypeMaster from './ExpenseTypeMaster'
import AllExpenses from './AllExpenses'
import ExpenseReport from './ExpenseReport'

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
      .select('id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, categories(name), expense_types(name, extra_fields)')
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

    var statuses = ['recorded']

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, categories(name), expense_types(name, extra_fields)')
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
        onBack={function () { if (allExpView) { setView('list'); setDetailExp(null); return } setView(detailExp._fromApprove ? 'approve' : 'list'); setDetailExp(null) }}
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

// ═══════════════════════════════════════════════════════════════
// FORM — Submit / Edit expense
// ═══════════════════════════════════════════════════════════════
function ExpenseEditForm({ profile, editExp, walletBalance, onCancel, onSaved }) {
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [categoryId, setCategoryId] = useState(editExp ? String(editExp.category_id) : '')
  var [subCategoryId, setSubCategoryId] = useState(editExp?.sub_category_id ? String(editExp.sub_category_id) : '')
  var [amount, setAmount] = useState(editExp ? String(editExp.amount_paise / 100) : '')
  var [description, setDescription] = useState(editExp ? (editExp.description || '') : '')
  var [expenseDate, setExpenseDate] = useState(editExp ? editExp.expense_date : new Date().toISOString().split('T')[0])
  var [receiptFile, setReceiptFile] = useState(null)
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})
  var [dupeWarning, setDupeWarning] = useState('')
  var [fieldValues, setFieldValues] = useState(function () {
    if (!editExp) return {}
    var fv = editExp.metadata && typeof editExp.metadata === 'object' ? Object.assign({}, editExp.metadata) : {}
    if (!fv.vendor_name && editExp.vendor_name) fv.vendor_name = editExp.vendor_name
    if (!fv.travel_from && editExp.travel_from) fv.travel_from = editExp.travel_from
    if (!fv.travel_to && editExp.travel_to) fv.travel_to = editExp.travel_to
    if (!fv.travel_mode && editExp.travel_mode) fv.travel_mode = editExp.travel_mode
    return fv
  })

  var isEditing = !!editExp
  var typeFields = editExp?.expense_types?.extra_fields || []

  useEffect(function () {
    supabase.from('categories').select('id, name, status').order('name')
      .then(function (res) { setCategories(res.data || []) })
  }, [])

  useEffect(function () {
    if (categoryId) {
      supabase.from('sub_categories').select('id, name').eq('category_id', Number(categoryId)).order('name')
        .then(function (res) { setSubCategories(res.data || []) })
    } else { setSubCategories([]); setSubCategoryId('') }
  }, [categoryId])

  useEffect(function () {
    if (!amount || !expenseDate || Number(amount) <= 0 || isEditing) { setDupeWarning(''); return }
    var paise = Math.round(Number(amount) * 100)
    supabase.from('expenses')
      .select('id, description')
      .eq('user_id', profile.id)
      .eq('amount_paise', paise)
      .eq('expense_date', expenseDate)
      .limit(1)
      .maybeSingle()
      .then(function (res) {
        if (res.data) {
          setDupeWarning('Possible duplicate: "' + (res.data.description || 'Expense') + '" with same amount on same date')
        } else {
          setDupeWarning('')
        }
      })
  }, [amount, expenseDate])

  var catItems = filterUserCategories(categories, profile).map(function (c) { return { label: c.name, value: String(c.id) } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id) } })

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = 'Category required'
    if (!amount || Number(amount) <= 0) errs.amount = 'Amount required'
    if (!description.trim()) errs.desc = 'Description required'
    if (!expenseDate) errs.date = 'Date required'
    for (var f = 0; f < typeFields.length; f++) {
      if (typeFields[f].required && !(fieldValues[typeFields[f].key] || '').toString().trim()) {
        errs.field = typeFields[f].label + ' is required'
        break
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function updateFieldValue(key, val) {
    setFieldValues(function (prev) { return Object.assign({}, prev, { [key]: val }) })
  }

  function renderDynamicField(field, value, onChange) {
    var cls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
    var sty = { fontSize: '16px' }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <select value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls + ' bg-white'} style={sty}>
            <option value="">Select...</option>
            {(field.options || []).map(function (opt) { return <option key={opt} value={opt}>{opt}</option> })}
          </select>
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={value || ''} onChange={function (e) { onChange(e.target.value) }} rows={2} className={cls + ' resize-none'} style={sty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls} style={sty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
      </div>
    )
  }

  async function uploadReceipt(expenseId) {
    if (!receiptFile) return null
    var ext = receiptFile.name.split('.').pop()
    var path = profile.id + '/' + expenseId + '_' + Date.now() + '.' + ext
    var { error } = await supabase.storage.from('receipts').upload(path, receiptFile, { upsert: true })
    if (error) return null
    return path
  }

  async function handleSubmit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    try {
      var amountPaise = Math.round(Number(amount) * 100)

      if (isEditing) {
        var { error: updErr } = await supabase.from('expenses').update({
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
          metadata: fieldValues,
          vendor_name: fieldValues.vendor_name || null,
          travel_from: fieldValues.travel_from || null,
          travel_to: fieldValues.travel_to || null,
          travel_mode: fieldValues.travel_mode || null,
        }).eq('id', editExp.id)
        if (updErr) throw new Error(updErr.message)

        if (receiptFile) {
          var path = await uploadReceipt(editExp.id)
          if (path) {
            var { error: pathErr } = await supabase.from('expenses').update({ receipt_path: path }).eq('id', editExp.id)
            if (pathErr) throw new Error(pathErr.message)
          }
        }

        try { await logActivity('EXPENSE_EDIT', description.trim() + ' | ' + formatPoints(amountPaise)) } catch (_) {}

        // Wallet diff adjustment
        var oldPaise = editExp.amount_paise || 0
        var diffPaise = amountPaise - oldPaise
        if (diffPaise !== 0) {
          var wRpc = diffPaise > 0 ? 'wallet_self_debit' : 'wallet_self_credit'
          var wAmt = Math.abs(diffPaise)
          var wRef = diffPaise > 0 ? 'expense' : 'expense_refund'
          var wDesc = 'Expense edited: ' + (diffPaise > 0 ? '+' : '-') + formatPoints(wAmt)
          var { error: wErr } = await supabase.rpc(wRpc, {
            p_amount_paise: wAmt,
            p_description: wDesc,
            p_ref_type: wRef,
            p_ref_id: editExp.id,
          })
          if (wErr) console.warn('Wallet adjust failed:', wErr.message)
        }
      } else {
        var { data: newExp, error: insErr } = await supabase.from('expenses').insert({
          user_id: profile.id,
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
          status: 'recorded',
        }).select('id').single()
        if (insErr) throw new Error(insErr.message)

        if (receiptFile && newExp) {
          var path = await uploadReceipt(newExp.id)
          if (path) {
            await supabase.from('expenses').update({ receipt_path: path }).eq('id', newExp.id)
          }
        }

        try {
          await supabase.rpc('wallet_self_debit', {
            p_amount_paise: amountPaise,
            p_description: 'Expense: ' + description.trim().slice(0, 50),
            p_ref_type: 'expense',
            p_ref_id: String(newExp.id),
          })
        } catch (_) {}
        try { await logActivity('EXPENSE_SUBMIT', description.trim() + ' | ' + formatPoints(amountPaise)) } catch (_) {}
      }

      onSaved()
    } catch (err) {
      setErrors(function (prev) { return Object.assign({}, prev, { submit: err.message }) })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Expense' : 'New Expense'}</h2>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
      </div>

      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
          <input type="date" value={expenseDate} onChange={function (e) { setExpenseDate(e.target.value) }}
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (errors.date ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date}</p>}
        </div>

        <SearchDropdown label="Category" required items={catItems} value={categoryId}
          onChange={function (val) { setCategoryId(val); setSubCategoryId('') }}
          placeholder="Search category..." error={errors.cat} />

        {subCatItems.length > 0 && (
          <SearchDropdown label="Sub-Category" items={subCatItems} value={subCategoryId}
            onChange={setSubCategoryId} placeholder="Search sub-category..." />
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points) <span className="text-red-500">*</span></label>
          <div className="relative">
            <input type="number" min="1" step="any" inputMode="decimal" value={amount}
              onChange={function (e) { setAmount(e.target.value) }}
              placeholder="0"
              className={"w-full px-3 py-2 pr-12 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (errors.amount ? "border-red-300" : "border-gray-300")}
              style={{ fontSize: '16px' }} />
            <span className="absolute right-3 top-2.5 text-xs font-bold text-gray-400">pts</span>
          </div>
          {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
          <textarea value={description} onChange={function (e) { setDescription(e.target.value) }}
            rows="2" maxLength="500" placeholder="What was this expense for?"
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none " + (errors.desc ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.desc && <p className="text-xs text-red-500 mt-1">{errors.desc}</p>}
        </div>

        {typeFields.map(function (field) {
          return renderDynamicField(field, fieldValues[field.key] || '', function (val) { updateFieldValue(field.key, val) })
        })}
        {errors.field && <p className="text-xs text-red-500 mt-1">{errors.field}</p>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receipt (optional)</label>
          <input type="file" accept="image/*,.pdf"
            onChange={function (e) { setReceiptFile(e.target.files?.[0] || null) }}
            className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100" />
          {editExp?.receipt_path && !receiptFile && (
            <p className="text-[11px] text-green-600 mt-1">📎 Existing receipt attached</p>
          )}
        </div>
      </div>

      {/* Summary */}
      {amount && Number(amount) > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">Total</span>
          <span className="text-sm font-bold text-indigo-900">{Number(amount).toLocaleString('en-IN')} pts</span>
        </div>
      )}
      {/* Duplicate warning */}
      {dupeWarning && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
          <span className="text-orange-600 text-lg">⚠️</span>
          <p className="text-sm text-orange-700">{dupeWarning}</p>
        </div>
      )}

      {/* Overdraft warning */}
      {amount && Number(amount) > 0 && walletBalance != null && Math.round(Number(amount) * 100) > walletBalance && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="text-amber-600 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-700">Insufficient balance</p>
            <p className="text-xs text-amber-600">Wallet: {formatPoints(walletBalance)} · Expense: {Number(amount).toLocaleString('en-IN')} pts · Shortfall: {formatPoints(Math.round(Number(amount) * 100) - walletBalance)}</p>
          </div>
        </div>
      )}

      {errors.submit && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.submit}</div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {saving ? (isEditing ? 'Updating...' : 'Submitting...') : (isEditing ? 'Update Expense' : 'Submit Expense')}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DETAIL + APPROVAL VIEW
// ═══════════════════════════════════════════════════════════════
function ExpenseDetail({ exp, profile, subCatMap, isAdmin, isDeptApprover, onBack, onUpdated, onEdit }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')
  var [penaltyAmount, setPenaltyAmount] = useState('')
  var [allocations, setAllocations] = useState([])
  var [allocVenues, setAllocVenues] = useState({})

  useEffect(function () {
    supabase.from('expense_allocations')
      .select('id, department, venue_id, sub_venue_id, amount_paise')
      .eq('expense_id', exp.id)
      .then(function (res) {
        var rows = res.data || []
        setAllocations(rows)
        if (rows.length > 0) {
          var vIds = rows.map(function (r) { return r.venue_id }).filter(Boolean)
          var svIds = rows.map(function (r) { return r.sub_venue_id }).filter(Boolean)
          Promise.all([
            vIds.length > 0 ? supabase.from('venues').select('id, code, name').in('id', vIds) : { data: [] },
            svIds.length > 0 ? supabase.from('sub_venues').select('id, name').in('id', svIds) : { data: [] }
          ]).then(function (results) {
            var map = {}
            ;(results[0].data || []).forEach(function (v) { map['v_' + v.id] = v.code + ' — ' + v.name })
            ;(results[1].data || []).forEach(function (sv) { map['sv_' + sv.id] = sv.name })
            setAllocVenues(map)
          })
        }
      })
  }, [exp.id])

  var canReview = (isAdmin || isDeptApprover) && exp.status === 'recorded' && exp.user_id !== profile?.id
  var canDelete = (exp.user_id === profile?.id && exp.status === 'recorded') || isAdmin
  var canEdit = exp.user_id === profile?.id && exp.status === 'recorded'

  async function acknowledge() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'acknowledged',
      acknowledged_by: profile.id,
      acknowledged_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Acknowledge failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_ACKNOWLEDGE', (exp.description || 'Expense') + ' | ' + formatPoints(exp.amount_paise)) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function flag() {
    if (!rejectReason.trim()) return
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'flagged',
      flag_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Flag failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_FLAG', (exp.description || 'Expense') + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function penalize() {
    if (!rejectReason.trim() || !penaltyAmount || Number(penaltyAmount) <= 0) return
    if (saving) return
    setSaving(true)
    var penaltyPaise = Math.round(Number(penaltyAmount) * 100)
    var { error } = await supabase.from('expenses').update({
      status: 'penalized',
      flag_reason: rejectReason.trim(),
      penalty_paise: penaltyPaise,
      penalized_by: profile.id,
      penalized_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Penalize failed: ' + error.message); setSaving(false); return }
    try {
      await supabase.rpc('deduct_money', {
        p_user_id: exp.user_id,
        p_amount_paise: penaltyPaise,
        p_description: 'Penalty: ' + rejectReason.trim().slice(0, 80),
      })
    } catch (_) {}
    try { await logActivity('EXPENSE_PENALIZE', (exp.description || 'Expense') + ' | ' + formatPoints(penaltyPaise) + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function deleteExp() {
    if (!confirm('Delete this expense? This cannot be undone.')) return
    if (saving) return
    setSaving(true)
    // Delete receipt from storage if exists
    if (exp.receipt_path) {
      await supabase.storage.from('receipts').remove([exp.receipt_path])
    }
    var { error } = await supabase.from('expenses').delete().eq('id', exp.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    try {
      if (exp.user_id === profile?.id) {
        await supabase.rpc('wallet_self_credit', {
          p_amount_paise: exp.amount_paise,
          p_description: 'Refund: deleted expense',
          p_ref_type: 'expense_refund',
          p_ref_id: String(exp.id),
        })
      } else {
        await supabase.rpc('wallet_admin_credit', {
          p_user_id: exp.user_id,
          p_amount_paise: exp.amount_paise,
          p_description: 'Refund: deleted expense',
          p_ref_type: 'expense_refund',
          p_ref_id: String(exp.id),
        })
      }
    } catch (_) {}
    try { await logActivity('EXPENSE_DELETE', exp.description || 'Expense') } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  var receiptUrl = exp.receipt_path ? supabase.storage.from('receipts').getPublicUrl(exp.receipt_path).data?.publicUrl : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-2">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{exp.description || 'Expense'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {exp.profiles?.name || '—'} · {formatDate(exp.expense_date)}
            </p>
          </div>
          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
            {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
          </span>
        </div>
      </div>

      {/* Rejection reason (legacy) */}
      {exp.status === 'rejected' && exp.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{exp.rejection_reason}</p>
        </div>
      )}

      {/* Flag reason */}
      {(exp.status === 'flagged' || exp.status === 'penalized') && exp.flag_reason && (
        <div className={"border rounded-lg p-3 " + (exp.status === 'penalized' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
          <p className={"text-xs font-bold mb-0.5 " + (exp.status === 'penalized' ? "text-red-700" : "text-amber-700")}>{exp.status === 'penalized' ? '💰 Penalized' : '⚠ Flagged'}</p>
          <p className={"text-sm " + (exp.status === 'penalized' ? "text-red-600" : "text-amber-600")}>{exp.flag_reason}</p>
          {exp.penalty_paise > 0 && (
            <p className="text-sm font-bold text-red-700 mt-1">Penalty: {formatPoints(exp.penalty_paise)}</p>
          )}
        </div>
      )}

      {/* Details card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Amount</span>
          <span className="text-sm font-bold text-gray-900">{formatPoints(exp.amount_paise)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Category</span>
          <span className="text-sm text-gray-800">{exp.categories?.name || '—'}{exp.sub_category_id && subCatMap[exp.sub_category_id] ? ' > ' + subCatMap[exp.sub_category_id] : ''}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Date</span>
          <span className="text-sm text-gray-800">{formatDate(exp.expense_date)}</span>
        </div>
        {exp.expense_types?.name && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Type</span>
            <span className="text-sm text-gray-800">{exp.expense_types.name}</span>
          </div>
        )}
        {exp.expense_types?.extra_fields && exp.expense_types.extra_fields.map(function (field) {
          var val = (exp.metadata && exp.metadata[field.key]) || exp[field.key] || null
          if (!val) return null
          return (
            <div key={field.key} className="flex justify-between">
              <span className="text-sm text-gray-500">{field.label}</span>
              <span className="text-sm text-gray-800">{val}</span>
            </div>
          )
        })}
        {exp.description && (
          <div>
            <span className="text-sm text-gray-500">Description</span>
            <p className="text-sm text-gray-800 mt-0.5">{exp.description}</p>
          </div>
        )}
      </div>

      {/* Allocations */}
      {allocations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Allocations</p>
          <div className="space-y-1.5">
            {allocations.map(function (a) {
              return (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">
                    {a.department}
                    {a.venue_id && allocVenues['v_' + a.venue_id] ? ' · ' + allocVenues['v_' + a.venue_id] : ''}
                    {a.sub_venue_id && allocVenues['sv_' + a.sub_venue_id] ? ' > ' + allocVenues['sv_' + a.sub_venue_id] : ''}
                  </span>
                  {a.amount_paise > 0 && <span className="font-medium text-gray-800">{formatPoints(a.amount_paise)}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Receipt */}
      {receiptUrl && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Receipt</p>
          {/\.(webm|ogg|mp3|wav)$/i.test(exp.receipt_path || '') ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium mb-2">🎙 Voice Receipt</p>
              <audio src={receiptUrl} controls className="w-full" />
            </div>
          ) : /\.(jpg|jpeg|png|gif|webp)$/i.test(exp.receipt_path || '') ? (
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
              <img src={receiptUrl} alt="Receipt" className="w-full max-h-80 object-contain rounded-lg border border-gray-200 bg-gray-50" />
            </a>
          ) : (
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
              📎 View Receipt
            </a>
          )}
        </div>
      )}

      {/* Edit button */}
      {canEdit && (
        <button onClick={onEdit} disabled={saving}
          className="w-full py-3 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          ✎ Edit Expense
        </button>
      )}

      {/* Review actions */}
      {canReview && !rejectMode && (
        <div className="space-y-2">
          <button onClick={acknowledge} disabled={saving}
            className="w-full py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : '✓ Acknowledge'}
          </button>
          <div className="flex gap-2">
            <button onClick={function () { setRejectMode('flag') }} disabled={saving}
              className="flex-1 py-3 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors">
              ⚠ Flag
            </button>
            <button onClick={function () { setRejectMode('penalize') }} disabled={saving}
              className="flex-1 py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
              💰 Penalize
            </button>
          </div>
        </div>
      )}

      {rejectMode && (
        <div className="space-y-3">
          <div className={"border rounded-lg p-3 " + (rejectMode === 'penalize' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
            <label className={"block text-sm font-medium mb-1 " + (rejectMode === 'penalize' ? "text-red-700" : "text-amber-700")}>
              {rejectMode === 'penalize' ? 'Penalty Reason' : 'Flag Reason'} <span className="text-red-500">*</span>
            </label>
            <textarea value={rejectReason}
              onChange={function (e) { setRejectReason(e.target.value) }}
              rows="3" maxLength="500" placeholder={rejectMode === 'penalize' ? 'Reason for penalty...' : 'What is the issue?'}
              className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 resize-none " + (rejectMode === 'penalize' ? "border-red-300 focus:ring-red-500" : "border-amber-300 focus:ring-amber-500")}
              style={{ fontSize: '16px' }} />
            {rejectMode === 'penalize' && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-red-700 mb-1">Penalty Amount (Points) <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="any" inputMode="decimal" value={penaltyAmount}
                  onChange={function (e) { setPenaltyAmount(e.target.value) }}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  style={{ fontSize: '16px' }} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setRejectMode(false); setRejectReason(''); setPenaltyAmount('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            {rejectMode === 'penalize' ? (
              <button onClick={penalize} disabled={saving || !rejectReason.trim() || !penaltyAmount || Number(penaltyAmount) <= 0}
                className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Penalizing...' : '💰 Confirm Penalty'}
              </button>
            ) : (
              <button onClick={flag} disabled={saving || !rejectReason.trim()}
                className="flex-1 py-3 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Flagging...' : '⚠ Confirm Flag'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete */}
      {canDelete && !canReview && (
        <button onClick={deleteExp} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Expense
        </button>
      )}
    </div>
  )
}

export default Expenses