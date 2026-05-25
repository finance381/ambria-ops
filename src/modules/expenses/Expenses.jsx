import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase, formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import ExpenseFormMulti from './ExpenseForm'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import BottomSheet from '../../components/ui/BottomSheet'

var PAGE_SIZE = 20

function Expenses({ profile }) {
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
  var [reportData, setReportData] = useState(null)
  var [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 7) + '-01')
  var [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
  var [reportLoading, setReportLoading] = useState(false)
  var [allExpView, setAllExpView] = useState(false)
  var [allExps, setAllExps] = useState([])
  var [allExpHasMore, setAllExpHasMore] = useState(false)
  var [allExpStatus, setAllExpStatus] = useState('')
  var [allExpFrom, setAllExpFrom] = useState('')
  var [allExpTo, setAllExpTo] = useState('')
  var [allExpSearch, setAllExpSearch] = useState('')
  var [allExpSearchD, setAllExpSearchD] = useState('')
  var [allExpLoading, setAllExpLoading] = useState(false)
  var [allExpLoadingMore, setAllExpLoadingMore] = useState(false)
  var [editExp, setEditExp] = useState(null)
  var [walletBalance, setWalletBalance] = useState(0)
  var [walletView, setWalletView] = useState(null) // null | 'wallets' | 'transactions'
  var [allWallets, setAllWallets] = useState([])
  var [walletProfiles, setWalletProfiles] = useState({})
  var [selectedWallet, setSelectedWallet] = useState(null)
  var [walletTxns, setWalletTxns] = useState([])
  var [txnFrom, setTxnFrom] = useState('')
  var [txnTo, setTxnTo] = useState('')
  var [walletSearch, setWalletSearch] = useState('')
  var [issueModal, setIssueModal] = useState(null)
  var [issueAmount, setIssueAmount] = useState('')
  var [issueDesc, setIssueDesc] = useState('')
  var [issueType, setIssueType] = useState('credit')
  var [issueSaving, setIssueSaving] = useState(false)
  var [bulkMode, setBulkMode] = useState(false)
  var [bulkSelected, setBulkSelected] = useState({})
  var [bulkAmount, setBulkAmount] = useState('')
  var [bulkDesc, setBulkDesc] = useState('')
  var [bulkSaving, setBulkSaving] = useState(false)
  var [issueImage, setIssueImage] = useState(null)
  var [receiveModal, setReceiveModal] = useState(null)
  var [receiveImage, setReceiveImage] = useState(null)
  var [receiveSaving, setReceiveSaving] = useState(false)
  var [enlargedWalletImg, setEnlargedWalletImg] = useState(null)
  var [pendingReceiveCount, setPendingReceiveCount] = useState(0)
  var [myWallet, setMyWallet] = useState(null)
  var [pendingIncoming, setPendingIncoming] = useState([])
  var [pendingOutgoing, setPendingOutgoing] = useState([])
  var [transferModal, setTransferModal] = useState(false)
  var [transferUsers, setTransferUsers] = useState([])
  var [transferTo, setTransferTo] = useState('')
  var [transferAmount, setTransferAmount] = useState('')
  var [transferDesc, setTransferDesc] = useState('')
  var [transferImage, setTransferImage] = useState(null)
  var [transferSaving, setTransferSaving] = useState(false)
  var [transferConfirmModal, setTransferConfirmModal] = useState(null)
  var [transferConfirmImage, setTransferConfirmImage] = useState(null)
  var [transferConfirmSaving, setTransferConfirmSaving] = useState(false)
  var [subCatMap, setSubCatMap] = useState({})
  var [typesModal, setTypesModal] = useState(false)
  var [expTypes, setExpTypes] = useState([])
  var [typeName, setTypeName] = useState('')
  var [typeEditId, setTypeEditId] = useState(null)
  var [typeSaving, setTypeSaving] = useState(false)


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
    var timer = setTimeout(function () { setAllExpSearchD(allExpSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [allExpSearch])

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
    loadTransfers()
    loadMyExpenses(false)
    loadApprovalExpenses(false)
  }, [statusFilter, dateFrom, dateTo, expSearchDebounced])
  async function loadMyExpenses(append) {
    var offset = append ? myExpenses.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var query = supabase.from('expenses')
      .select('id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, categories(name), expense_types(name)')
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

    var statuses = []
    if (isAdmin || isAuditor) {
      statuses = isDeptApprover ? ['pending_dept', 'pending'] : ['pending']
    } else if (isDeptApprover) {
      statuses = ['pending_dept']
    }
    if (statuses.length === 0) { setApprovalExpenses([]); return }

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, categories(name), expense_types(name)')
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

  async function loadAllWallets() {
    var [wRes, pRes, pendRes] = await Promise.all([
      supabase.from('wallets').select('id, user_id, balance_paise, updated_at'),
      supabase.from('profiles').select('id, name, email, role').eq('active', true).order('name'),
      supabase.from('wallet_transactions').select('wallet_id').eq('status', 'pending'),
    ])
    var pMap = {}
    ;(pRes.data || []).forEach(function (p) { pMap[p.id] = p })
    setWalletProfiles(pMap)
    var pendingMap = {}
    ;(pendRes.data || []).forEach(function (t) { pendingMap[t.wallet_id] = (pendingMap[t.wallet_id] || 0) + 1 })
    var wMap = {}
    ;(wRes.data || []).forEach(function (w) { wMap[w.user_id] = w })
    var combined = (pRes.data || []).map(function (p) {
      var w = wMap[p.id]
      var wid = w?.id || 'no_wallet_' + p.id
      return { id: wid, user_id: p.id, balance_paise: w?.balance_paise || 0, updated_at: w?.updated_at || null, _hasWallet: !!w, _pendingCount: pendingMap[wid] || 0 }
    })
    setAllWallets(combined)
  }

  async function openWalletTxns(wallet, from, to) {
    if (wallet) setSelectedWallet(wallet)
    var wid = (wallet || selectedWallet)?.id
    if (!wid) return
    var query = supabase.from('wallet_transactions')
      .select('id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, created_at, issued_image_path, received_image_path, received_at, wallet_id, status')
      .eq('wallet_id', wid)
      .order('created_at', { ascending: false })
      .limit(500)
    var f = from != null ? from : txnFrom
    var t = to != null ? to : txnTo
    if (f) query = query.gte('created_at', f + 'T00:00:00')
    if (t) query = query.lte('created_at', t + 'T23:59:59')
    var { data } = await query
    setWalletTxns(data || [])
    if (wallet) setWalletView('transactions')
  }

  async function issuePoints() {
    if (issueSaving || !issueModal || !issueAmount || Number(issueAmount) <= 0) return
    setIssueSaving(true)
    var amountPaise = Math.round(Number(issueAmount) * 100)
    var rpcName = issueType === 'debit' ? 'deduct_money' : 'issue_money'
    var defaultDesc = issueType === 'debit' ? 'Points deducted by admin' : 'Points issued by admin'
    var imagePath = null
    if (issueImage) {
      var ext = issueImage.name.split('.').pop()
      var path = 'wallet/issued/' + issueModal.user_id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, issueImage, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setIssueSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc(rpcName, {
      p_user_id: issueModal.user_id,
      p_amount_paise: amountPaise,
      p_description: issueDesc.trim() || defaultDesc,
    })
    if (error) { alert((issueType === 'debit' ? 'Deduct' : 'Issue') + ' failed: ' + error.message); setIssueSaving(false); return }
    if (imagePath) {
      var { data: latestTxn } = await supabase.from('wallet_transactions')
        .select('id')
        .eq('wallet_id', issueModal.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (latestTxn) {
        await supabase.from('wallet_transactions').update({ issued_image_path: imagePath }).eq('id', latestTxn.id)
      }
    }
    var logAction = issueType === 'debit' ? 'WALLET_DEDUCT' : 'WALLET_ISSUE'
    try { await logActivity(logAction, (walletProfiles[issueModal.user_id]?.name || '—') + ' | ' + formatPoints(amountPaise) + ' | ' + (issueDesc.trim() || '—')) } catch (_) {}
    setIssueModal(null)
    setIssueAmount('')
    setIssueDesc('')
    setIssueImage(null)
    setIssueSaving(false)
    loadAllWallets()
  }
  async function confirmReceive() {
    if (receiveSaving || !receiveModal || !receiveImage) return
    setReceiveSaving(true)
    var imagePath = null
    var ext = receiveImage.name.split('.').pop()
    var path = 'wallet/received/' + profile.id + '_' + Date.now() + '.' + ext
    var { error: upErr } = await supabase.storage.from('receipts').upload(path, receiveImage, { upsert: true })
    if (upErr) { alert('Image upload failed: ' + upErr.message); setReceiveSaving(false); return }
    imagePath = path
    var { error } = await supabase.rpc('confirm_wallet_receive', {
      p_txn_id: receiveModal.id,
      p_received_image: imagePath,
    })
    if (error) { alert('Confirm failed: ' + error.message); setReceiveSaving(false); return }
    try { await logActivity('WALLET_RECEIVE_CONFIRM', formatPoints(Math.abs(receiveModal.amount_paise)) + ' | Txn #' + receiveModal.id) } catch (_) {}
    setReceiveModal(null)
    setReceiveImage(null)
    setReceiveSaving(false)
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    supabase.from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('type', 'credit')
      .then(function (res) { setPendingReceiveCount(res.count || 0) })
    openWalletTxns(null)
  }

  async function loadTransfers() {
    var [incRes, outRes] = await Promise.all([
      supabase.from('wallet_transfers').select('id, from_user_id, amount_paise, description, sender_image_path, status, created_at').eq('to_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('wallet_transfers').select('id, to_user_id, amount_paise, description, sender_image_path, status, created_at').eq('from_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
    ])
    var inc = incRes.data || []
    var out = outRes.data || []
    // resolve names
    var uids = []
    inc.forEach(function (t) { if (uids.indexOf(t.from_user_id) === -1) uids.push(t.from_user_id) })
    out.forEach(function (t) { if (uids.indexOf(t.to_user_id) === -1) uids.push(t.to_user_id) })
    if (uids.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: uids })
      var nMap = {}
      ;(names || []).forEach(function (n) { nMap[n.id] = n.name })
      inc = inc.map(function (t) { return Object.assign({}, t, { _fromName: nMap[t.from_user_id] || '—' }) })
      out = out.map(function (t) { return Object.assign({}, t, { _toName: nMap[t.to_user_id] || '—' }) })
    }
    setPendingIncoming(inc)
    setPendingOutgoing(out)
  }

  async function openTransferModal() {
    setTransferModal(true)
    setTransferTo('')
    setTransferAmount('')
    setTransferDesc('')
    setTransferImage(null)
    if (transferUsers.length === 0) {
      var { data } = await supabase.rpc('get_transfer_users')
      setTransferUsers(data || [])
    }
  }

  async function initiateTransfer() {
    if (transferSaving || !transferTo || !transferAmount || Number(transferAmount) <= 0) return
    setTransferSaving(true)
    var amountPaise = Math.round(Number(transferAmount) * 100)
    var imagePath = null
    if (transferImage) {
      var ext = transferImage.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, transferImage, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setTransferSaving(false); return }
      imagePath = path
    }
    var { data: tid, error } = await supabase.rpc('initiate_transfer', {
      p_to_user_id: transferTo,
      p_amount_paise: amountPaise,
      p_description: transferDesc.trim() || 'Cash transfer',
      p_sender_image: imagePath,
    })
    if (error) { alert('Transfer failed: ' + error.message); setTransferSaving(false); return }
    var toName = (transferUsers.find(function (u) { return u.id === transferTo }) || {}).name || '—'
    try { await logActivity('WALLET_TRANSFER', toName + ' | ' + formatPoints(amountPaise)) } catch (_) {}
    setTransferModal(false)
    setTransferSaving(false)
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    loadTransfers()
  }

  async function confirmTransferReceive() {
    if (transferConfirmSaving || !transferConfirmModal) return
    setTransferConfirmSaving(true)
    var imagePath = null
    if (transferConfirmImage) {
      var ext = transferConfirmImage.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_recv_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, transferConfirmImage, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setTransferConfirmSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc('confirm_transfer', {
      p_transfer_id: transferConfirmModal.id,
      p_receiver_image: imagePath,
    })
    if (error) { alert('Confirm failed: ' + error.message); setTransferConfirmSaving(false); return }
    try { await logActivity('WALLET_TRANSFER_CONFIRM', formatPoints(transferConfirmModal.amount_paise) + ' from ' + (transferConfirmModal._fromName || '—')) } catch (_) {}
    setTransferConfirmModal(null)
    setTransferConfirmImage(null)
    setTransferConfirmSaving(false)
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    loadTransfers()
  }

  async function cancelTransfer(t) {
    if (!confirm('Cancel this transfer? ' + formatPoints(t.amount_paise) + ' will be refunded.')) return
    var { error } = await supabase.rpc('cancel_transfer', { p_transfer_id: t.id })
    if (error) { alert('Cancel failed: ' + error.message); return }
    try { await logActivity('WALLET_TRANSFER_CANCEL', formatPoints(t.amount_paise)) } catch (_) {}
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    loadTransfers()
  }

  async function runBulkIssue() {
    var userIds = Object.keys(bulkSelected).filter(function (k) { return bulkSelected[k] })
    if (bulkSaving || !userIds.length || !bulkAmount || Number(bulkAmount) <= 0) return
    setBulkSaving(true)
    var amountPaise = Math.round(Number(bulkAmount) * 100)
    var desc = bulkDesc.trim() || 'Bulk points issued by admin'
    var succeeded = 0
    var failed = 0
    var CHUNK = 10
    for (var c = 0; c < userIds.length; c += CHUNK) {
      var chunk = userIds.slice(c, c + CHUNK)
      var results = await Promise.allSettled(chunk.map(function (uid) {
        return supabase.rpc('issue_money', { p_user_id: uid, p_amount_paise: amountPaise, p_description: desc })
      }))
      results.forEach(function (res) {
        if (res.status === 'fulfilled' && !res.value.error) succeeded++
        else failed++
      })
    }
    try { await logActivity('WALLET_BULK_ISSUE', succeeded + ' users | ' + formatPoints(amountPaise) + ' each | ' + desc) } catch (_) {}
    alert('Done: ' + succeeded + ' issued' + (failed > 0 ? ', ' + failed + ' failed' : ''))
    setBulkSaving(false)
    setBulkMode(false)
    setBulkSelected({})
    setBulkAmount('')
    setBulkDesc('')
    loadAllWallets()
  }

  function exportWalletCSV() {
    if (!walletTxns.length || !selectedWallet) return
    var userName = walletProfiles[selectedWallet.user_id]?.name || 'user'
    var headers = ['Date', 'Type', 'Amount (pts)', 'Balance After (pts)', 'Description', 'Performed By']
    var rows = walletTxns.map(function (t) {
      return [
        t.created_at ? t.created_at.split('T')[0] : '',
        t.type || '',
        t.amount_paise ? (t.amount_paise / 100) : 0,
        t.balance_after_paise ? (t.balance_after_paise / 100) : 0,
        (t.description || '').replace(/,/g, ';'),
        walletProfiles[t.performed_by]?.name || '—',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wallet_' + userName + '_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }
  async function loadAllExps(append) {
    var offset = append ? allExps.length : 0
    if (append) setAllExpLoadingMore(true)
    else setAllExpLoading(true)

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, categories(name), expense_types(name)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (allExpStatus) query = query.eq('status', allExpStatus)
    if (allExpFrom) query = query.gte('expense_date', allExpFrom)
    if (allExpTo) query = query.lte('expense_date', allExpTo)
    if (allExpSearchD) query = query.ilike('description', '%' + allExpSearchD + '%')

    var { data, error } = await query
    if (error) { alert('Failed: ' + error.message); setAllExpLoading(false); setAllExpLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    var aUserIds = []
    rows.forEach(function (r) { if (r.user_id && aUserIds.indexOf(r.user_id) === -1) aUserIds.push(r.user_id) })
    if (aUserIds.length > 0) {
      var { data: aNames } = await supabase.rpc('get_profile_names', { p_ids: aUserIds })
      var aMap = {}
      ;(aNames || []).forEach(function (n) { aMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: aMap[r.user_id] || null } }) })
    }
    if (append) {
      setAllExps(function (prev) { return prev.concat(rows) })
    } else {
      setAllExps(rows)
    }
    setAllExpHasMore(hasMore)
    setAllExpLoading(false)
    setAllExpLoadingMore(false)
  }

  function exportAllExpCSV() {
    if (!allExps.length) return
    var headers = ['Date', 'User', 'Category', 'Sub-Category', 'Amount (pts)', 'Description', 'Status']
    var rows = allExps.map(function (e) {
      return [
        e.expense_date || '',
        e.profiles?.name || '',
        e.categories?.name || '',
        subCatMap[e.sub_category_id] || '',
        e.amount_paise ? (e.amount_paise / 100) : 0,
        (e.description || '').replace(/,/g, ';'),
        e.status || '',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all_expenses_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }
  async function loadReport() {
    setReportLoading(true)
    var { data, error } = await supabase.from('expenses')
      .select('id, user_id, category_id, amount_paise, status, expense_date, categories(name), profiles:user_id(name)')
      .eq('status', 'approved')
      .gte('expense_date', reportFrom)
      .lte('expense_date', reportTo)
      .order('expense_date', { ascending: false })
      .limit(5000)
    if (error) { alert('Report failed: ' + error.message); setReportLoading(false); return }
    var rows = data || []
    var totalPaise = 0
    var byUser = {}
    var byCat = {}
    var byMonth = {}
    rows.forEach(function (r) {
      var amt = r.amount_paise || 0
      totalPaise += amt
      var uName = r.profiles?.name || '—'
      byUser[uName] = (byUser[uName] || 0) + amt
      var cName = r.categories?.name || 'Uncategorized'
      byCat[cName] = (byCat[cName] || 0) + amt
      var month = (r.expense_date || '').slice(0, 7)
      if (month) byMonth[month] = (byMonth[month] || 0) + amt
    })
    var sortObj = function (obj) {
      return Object.entries(obj).sort(function (a, b) { return b[1] - a[1] })
    }
    setReportData({
      count: rows.length,
      totalPaise: totalPaise,
      byUser: sortObj(byUser),
      byCat: sortObj(byCat),
      byMonth: Object.entries(byMonth).sort(function (a, b) { return a[0].localeCompare(b[0]) }),
    })
    setReportLoading(false)
  }

  function exportReportCSV() {
    if (!reportData) return
    var sections = []
    sections.push('Summary')
    sections.push('Total Approved,' + (reportData.totalPaise / 100))
    sections.push('Count,' + reportData.count)
    sections.push('')
    sections.push('By User')
    sections.push('User,Amount (pts)')
    reportData.byUser.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Category')
    sections.push('Category,Amount (pts)')
    reportData.byCat.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Month')
    sections.push('Month,Amount (pts)')
    reportData.byMonth.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    var csv = '\uFEFF' + sections.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'expense_report_' + reportFrom + '_' + reportTo + '.csv'; a.click()
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

  async function loadExpTypes() {
    var { data } = await supabase.from('expense_types').select('id, name, extra_fields, active, sort_order').order('sort_order')
    setExpTypes(data || [])
  }
  async function saveExpType() {
    if (typeSaving || !typeName.trim()) return
    setTypeSaving(true)
    if (typeEditId) {
      await supabase.from('expense_types').update({ name: typeName.trim() }).eq('id', typeEditId)
    } else {
      var maxSort = expTypes.reduce(function (m, t) { return t.sort_order > m ? t.sort_order : m }, 0)
      await supabase.from('expense_types').insert({ name: typeName.trim(), sort_order: maxSort + 1 })
    }
    setTypeName('')
    setTypeEditId(null)
    setTypeSaving(false)
    loadExpTypes()
  }
  async function toggleExpType(id, active) {
    await supabase.from('expense_types').update({ active: !active }).eq('id', id)
    loadExpTypes()
  }

  var displayList = view === 'approve' ? approvalExpenses : myExpenses
  var displayHasMore = view === 'approve' ? approvalHasMore : myHasMore

  // Total points for my expenses
  var myTotal = myExpenses.reduce(function (sum, e) { return sum + (e.amount_paise || 0) }, 0)
  useEffect(function () {
    if (allExpView) loadAllExps(false)
  }, [allExpStatus, allExpFrom, allExpTo, allExpSearchD])
if (allExpView && (isAdmin || isAuditor)) {
    var allExpTotal = allExps.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0)
    return (
      <div className="space-y-4">
        <div>
          <button onClick={function () { setAllExpView(false) }}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">All Expenses</h2>
              <p className="text-xs text-gray-400">{allExps.length} shown · {formatPoints(allExpTotal)} total</p>
            </div>
            {allExps.length > 0 && (
              <button onClick={exportAllExpCSV}
                className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                📥 CSV
              </button>
            )}
          </div>
        </div>

        <input type="text" value={allExpSearch} onChange={function (e) { setAllExpSearch(e.target.value) }}
          placeholder="Search description..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />

        <div className="flex gap-2 flex-wrap">
          {['', 'pending_dept', 'pending', 'approved', 'rejected'].map(function (s) {
            var label = s ? APPROVAL_STATUS_LABELS[s] : 'All'
            return (
              <button key={s} onClick={function () { setAllExpStatus(s === allExpStatus ? '' : s) }}
                className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                  (allExpStatus === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                {label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
            <input type="date" value={allExpFrom} onChange={function (e) { setAllExpFrom(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
            <input type="date" value={allExpTo} onChange={function (e) { setAllExpTo(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          {(allExpFrom || allExpTo) && (
            <button onClick={function () { setAllExpFrom(''); setAllExpTo('') }}
              className="self-end px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-px">
              Clear
            </button>
          )}
        </div>

        {allExpLoading && <p className="text-gray-400 text-sm text-center py-4">Loading...</p>}

        {!allExpLoading && allExps.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-400 text-sm">No expenses found</p>
          </div>
        )}

        {!allExpLoading && (
          <div className="space-y-3">
            {allExps.map(function (exp) {
              return (
                <div key={exp.id}
                  onClick={function () {
                    var e = Object.assign({}, exp, { _fromApprove: true })
                    openDetail(e)
                  }}
                  className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{exp.description || 'Expense'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {exp.profiles?.name || '—'} · {exp.expense_types?.name ? exp.expense_types.name + ' · ' : ''}{exp.categories?.name || '—'}
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
                </div>
              )
            })}
          </div>
        )}

        {allExpHasMore && (
          <button onClick={function () { loadAllExps(true) }} disabled={allExpLoadingMore}
            className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
            {allExpLoadingMore ? 'Loading...' : 'Load More'}
          </button>
        )}
      </div>
    )
  }

  if (reportView && (isAdmin || isAuditor)) {
    return (
      <div className="space-y-4">
        <div>
          <button onClick={function () { setReportView(false); setReportData(null) }}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
          <h2 className="text-lg font-bold text-gray-900">Expense Report</h2>
          <p className="text-xs text-gray-400">Approved expenses summary</p>
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
            <input type="date" value={reportFrom} onChange={function (e) { setReportFrom(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
            <input type="date" value={reportTo} onChange={function (e) { setReportTo(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <button onClick={loadReport} disabled={reportLoading}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {reportLoading ? 'Loading...' : 'Generate'}
          </button>
        </div>
        {reportData && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
                <p className="text-[10px] font-bold text-indigo-400 uppercase">Total Approved</p>
                <p className="text-xl font-bold text-indigo-700">{formatPoints(reportData.totalPaise)}</p>
              </div>
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Expenses</p>
                <p className="text-xl font-bold text-gray-700">{reportData.count}</p>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">By User</h3>
              </div>
              <div className="space-y-2">
                {reportData.byUser.slice(0, 15).map(function (r) {
                  var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                  return (
                    <div key={r[0]} className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                          <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-gray-700 ml-3 flex-shrink-0">{formatPoints(r[1])}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-3">By Category</h3>
              <div className="space-y-2">
                {reportData.byCat.slice(0, 15).map(function (r) {
                  var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                  return (
                    <div key={r[0]} className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-gray-700 ml-3 flex-shrink-0">{formatPoints(r[1])}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-3">By Month</h3>
              <div className="space-y-2">
                {reportData.byMonth.map(function (r) {
                  return (
                    <div key={r[0]} className="flex items-center justify-between">
                      <span className="text-sm text-gray-800">{r[0]}</span>
                      <span className="text-sm font-bold text-gray-700">{formatPoints(r[1])}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <button onClick={exportReportCSV}
              className="w-full py-3 text-sm font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
              📥 Export Report CSV
            </button>
          </div>
        )}
      </div>
    )
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
        onUpdated={function () { loadMyExpenses(false); loadApprovalExpenses(false); if (allExpView) loadAllExps(false); if (allExpView) { setView('list'); setDetailExp(null); return } setView(detailExp._fromApprove ? 'approve' : 'list'); setDetailExp(null) }}
        onEdit={function () { setEditExp(detailExp); setView('form') }}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // WALLET ADMIN — All balances
  // ═══════════════════════════════════════════════
  if (walletView === 'wallets') {
    var wSearchLower = walletSearch.toLowerCase()
    var filteredWallets = allWallets.filter(function (w) {
      if (!walletSearch) return true
      var p = walletProfiles[w.user_id]
      return (p?.name || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
        (p?.email || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
        (p?.role || '').toLowerCase().indexOf(wSearchLower) !== -1
    })
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={function () { setWalletView(null) }} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
            <h2 className="text-lg font-bold text-gray-900">All Wallets</h2>
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400">{filteredWallets.length} wallets</p>
              {!bulkMode && (
                <button onClick={function () { setBulkMode(true); setBulkSelected({}) }}
                  className="px-2 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors">
                  Bulk Issue
                </button>
              )}
            </div>
            
          </div>
        </div>
        <input type="text" value={walletSearch} onChange={function (e) { setWalletSearch(e.target.value) }}
          placeholder="Search name, email, role..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        {myWallet && (
          <div onClick={function () {
            setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
            var w = Object.assign({}, myWallet, { balance_paise: walletBalance })
            openWalletTxns(w)
            loadTransfers()
          }}
            className="relative bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform">
            <div>
              <p className="text-sm font-bold text-emerald-800">My Wallet</p>
              <p className="text-xs text-emerald-600">{formatPoints(walletBalance)} · View transactions →</p>
            </div>
            {pendingIncoming.length > 0 && (
              <span className="px-2.5 py-1 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full">{pendingIncoming.length} incoming</span>
            )}
          </div>
        )}

        <div className="space-y-2">
          {filteredWallets.map(function (w) {
            var p = walletProfiles[w.user_id] || {}
            return (
              <div key={w.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                {bulkMode && (
                  <input type="checkbox" checked={!!bulkSelected[w.user_id]}
                    onChange={function () { setBulkSelected(function (prev) { var n = Object.assign({}, prev); n[w.user_id] = !n[w.user_id]; return n }) }}
                    className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mr-3 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={function () { if (!bulkMode) openWalletTxns(w) }}>
                  <p className="text-sm font-semibold text-gray-900">{p.name || '—'}</p>
                  <p className="text-xs text-gray-400">{p.email || '—'} · {p.role || '—'}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {w._pendingCount > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full">{w._pendingCount} pending</span>
                  )}
                  <span className={"text-sm font-bold " + ((w.balance_paise || 0) < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(w.balance_paise)}</span>
                  <button onClick={function () { setIssueModal(w); setIssueAmount(''); setIssueDesc(''); setIssueType('credit') }}
                    className="px-3 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                    + Issue
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {bulkMode && (
          <div className="sticky bottom-0 bg-white border-t border-gray-200 rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">
                {Object.values(bulkSelected).filter(Boolean).length} selected
              </p>
              <div className="flex gap-2">
                <button onClick={function () { var all = {}; filteredWallets.forEach(function (w) { all[w.user_id] = true }); setBulkSelected(all) }}
                  className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors">Select All</button>
                <button onClick={function () { setBulkSelected({}) }}
                  className="text-[10px] font-bold text-gray-500 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg transition-colors">Clear</button>
              </div>
            </div>
            <div className="flex gap-2">
              <input type="number" min="1" step="any" inputMode="decimal" value={bulkAmount}
                onChange={function (e) { setBulkAmount(e.target.value) }}
                placeholder="Amount (pts)" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
              <input type="text" value={bulkDesc} onChange={function (e) { setBulkDesc(e.target.value) }}
                placeholder="Description" maxLength="300" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex gap-2">
              <button onClick={function () { setBulkMode(false); setBulkSelected({}); setBulkAmount(''); setBulkDesc('') }}
                className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
              <button onClick={runBulkIssue}
                disabled={bulkSaving || !bulkAmount || Number(bulkAmount) <= 0 || Object.values(bulkSelected).filter(Boolean).length === 0}
                className="flex-1 py-2.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                {bulkSaving ? 'Issuing...' : 'Issue to ' + Object.values(bulkSelected).filter(Boolean).length + ' users'}
              </button>
            </div>
          </div>
        )}
        {/* Issue Points Modal */}
        {issueModal && (
          <BottomSheet open={true} onClose={function () { setIssueModal(null) }} title={issueType === 'debit' ? 'Deduct Points' : 'Issue Points'}>
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={function () { setIssueType('credit') }}
                    className={"px-3 py-1.5 text-xs font-bold rounded-md transition-colors " + (issueType === 'credit' ? "bg-white text-green-700 shadow-sm" : "text-gray-500")}>
                    + Credit
                  </button>
                  <button onClick={function () { setIssueType('debit') }}
                    className={"px-3 py-1.5 text-xs font-bold rounded-md transition-colors " + (issueType === 'debit' ? "bg-white text-red-700 shadow-sm" : "text-gray-500")}>
                    − Debit
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-500">To: <span className="font-medium text-gray-800">{walletProfiles[issueModal.user_id]?.name || '—'}</span></p>
              <p className="text-xs text-gray-400">Current balance: {formatPoints(issueModal.balance_paise)}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points)</label>
                <input type="number" min="1" step="any" inputMode="decimal" value={issueAmount}
                  onChange={function (e) { setIssueAmount(e.target.value) }}
                  placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={issueDesc} onChange={function (e) { setIssueDesc(e.target.value) }}
                  placeholder="e.g. Weekly allowance, Reimbursement..."
                  maxLength="300" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Cash Photo</label>
                {issueImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {issueImage.name}</span>
                    <button onClick={function () { setIssueImage(null) }}
                      className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 text-center text-sm text-indigo-600 border border-dashed border-indigo-300 rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors">
                    Tap to attach photo
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={function (e) { if (e.target.files?.[0]) setIssueImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setIssueModal(null); setIssueImage(null) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={issuePoints} disabled={issueSaving || !issueAmount || Number(issueAmount) <= 0}
                  className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold">
                  {issueSaving ? (issueType === 'debit' ? 'Deducting...' : 'Issuing...') : (issueType === 'debit' ? 'Deduct ' : 'Issue ') + (issueAmount && Number(issueAmount) > 0 ? Number(issueAmount).toLocaleString('en-IN') + ' pts' : '')}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // WALLET TRANSACTIONS — Per-user drill-down
  // ═══════════════════════════════════════════════
  if (walletView === 'transactions' && selectedWallet) {
    var txnUser = walletProfiles[selectedWallet.user_id] || {}
    return (
      <div className="space-y-4">
        <div>
          <button onClick={function () {
            if (isAdmin || isAuditor) { setWalletView('wallets') } else { setWalletView(null) }
            setSelectedWallet(null); setWalletTxns([]); setTxnFrom(''); setTxnTo('')
          }}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">{(isAdmin || isAuditor) ? '← Back to Wallets' : '← Back to Expenses'}</button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{txnUser.name || '—'}</h2>
              <p className="text-xs text-gray-400">{txnUser.email || '—'} · Balance: <span className={"font-bold " + ((selectedWallet.balance_paise || 0) < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(selectedWallet.balance_paise)}</span></p>
            </div>
            <div className="flex gap-2">
              {selectedWallet && selectedWallet.user_id === profile.id && (
                <button onClick={openTransferModal}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">
                  ↗ Transfer
                </button>
              )}
              {(isAdmin || isAuditor) && (
                <button onClick={function () { setIssueModal(selectedWallet); setIssueAmount(''); setIssueDesc('') }}
                  className="px-3 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                  + Issue
                </button>
              )}
              {walletTxns.length > 0 && (
                <button onClick={exportWalletCSV}
                  className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                  📥 CSV
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
            <input type="date" value={txnFrom} onChange={function (e) { setTxnFrom(e.target.value); openWalletTxns(null, e.target.value, null) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
            <input type="date" value={txnTo} onChange={function (e) { setTxnTo(e.target.value); openWalletTxns(null, null, e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          {(txnFrom || txnTo) && (
            <button onClick={function () { setTxnFrom(''); setTxnTo(''); openWalletTxns(null, '', '') }}
              className="px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-px">
              Clear
            </button>
          )}
        </div>
        {/* Pending incoming transfers */}
        {selectedWallet && selectedWallet.user_id === profile.id && pendingIncoming.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Incoming Transfers</p>
            {pendingIncoming.map(function (t) {
              var imgUrl = t.sender_image_path ? supabase.storage.from('receipts').getPublicUrl(t.sender_image_path).data?.publicUrl : null
              return (
                <div key={t.id} className="bg-amber-50/50 border border-amber-300 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{t._fromName} sent you {formatPoints(t.amount_paise)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.description || '—'} · {formatDate(t.created_at)}</p>
                      {imgUrl && (
                        <div className="mt-1.5 relative inline-block cursor-pointer" onClick={function () { setEnlargedWalletImg(imgUrl) }}>
                          <img src={imgUrl} alt="" className="w-10 h-10 rounded border border-gray-200 object-cover" />
                          <span className="absolute -top-1 -left-1 text-[8px] bg-blue-600 text-white px-1 rounded font-bold">Sent</span>
                        </div>
                      )}
                    </div>
                    <button onClick={function () { setTransferConfirmModal(t); setTransferConfirmImage(null) }}
                      className="px-3 py-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors flex-shrink-0 ml-2">
                      📷 Confirm
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pending outgoing transfers */}
        {selectedWallet && selectedWallet.user_id === profile.id && pendingOutgoing.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outgoing Transfers (Pending)</p>
            {pendingOutgoing.map(function (t) {
              return (
                <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">Sent {formatPoints(t.amount_paise)} to {t._toName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t.description || '—'} · {formatDate(t.created_at)}</p>
                    </div>
                    <button onClick={function () { cancelTransfer(t) }}
                      className="px-3 py-1.5 text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex-shrink-0 ml-2">
                      Cancel
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {walletTxns.length === 0 && pendingIncoming.length === 0 && pendingOutgoing.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-400 text-sm">No transactions yet</p>
          </div>
        )}
        <div className="space-y-2">
          {walletTxns.map(function (t) {
            var isCredit = t.type === 'credit'
            var issuedUrl = t.issued_image_path ? supabase.storage.from('receipts').getPublicUrl(t.issued_image_path).data?.publicUrl : null
            var receivedUrl = t.received_image_path ? supabase.storage.from('receipts').getPublicUrl(t.received_image_path).data?.publicUrl : null
            var isOwnWallet = selectedWallet && selectedWallet.user_id === profile.id
            var canConfirm = isCredit && t.status === 'pending' && isOwnWallet
            return (
              <div key={t.id} className={"bg-white border rounded-lg p-3 " + (t.status === 'pending' ? "border-amber-300 bg-amber-50/30" : "border-gray-200")}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{t.description || '—'}</p>
                    <p className="text-[11px] text-gray-400">
                      {formatDate(t.created_at)}
                      {t.reference_type ? ' · ' + t.reference_type : ''}
                      {t.performed_by && walletProfiles[t.performed_by] ? ' · by ' + walletProfiles[t.performed_by].name : ''}
                    </p>
                    {t.received_at && <p className="text-[10px] text-green-600 font-medium mt-0.5">✓ Confirmed {formatDate(t.received_at)}</p>}
                    <div className="flex gap-2 mt-1.5">
                      {issuedUrl && (
                        <div className="relative cursor-pointer" onClick={function () { setEnlargedWalletImg(issuedUrl) }}>
                          <img src={issuedUrl} alt="" className="w-10 h-10 rounded border border-gray-200 object-cover" />
                          <span className="absolute -top-1 -left-1 text-[8px] bg-blue-600 text-white px-1 rounded font-bold">Sent</span>
                        </div>
                      )}
                      {receivedUrl && (
                        <div className="relative cursor-pointer" onClick={function () { setEnlargedWalletImg(receivedUrl) }}>
                          <img src={receivedUrl} alt="" className="w-10 h-10 rounded border border-gray-200 object-cover" />
                          <span className="absolute -top-1 -left-1 text-[8px] bg-green-600 text-white px-1 rounded font-bold">Rcvd</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className={"text-sm font-bold " + (isCredit ? "text-green-600" : "text-red-600")}>
                      {isCredit ? '+' : '−'}{formatPoints(Math.abs(t.amount_paise))}
                    </p>
                    <p className="text-[10px] text-gray-400">bal: {formatPoints(t.balance_after_paise)}</p>
                    {canConfirm && (
                      <button onClick={function () { setReceiveModal(t); setReceiveImage(null) }}
                        className="mt-1.5 px-2 py-1 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200 transition-colors">
                        📷 Confirm Received
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {/* Issue modal (reuse same one) */}
        {issueModal && (
          <BottomSheet open={true} onClose={function () { setIssueModal(null); setIssueImage(null) }} title="Issue Points">
            <div className="space-y-4">
              <p className="text-sm text-gray-500">To: <span className="font-medium text-gray-800">{walletProfiles[issueModal.user_id]?.name || '—'}</span></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points)</label>
                <input type="number" min="1" step="any" inputMode="decimal" value={issueAmount}
                  onChange={function (e) { setIssueAmount(e.target.value) }}
                  placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={issueDesc} onChange={function (e) { setIssueDesc(e.target.value) }}
                  placeholder="e.g. Weekly allowance" maxLength="300"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Cash Photo</label>
                {issueImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {issueImage.name}</span>
                    <button onClick={function () { setIssueImage(null) }}
                      className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 text-center text-sm text-indigo-600 border border-dashed border-indigo-300 rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors">
                    Tap to attach photo
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={function (e) { if (e.target.files?.[0]) setIssueImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setIssueModal(null); setIssueImage(null) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={issuePoints} disabled={issueSaving || !issueAmount || Number(issueAmount) <= 0}
                  className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold">
                  {issueSaving ? 'Issuing...' : 'Issue ' + (issueAmount && Number(issueAmount) > 0 ? Number(issueAmount).toLocaleString('en-IN') + ' pts' : '')}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}
        {/* Confirm Receive modal */}
        {receiveModal && (
          <BottomSheet open={true} onClose={function () { setReceiveModal(null); setReceiveImage(null) }} title="Confirm Cash Received">
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Amount: <span className="font-bold text-green-700">{formatPoints(Math.abs(receiveModal.amount_paise))}</span></p>
              <p className="text-xs text-gray-400">{receiveModal.description || '—'}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Receipt Photo</label>
                {receiveImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {receiveImage.name}</span>
                    <button onClick={function () { setReceiveImage(null) }}
                      className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-3 text-center text-sm text-amber-700 border-2 border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors font-medium">
                    📷 Take photo of cash received
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={function (e) { if (e.target.files?.[0]) setReceiveImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setReceiveModal(null); setReceiveImage(null) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={confirmReceive} disabled={receiveSaving || !receiveImage}
                  className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
                  {receiveSaving ? 'Confirming...' : '✓ Confirm Received'}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}
        {/* Transfer initiation */}
        {transferModal && (
          <BottomSheet open={true} onClose={function () { setTransferModal(false) }} title="Transfer Cash">
            <div className="space-y-4">
              <SearchDropdown label="Send to" required
                items={transferUsers.map(function (u) { return { label: u.name, value: u.id } })}
                value={transferTo}
                onChange={function (val) { setTransferTo(val) }}
                placeholder="Search user..." />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points)</label>
                <input type="number" min="1" step="any" inputMode="decimal" value={transferAmount}
                  onChange={function (e) { setTransferAmount(e.target.value) }}
                  placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  style={{ fontSize: '16px' }} />
                {transferAmount && Number(transferAmount) > 0 && walletBalance > 0 && Math.round(Number(transferAmount) * 100) > walletBalance && (
                  <p className="text-xs text-red-500 mt-1">Exceeds balance ({formatPoints(walletBalance)})</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={transferDesc} onChange={function (e) { setTransferDesc(e.target.value) }}
                  placeholder="e.g. Repayment, Lunch money..." maxLength="300"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Cash Photo</label>
                {transferImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {transferImage.name}</span>
                    <button onClick={function () { setTransferImage(null) }} className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 text-center text-sm text-emerald-600 border border-dashed border-emerald-300 rounded-lg cursor-pointer hover:bg-emerald-50 transition-colors">
                    Tap to attach photo
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={function (e) { if (e.target.files?.[0]) setTransferImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setTransferModal(false) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={initiateTransfer}
                  disabled={transferSaving || !transferTo || !transferAmount || Number(transferAmount) <= 0}
                  className="flex-1 py-3 text-sm text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors font-semibold">
                  {transferSaving ? 'Sending...' : 'Send ' + (transferAmount && Number(transferAmount) > 0 ? Number(transferAmount).toLocaleString('en-IN') + ' pts' : '')}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}

        {/* Transfer confirm */}
        {transferConfirmModal && (
          <BottomSheet open={true} onClose={function () { setTransferConfirmModal(null); setTransferConfirmImage(null) }} title="Confirm Transfer Received">
            <div className="space-y-4">
              <p className="text-sm text-gray-500">From: <span className="font-bold text-gray-900">{transferConfirmModal._fromName}</span></p>
              <p className="text-sm text-gray-500">Amount: <span className="font-bold text-green-700">{formatPoints(transferConfirmModal.amount_paise)}</span></p>
              <p className="text-xs text-gray-400">{transferConfirmModal.description || '—'}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Receipt Photo</label>
                {transferConfirmImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {transferConfirmImage.name}</span>
                    <button onClick={function () { setTransferConfirmImage(null) }} className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-3 text-center text-sm text-amber-700 border-2 border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors font-medium">
                    📷 Take photo of cash received
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={function (e) { if (e.target.files?.[0]) setTransferConfirmImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setTransferConfirmModal(null); setTransferConfirmImage(null) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={confirmTransferReceive} disabled={transferConfirmSaving || !transferConfirmImage}
                  className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
                  {transferConfirmSaving ? 'Confirming...' : '✓ Confirm Received'}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}

        {/* Enlarged wallet image */}
        {enlargedWalletImg && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={function () { setEnlargedWalletImg(null) }}>
            <img src={enlargedWalletImg} alt="" className="max-w-full max-h-[80vh] rounded-lg" />
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // EXPENSE TYPES — Admin config
  // ═══════════════════════════════════════════════
  if (typesModal) {
    return (
      <div className="space-y-4">
        <div>
          <button onClick={function () { setTypesModal(false); setTypeName(''); setTypeEditId(null) }}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Expense Types</h2>
              <p className="text-xs text-gray-400">{expTypes.length} types configured</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {expTypes.map(function (et) {
            var isEditing = typeEditId === et.id
            return (
              <div key={et.id} className={"bg-white border rounded-xl p-4 transition-all " + (et.active ? "border-gray-200" : "border-gray-100 opacity-60")}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <input type="text" value={typeName} onChange={function (e) { setTypeName(e.target.value) }}
                          className="flex-1 px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          style={{ fontSize: '16px' }}
                          onKeyDown={function (e) { if (e.key === 'Enter') saveExpType(); if (e.key === 'Escape') { setTypeEditId(null); setTypeName('') } }}
                          autoFocus />
                        <button onClick={saveExpType} disabled={typeSaving || !typeName.trim()}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                          Save
                        </button>
                        <button onClick={function () { setTypeEditId(null); setTypeName('') }}
                          className="px-3 py-1.5 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className={"text-sm font-semibold " + (et.active ? "text-gray-900" : "text-gray-400 line-through")}>{et.name}</p>
                        {et.extra_fields && et.extra_fields.length > 0 && (
                          <span className="text-[10px] text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full font-bold">{et.extra_fields.length} fields</span>
                        )}
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex gap-2 flex-shrink-0 ml-3">
                      <button onClick={function () { setTypeEditId(et.id); setTypeName(et.name) }}
                        className="w-8 h-8 flex items-center justify-center text-xs rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">✎</button>
                      <button onClick={function () { toggleExpType(et.id, et.active) }}
                        className={"px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors " + (et.active ? "bg-green-100 text-green-700 hover:bg-green-200 border border-green-200" : "bg-red-50 text-red-500 hover:bg-red-100 border border-red-200")}>
                        {et.active ? 'Active' : 'Off'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {expTypes.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No expense types yet</p>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Add New Type</p>
          <div className="flex gap-2">
            <input type="text" value={typeEditId ? '' : typeName} onChange={function (e) { if (!typeEditId) setTypeName(e.target.value) }}
              disabled={!!typeEditId}
              placeholder="Type name..."
              className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-40"
              style={{ fontSize: '16px' }}
              onKeyDown={function (e) { if (e.key === 'Enter' && !typeEditId) saveExpType() }} />
            <button onClick={function () { if (!typeEditId) saveExpType() }} disabled={typeSaving || !typeName.trim() || !!typeEditId}
              className="px-4 py-2.5 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
              Add
            </button>
          </div>
        </div>
      </div>
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
          onClick={function () {
            if (isAdmin || isAuditor) { setWalletView('wallets'); loadAllWallets() }
            else if (myWallet) {
              setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
              openWalletTxns(myWallet)
            }
          }}>
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
          <button onClick={function () { setReportView(true); loadReport() }}
            className="flex-1 py-2.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
            📊 Reports
          </button>
          <button onClick={function () { setAllExpView(true); loadAllExps(false) }}
            className="flex-1 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
            📋 All Expenses
          </button>
          {(profile?.permissions || []).indexOf('admin_masters') !== -1 && (
            <button onClick={function () { setTypesModal(true); loadExpTypes() }}
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
              ? approvalExpenses.length + ' pending approval'
              : myExpenses.length + ' expenses' + (myTotal > 0 ? ' · ' + formatPoints(myTotal) + ' total' : '')}
          </p>
        </div>
        <div className="flex gap-2">
          {(isAdmin || isAuditor) && (
            <div className="hidden md:flex gap-2">
              <button onClick={function () { setReportView(true); loadReport() }}
                className="px-3 py-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
                📊 Reports
              </button>
              <button onClick={function () { setAllExpView(true); loadAllExps(false) }}
                className="px-3 py-2 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                📋 All
              </button>
              {(profile?.permissions || []).indexOf('admin_masters') !== -1 && (
                <button onClick={function () { setTypesModal(true); loadExpTypes() }}
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
            Approvals
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
          {['', 'pending_dept', 'pending', 'approved', 'rejected'].map(function (s) {
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
          <p className="text-gray-400 text-sm">{view === 'approve' ? 'No pending approvals' : 'No expenses yet'}</p>
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

  var isEditing = !!editExp

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

  var catItems = categories.map(function (c) { return { label: c.name, value: String(c.id) } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id) } })

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = 'Category required'
    if (!amount || Number(amount) <= 0) errs.amount = 'Amount required'
    if (!description.trim()) errs.desc = 'Description required'
    if (!expenseDate) errs.date = 'Date required'
    setErrors(errs)
    return Object.keys(errs).length === 0
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
      } else {
        // Determine status — same two-tier logic
        var selfIsDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
        var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'

        var status = 'pending_dept'
        var deptApprovedBy = null
        var deptApprovedAt = null

        if (isAdminRole) {
          status = 'approved'
        } else if (selfIsDeptApprover) {
          status = 'pending'
          deptApprovedBy = profile.id
          deptApprovedAt = new Date().toISOString()
        } else {
          var { data: hasAppr } = await supabase.rpc('has_dept_approvers', { p_exclude_id: profile.id })
          if (!hasAppr) {
            status = 'pending'
          }
        }

        var { data: newExp, error: insErr } = await supabase.from('expenses').insert({
          user_id: profile.id,
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
          status: status,
          dept_approved_by: deptApprovedBy,
          dept_approved_at: deptApprovedAt,
        }).select('id').single()
        if (insErr) throw new Error(insErr.message)

        if (receiptFile && newExp) {
          var path = await uploadReceipt(newExp.id)
          if (path) {
            await supabase.from('expenses').update({ receipt_path: path }).eq('id', newExp.id)
          }
        }

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

  var canDeptApprove = isDeptApprover && exp.status === 'pending_dept' && exp.user_id !== profile?.id
  var canAdminApprove = isAdmin && exp.status === 'pending'
  var canApprove = canDeptApprove || canAdminApprove
  var canDelete = (exp.user_id === profile?.id && (exp.status === 'pending_dept' || exp.status === 'pending')) || isAdmin
  var canEdit = exp.user_id === profile?.id && (exp.status === 'pending_dept' || exp.status === 'pending')

  async function approve() {
    if (saving) return
    setSaving(true)
    var update = {}
    if (canDeptApprove) {
      update = { status: 'pending', dept_approved_by: profile.id, dept_approved_at: new Date().toISOString() }
    } else if (canAdminApprove) {
      update = { status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
    }
    var { error } = await supabase.from('expenses').update(update).eq('id', exp.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_APPROVE', (exp.description || 'Expense') + ' | ' + formatPoints(exp.amount_paise) + ' | ' + (canDeptApprove ? 'dept' : 'admin')) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function reject() {
    if (!rejectReason.trim()) return
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'rejected',
      rejection_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_REJECT', (exp.description || 'Expense') + ' | ' + rejectReason.trim()) } catch (_) {}
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

      {/* Rejection reason */}
      {exp.status === 'rejected' && exp.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{exp.rejection_reason}</p>
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
        {exp.vendor_name && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Vendor</span>
            <span className="text-sm text-gray-800">{exp.vendor_name}</span>
          </div>
        )}
        {exp.travel_from && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Travel</span>
            <span className="text-sm text-gray-800">{(exp.travel_mode ? exp.travel_mode + ': ' : '') + exp.travel_from + ' → ' + (exp.travel_to || '—')}</span>
          </div>
        )}
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

      {/* Approval actions */}
      {canApprove && !rejectMode && (
        <div className="flex gap-3">
          <button onClick={function () { setRejectMode(true) }} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
            ✗ Reject
          </button>
          <button onClick={approve} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? 'Approving...' : '✓ Approve'}
          </button>
        </div>
      )}

      {rejectMode && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <label className="block text-sm font-medium text-red-700 mb-1">Rejection Reason <span className="text-red-500">*</span></label>
            <textarea value={rejectReason}
              onChange={function (e) { setRejectReason(e.target.value) }}
              rows="3" maxLength="500" placeholder="Reason for rejection..."
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setRejectMode(false); setRejectReason('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            <button onClick={reject} disabled={saving || !rejectReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      {canDelete && !canApprove && (
        <button onClick={deleteExp} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Expense
        </button>
      )}
    </div>
  )
}

export default Expenses