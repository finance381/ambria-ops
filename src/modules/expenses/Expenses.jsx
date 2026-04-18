import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import SearchDropdown from '../../components/ui/SearchDropdown'

var STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

function Expenses({ profile }) {
  var perms = profile?.permissions || []
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var canApprove = isAdmin || perms.includes('expense_approve')
  var canSubmit = isAdmin || perms.includes('expense_submit')

  var [view, setView] = useState(canApprove ? 'review' : 'my')
  var [expenses, setExpenses] = useState([])
  var [categories, setCategories] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [showForm, setShowForm] = useState(false)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [receiptPreview, setReceiptPreview] = useState(null)

  // Wallet state
  var [wallet, setWallet] = useState(null)
  var [transactions, setTransactions] = useState([])
  var [allWallets, setAllWallets] = useState([])
  var [selectedWalletUser, setSelectedWalletUser] = useState(null)
  var [walletSearch, setWalletSearch] = useState('')
  var [walletRoleFilter, setWalletRoleFilter] = useState('')
  var [txDateFrom, setTxDateFrom] = useState('')
  var [txDateTo, setTxDateTo] = useState('')
  var [showIssue, setShowIssue] = useState(false)
  var [issueUserId, setIssueUserId] = useState('')
  var [issueAmount, setIssueAmount] = useState('')
  var [issueDesc, setIssueDesc] = useState('')
  var [allUsers, setAllUsers] = useState([])
  var [selectedUserWallet, setSelectedUserWallet] = useState(null)

  // Form state
  var [formCat, setFormCat] = useState('')
  var [formAmount, setFormAmount] = useState('')
  var [formDesc, setFormDesc] = useState('')
  var [formDate, setFormDate] = useState(new Date().toISOString().substring(0, 10))
  var [formReceipt, setFormReceipt] = useState(null)

  useEffect(function () { loadData(); loadWallet() }, [view])

  async function loadWallet() {
    var { data } = await supabase.from('wallets')
      .select('id, balance_paise, updated_at')
      .eq('user_id', profile.id)
      .maybeSingle()
    setWallet(data)
  }

  async function loadTransactions() {
    if (!wallet) return
    var { data } = await supabase.from('wallet_transactions')
      .select('id, type, amount_paise, balance_after_paise, description, reference_type, performed_by, created_at, performer:profiles!wallet_transactions_performed_by_fkey(name)')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setTransactions(data || [])
  }

  async function loadData() {
    setLoading(true)
    var queries = [
      supabase.from('expense_categories').select('id, name').eq('active', true).order('name'),
    ]
    if (view === 'review') {
      queries.push(
        supabase.from('expenses')
          .select('id, user_id, category_id, amount_paise, description, receipt_path, status, reviewed_by, reviewed_at, rejection_reason, expense_date, created_at, expense_categories(name), profiles!expenses_user_id_fkey(name, email), reviewer:profiles!expenses_reviewed_by_fkey(name)')
          .order('created_at', { ascending: false })
          .limit(200)
      )
    } else if (view === 'my') {
      queries.push(
        supabase.from('expenses')
          .select('id, user_id, category_id, amount_paise, description, receipt_path, status, reviewed_by, reviewed_at, rejection_reason, expense_date, created_at, expense_categories(name), reviewer:profiles!expenses_reviewed_by_fkey(name)')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(100)
      )
    }
    var results = await Promise.all(queries)
    setCategories(results[0].data || [])
    if (view !== 'wallet') {
      setExpenses(results[1]?.data || [])
    }
    setLoading(false)
  }

  useEffect(function () {
    if (view === 'wallet') {
      if (isAdmin) { loadAllWallets() }
      else if (wallet) { loadTransactions() }
    }
  }, [view, wallet?.id])

  async function loadAllWallets() {
    var { data: profiles } = await supabase.from('profiles')
      .select('id, name, email, role')
      .eq('active', true)
      .order('name')
    var { data: wallets } = await supabase.from('wallets')
      .select('id, user_id, balance_paise, updated_at')
    var walletMap = {}
    ;(wallets || []).forEach(function (w) { walletMap[w.user_id] = w })
    var merged = (profiles || []).map(function (p) {
      var w = walletMap[p.id]
      return { id: p.id, name: p.name, email: p.email, role: p.role, balance_paise: w ? w.balance_paise : 0, wallet_id: w ? w.id : null }
    })
    setAllWallets(merged)
  }

  async function loadUserTransactions(user, dateFrom, dateTo) {
    setSelectedWalletUser(user)
    if (!user.wallet_id) { setTransactions([]); return }
    var query = supabase.from('wallet_transactions')
      .select('id, type, amount_paise, balance_after_paise, description, reference_type, performed_by, created_at, performer:profiles!wallet_transactions_performed_by_fkey(name)')
      .eq('wallet_id', user.wallet_id)
    if (dateFrom) { query = query.gte('created_at', dateFrom + 'T00:00:00') }
    if (dateTo) { query = query.lte('created_at', dateTo + 'T23:59:59') }
    var { data } = await query.order('created_at', { ascending: false }).limit(200)
    setTransactions(data || [])
  }

  function exportTransactions() {
    if (transactions.length === 0) return
    var userName = selectedWalletUser?.name || 'user'
    var rows = [['Date', 'Type', 'Amount', 'Balance After', 'Description', 'By']]
    transactions.forEach(function (tx) {
      rows.push([
        new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        tx.type,
        (tx.type === 'debit' ? '-' : '+') + (tx.amount_paise / 100).toFixed(2),
        (tx.balance_after_paise / 100).toFixed(2),
        (tx.description || '').replace(/,/g, ' '),
        tx.performer?.name || '—',
      ])
    })
    var csv = '\uFEFF' + rows.map(function (r) { return r.join(',') }).join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    var range = (txDateFrom || 'all') + '_to_' + (txDateTo || 'now')
    a.download = 'wallet_' + userName.replace(/\s+/g, '_') + '_' + range + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(function () {
    if (isAdmin) {
      supabase.from('profiles').select('id, name, email, role').eq('active', true).order('name')
        .then(function (res) { setAllUsers(res.data || []) })
    }
  }, [])

  function resetForm() {
    setFormCat('')
    setFormAmount('')
    setFormDesc('')
    setFormDate(new Date().toISOString().substring(0, 10))
    setFormReceipt(null)
    setShowForm(false)
  }

  async function handleSubmit() {
    if (!formCat || !formAmount || !formDesc.trim()) {
      alert('Category, amount, description required')
      return
    }
    var amtPaise = Math.round(Number(formAmount) * 100)
    if (amtPaise <= 0 || isNaN(amtPaise)) {
      alert('Enter valid amount')
      return
    }
    setSaving(true)

    var receiptPath = null
    if (formReceipt) {
      var ext = formReceipt.name.split('.').pop() || 'jpg'
      var filePath = profile.id + '/' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(filePath, formReceipt)
      if (upErr) {
        alert('Receipt upload failed: ' + upErr.message)
        setSaving(false)
        return
      }
      receiptPath = filePath
    }

    var { error } = await supabase.from('expenses').insert({
      user_id: profile.id,
      category_id: Number(formCat),
      amount_paise: amtPaise,
      description: formDesc.trim(),
      expense_date: formDate,
      receipt_path: receiptPath,
      status: 'pending',
    })
    if (error) {
      alert('Submit failed: ' + error.message)
      setSaving(false)
      return
    }
    logActivity('EXPENSE_SUBMIT', formatPaise(amtPaise) + ' | ' + formDesc.trim().substring(0, 50))
    resetForm()
    setSaving(false)
    loadData()
  }

  async function approveExpense(exp) {
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    logActivity('EXPENSE_APPROVE', formatPaise(exp.amount_paise) + ' | ' + (exp.profiles?.name || '—'))
    loadData()
    loadWallet()
    setSaving(false)
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rejectReason.trim(),
    }).eq('id', rejectTarget.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    logActivity('EXPENSE_REJECT', formatPaise(rejectTarget.amount_paise) + ' | ' + rejectReason.trim().substring(0, 50))
    setRejectTarget(null)
    setRejectReason('')
    loadData()
    setSaving(false)
  }

  async function handleIssueMoney() {
    if (!issueUserId || !issueAmount) {
      alert('Select user and enter amount')
      return
    }
    var amtPaise = Math.round(Number(issueAmount) * 100)
    if (amtPaise <= 0 || isNaN(amtPaise)) {
      alert('Enter valid amount')
      return
    }
    setSaving(true)
    var { data, error } = await supabase.rpc('issue_money', {
      p_user_id: issueUserId,
      p_amount_paise: amtPaise,
      p_description: issueDesc.trim() || 'Petty cash issued',
    })
    if (error) {
      alert('Issue failed: ' + error.message)
      setSaving(false)
      return
    }
    var userName = allUsers.find(function (u) { return u.id === issueUserId })?.name || '—'
    logActivity('WALLET_ISSUE', formatPaise(amtPaise) + ' → ' + userName)
    setShowIssue(false)
    setIssueUserId('')
    setIssueAmount('')
    setIssueDesc('')
    setSelectedUserWallet(null)
    loadWallet()
    if (isAdmin) { loadAllWallets() }
    setSaving(false)
  }

  async function onIssueUserChange(uid) {
    setIssueUserId(uid)
    if (!uid) { setSelectedUserWallet(null); return }
    var { data } = await supabase.from('wallets')
      .select('balance_paise')
      .eq('user_id', uid)
      .maybeSingle()
    setSelectedUserWallet(data)
  }

  function getReceiptUrl(path) {
    if (!path) return null
    var { data } = supabase.storage.from('receipts').getPublicUrl(path)
    return data?.publicUrl || null
  }

  var searchLower = search.toLowerCase()
  var filtered = expenses.filter(function (e) {
    if (statusFilter && e.status !== statusFilter) return false
    if (!search) return true
    return (e.description || '').toLowerCase().includes(searchLower) ||
      (e.expense_categories?.name || '').toLowerCase().includes(searchLower) ||
      (e.profiles?.name || '').toLowerCase().includes(searchLower) ||
      String(e.amount_paise).includes(search)
  })

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-3">
      {/* Wallet balance card — own balance for staff, summary for admin */}
      {!isAdmin && (
        <div className={"rounded-xl p-4 border " + (wallet && wallet.balance_paise < 0 ? "bg-red-50 border-red-200" : "bg-indigo-50 border-indigo-200")}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Wallet Balance</p>
              <p className={"text-2xl font-bold mt-1 " + (wallet && wallet.balance_paise < 0 ? "text-red-600" : "text-indigo-700")}>
                {wallet ? formatPaise(wallet.balance_paise) : '₹0.00'}
              </p>
              {wallet && wallet.balance_paise < 0 && (
                <p className="text-xs text-red-500 mt-0.5 font-medium">Overdraft</p>
              )}
            </div>
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="rounded-xl p-4 border bg-indigo-50 border-indigo-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Issued</p>
              <p className="text-2xl font-bold mt-1 text-indigo-700">
                {formatPaise(allWallets.reduce(function (s, w) { return s + (w.balance_paise > 0 ? w.balance_paise : 0) }, 0))}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{allWallets.filter(function (w) { return w.balance_paise !== 0 }).length} active wallets</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-red-500">Total Overdraft</p>
              <p className="text-lg font-bold text-red-600">
                {formatPaise(Math.abs(allWallets.reduce(function (s, w) { return s + (w.balance_paise < 0 ? w.balance_paise : 0) }, 0)))}
              </p>
            </div>
            <button onClick={function () { setShowIssue(true) }}
              className="px-3 py-1.5 text-xs font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors">
              + Issue Money
            </button>
          </div>
        </div>
      )}

      {/* View toggle + Add button */}
      <div className="flex items-center gap-2">
        <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          {canApprove && (
            <button onClick={function () { setView('review') }}
              className={"px-3 py-1.5 text-xs font-bold transition-colors " + (view === 'review' ? "bg-gray-900 text-white" : "text-gray-400")}>
              Review
            </button>
          )}
          <button onClick={function () { setView('my') }}
            className={"px-3 py-1.5 text-xs font-bold transition-colors " + (view === 'my' ? "bg-gray-900 text-white" : "text-gray-400")}>
            My Expenses
          </button>
          <button onClick={function () { setView('wallet') }}
            className={"px-3 py-1.5 text-xs font-bold transition-colors " + (view === 'wallet' ? "bg-gray-900 text-white" : "text-gray-400")}>
            Transactions
          </button>
        </div>
        <div className="flex-1" />
        {canSubmit && view === 'my' && (
          <button onClick={function () { setShowForm(true) }}
            className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
            + New Expense
          </button>
        )}
      </div>

      {/* ═══ WALLET VIEW ═══ */}
      {view === 'wallet' && !isAdmin && (
        <div className="space-y-2">
          <div className="text-sm text-gray-400">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</div>
          {transactions.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No transactions yet</p>
            </div>
          )}
          {transactions.map(function (tx) {
            var isCredit = tx.type === 'credit'
            return (
              <div key={tx.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={"text-sm font-bold " + (isCredit ? "text-green-600" : "text-red-600")}>
                        {isCredit ? '+' : '-'}{formatPaise(tx.amount_paise)}
                      </span>
                      <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full " + (isCredit ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {tx.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{tx.description || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-medium text-gray-700">Bal: {formatPaise(tx.balance_after_paise)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(tx.created_at)}</p>
                  </div>
                </div>
                {tx.performer?.name && (
                  <p className="text-[11px] text-gray-400 mt-1">By: {tx.performer.name}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ ADMIN ALL WALLETS VIEW ═══ */}
      {view === 'wallet' && isAdmin && !selectedWalletUser && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input type="text" value={walletSearch}
              onChange={function (e) { setWalletSearch(e.target.value) }}
              placeholder="Search user..."
              className="flex-1 min-w-[150px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
            <select value={walletRoleFilter} onChange={function (e) { setWalletRoleFilter(e.target.value) }}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All roles</option>
              {[...new Set(allWallets.map(function (w) { return w.role }))].sort().map(function (r) {
                return <option key={r} value={r}>{r}</option>
              })}
            </select>
          </div>
          <div className="text-sm text-gray-400">
            {(function () {
              var wSearch = walletSearch.toLowerCase()
              return allWallets.filter(function (w) {
                if (walletRoleFilter && w.role !== walletRoleFilter) return false
                if (!walletSearch) return true
                return w.name.toLowerCase().includes(wSearch) || (w.email || '').toLowerCase().includes(wSearch)
              }).length
            })()} users
          </div>
          {allWallets.filter(function (w) {
            if (walletRoleFilter && w.role !== walletRoleFilter) return false
            if (!walletSearch) return true
            var wSearch = walletSearch.toLowerCase()
            return w.name.toLowerCase().includes(wSearch) || (w.email || '').toLowerCase().includes(wSearch)
          }).map(function (w) {
            return (
              <div key={w.id} onClick={function () { loadUserTransactions(w) }}
                className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{w.name}</p>
                    <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600"}>{w.role}</span>
                  </div>
                  <p className={"text-lg font-bold " + (w.balance_paise < 0 ? "text-red-600" : w.balance_paise > 0 ? "text-green-600" : "text-gray-400")}>
                    {formatPaise(w.balance_paise)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ ADMIN SELECTED USER TRANSACTIONS ═══ */}
      {view === 'wallet' && isAdmin && selectedWalletUser && (
        <div className="space-y-2">
          <button onClick={function () { setSelectedWalletUser(null); setTransactions([]); setTxDateFrom(''); setTxDateTo('') }}
            className="text-xs font-bold text-indigo-600 hover:underline">← Back to all wallets</button>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{selectedWalletUser.name}</p>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{selectedWalletUser.role}</span>
              </div>
              <p className={"text-xl font-bold " + (selectedWalletUser.balance_paise < 0 ? "text-red-600" : "text-green-600")}>
                {formatPaise(selectedWalletUser.balance_paise)}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <input type="date" value={txDateFrom}
              onChange={function (e) { setTxDateFrom(e.target.value) }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={txDateTo}
              onChange={function (e) { setTxDateTo(e.target.value) }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
            <button onClick={function () { loadUserTransactions(selectedWalletUser, txDateFrom, txDateTo) }}
              className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
              Filter
            </button>
            {(txDateFrom || txDateTo) && (
              <button onClick={function () { setTxDateFrom(''); setTxDateTo(''); loadUserTransactions(selectedWalletUser, '', '') }}
                className="px-3 py-1.5 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                Reset
              </button>
            )}
            <div className="flex-1" />
            <button onClick={exportTransactions} disabled={transactions.length === 0}
              className="px-3 py-1.5 text-xs font-bold text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-30 transition-colors">
              Export CSV
            </button>
          </div>
          <div className="text-sm text-gray-400">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</div>
          {transactions.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No transactions for this user</p>
            </div>
          )}
          {transactions.map(function (tx) {
            var isCredit = tx.type === 'credit'
            return (
              <div key={tx.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={"text-sm font-bold " + (isCredit ? "text-green-600" : "text-red-600")}>
                        {isCredit ? '+' : '-'}{formatPaise(tx.amount_paise)}
                      </span>
                      <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full " + (isCredit ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {tx.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{tx.description || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-medium text-gray-700">Bal: {formatPaise(tx.balance_after_paise)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(tx.created_at)}</p>
                  </div>
                </div>
                {tx.performer?.name && (
                  <p className="text-[11px] text-gray-400 mt-1">By: {tx.performer.name}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ EXPENSES LIST (my + review) ═══ */}
      {view !== 'wallet' && (
        <>
          <input type="text" value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search expenses..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />

          <div className="flex items-center gap-3">
            {view === 'review' && (
              <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            )}
            <div className="text-sm text-gray-400">
              {filtered.length} expense{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">{view === 'review' ? 'No expenses' : 'No expenses yet'}</p>
            </div>
          )}

          {filtered.map(function (exp) {
            var receiptUrl = getReceiptUrl(exp.receipt_path)
            return (
              <div key={exp.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-bold text-gray-900">{formatPaise(exp.amount_paise)}</p>
                      <p className="text-sm text-gray-700 mt-0.5">{exp.description}</p>
                    </div>
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 " + (STATUS_COLORS[exp.status] || '')}>
                      {exp.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>📁 {exp.expense_categories?.name || '—'}</span>
                    <span>📅 {formatDate(exp.expense_date)}</span>
                    {view === 'review' && exp.profiles && (
                      <span>👤 {exp.profiles.name}</span>
                    )}
                    {exp.status === 'rejected' && exp.rejection_reason && (
                      <span className="text-red-500">❌ {exp.rejection_reason}</span>
                    )}
                    {exp.status !== 'pending' && exp.reviewer?.name && (
                      <span>🔍 {exp.reviewer.name}</span>
                    )}
                  </div>
                  {receiptUrl && (
                    <button onClick={function () { setReceiptPreview(receiptUrl) }}
                      className="mt-2 text-xs text-indigo-600 font-medium hover:underline">
                      📎 View Receipt
                    </button>
                  )}
                </div>
                {view === 'review' && exp.status === 'pending' && canApprove && (
                  <div className="flex border-t border-gray-100">
                    <button onClick={function () { approveExpense(exp) }} disabled={saving}
                      className="flex-1 py-3 text-sm font-bold text-green-600 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 transition-colors">
                      ✓ Approve
                    </button>
                    <div className="w-px bg-gray-100" />
                    <button onClick={function () { setRejectTarget(exp); setRejectReason('') }} disabled={saving}
                      className="flex-1 py-3 text-sm font-bold text-red-500 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors">
                      ✗ Reject
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* ═══ SUBMIT FORM MODAL ═══ */}
      <Modal open={showForm} onClose={resetForm} title="New Expense">
        <div className="space-y-4">
          {wallet && (
            <div className={"rounded-lg p-3 text-sm font-medium " + (wallet.balance_paise < 0 ? "bg-red-50 text-red-700" : "bg-indigo-50 text-indigo-700")}>
              Wallet: {formatPaise(wallet.balance_paise)}{wallet.balance_paise < 0 ? ' (Overdraft)' : ''}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
            <select value={formCat} onChange={function (e) { setFormCat(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }}>
              <option value="">Select category</option>
              {categories.map(function (c) {
                return <option key={c.id} value={String(c.id)}>{c.name}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
            <input type="number" inputMode="decimal" step="0.01" min="0" value={formAmount}
              onChange={function (e) { setFormAmount(e.target.value) }}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
            <textarea value={formDesc} onChange={function (e) { setFormDesc(e.target.value) }}
              rows="2" maxLength="500" placeholder="What was this expense for?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={formDate}
              onChange={function (e) { setFormDate(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Receipt (optional)</label>
            <input type="file" accept="image/*,application/pdf"
              onChange={function (e) { setFormReceipt(e.target.files?.[0] || null) }}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={resetForm}
              className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving || !formCat || !formAmount || !formDesc.trim()}
              className="flex-1 px-4 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══ ISSUE MONEY MODAL ═══ */}
      <Modal open={showIssue} onClose={function () { setShowIssue(false); setIssueUserId(''); setIssueAmount(''); setIssueDesc(''); setSelectedUserWallet(null) }} title="Issue Petty Cash">
        <div className="space-y-4">
          <div>
            <SearchDropdown
              label="User"
              required
              items={allUsers.map(function (u) { return { label: u.name + ' (' + u.role + ')', value: u.id } })}
              value={issueUserId}
              onChange={function (val) { onIssueUserChange(val) }}
              placeholder="Search user..."
            />
            {selectedUserWallet && (
              <p className={"text-xs mt-1 font-medium " + (selectedUserWallet.balance_paise < 0 ? "text-red-500" : "text-green-600")}>
                Current balance: {formatPaise(selectedUserWallet.balance_paise)}
              </p>
            )}
            {issueUserId && !selectedUserWallet && (
              <p className="text-xs mt-1 text-gray-400">No wallet yet — will be created on issue</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
            <input type="number" inputMode="decimal" step="0.01" min="0" value={issueAmount}
              onChange={function (e) { setIssueAmount(e.target.value) }}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" value={issueDesc}
              onChange={function (e) { setIssueDesc(e.target.value) }}
              placeholder="Petty cash issued"
              maxLength="200"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={function () { setShowIssue(false); setIssueUserId(''); setIssueAmount(''); setIssueDesc(''); setSelectedUserWallet(null) }}
              className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">
              Cancel
            </button>
            <button onClick={handleIssueMoney} disabled={saving || !issueUserId || !issueAmount}
              className="flex-1 px-4 py-3 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Issuing...' : 'Issue Money'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══ REJECT MODAL ═══ */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title="Reject Expense">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Reject {formatPaise(rejectTarget.amount_paise)} expense?</p>
              <p className="text-xs text-red-600 mt-1">{rejectTarget.description}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea value={rejectReason}
                onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3" maxLength="500" placeholder="Reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex gap-3">
              <button onClick={function () { setRejectTarget(null) }}
                className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
              <button onClick={confirmReject} disabled={saving || !rejectReason.trim()}
                className="flex-1 px-4 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ RECEIPT PREVIEW MODAL ═══ */}
      <Modal open={!!receiptPreview} onClose={function () { setReceiptPreview(null) }} title="Receipt">
        {receiptPreview && (
          <div className="flex items-center justify-center">
            {receiptPreview.endsWith('.pdf') ? (
              <a href={receiptPreview} target="_blank" rel="noopener noreferrer"
                className="text-indigo-600 font-medium text-sm hover:underline">Open PDF in new tab</a>
            ) : (
              <img src={receiptPreview} alt="Receipt" className="max-w-full max-h-[70vh] rounded-lg" />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Expenses
