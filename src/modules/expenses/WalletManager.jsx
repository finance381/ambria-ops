import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload } from '../../lib/uploadHelper'
import SearchDropdown from '../../components/ui/SearchDropdown'
import BottomSheet from '../../components/ui/BottomSheet'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { useVoice } from '../../hooks/useVoice'
import { generateCollectionReceiptPdf } from '../../lib/pdfReceipt'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'
import ExpenseDetail from './ExpenseDetail'
import VoiceInput from '../../components/ui/VoiceInput'
import { DeptChip } from '../../components/ui/Badge'
import SearchField from '../../components/ui/SearchField'
import { pushBack, goBack } from '../../lib/backNav'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'



var REF_TYPE_LABELS = {
  expense: 'Expense',
  expense_refund: 'Refund',
  transfer: 'Transfer',
  issued: 'Issued',
  deducted: 'Deducted',
  collection: 'Collection',
  collection_cancel: 'Cancel',
  opening: 'Opening',
  vendor_payment: 'Vendor Payment',
  vendor_deduction: 'Vendor Deduction',
  salary_payment: 'Salary Payment',
  salary_adjustment: 'Salary Adjustment',
}

var REF_TYPE_STYLES = {
  expense: 'bg-red-50 text-red-700 border-red-200',
  expense_refund: 'bg-green-50 text-green-700 border-green-200',
  transfer: 'bg-blue-50 text-blue-700 border-blue-200',
  issued: 'bg-purple-50 text-purple-700 border-purple-200',
  deducted: 'bg-orange-50 text-orange-700 border-orange-200',
  collection: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  collection_cancel: 'bg-rose-50 text-rose-700 border-rose-200',
  opening: 'bg-gray-100 text-gray-700 border-gray-300',
  vendor_payment: 'bg-red-50 text-red-700 border-red-200',
  vendor_deduction: 'bg-amber-50 text-amber-700 border-amber-200',
  salary_payment: 'bg-red-50 text-red-700 border-red-200',
  salary_adjustment: 'bg-amber-50 text-amber-700 border-amber-200',
}

// wallet_transactions rows created by pay_vendor/pay_employee — reference_id points at
// the ledger_entries row for that specific payment (proof images, deduction reason, etc.)
var PAYMENT_REF_TYPES = ['vendor_payment', 'vendor_deduction', 'salary_payment', 'salary_adjustment']

// expenses.status — mirrors Ledgers.jsx's drill-view badges so an expense's
// acknowledgment state is visible here too, not just after drilling into the ledger.
var EXP_STATUS_LABELS = { recorded: 'Recorded', flagged: 'Resubmit', acknowledged: 'Acknowledged', deducted: 'Deducted' }
var EXP_STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}

function WalletManager({ profile, isAdmin, isAuditor, myWallet, walletBalance, onClose, onBalanceChange, onOpenExpense, onNavigateToExpenses }) {
  var [walletView, setWalletView] = useState(null)
  var [allWallets, setAllWallets] = useState([])
  var [walletProfiles, setWalletProfiles] = useState({})
  var [selectedWallet, setSelectedWallet] = useState(null)
  var [walletTxns, setWalletTxns] = useState([])
  var [txnFrom, setTxnFrom] = useState('')
  var [txnTo, setTxnTo] = useState('')
  var [txnRefType, setTxnRefType] = useState('')
  var [walletSearch, setWalletSearch] = useState('')
  var [walletRoleFilter, setWalletRoleFilter] = useState('')
  var [pdfBusy, setPdfBusy] = useState(false)
  var [walletBalanceState, setWalletBalanceState] = useState('all')
  var [walletPendingOnly, setWalletPendingOnly] = useState(false)
  var [walletSort, setWalletSort] = useState('name')
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
  var [pendingIncoming, setPendingIncoming] = useState([])
  var [pendingOutgoing, setPendingOutgoing] = useState([])
  var [pendingIssues, setPendingIssues] = useState([])
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
  var [transferParties, setTransferParties] = useState({})
  var [expenseRefs, setExpenseRefs] = useState({})
  // Resolved display labels for lookup-type sub-type extra fields, keyed 'source:id' → label.
  var [expLookupLabels, setExpLookupLabels] = useState({})
  // ledger_entries rows for PAYMENT_REF_TYPES txns, keyed by ledger_entries.id (== t.reference_id)
  // — carries .metadata (payment_images / deduction_image) for inline proof thumbnails.
  var [paymentRefs, setPaymentRefs] = useState({})
  // EPC back-links: wallet_tx_id → { epc, isCancel }. Populated by loadRecentTxns / openWalletTxns.
  var [epcRefs, setEpcRefs] = useState({})
  var [cancelTarget, setCancelTarget] = useState(null)  // { txn, kind: 'collection' | 'epc' }
  var [cancelReason, setCancelReason] = useState('')
  var [cancelSaving, setCancelSaving] = useState(false)
  var [collectModal, setCollectModal] = useState(false)
  var [collectDate, setCollectDate] = useState('')
  var [collectEvents, setCollectEvents] = useState([])
  var [collectFunctionsLoading, setCollectFunctionsLoading] = useState(false)
  var [collectEventId, setCollectEventId] = useState('')
  var [collectMode, setCollectMode] = useState('')
  var [collectBalance, setCollectBalance] = useState(null)
  var [collectBalanceLoading, setCollectBalanceLoading] = useState(false)
  var [showActualCash, setShowActualCash] = useState(false)
  var [collectAmount, setCollectAmount] = useState('')
  var [collectDesc, setCollectDesc] = useState('')
  var [collectImage, setCollectImage] = useState(null)
  var [collectSaving, setCollectSaving] = useState(false)
  var collectVoice = useVoice()

  useEffect(function () {
    if (isAdmin || isAuditor) {
      setWalletView('wallets')
      loadAllWallets()
    }
    loadTransfers()
  }, [])

  // For non-admin/auditor: land on dashboard once myWallet is available.
  // Handles race where WalletManager mounts before parent's async wallet fetch resolves.
  useEffect(function () {
    if (isAdmin || isAuditor) return
    if (!myWallet) return
    if (walletView === 'dashboard' || walletView === 'transactions') return
    setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
    setSelectedWallet(myWallet)
    setWalletView('dashboard')
    loadRecentTxns(myWallet)
  }, [myWallet, isAdmin, isAuditor])

  function refreshBalance() {
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { onBalanceChange(res.data?.balance_paise || 0) })
  }

  function refreshView() {
    if (walletView === 'dashboard' && selectedWallet) {
      loadRecentTxns(selectedWallet)
    } else if (walletView === 'transactions' && selectedWallet) {
      openWalletTxns(null)
    } else if (walletView === 'wallets') {
      loadAllWallets()
    }
  }

  // Resolve lookup-type extra fields (vendor/staff/category/venue/job-department pickers)
  // defined on each expense's sub-type into display labels, keyed 'source:id'.
  function resolveExpenseLookups(eMap) {
    var bySource = {}
    Object.keys(eMap).forEach(function (eid) {
      var e = eMap[eid]
      var fields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
      var meta = e.metadata || {}
      fields.forEach(function (f) {
        if (f.type !== 'lookup' || !f.source) return
        var v = meta[f.key]
        if (!v) return
        if (!bySource[f.source]) bySource[f.source] = []
        if (bySource[f.source].indexOf(v) === -1) bySource[f.source].push(v)
      })
    })
    var sources = Object.keys(bySource)
    if (sources.length === 0) return
    Promise.all(sources.map(function (src) {
      var ids = bySource[src]
      if (src === 'vendors') {
        return supabase.from('vendors').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.name } }) } })
      }
      if (src === 'staff') {
        return supabase.from('profiles').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (p) { return { id: String(p.id), label: p.name || '—' } }) } })
      }
      if (src === 'job_departments') {
        return supabase.from('employees').select('id, full_name, employee_code').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (e) { return { id: String(e.id), label: e.full_name + ' (' + e.employee_code + ')' } } ) } })
      }
      if (src === 'categories') {
        return supabase.from('categories').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (c) { return { id: String(c.id), label: c.name } }) } })
      }
      if (src === 'venues') {
        return supabase.from('venues').select('id, code, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.code + ' — ' + v.name } }) } })
      }
      return Promise.resolve({ src: src, rows: [] })
    })).then(function (results) {
      var next = {}
      results.forEach(function (res) { res.rows.forEach(function (row) { next[res.src + ':' + row.id] = row.label }) })
      setExpLookupLabels(function (prev) { return Object.assign({}, prev, next) })
    }).catch(function () {})
  }

  async function loadRecentTxns(wallet) {
    if (!wallet) return
    var { data } = await supabase.from('wallet_transactions')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(5)
    var txns = data || []
    var tRefIds = txns.filter(function (t) { return t.reference_type === 'transfer' && t.reference_id }).map(function (t) { return t.reference_id })
    if (tRefIds.length > 0) {
      var { data: tData } = await supabase.from('wallet_transfers').select('*').in('id', tRefIds)
      var tMap = {}
      var cpIds = {}
      ;(tData || []).forEach(function (tr) {
        tMap[tr.id] = tr
        if (tr.from_user_id) cpIds[tr.from_user_id] = true
        if (tr.to_user_id) cpIds[tr.to_user_id] = true
      })
      setTransferParties(function (prev) { return Object.assign({}, prev, tMap) })
      var cpArr = Object.keys(cpIds)
      if (cpArr.length > 0) {
        var { data: pData } = await supabase.from('profiles').select('id, name').in('id', cpArr)
        var pMap = {}
        ;(pData || []).forEach(function (p) { pMap[p.id] = p })
        setWalletProfiles(function (prev) { return Object.assign({}, prev, pMap) })
      }
    }
    var expRefIds = txns.filter(function (tt) {
      return (tt.reference_type === 'expense' || tt.reference_type === 'expense_refund') && tt.reference_id
    }).map(function (tt) { return tt.reference_id })
    if (expRefIds.length > 0) {
      var expIdsNum = expRefIds.map(function (x) { return Number(x) }).filter(function (n) { return !isNaN(n) })
      var { data: eData } = await supabase.from('expenses')
        .select('id, description, amount_paise, expense_date, event_id, vendor_name, metadata, expense_types(name, icon), expense_sub_types(name, extra_fields), expense_allocations(department, amount_paise, expense_types(name), expense_sub_types(name))')
        .in('id', expIdsNum)
      var eMap = {}
      var evIds = {}
      ;(eData || []).forEach(function (e) {
        eMap[e.id] = e
        if (e.event_id) evIds[e.event_id] = true
      })
      var evArr = Object.keys(evIds)
      if (evArr.length > 0) {
        var { data: evData } = await supabase.from('event_ledger').select('id, event_name').in('id', evArr)
        var evNameMap = {}
        ;(evData || []).forEach(function (ev) { evNameMap[ev.id] = ev.event_name })
        Object.keys(eMap).forEach(function (eid) {
          var ex = eMap[eid]
          if (ex.event_id && evNameMap[ex.event_id]) ex._event_name = evNameMap[ex.event_id]
        })
      }
      setExpenseRefs(function (prev) { return Object.assign({}, prev, eMap) })
      resolveExpenseLookups(eMap)
    }
    // EPC back-links: any wallet_txn whose id matches extra_plate_collections.wallet_tx_id OR .cancel_wallet_tx_id
    var txnIds = txns.map(function (tt) { return tt.id })
    if (txnIds.length > 0) {
      var { data: epcFwd } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('wallet_tx_id', txnIds)
      var { data: epcRev } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('cancel_wallet_tx_id', txnIds)
      var eMapEpc = {}
      ;(epcFwd || []).forEach(function (r) { if (r.wallet_tx_id) eMapEpc[r.wallet_tx_id] = { epc: r, isCancel: false } })
      ;(epcRev || []).forEach(function (r) { if (r.cancel_wallet_tx_id) eMapEpc[r.cancel_wallet_tx_id] = { epc: r, isCancel: true } })
      setEpcRefs(function (prev) { return Object.assign({}, prev, eMapEpc) })
    }
    setWalletTxns(txns)
  }

  function handleBack() {
    if (walletView === 'transactions' && (isAdmin || isAuditor)) {
      // Admin viewing own wallet: back to dashboard. Otherwise back to wallets list.
      if (selectedWallet && selectedWallet.user_id === profile.id) {
        setWalletView('dashboard')
        setTxnFrom('')
        setTxnTo('')
        loadRecentTxns(selectedWallet)
      } else {
        setWalletView('wallets')
        setSelectedWallet(null)
        setWalletTxns([])
        setTxnFrom('')
        setTxnTo('')
      }
    } else if (walletView === 'transactions' && !isAdmin && !isAuditor) {
      setWalletView('dashboard')
      setTxnFrom('')
      setTxnTo('')
      loadRecentTxns(selectedWallet)
    } else if (walletView === 'dashboard' && (isAdmin || isAuditor)) {
      setWalletView('wallets')
      setSelectedWallet(null)
      setWalletTxns([])
    } else {
      onClose()
    }
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

  async function openWalletTxns(wallet, from, to, refType) {
    if (wallet) setSelectedWallet(wallet)
    var wid = (wallet || selectedWallet)?.id
    if (!wid) return
    var query = supabase.from('wallet_transactions')
      .select('id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, created_at, issued_image_path, received_image_path, received_at, wallet_id, status, receipt_no, payment_mode, cancel_wallet_tx_id, cancelled_at, cancelled_by, cancelled_reason')
      .eq('wallet_id', wid)
      .order('created_at', { ascending: false })
      .limit(500)
    var f = from != null ? from : txnFrom
    var t = to != null ? to : txnTo
    var rt = refType != null ? refType : txnRefType
    if (f) query = query.gte('created_at', f + 'T00:00:00')
    if (t) query = query.lte('created_at', t + 'T23:59:59')
    if (rt) query = query.eq('reference_type', rt)
    var { data } = await query
    var txns = data || []
    var cpIds = {}
    var tRefIds = txns.filter(function (t) { return t.reference_type === 'transfer' && t.reference_id }).map(function (t) { return t.reference_id })
    if (tRefIds.length > 0) {
      var { data: tData } = await supabase.from('wallet_transfers').select('*').in('id', tRefIds)
      var tMap = {}
      ;(tData || []).forEach(function (tr) {
        tMap[tr.id] = tr
        if (tr.from_user_id) cpIds[tr.from_user_id] = true
        if (tr.to_user_id) cpIds[tr.to_user_id] = true
      })
      setTransferParties(tMap)
    } else {
      setTransferParties({})
    }
    // Enrich expense + refund refs with type / sub-type / dept / event for finance context.
    var expRefIds = txns.filter(function (tt) {
      return (tt.reference_type === 'expense' || tt.reference_type === 'expense_refund') && tt.reference_id
    }).map(function (tt) { return tt.reference_id })
    if (expRefIds.length > 0) {
      var expIdsNum = expRefIds.map(function (x) { return Number(x) }).filter(function (n) { return !isNaN(n) })
      var { data: eData } = await supabase.from('expenses')
        .select('id, description, amount_paise, expense_date, event_id, vendor_name, metadata, status, expense_types(name, icon), expense_sub_types(name, extra_fields), expense_allocations(department, amount_paise, expense_types(name), expense_sub_types(name))')
        .in('id', expIdsNum)
      var eMap = {}
      var evIds = {}
      ;(eData || []).forEach(function (e) {
        eMap[e.id] = e
        if (e.event_id) evIds[e.event_id] = true
      })
      var evArr = Object.keys(evIds)
      if (evArr.length > 0) {
        var { data: evData } = await supabase.from('event_ledger').select('id, event_name').in('id', evArr)
        var evNameMap = {}
        ;(evData || []).forEach(function (ev) { evNameMap[ev.id] = ev.event_name })
        Object.keys(eMap).forEach(function (eid) {
          var ex = eMap[eid]
          if (ex.event_id && evNameMap[ex.event_id]) ex._event_name = evNameMap[ex.event_id]
        })
      }
      setExpenseRefs(eMap)
      resolveExpenseLookups(eMap)
    } else {
      setExpenseRefs({})
    }
    // Vendor/salary payment proof images live on ledger_entries.metadata, not on the
    // wallet_transactions row itself — batch-fetch so the list can show a thumbnail
    // inline instead of only after opening the detail modal.
    var payRefIds = txns.filter(function (tt) {
      return PAYMENT_REF_TYPES.indexOf(tt.reference_type) !== -1 && tt.reference_id
    }).map(function (tt) { return tt.reference_id })
    if (payRefIds.length > 0) {
      var { data: leData } = await supabase.from('ledger_entries').select('id, metadata').in('id', payRefIds)
      var leMap = {}
      ;(leData || []).forEach(function (le) { leMap[le.id] = le })
      setPaymentRefs(leMap)
    } else {
      setPaymentRefs({})
    }
    // EPC back-links: any wallet_txn whose id matches extra_plate_collections.wallet_tx_id OR .cancel_wallet_tx_id
    var txnIds = txns.map(function (tt) { return tt.id })
    if (txnIds.length > 0) {
      var { data: epcFwd } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('wallet_tx_id', txnIds)
      var { data: epcRev } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('cancel_wallet_tx_id', txnIds)
      var eMapEpc = {}
      ;(epcFwd || []).forEach(function (r) { if (r.wallet_tx_id) eMapEpc[r.wallet_tx_id] = { epc: r, isCancel: false } })
      ;(epcRev || []).forEach(function (r) { if (r.cancel_wallet_tx_id) eMapEpc[r.cancel_wallet_tx_id] = { epc: r, isCancel: true } })
      setEpcRefs(eMapEpc)
    } else {
      setEpcRefs({})
    }
    // Ensure counterparty profile names load (needed on non-admin own-wallet view).
    var cpArr = Object.keys(cpIds)
    if (cpArr.length > 0) {
      var missing = cpArr.filter(function (id) { return !walletProfiles[id] })
      if (missing.length > 0) {
        var { data: pData } = await supabase.from('profiles').select('id, name').in('id', missing)
        var pMap = {}
        ;(pData || []).forEach(function (p) { pMap[p.id] = p })
        setWalletProfiles(function (prev) { return Object.assign({}, prev, pMap) })
      }
    }
    setWalletTxns(txns)
    if (wallet) {
      // Register the mobile back-gesture's undo for this navigation — mirrors handleBack's
      // transactions→(dashboard|wallets) logic, but computed off the fresh `wallet` param
      // rather than component state (which hasn't committed the new view yet at this point).
      var isOwnWalletNav = wallet.user_id === profile.id
      var walletForUndo = wallet
      pushBack(function () {
        if (isOwnWalletNav) {
          setWalletView('dashboard')
          setTxnFrom('')
          setTxnTo('')
          loadRecentTxns(walletForUndo)
        } else {
          setWalletView('wallets')
          setSelectedWallet(null)
          setWalletTxns([])
          setTxnFrom('')
          setTxnTo('')
        }
      })
      setWalletView('transactions')
    }
  }

  async function issuePoints() {
    if (issueSaving || !issueModal || !issueAmount || Number(issueAmount) <= 0) return
    // Image mandatory on credit (issue). Debit unchanged.
    if (issueType !== 'debit' && !issueImage) {
      alert('Receipt image is required when issuing points.')
      return
    }
    setIssueSaving(true)
    var amountRupees = Math.round(Number(issueAmount) * 100)
    var rpcName = issueType === 'debit' ? 'deduct_money' : 'issue_money'
    var defaultDesc = issueType === 'debit' ? 'Points deducted by admin' : 'Points issued by admin'
    var imagePath = null
    if (issueImage) {
      var iF = await prepUpload(issueImage, 100)
      var ext = iF.name.split('.').pop()
      var path = 'wallet/issued/' + issueModal.user_id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, iF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setIssueSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc(rpcName, {
      p_user_id: issueModal.user_id,
      p_amount_paise: amountRupees,
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
    try { await logActivity(logAction, (walletProfiles[issueModal.user_id]?.name || '—') + ' | ' + formatPoints(amountRupees) + ' | ' + (issueDesc.trim() || '—')) } catch (_) {}
    setIssueModal(null)
    setIssueAmount('')
    setIssueDesc('')
    setIssueImage(null)
    setIssueSaving(false)
    loadAllWallets()
    refreshBalance()
    refreshView()
  }

  async function confirmReceive() {
    if (receiveSaving || !receiveModal) return
    setReceiveSaving(true)
    var imagePath = null
    if (receiveImage) {
      var rF = await prepUpload(receiveImage, 100)
      var ext = rF.name.split('.').pop()
      var path = 'wallet/received/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, rF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setReceiveSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc('confirm_wallet_receive', {
      p_txn_id: receiveModal.id,
      p_received_image: imagePath,
    })
    if (error) { alert('Confirm failed: ' + error.message); setReceiveSaving(false); return }
    try { await logActivity('WALLET_RECEIVE_CONFIRM', formatPoints(Math.abs(receiveModal.amount_paise)) + ' | Txn #' + receiveModal.id) } catch (_) {}
    setReceiveModal(null)
    setReceiveImage(null)
    setReceiveSaving(false)
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function loadTransfers() {
    var wid = myWallet?.id
    var [incRes, outRes, issRes] = await Promise.all([
      supabase.from('wallet_transfers').select('id, from_user_id, amount_paise, description, sender_image_path, status, created_at').eq('to_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('wallet_transfers').select('id, to_user_id, amount_paise, description, sender_image_path, status, created_at').eq('from_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      wid
        ? supabase.from('wallet_transactions').select('id, type, amount_paise, description, performed_by, created_at, issued_image_path, wallet_id, status, reference_type').eq('wallet_id', wid).eq('status', 'pending').eq('type', 'credit').is('reference_type', null).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    var inc = incRes.data || []
    var out = outRes.data || []
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
    setPendingIssues(issRes.data || [])
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
    var amountRupees = Math.round(Number(transferAmount) * 100)
    var imagePath = null
    if (transferImage) {
      var tF = await prepUpload(transferImage, 100)
      var ext = tF.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, tF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setTransferSaving(false); return }
      imagePath = path
    }
    var toName = (transferUsers.find(function (u) { return u.id === transferTo }) || {}).name || '—'
    var { data: tid, error } = await supabase.rpc('initiate_transfer', {
      p_to_user_id: transferTo,
      p_amount_paise: amountRupees,
      p_description: (transferDesc.trim() || 'Cash transfer') + ' → ' + toName,
      p_sender_image: imagePath,
    })
    if (error) { alert('Transfer failed: ' + error.message); setTransferSaving(false); return }
    try { await logActivity('WALLET_TRANSFER', toName + ' | ' + formatPoints(amountRupees)) } catch (_) {}
    setTransferModal(false)
    setTransferSaving(false)
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function confirmTransferReceive() {
    if (transferConfirmSaving || !transferConfirmModal) return
    setTransferConfirmSaving(true)
    var imagePath = null
    if (transferConfirmImage) {
      var tcF = await prepUpload(transferConfirmImage, 100)
      var ext = tcF.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_recv_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, tcF, { upsert: true })
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
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function cancelTransfer(t) {
    if (!confirm('Cancel this transfer? ' + formatPoints(t.amount_paise) + ' will be refunded.')) return
    var { error } = await supabase.rpc('cancel_transfer', { p_transfer_id: t.id })
    if (error) { alert('Cancel failed: ' + error.message); return }
    try { await logActivity('WALLET_TRANSFER_CANCEL', formatPoints(t.amount_paise)) } catch (_) {}
    refreshBalance()
    loadTransfers()
  }

  async function openCollectModal() {
    setCollectModal(true)
    setCollectDate('')
    setCollectEvents([])
    setCollectEventId('')
    setCollectMode('')
    setCollectBalance(null)
    setCollectAmount('')
    setCollectDesc('')
    setCollectImage(null)
  }

  async function loadFunctionsForDate(dateStr) {
    setCollectDate(dateStr)
    setCollectEventId('')
    setCollectBalance(null)
    if (!dateStr) { setCollectEvents([]); return }
    setCollectFunctionsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, client_name, session, contact_person, contact_number, secondary_contact, created_user_name, department, contract_no')
      .eq('function_date', dateStr)
      .order('event_name')
    setCollectEvents(data || [])
    setCollectFunctionsLoading(false)
    if (data && data.length === 1) { selectCollectFunction(String(data[0].id)) }
  }

  async function selectCollectFunction(fid) {
    setCollectEventId(fid)
    setCollectBalance(null)
    if (!fid) return
    setCollectBalanceLoading(true)
    var { data, error } = await supabase.rpc('fn_event_balance', { p_event_id: Number(fid) })
    if (!error && data && data.length > 0) { setCollectBalance(data[0]) }
    setCollectBalanceLoading(false)
  }

  async function printReceipt(txn) {
    if (!txn) return
    var contractNo = null
    var clientName = ''
    var eventDate = ''
    var dealBy = ''
    if (txn.reference_id) {
      var { data: ev } = await supabase.from('events')
        .select('contract_no, client_name, function_date, created_user_name')
        .eq('id', Number(txn.reference_id)).maybeSingle()
      if (ev) {
        contractNo = ev.contract_no || null
        clientName = ev.client_name || ''
        eventDate = ev.function_date || ''
        dealBy = ev.created_user_name || ''
      }
    }
    var collectorId = txn.performed_by
    var receivedByName = walletProfiles[collectorId]?.name || ''
    var signatureUrl = null
    if (collectorId) {
      var { data: pr } = await supabase.from('profiles').select('name, signature_path').eq('id', collectorId).maybeSingle()
      if (pr) {
        if (!receivedByName) receivedByName = pr.name || ''
        if (pr.signature_path) {
          var { data: signed } = await supabase.storage.from('images').createSignedUrl(pr.signature_path, 300)
          signatureUrl = signed?.signedUrl || null
        }
      }
    }
    try {
      await generateCollectionReceiptPdf({
        receiptNo: txn.receipt_no,
        paymentMode: txn.payment_mode,
        amountRupees: txn.amount_paise,
        description: txn.description,
        createdAt: txn.created_at,
        contractNo: contractNo,
        clientName: clientName,
        eventDate: eventDate,
        dealBy: dealBy,
        receivedByName: receivedByName,
        signatureUrl: signatureUrl,
      })
    } catch (e) { alert('Receipt generation failed: ' + e.message) }
  }

  function openCancel(txn, kind) {
    setCancelTarget({ txn: txn, kind: kind })
    setCancelReason('')
  }

  async function confirmCancel() {
    if (cancelSaving || !cancelTarget) return
    var reason = cancelReason.trim()
    if (reason.length < 3) { alert('Reason required (min 3 chars)'); return }
    setCancelSaving(true)
    var t = cancelTarget.txn
    var kind = cancelTarget.kind
    var rpc, params, actName, lbl
    if (kind === 'epc') {
      var epcRow = (epcRefs[t.id] || {}).epc
      if (!epcRow) { alert('EPC row not found'); setCancelSaving(false); return }
      rpc = 'fn_extra_plate_cancel'
      params = { p_collection_id: epcRow.id, p_reason: reason }
      actName = 'EXTRA_PLATE_CANCEL_FROM_WALLET'
      lbl = epcRow.extras_charged + ' extras · ' + formatPoints(t.amount_paise)
    } else {
      rpc = 'fn_wallet_collect_cancel'
      params = { p_txn_id: t.id, p_reason: reason }
      actName = 'WALLET_COLLECTION_CANCEL'
      lbl = (t.receipt_no ? '#' + t.receipt_no + ' · ' : '') + formatPoints(t.amount_paise)
    }
    var { error } = await supabase.rpc(rpc, params)
    if (error) { alert('Cancel failed: ' + error.message); setCancelSaving(false); return }
    try { await logActivity(actName, lbl + ' | ' + reason) } catch (_) {}
    setCancelTarget(null)
    setCancelReason('')
    setCancelSaving(false)
    refreshBalance()
    if (walletView === 'transactions') { openWalletTxns(null) }
    else if (walletView === 'dashboard') { loadRecentTxns(selectedWallet) }
  }

  function renderCancelModal() {
    if (!cancelTarget) return null
    var t = cancelTarget.txn
    var kind = cancelTarget.kind
    var isEpc = kind === 'epc'
    var epcRow = isEpc ? (epcRefs[t.id] || {}).epc : null
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { if (!cancelSaving) { setCancelTarget(null); setCancelReason('') } }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          <h3 className="text-base font-bold text-gray-900">
            Cancel {isEpc ? 'Extra Plate Collection' : 'Event Collection'}
          </h3>
          <div className="text-sm text-gray-600">
            {isEpc && epcRow
              ? epcRow.extras_charged + ' extras · ' + formatPoints(t.amount_paise) + (t.payment_mode ? ' · ' + t.payment_mode.toUpperCase() : '')
              : (t.receipt_no ? '#' + t.receipt_no + ' · ' : '') + formatPoints(t.amount_paise) + (t.payment_mode ? ' · ' + t.payment_mode.toUpperCase() : '')}
            {t.description ? ' — ' + t.description : ''}
          </div>
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            Wallet will be debited {formatPoints(t.amount_paise)} and the event ledger reversed. This cannot be undone.
          </div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</label>
          <VoiceInput type="text" value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
            placeholder="Why is this being cancelled?"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={function () { setCancelTarget(null); setCancelReason('') }} disabled={cancelSaving}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl font-semibold">Keep</button>
            <button type="button" onClick={confirmCancel} disabled={cancelSaving || !cancelReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-xl disabled:opacity-40 font-semibold">
              {cancelSaving ? 'Cancelling...' : 'Confirm Cancel'}
            </button>
          </div>
        </div>
      </div>
    ), document.body)
  }

  // ── Detail overlays: expense (ExpenseDetail reused) + collection (self-contained modal) ──
  var [expenseDetailTarget, setExpenseDetailTarget] = useState(null)  // full expense row for ExpenseDetail
  var [expenseDetailLoading, setExpenseDetailLoading] = useState(false)
  var [detailTarget, setDetailTarget] = useState(null)  // { txn, kind, event, collectorName, imgUrl, loading }
  var [payDetailTarget, setPayDetailTarget] = useState(null)  // { txn, entry, partyName, loading }

  async function openExpenseDetail(expenseId) {
    if (!expenseId) return
    setExpenseDetailLoading(true)
    setExpenseDetailTarget({ _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)')
      .eq('id', Number(expenseId)).maybeSingle()
    setExpenseDetailLoading(false)
    if (error || !row) { alert('Expense not found: ' + (error?.message || 'missing')); setExpenseDetailTarget(null); return }
    setExpenseDetailTarget(row)
  }

  function closeExpenseDetail(refresh) {
    setExpenseDetailTarget(null)
    if (refresh) {
      refreshBalance()
      if (walletView === 'transactions') { openWalletTxns(null) }
      else if (walletView === 'dashboard') { loadRecentTxns(selectedWallet) }
    }
  }

  function renderExpenseDetailModal() {
    if (!expenseDetailTarget) return null
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        onClick={function () { closeExpenseDetail(false) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          {expenseDetailLoading || expenseDetailTarget._placeholder ? (
            <div className="py-16 text-center text-sm text-gray-500">Loading expense…</div>
          ) : (
            <ExpenseDetail
              key={expenseDetailTarget.id}
              exp={expenseDetailTarget}
              profile={profile}
              isAdmin={isAdmin}
              isDeptApprover={false}
              onBack={function () { closeExpenseDetail(false) }}
              onUpdated={function () { closeExpenseDetail(true) }}
              onEdit={function () { closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses() }}
              onRaiseGV={function () { closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses() }}
            />
          )}
        </div>
      </div>
    ), document.body)
  }

  async function openCollectionDetail(txn, kind) {
    setDetailTarget({ txn: txn, kind: kind, loading: true })
    var evData = null
    if (kind === 'collection' && txn.reference_id) {
      var { data: ev } = await supabase.from('events')
        .select('id, contract_no, event_name, client_name, function_date, created_user_name, venue_name')
        .eq('id', Number(txn.reference_id)).maybeSingle()
      evData = ev || null
    } else if (kind === 'epc') {
      var epcRow = (epcRefs[txn.id] || {}).epc
      if (epcRow && epcRow.event_id) {
        var { data: ev2 } = await supabase.from('events')
          .select('id, contract_no, event_name, client_name, function_date, created_user_name, venue_name')
          .eq('id', epcRow.event_id).maybeSingle()
        evData = ev2 || null
      }
    }
    var collectorName = walletProfiles[txn.performed_by]?.name || ''
    if (!collectorName && txn.performed_by) {
      var { data: pr } = await supabase.from('profiles').select('name').eq('id', txn.performed_by).maybeSingle()
      if (pr) collectorName = pr.name || ''
    }
    var imgUrl = txn.received_image_path
      ? supabase.storage.from('receipts').getPublicUrl(txn.received_image_path).data?.publicUrl
      : null
    setDetailTarget({ txn: txn, kind: kind, loading: false, event: evData, collectorName: collectorName, imgUrl: imgUrl })
  }

  function renderCollectionDetailModal() {
    if (!detailTarget) return null
    var t = detailTarget.txn
    var kind = detailTarget.kind
    var isEpc = kind === 'epc'
    var ev = detailTarget.event || null
    var epcRow = isEpc ? (epcRefs[t.id] || {}).epc : null
    var isCancelled = t.status === 'cancelled' || (isEpc && epcRow && epcRow.status === 'cancelled')
    var canCancel = !isCancelled && (
      (kind === 'collection' && (isAdmin || t.performed_by === profile.id)) ||
      (isEpc && epcRow && (isAdmin || epcRow.collected_by === profile.id))
    )
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { setDetailTarget(null) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev2) { ev2.stopPropagation() }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {isEpc ? '🍽 Extra Plate Collection' : '🎯 Event Collection'}
              </h3>
              {ev && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {ev.event_name || '—'}{ev.client_name ? ' · ' + ev.client_name : ''}
                </p>
              )}
            </div>
            <button type="button" onClick={function () { setDetailTarget(null) }}
              className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">✕</button>
          </div>
          {isCancelled && (
            <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <span className="font-bold uppercase text-[9px] tracking-wider">Cancelled</span>
              {(t.cancelled_reason || (epcRow && epcRow.cancelled_reason)) && (
                <div className="mt-0.5">Reason: {t.cancelled_reason || epcRow.cancelled_reason}</div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Amount</p>
              <p className="font-bold text-gray-900 text-base">{formatPoints(t.amount_paise)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Payment</p>
              <p className="font-medium text-gray-800">{t.payment_mode ? t.payment_mode.toUpperCase() : '—'}</p>
            </div>
            {t.receipt_no && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Receipt No</p>
                <p className="font-medium text-gray-800">#{t.receipt_no}</p>
              </div>
            )}
            {isEpc && epcRow && (
              <>
                <div>
                  <p className="text-[10px] uppercase text-gray-500">Plates Charged</p>
                  <p className="font-medium text-gray-800">{epcRow.extras_charged}</p>
                </div>
                {epcRow.plates_returned > 0 && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Returned</p>
                    <p className="font-medium text-gray-800">{epcRow.plates_returned}</p>
                  </div>
                )}
                {epcRow.discount_paise > 0 && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Discount</p>
                    <p className="font-medium text-gray-800">{formatPoints(epcRow.discount_paise)}</p>
                  </div>
                )}
              </>
            )}
            {ev && ev.function_date && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Event Date</p>
                <p className="font-medium text-gray-800">{formatDate(ev.function_date)}</p>
              </div>
            )}
            {ev && ev.contract_no && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Contract</p>
                <p className="font-medium text-gray-800">{ev.contract_no}</p>
              </div>
            )}
            {ev && ev.venue_name && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Venue</p>
                <p className="font-medium text-gray-800">{ev.venue_name}</p>
              </div>
            )}
            {ev && ev.created_user_name && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Deal By</p>
                <p className="font-medium text-gray-800">{ev.created_user_name}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase text-gray-500">Collected By</p>
              <p className="font-medium text-gray-800">{detailTarget.collectorName || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">When</p>
              <p className="font-medium text-gray-800">{formatDate(t.created_at)}</p>
            </div>
          </div>
          {t.description && (
            <div>
              <p className="text-[10px] uppercase text-gray-500 mb-0.5">Description</p>
              <p className="text-sm text-gray-800">{t.description}</p>
            </div>
          )}
          {detailTarget.imgUrl && (
            <div>
              <p className="text-[10px] uppercase text-gray-500 mb-1">Receipt Image</p>
              <img src={detailTarget.imgUrl} alt="receipt"
                onClick={function () { setEnlargedImg(detailTarget.imgUrl) }}
                className="w-full max-h-64 object-contain rounded border border-gray-200 cursor-zoom-in bg-gray-50" />
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            {kind === 'collection' && t.receipt_no && (
              <button type="button" onClick={function () { printReceipt(t) }}
                className="flex-1 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100">
                🖨 Reprint
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={function () { setDetailTarget(null); openCancel(t, kind) }}
                className="flex-1 py-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
                🚫 Cancel
              </button>
            )}
            <button type="button" onClick={function () { setDetailTarget(null) }}
              className="flex-1 py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      </div>
    ), document.body)
  }

  async function openPaymentDetail(t) {
    setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: true })
    if (!t.reference_id) { setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: false }); return }
    var { data: entry } = await supabase.from('ledger_entries')
      .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_type, metadata')
      .eq('id', t.reference_id).maybeSingle()
    if (!entry) { setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: false }); return }
    var partyName = ''
    if (entry.ledger_type === 'vendor') {
      var { data: v } = await supabase.from('vendors').select('name').eq('id', entry.party_id).maybeSingle()
      partyName = (v && v.name) || ''
    } else {
      var { data: p } = await supabase.from('profiles').select('name').eq('id', entry.party_id).maybeSingle()
      partyName = (p && p.name) || ''
    }
    setPayDetailTarget({ txn: t, entry: entry, partyName: partyName, loading: false })
  }

  function renderPaymentDetailModal() {
    if (!payDetailTarget) return null
    var t = payDetailTarget.txn
    var entry = payDetailTarget.entry
    var meta = (entry && entry.metadata) || {}
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { setPayDetailTarget(null) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-gray-900">{REF_TYPE_LABELS[t.reference_type] || t.reference_type}</h3>
            <button type="button" onClick={function () { setPayDetailTarget(null) }}
              className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">✕</button>
          </div>
          {payDetailTarget.loading ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading...</p>
          ) : (
            <>
              <p className="text-2xl font-bold text-red-700">−{formatPoints(t.amount_paise)}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <p className="text-[10px] uppercase text-gray-500">{entry && entry.ledger_type === 'vendor' ? 'Vendor' : 'Employee'}</p>
                  <p className="font-medium text-gray-800">{payDetailTarget.partyName || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-gray-500">Date</p>
                  <p className="font-medium text-gray-800">{formatDate((entry && entry.entry_date) || t.created_at)}</p>
                </div>
                {meta.mode && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Mode</p>
                    <p className="font-medium text-gray-800">{meta.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}</p>
                  </div>
                )}
                {meta.salary_month && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Salary Month</p>
                    <p className="font-medium text-gray-800">{meta.salary_month}</p>
                  </div>
                )}
              </div>
              {(t.description || (entry && entry.description)) && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-0.5">Description</p>
                  <p className="text-sm text-gray-800">{t.description || entry.description}</p>
                </div>
              )}
              {meta.reason && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-0.5">Reason</p>
                  <p className="text-sm text-gray-800">{meta.reason}</p>
                </div>
              )}
              {(meta.payment_images || meta.deduction_image) && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-1">Proof</p>
                  <PaymentProofThumbs meta={meta} />
                </div>
              )}
              <p className="text-[10px] text-gray-400 pt-1">Logged {formatDate(t.created_at)}</p>
              <button type="button" onClick={function () { setPayDetailTarget(null) }}
                className="w-full py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                Close
              </button>
            </>
          )}
        </div>
      </div>
    ), document.body)
  }

  async function submitCollection() {
    if (collectSaving) return
    if (!collectEventId) { alert('Select a function'); return }
    if (!collectMode) { alert('Select Cash or Bank'); return }
    if (!collectAmount || Number(collectAmount) <= 0) { alert('Enter amount'); return }
    if (collectMode === 'bank' && !collectImage) { alert('Receipt photo is required for bank collections'); return }
    setCollectSaving(true)
    var amountRupees = Math.round(Number(collectAmount) * 100)
    var imagePath = null
    if (collectImage) {
      // Upload receipt first — DB write is source of truth
      var cF = await prepUpload(collectImage, 100)
      var ext = cF.name.split('.').pop()
      imagePath = 'wallet/collection/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(imagePath, cF, { upsert: true })
      if (upErr) { alert('Receipt upload failed: ' + upErr.message); setCollectSaving(false); return }
    }
    var evtName = (collectEvents.find(function (e) { return String(e.id) === collectEventId }) || {}).event_name || ''
    var desc = (collectDesc.trim() || 'Collection') + ' — ' + evtName
    var { data, error } = await supabase.rpc('fn_wallet_collect', {
      p_event_id: Number(collectEventId),
      p_payment_mode: collectMode,
      p_amount_paise: amountRupees,
      p_description: desc,
      p_receipt_path: imagePath
    })
    if (error) { alert('Collection failed: ' + error.message); setCollectSaving(false); return }
    if (data && data.over_agreed) {
      alert('Warning: this collection exceeds the agreed ' + collectMode + ' amount for the event. Recorded anyway.')
    }
    try { await logActivity('WALLET_COLLECTION', evtName + ' | ' + collectMode + ' | ' + formatPoints(amountRupees)) } catch (_) {}

    // Auto-open PDF receipt in new tab
    try {
      await printReceipt({
        receipt_no: data ? data.receipt_no : null,
        payment_mode: collectMode,
        amount_paise: amountRupees,
        description: desc,
        created_at: new Date().toISOString(),
        reference_id: collectEventId,
      })
    } catch (_) {}

    setCollectModal(false)
    setCollectSaving(false)
    refreshBalance()
    openWalletTxns(null)
  }

  async function runBulkIssue() {
    var userIds = Object.keys(bulkSelected).filter(function (k) { return bulkSelected[k] })
    if (bulkSaving || !userIds.length || !bulkAmount || Number(bulkAmount) <= 0) return
    setBulkSaving(true)
    var amountRupees = Math.round(Number(bulkAmount) * 100)
    var desc = bulkDesc.trim() || 'Bulk points issued by admin'
    var succeeded = 0
    var failed = 0
    var CHUNK = 10
    for (var c = 0; c < userIds.length; c += CHUNK) {
      var chunk = userIds.slice(c, c + CHUNK)
      var results = await Promise.allSettled(chunk.map(function (uid) {
        return supabase.rpc('issue_money', { p_user_id: uid, p_amount_paise: amountRupees, p_description: desc })
      }))
      results.forEach(function (res) {
        if (res.status === 'fulfilled' && !res.value.error) succeeded++
        else failed++
      })
    }
    try { await logActivity('WALLET_BULK_ISSUE', succeeded + ' users | ' + formatPoints(amountRupees) + ' each | ' + desc) } catch (_) {}
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

  async function exportWalletPDF() {
    if (!walletTxns.length || !selectedWallet || pdfBusy) return
    setPdfBusy(true)
    try {
      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      var fontOk = await registerPdfFont(doc)
      var FONT = fontOk ? 'NotoSans' : 'helvetica'
      var pageW = doc.internal.pageSize.getWidth()
      var pageH = doc.internal.pageSize.getHeight()

      // Chronological (oldest → newest) for bank-statement feel
      var chrono = walletTxns.slice().sort(function (a, b) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

      var totalCr = 0, totalDb = 0
      chrono.forEach(function (t) {
        if (t.type === 'credit') totalCr += (t.amount_paise || 0)
        else totalDb += (t.amount_paise || 0)
      })
      var oldest = chrono[0]
      var newest = chrono[chrono.length - 1]
      var opening = oldest ? ((oldest.balance_after_paise || 0) - (oldest.type === 'credit' ? (oldest.amount_paise || 0) : -(oldest.amount_paise || 0))) : 0
      var closing = newest ? (newest.balance_after_paise || 0) : 0

      var userName = walletProfiles[selectedWallet.user_id]?.name || 'User'
      var userEmail = walletProfiles[selectedWallet.user_id]?.email || selectedWallet.email || ''
      var mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      function fmtD(iso) {
        if (!iso) return '—'
        var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
        return String(d.getDate()).padStart(2, '0') + '-' + mm[d.getMonth()] + '-' + d.getFullYear()
      }
      function fmtN(paise) {
        return ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }
      // Structured Particulars lines for the hand-drawn column: a bold header (the
      // linked expense's type > sub-type when there is one, else the transaction's
      // own ref kind), the description, then whatever context that reference type
      // offers — sub-type fields, a per-allocation breakdown with right-pinned
      // amounts, event name, counterparty, payment mode, etc.
      function particularsLinesFor(t) {
        var refLabel = REF_TYPE_LABELS[t.reference_type] || (t.reference_type || '')
        var refNo = t.reference_id ? String(t.reference_id).slice(0, 10) : ''
        var e = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
          ? expenseRefs[t.reference_id] : null
        var tn = (e && e.expense_types?.name) || ''
        var stn = (e && e.expense_sub_types?.name) || ''

        var lines = [{ kind: 'header', text: tn ? (tn + (stn ? ' > ' + stn : '')) : (refLabel + (refNo ? ' #' + refNo : '')) }]
        lines.push({ kind: 'desc', text: t.description || '—' })

        if (e) {
          // Sub-type custom fields (vendor, employee, casual type, slip no, etc.), resolving
          // lookup fields to their display names — mirrors the on-screen transaction list.
          var subFields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
          var meta = e.metadata || {}
          var fieldBits = []
          subFields.forEach(function (f) {
            var val = meta[f.key]
            if (val == null || val === '') return
            var display = val
            if (f.type === 'lookup' && f.source) display = expLookupLabels[f.source + ':' + String(val)] || val
            fieldBits.push((f.label || f.key) + ': ' + display)
          })
          if (e.vendor_name && !fieldBits.some(function (b) { return b.slice(b.indexOf(': ') + 2) === e.vendor_name })) {
            fieldBits.unshift('Vendor: ' + e.vendor_name)
          }
          if (fieldBits.length > 0) lines.push({ kind: 'chip', text: fieldBits.join('   ·   ') })

          var allocs = e.expense_allocations || []
          if (allocs.length > 1) {
            allocs.forEach(function (a) {
              var atn = a.expense_types?.name || ''
              var astn = a.expense_sub_types?.name || ''
              var differs = atn && (atn !== tn || astn !== stn)
              var typeLabel = differs ? (' [' + atn + (astn ? ' > ' + astn : '') + ']') : ''
              lines.push({ kind: 'alloc', text: (a.department || 'Unassigned') + typeLabel, amount: fmtN(a.amount_paise) })
            })
          } else if (allocs.length === 1 && allocs[0].department) {
            lines.push({ kind: 'chip', text: allocs[0].department })
          }
          if (e._event_name) lines.push({ kind: 'chip', text: 'Event: ' + e._event_name })
          if (e.expense_date) lines.push({ kind: 'chip', text: 'Expense date: ' + fmtD(e.expense_date) })
        } else if (t.reference_type === 'transfer' && t.reference_id) {
          var tr = transferParties[t.reference_id]
          if (tr) {
            var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
            var cpName = walletProfiles[cpId]?.name
            if (cpName) lines.push({ kind: 'chip', text: (t.type === 'debit' ? '→ ' : '← ') + cpName })
          }
        } else if (t.reference_type === 'collection') {
          var bits = []
          if (t.payment_mode) bits.push(t.payment_mode)
          if (t.receipt_no) bits.push('Receipt #' + t.receipt_no)
          if (bits.length) lines.push({ kind: 'chip', text: bits.join('   ·   ') })
        } else if (t.reference_type === 'issued') {
          lines.push({ kind: 'chip', text: 'Issued by admin' })
        } else if (t.reference_type === 'deducted') {
          lines.push({ kind: 'chip', text: 'Deducted by admin' })
        } else if (t.reference_type === 'opening') {
          lines.push({ kind: 'chip', text: 'Opening balance' })
        }
        return lines
      }

      var periodFrom = txnFrom || (oldest ? oldest.created_at.split('T')[0] : '')
      var periodTo = txnTo || (newest ? newest.created_at.split('T')[0] : '')

      // Header
      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('WALLET STATEMENT', 10, 14)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), pageW - 10, 14, { align: 'right' })
      doc.setTextColor(0)

      doc.setFontSize(9)
      var y = 22
      doc.setFont(FONT, 'bold'); doc.text('Account:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(userName + (userEmail ? '  (' + userEmail + ')' : ''), 28, y)
      y += 5
      doc.setFont(FONT, 'bold'); doc.text('Period:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(fmtD(periodFrom) + '  to  ' + fmtD(periodTo) + '     (' + chrono.length + ' transactions)', 28, y)
      y += 7

      // Summary strip
      autoTable(doc, {
        startY: y,
        head: [['Opening Balance', 'Total Credits', 'Total Debits', 'Closing Balance']],
        body: [[
          fmtN(opening),
          '+' + fmtN(totalCr),
          '-' + fmtN(totalDb),
          fmtN(closing),
        ]],
        styles: { font: FONT, fontSize: 9, halign: 'right', cellPadding: 2 },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'right', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 47.5 },
          1: { cellWidth: 47.5, textColor: [16, 128, 60] },
          2: { cellWidth: 47.5, textColor: [180, 30, 30] },
          3: { cellWidth: 47.5, fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
      })

      // Main ledger
      var dateMeta = []
      var particularsMeta = []
      var body = chrono.map(function (t) {
        var dt = t.created_at ? new Date(t.created_at) : null
        var dm = { top: dt ? fmtD(t.created_at.split('T')[0]) : '—', bottom: dt ? dt.toTimeString().slice(0, 5) : '' }
        dateMeta.push(dm)
        var pLines = particularsLinesFor(t)
        particularsMeta.push(pLines)
        var isCredit = t.type === 'credit'
        var amt = fmtN(t.amount_paise || 0)
        return [
          plainDateLines(dm, ''),
          plainParticularsLines(pLines).join('\n'),
          isCredit ? '' : amt,
          isCredit ? amt : '',
          fmtN(t.balance_after_paise || 0),
        ]
      })

      var statementHooks = makeStatementCellHooks(doc, FONT, {
        dateCol: 0, particularsCol: 1, dateMeta: dateMeta, particularsMeta: particularsMeta,
        topLabel: 'DATE', bottomLabel: 'TIME',
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        // columnStyles' halign only ever reaches body cells (jspdf-autotable applies it
        // exclusively to sectionName === 'body'), so Debit/Credit/Balance need their own
        // per-cell halign here to land over the right-aligned figures below.
        head: [['Date', 'Particulars',
          { content: 'Debit', styles: { halign: 'right' } },
          { content: 'Credit', styles: { halign: 'right' } },
          { content: 'Balance', styles: { halign: 'right' } }]],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 26, fontSize: 7 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 22, halign: 'right', textColor: [180, 30, 30] },
          3: { cellWidth: 22, halign: 'right', textColor: [16, 128, 60] },
          4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
        willDrawCell: statementHooks.willDrawCell,
        didDrawCell: statementHooks.didDrawCell,
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Wallet statement for ' + userName, 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      await openOrSharePdf(doc, 'wallet_' + userName.replace(/[^a-z0-9]+/gi, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf')
      try { await logActivity('WALLET_PDF_EXPORT', userName + ' | ' + chrono.length + ' txns') } catch (_) {}
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // ═══════════════════════════════════════════════
  // MODAL HELPERS — Shared across dashboard / wallets / transactions views
  // ═══════════════════════════════════════════════
  function renderIssueModal() {
    if (!issueModal) return null
    return (
      <BottomSheet open={true} onClose={function () { setIssueModal(null); setIssueImage(null) }} title={issueType === 'debit' ? 'Deduct Points' : 'Issue Points'}>
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
            <VoiceInput type="text" value={issueDesc} onChange={function (e) { setIssueDesc(e.target.value) }}
              placeholder="e.g. Weekly allowance, Reimbursement..."
              maxLength="300" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
                <input type="file" accept="image/*" capture="environment" className="sr-only"
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
    )
  }

  function renderReceiveModal() {
    if (!receiveModal) return null
    return (
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
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={function (e) { if (e.target.files?.[0]) setReceiveImage(e.target.files[0]); e.target.value = '' }} />
              </label>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={function () { setReceiveModal(null); setReceiveImage(null) }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={confirmReceive} disabled={receiveSaving}
              className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
              {receiveSaving ? 'Confirming...' : '✓ Confirm Received'}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderCollectModal() {
    if (!collectModal) return null
    var pendCashP = collectBalance ? Number(collectBalance.pending_cash_paise || 0) : 0
    var pendBankP = collectBalance ? Number(collectBalance.pending_bank_paise || 0) : 0
    var pendTaxP = collectBalance ? Number(collectBalance.pending_tax_paise || 0) : 0
    var agrCashP = collectBalance ? Number(collectBalance.agreed_cash_paise || 0) : 0
    var agrBankP = collectBalance ? Number(collectBalance.agreed_bank_paise || 0) : 0
    var colCashP = collectBalance ? Number(collectBalance.collected_cash_paise || 0) : 0
    var colBankP = collectBalance ? Number(collectBalance.collected_bank_paise || 0) : 0
    var taxP = collectBalance ? Number(collectBalance.tax_amount_paise || 0) : 0
    var canSubmit = collectEventId && collectMode && collectAmount && Number(collectAmount) > 0 && (collectMode === 'cash' || collectImage) && !collectSaving
    return (
      <BottomSheet open={true} onClose={function () { setCollectModal(false) }} title="Collect Payment">
        <div className="space-y-4">
          <EventDatePicker label="1. Event Date" value={collectDate} collapsible
            onChange={function (dateStr) { loadFunctionsForDate(dateStr) }} />

          {collectDate && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">2. Select Function</label>
              {collectFunctionsLoading && <p className="text-xs text-gray-400">Loading...</p>}
              {!collectFunctionsLoading && collectEvents.length === 0 && (
                <p className="text-xs text-gray-400">No functions on this date</p>
              )}
              {collectEvents.length > 0 && (
                <div className="space-y-1.5">
                  {collectEvents.map(function (ev) {
                    var selected = String(ev.id) === collectEventId
                    return (
                      <div key={ev.id} role="button" tabIndex={0}
                        onClick={function () { selectCollectFunction(String(ev.id)) }}
                        onKeyDown={function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCollectFunction(String(ev.id)) } }}
                        className={"w-full text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer " +
                          (selected ? "border-blue-600 bg-blue-50 border-2" : "border-gray-200 hover:border-gray-300 bg-white")}>
                        <div className={"text-sm font-medium " + (selected ? "text-blue-900" : "text-gray-900")}>
                          {ev.event_name + (ev.client_name ? ' — ' + ev.client_name : '')}
                        </div>
                        <div className={"text-xs " + (selected ? "text-blue-700" : "text-gray-500")}>
                          {(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : '')}
                        </div>
                        {(ev.department || ev.contract_no) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <DeptChip name={ev.department} />
                            {ev.contract_no && (
                              <span className="text-[10px] font-mono text-gray-500">#{ev.contract_no}</span>
                            )}
                          </div>
                        )}
                        {ev.created_user_name && (
                          <div className={"text-[11px] mt-0.5 " + (selected ? "text-blue-600" : "text-gray-400")}>
                            Contract by {ev.created_user_name}
                          </div>
                        )}
                        {(ev.contact_number || ev.secondary_contact) && (
                          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                            {ev.contact_person && <span className="text-gray-500">{ev.contact_person}:</span>}
                            {ev.contact_number && (
                              <a href={"tel:" + String(ev.contact_number).replace(/[^0-9+]/g, '')}
                                onClick={function (e) { e.stopPropagation() }}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                                <i className="ti ti-phone" style={{ fontSize: '13px' }} aria-hidden="true"></i>
                                {ev.contact_number}
                              </a>
                            )}
                            {ev.secondary_contact && (
                              <a href={"tel:" + String(ev.secondary_contact).replace(/[^0-9+]/g, '')}
                                onClick={function (e) { e.stopPropagation() }}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                                <i className="ti ti-phone" style={{ fontSize: '13px' }} aria-hidden="true"></i>
                                {ev.secondary_contact}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {collectEventId && (
            <div className="bg-gray-50 rounded-lg px-3 py-2.5">
              {collectBalanceLoading ? (
                <p className="text-xs text-gray-400">Loading balance...</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending Balance</div>
                    <button type="button" onClick={function () { setShowActualCash(!showActualCash) }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 underline">
                      {showActualCash ? 'LMS scale' : 'Actual ×10'}
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-gray-500">💵 Cash{showActualCash && agrCashP > 0 ? ' (actual)' : ''}</div>
                      <div className={"text-base font-semibold " + (pendCashP > 0 ? "text-red-600" : "text-green-600")}>
                        {agrCashP > 0 ? formatPoints(pendCashP * (showActualCash ? 10 : 1)) : formatPoints(colCashP * (showActualCash ? 10 : 1)) + ' collected'}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-gray-500">🏦 Bank</div>
                      <div className={"text-base font-semibold " + (pendBankP > 0 ? "text-red-600" : "text-green-600")}>
                        {agrBankP > 0 ? formatPoints(pendBankP) : (colBankP > 0 ? formatPoints(colBankP) + ' collected' : '—')}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-gray-500">🧾 Tax</div>
                      <div className={"text-base font-semibold " + (pendTaxP > 0 ? "text-red-600" : "text-green-600")}>
                        {taxP > 0 ? formatPoints(pendTaxP) : '—'}
                      </div>
                    </div>
                  </div>
                  {agrCashP === 0 && agrBankP === 0 && taxP === 0 && (
                    <div className="text-xs text-gray-400 mt-1.5">No agreed split set from LMS</div>
                  )}
                </>
              )}
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">3. Payment Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={function () { setCollectMode('cash') }}
                  className={"py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors " +
                    (collectMode === 'cash' ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-600")}>
                  💵 Cash
                </button>
                <button type="button" onClick={function () { setCollectMode('bank') }}
                  className={"py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors " +
                    (collectMode === 'bank' ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-600")}>
                  🏦 Bank
                </button>
              </div>
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">4. Amount Received</label>
              <input type="number" min="1" step="any" inputMode="decimal" value={collectAmount}
                onChange={function (e) { setCollectAmount(e.target.value) }}
                placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }} />
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">5. Description</label>
              <VoiceInput type="text" value={collectDesc} onChange={function (e) { setCollectDesc(e.target.value) }}
                placeholder="e.g. Advance payment, Final settlement..."
                maxLength="300" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">6. Receipt Photo {collectMode === 'bank' && <span className="text-red-500">*</span>}{collectMode === 'cash' && <span className="text-gray-400 normal-case">(optional)</span>}</label>
              {collectImage ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-green-300 bg-green-50 rounded-lg">
                  <span className="text-xs text-green-700 font-medium truncate flex-1">✓ {collectImage.name}</span>
                  <button onClick={function () { setCollectImage(null) }} className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="py-3 text-center text-sm text-gray-700 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    📷 Camera
                    <input type="file" accept="image/*" capture="environment" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                  <label className="py-3 text-center text-sm text-gray-700 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    🖼️ Gallery
                    <input type="file" accept="image/*" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={function () { setCollectModal(false) }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={submitCollection}
              disabled={!canSubmit}
              className="flex-1 py-3 text-sm text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors font-semibold">
              {collectSaving ? 'Saving...' : 'Collect ' + (collectAmount && Number(collectAmount) > 0 ? Number(collectAmount).toLocaleString('en-IN') + ' pts' : '')}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderTransferModal() {
    if (!transferModal) return null
    return (
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
            {transferAmount && Number(transferAmount) > 0 && Math.round(Number(transferAmount) * 100) > walletBalance && (
              <p className="text-xs text-amber-700 mt-1">⚠ Wallet will go negative. Balance: {formatPoints(walletBalance)}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <VoiceInput type="text" value={transferDesc} onChange={function (e) { setTransferDesc(e.target.value) }}
              placeholder="e.g. Repayment, Lunch money..." maxLength="300"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
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
                <input type="file" accept="image/*" capture="environment" className="sr-only"
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
    )
  }

  function renderTransferConfirmModal() {
    if (!transferConfirmModal) return null
    return (
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
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={function (e) { if (e.target.files?.[0]) setTransferConfirmImage(e.target.files[0]); e.target.value = '' }} />
              </label>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={function () { setTransferConfirmModal(null); setTransferConfirmImage(null) }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={confirmTransferReceive} disabled={transferConfirmSaving}
              className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
              {transferConfirmSaving ? 'Confirming...' : '✓ Confirm Received'}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderEnlargedImg() {
    if (!enlargedWalletImg) return null
    return createPortal((
      <div className="fixed inset-0 bg-black/80 z-[9998] flex items-center justify-center p-4" onClick={function () { setEnlargedWalletImg(null) }}>
        <img src={enlargedWalletImg} alt="" className="max-w-full max-h-[80vh] rounded-lg" />
      </div>
    ), document.body)
  }

  // ═══════════════════════════════════════════════
  // WALLET DASHBOARD — Own wallet landing (mobile-first)
  // ═══════════════════════════════════════════════
  if (walletView === 'dashboard' && selectedWallet) {
    var bal = walletBalance != null ? walletBalance : (selectedWallet.balance_paise || 0)
    var balColor = bal < 0 ? 'text-red-700' : bal === 0 ? 'text-gray-500' : 'text-green-800'
    var balBg = bal < 0 ? 'bg-red-50 border-red-200' : bal === 0 ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-200'
    var lastTxn = walletTxns[0]
    var lastActivity = lastTxn ? formatDate(lastTxn.created_at) : 'none yet'
    var receiveCount = pendingIncoming.length + pendingIssues.length
    // Pending confirmations take priority over the Issue shortcut — otherwise an admin/
    // auditor's own incoming transfers never surface on their dashboard at all.
    var showIssueTile = (isAdmin || isAuditor) && receiveCount === 0
    return (
      <div className="@container">
      <div className="space-y-4 max-w-2xl mx-auto @3xl:max-w-none">
        <div>
          <button onClick={handleBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back</button>
          <h2 className="text-lg font-bold text-gray-900">Wallet</h2>
          <p className="text-xs text-gray-400">{profile.name || '—'} · <span className={"font-bold " + balColor}>{formatPoints(bal)}</span></p>
        </div>

        <div className="space-y-4 @3xl:grid @3xl:grid-cols-12 @3xl:gap-5 @3xl:space-y-0 @3xl:items-start">
          <div className="@3xl:col-span-5 space-y-4">

        {/* Balance card */}
        <div className={"border rounded-2xl p-5 " + balBg}>
          <p className={"text-[11px] font-bold uppercase tracking-wider mb-1 " + balColor}>Balance</p>
          <p className={"text-4xl font-bold " + balColor}>{formatPoints(bal)}</p>
          <p className={"text-xs mt-2 " + balColor + " opacity-75"}>Last activity — {lastActivity}</p>
        </div>

        {/* 2x2 action grid */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={openCollectModal}
            className="py-5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex flex-col items-center gap-1.5">
            <span className="text-xl text-blue-600">↓</span>
            <span className="text-sm font-bold text-gray-800">Collect</span>
          </button>
          <button onClick={openTransferModal}
            className="py-5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex flex-col items-center gap-1.5">
            <span className="text-xl text-emerald-600">⇄</span>
            <span className="text-sm font-bold text-gray-800">Transfer</span>
          </button>
          <button onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }}
            className="py-5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex flex-col items-center gap-1.5">
            <span className="text-xl text-gray-600">🕐</span>
            <span className="text-sm font-bold text-gray-800">History</span>
          </button>
          {showIssueTile ? (
            <button onClick={function () { setIssueModal(selectedWallet); setIssueAmount(''); setIssueDesc(''); setIssueType('credit') }}
              className="py-5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex flex-col items-center gap-1.5">
              <span className="text-xl text-indigo-600">+</span>
              <span className="text-sm font-bold text-gray-800">Issue</span>
            </button>
          ) : receiveCount > 0 ? (
            <button onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }}
              className="py-5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex flex-col items-center gap-1.5 relative">
              <span className="text-xl text-orange-600">📥</span>
              <span className="text-sm font-bold text-gray-800">Receive</span>
              <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{receiveCount}</span>
            </button>
          ) : (
            <div className="py-5 bg-gray-50 border border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <span className="text-[11px] text-gray-400">No pending</span>
            </div>
          )}
        </div>
          </div>

          <div className="@3xl:col-span-7">
        {/* Recent transactions */}
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Recent Transactions</p>
          {walletTxns.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400 bg-white border border-gray-200 rounded-xl">No transactions yet</div>
          ) : (
            <div className="space-y-2">
              {walletTxns.slice(0, 5).map(function (t) {
                var isCredit = t.type === 'credit'
                var isExpKind = t.reference_type === 'expense' || t.reference_type === 'expense_refund'
                var xp = isExpKind && t.reference_id ? expenseRefs[t.reference_id] : null
                var tr = t.reference_type === 'transfer' && t.reference_id ? transferParties[t.reference_id] : null
                var epcHit = epcRefs[t.id] || null
                var isEpc = !!epcHit && !epcHit.isCancel
                var isEpcCancel = !!epcHit && epcHit.isCancel
                var isCancelled = t.status === 'cancelled'
                var cpName = null
                if (tr) {
                  var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
                  cpName = walletProfiles[cpId]?.name
                }
                var enrichLine = null
                if (isExpKind) {
                  var typeName = xp?.expense_types?.name || ''
                  var subTypeName = xp?.expense_sub_types?.name || ''
                  var alloc = (xp?.expense_allocations && xp.expense_allocations[0]) || null
                  var dept = alloc?.department || ''
                  var parts = []
                  if (typeName) parts.push((xp.expense_types?.icon ? xp.expense_types.icon + ' ' : '') + typeName + (subTypeName ? ' › ' + subTypeName : ''))
                  if (dept) parts.push(dept)
                  if (t.reference_type === 'expense_refund' && xp?.amount_paise) parts.push('orig ' + formatPoints(xp.amount_paise))
                  if (parts.length > 0) enrichLine = <p className="text-[11px] text-indigo-600 truncate">{parts.join(' · ')}</p>
                  else enrichLine = <p className="text-[11px] text-gray-400 italic truncate">No type / dept set</p>
                } else if (t.reference_type === 'collection') {
                  enrichLine = <p className="text-[11px] text-emerald-600 truncate">🎉 Event Collection{t.payment_mode ? ' · ' + t.payment_mode : ''}</p>
                } else if (t.reference_type === 'collection_cancel') {
                  enrichLine = <p className="text-[11px] text-rose-600 truncate">🔁 Cancellation reversal</p>
                } else if (isEpc) {
                  enrichLine = <p className="text-[11px] text-emerald-600 truncate">🍽 Extra Plates · {epcHit.epc.extras_charged}{epcHit.epc.payment_mode ? ' · ' + epcHit.epc.payment_mode : ''}</p>
                } else if (isEpcCancel) {
                  enrichLine = <p className="text-[11px] text-rose-600 truncate">🔁 Extra Plate cancel</p>
                } else if (tr && cpName) {
                  enrichLine = <p className="text-[11px] text-blue-600 truncate">{t.type === 'debit' ? '→ ' : '← '}{cpName}</p>
                } else if (t.reference_type === 'issued') {
                  enrichLine = <p className="text-[11px] text-purple-600 truncate">Issued by admin</p>
                } else if (t.reference_type === 'deducted') {
                  enrichLine = <p className="text-[11px] text-orange-600 truncate">Deducted by admin</p>
                } else if (t.reference_type === 'opening') {
                  enrichLine = <p className="text-[11px] text-gray-500 truncate">Opening balance</p>
                }
                var epcCancellable = isEpc && epcHit.epc.status !== 'cancelled' && (isAdmin || epcHit.epc.collected_by === profile.id)
                var collCancellable = t.reference_type === 'collection' && !isCancelled && (isAdmin || t.performed_by === profile.id)
                var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
                var isPayRow = PAYMENT_REF_TYPES.indexOf(t.reference_type) !== -1
                var rowIsClickable = isExpRow || t.reference_type === 'collection' || isEpc || isPayRow
                function handleRowClick() {
                  if (!rowIsClickable) return
                  if (isExpRow) {
                    if (onOpenExpense) onOpenExpense(t.reference_id)
                    else openExpenseDetail(t.reference_id)
                  } else if (t.reference_type === 'collection') {
                    openCollectionDetail(t, 'collection')
                  } else if (isEpc) {
                    openCollectionDetail(t, 'epc')
                  } else if (isPayRow) {
                    openPaymentDetail(t)
                  }
                }
                return (
                  <div key={t.id}
                    onClick={handleRowClick}
                    className={"flex items-center gap-3 p-3 bg-white border rounded-xl " + (isCancelled ? "border-gray-200 opacity-50" : "border-gray-200") + (rowIsClickable ? " cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors" : "")}>
                    <div className={"w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 " + (isCredit ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600")}>
                      <span className="text-sm font-bold">{isCredit ? '+' : '−'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {t.reference_type && (
                          <span className={"text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 " + (REF_TYPE_STYLES[t.reference_type] || 'bg-gray-100 text-gray-700 border-gray-300')}>
                            {REF_TYPE_LABELS[t.reference_type] || t.reference_type}
                          </span>
                        )}
                        <p className={"text-sm font-bold text-gray-800 truncate " + (isCancelled ? "line-through" : "")}>{t.description || (isCredit ? 'Credit' : 'Debit')}</p>
                        {t.status === 'pending' && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded flex-shrink-0">Pending</span>}
                        {isCancelled && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded flex-shrink-0">Cancelled</span>}
                      </div>
                      {enrichLine}
                      {isCancelled && t.cancelled_reason && (
                        <p className="text-[10px] text-rose-600 italic truncate">Reason: {t.cancelled_reason}</p>
                      )}
                      <p className="text-[11px] text-gray-400">{formatDate(t.created_at)}</p>
                      <div className="flex gap-1 flex-wrap mt-1" onClick={function (ev) { ev.stopPropagation() }}>
                        {t.reference_type === 'collection' && t.receipt_no && (
                          <button onClick={function (ev) { ev.stopPropagation(); printReceipt(t) }}
                            className="px-2 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors">
                            🖨 #{t.receipt_no}
                          </button>
                        )}
                        {collCancellable && (
                          <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, 'collection') }}
                            className="px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                            🚫 Cancel
                          </button>
                        )}
                        {epcCancellable && (
                          <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, 'epc') }}
                            className="px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                            🚫 Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    <span className={"text-sm font-bold flex-shrink-0 " + (isCredit ? "text-green-600" : "text-red-600")}>
                      {isCredit ? '+' : '−'}{formatPoints(t.amount_paise)}
                    </span>
                  </div>
                )
              })}
              {walletTxns.length >= 5 && (
                <button onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }}
                  className="w-full py-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                  View all →
                </button>
              )}
            </div>
          )}
        </div>
          </div>
        </div>

        {renderCollectModal()}
        {renderTransferModal()}
        {renderIssueModal()}
        {renderReceiveModal()}
        {renderTransferConfirmModal()}
        {renderCancelModal()}
        {renderCollectionDetailModal()}
        {renderPaymentDetailModal()}
        {renderExpenseDetailModal()}
        {renderEnlargedImg()}
      </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // WALLET ADMIN — All balances
  // ═══════════════════════════════════════════════
  if (walletView === 'wallets') {
    var wSearchLower = walletSearch.toLowerCase()
    var uniqueRoles = {}
    ;(allWallets || []).forEach(function (w) {
      var p = walletProfiles[w.user_id]
      if (p && p.role) uniqueRoles[p.role] = true
    })
    var roleOptions = Object.keys(uniqueRoles).sort()

    var filteredWallets = allWallets.filter(function (w) {
      var p = walletProfiles[w.user_id]
      if (walletSearch) {
        var matches = (p?.name || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
          (p?.email || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
          (p?.role || '').toLowerCase().indexOf(wSearchLower) !== -1
        if (!matches) return false
      }
      if (walletRoleFilter && (p?.role || '') !== walletRoleFilter) return false
      var bal = w.balance_paise || 0
      if (walletBalanceState === 'positive' && bal <= 0) return false
      if (walletBalanceState === 'zero' && bal !== 0) return false
      if (walletBalanceState === 'negative' && bal >= 0) return false
      if (walletPendingOnly && !(w._pendingCount > 0)) return false
      return true
    })

    if (walletSort === 'balance_desc') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (b.balance_paise || 0) - (a.balance_paise || 0) })
    } else if (walletSort === 'balance_asc') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (a.balance_paise || 0) - (b.balance_paise || 0) })
    } else if (walletSort === 'pending') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (b._pendingCount || 0) - (a._pendingCount || 0) })
    } else if (walletSort === 'activity') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) {
        var ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
        var tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
        return tb - ta
      })
    }

    var filtersActive = !!walletRoleFilter || walletBalanceState !== 'all' || walletPendingOnly || walletSort !== 'name'

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">All Wallets</h2>
            <div className="flex items-center gap-2 mt-1">
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
        <SearchField
          value={walletSearch}
          onChange={function (v) { setWalletSearch(v) }}
          placeholder="Search name, email, role..."
          className="w-full"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select value={walletRoleFilter} onChange={function (e) { setWalletRoleFilter(e.target.value) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }}>
            <option value="">All Roles</option>
            {roleOptions.map(function (r) { return <option key={r} value={r}>{r}</option> })}
          </select>

          <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
            {[['all', 'All'], ['positive', '+ ve'], ['zero', 'Zero'], ['negative', '− ve']].map(function (opt) {
              var active = walletBalanceState === opt[0]
              var color = opt[0] === 'positive' ? 'text-green-700' : opt[0] === 'negative' ? 'text-red-700' : 'text-gray-700'
              return (
                <button key={opt[0]} type="button" onClick={function () { setWalletBalanceState(opt[0]) }}
                  className={"px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors " + (active ? "bg-white shadow-sm " + color : "text-gray-500")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 px-2.5 py-1.5 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 bg-white">
            <input type="checkbox" checked={walletPendingOnly}
              onChange={function (e) { setWalletPendingOnly(e.target.checked) }}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="font-medium">Pending only</span>
          </label>

          <select value={walletSort} onChange={function (e) { setWalletSort(e.target.value) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ml-auto"
            style={{ fontSize: '16px' }}>
            <option value="name">Sort: Name</option>
            <option value="balance_desc">Balance high → low</option>
            <option value="balance_asc">Balance low → high</option>
            <option value="pending">Most pending</option>
            <option value="activity">Recent activity</option>
          </select>

          {filtersActive && (
            <button type="button"
              onClick={function () { setWalletRoleFilter(''); setWalletBalanceState('all'); setWalletPendingOnly(false); setWalletSort('name') }}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 px-2">
              Clear
            </button>
          )}
        </div>
        {myWallet && (
          <div onClick={function () {
            setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
            var w = Object.assign({}, myWallet, { balance_paise: walletBalance })
            setSelectedWallet(w)
            setWalletView('dashboard')
            loadRecentTxns(w)
            loadTransfers()
          }}
            className="relative bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform">
            <div>
              <p className="text-sm font-bold text-emerald-800">My Wallet</p>
              <p className="text-xs text-emerald-600">{formatPoints(walletBalance)} · Open dashboard →</p>
            </div>
            {pendingIncoming.length > 0 && (
              <span className="px-2.5 py-1 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full">{pendingIncoming.length} incoming</span>
            )}
          </div>
        )}

        <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2">
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
                  <span className={"text-sm font-bold " + ((w.balance_paise || 0) < 0 ? "text-red-600" : (w.balance_paise || 0) === 0 ? "text-gray-400" : "text-green-700")}>{formatPoints(w.balance_paise)}</span>
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
              <VoiceInput type="text" value={bulkDesc} onChange={function (e) { setBulkDesc(e.target.value) }}
                placeholder="Description" maxLength="300" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
        {renderIssueModal()}
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
          <button onClick={goBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">{(isAdmin || isAuditor) ? '← Back to Wallets' : '← Back'}</button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{txnUser.name || '—'}</h2>
              <p className="text-xs text-gray-400">{txnUser.email || '—'} · Balance: <span className={"font-bold " + ((selectedWallet.balance_paise || 0) < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(selectedWallet.balance_paise)}</span></p>
            </div>
            <div className="flex gap-2">

              {walletTxns.length > 0 && (
                <button onClick={exportWalletCSV}
                  className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                  📥 CSV
                </button>
              )}
              {walletTxns.length > 0 && (
                <button onClick={exportWalletPDF} disabled={pdfBusy}
                  className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40">
                  {pdfBusy ? '⏳ Generating…' : '📄 PDF'}
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
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Type</label>
            <select value={txnRefType} onChange={function (e) { setTxnRefType(e.target.value); openWalletTxns(null, null, null, e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }}>
              <option value="">All Types</option>
              <option value="expense">Expenses</option>
              <option value="expense_refund">Refunds</option>
              <option value="collection">Collections</option>
              <option value="transfer">Transfers</option>
              <option value="issued">Issued (admin)</option>
              <option value="deducted">Deducted (admin)</option>
              <option value="opening">Opening</option>
            </select>
          </div>
          {(txnFrom || txnTo) && (
            <button onClick={function () { setTxnFrom(''); setTxnTo(''); openWalletTxns(null, '', '') }}
              className="px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-px">
              Clear
            </button>
          )}
        </div>
        {walletTxns.length > 0 && (function () {
          var chrono = walletTxns.slice().sort(function (a, b) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
          var totalCr = 0, totalDb = 0
          chrono.forEach(function (t) {
            if (t.type === 'credit') totalCr += (t.amount_paise || 0)
            else totalDb += (t.amount_paise || 0)
          })
          var oldest = chrono[0]
          var newest = chrono[chrono.length - 1]
          var opening = oldest ? ((oldest.balance_after_paise || 0) - (oldest.type === 'credit' ? (oldest.amount_paise || 0) : -(oldest.amount_paise || 0))) : 0
          var closing = newest ? (newest.balance_after_paise || 0) : 0
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Opening</p>
                <p className={"text-sm font-bold mt-0.5 " + (opening < 0 ? "text-red-600" : "text-gray-900")}>{formatPoints(opening)}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Total Credits</p>
                <p className="text-sm font-bold text-green-700 mt-0.5">+{formatPoints(totalCr)}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Total Debits</p>
                <p className="text-sm font-bold text-red-700 mt-0.5">-{formatPoints(totalDb)}</p>
              </div>
              <div className="bg-gray-900 border border-gray-900 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Closing</p>
                <p className={"text-sm font-bold mt-0.5 " + (closing < 0 ? "text-red-400" : "text-green-400")}>{formatPoints(closing)}</p>
              </div>
            </div>
          )
        })()}
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
            var transferRow = t.reference_type === 'transfer' && t.reference_id ? transferParties[t.reference_id] : null
            if (transferRow) {
              var transferSenderPath = transferRow.sender_image_path
              var transferReceiverPath = transferRow.receiver_image_path || transferRow.received_image_path
              if (transferSenderPath) issuedUrl = supabase.storage.from('receipts').getPublicUrl(transferSenderPath).data?.publicUrl
              if (transferReceiverPath) receivedUrl = supabase.storage.from('receipts').getPublicUrl(transferReceiverPath).data?.publicUrl
            }
            var isOwnWallet = selectedWallet && selectedWallet.user_id === profile.id
            var canConfirm = isCredit && t.status === 'pending' && isOwnWallet
            var epcHit = epcRefs[t.id] || null
            var isEpc = !!epcHit && !epcHit.isCancel
            var isEpcCancel = !!epcHit && epcHit.isCancel
            var isCancelled = t.status === 'cancelled'
            var epcCancellable = isEpc && epcHit.epc.status !== 'cancelled' && (isAdmin || epcHit.epc.collected_by === profile.id)
            var collCancellable = t.reference_type === 'collection' && !isCancelled && (isAdmin || t.performed_by === profile.id)
            var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
            var isPayRow = PAYMENT_REF_TYPES.indexOf(t.reference_type) !== -1
            var rowIsClickable = isExpRow || t.reference_type === 'collection' || isEpc || isPayRow
            function handleRowClick() {
              if (!rowIsClickable) return
              if (isExpRow) {
                if (onOpenExpense) onOpenExpense(t.reference_id)
                else openExpenseDetail(t.reference_id)
              } else if (t.reference_type === 'collection') {
                openCollectionDetail(t, 'collection')
              } else if (isEpc) {
                openCollectionDetail(t, 'epc')
              } else if (isPayRow) {
                openPaymentDetail(t)
              }
            }
            var rowBorderClass = isCancelled
              ? "border-gray-200 opacity-50"
              : (t.status === 'pending' ? "border-amber-300 bg-amber-50/30" : "border-gray-200")
            return (
              <div key={t.id}
                onClick={handleRowClick}
                className={"bg-white border rounded-lg p-3 " + rowBorderClass + (rowIsClickable ? " cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors" : "")}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.reference_type && (
                        <span className={"text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border " + (REF_TYPE_STYLES[t.reference_type] || 'bg-gray-100 text-gray-700 border-gray-300')}>
                          {REF_TYPE_LABELS[t.reference_type] || t.reference_type}
                        </span>
                      )}
                      {isEpc && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Extra Plates
                        </span>
                      )}
                      {isEpcCancel && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                          EP Cancel
                        </span>
                      )}
                      <p className={"text-sm text-gray-800 " + (isCancelled ? "line-through" : "")}>
                        {t.description || '—'}
                        {t.reference_type === 'transfer' && t.reference_id && transferParties[t.reference_id] && (function () {
                          var tr = transferParties[t.reference_id]
                          var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
                          var cpName = walletProfiles[cpId]?.name
                          if (!cpName) return null
                          return ' ' + (t.type === 'debit' ? '→' : '←') + ' ' + cpName
                        })()}
                        {isEpc && ' · ' + epcHit.epc.extras_charged + ' extras'}
                      </p>
                      {t.reference_type === 'collection' && t.payment_mode && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                          {t.payment_mode}
                        </span>
                      )}
                      {t.status === 'pending' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Pending</span>
                      )}
                      {isCancelled && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded">Cancelled</span>
                      )}
                      {(t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id && expenseRefs[t.reference_id] && expenseRefs[t.reference_id].status && (
                        <span className={"text-[9px] font-bold uppercase px-1.5 py-0.5 rounded " + (EXP_STATUS_COLORS[expenseRefs[t.reference_id].status] || 'bg-gray-100 text-gray-600')}>
                          {EXP_STATUS_LABELS[expenseRefs[t.reference_id].status] || expenseRefs[t.reference_id].status}
                        </span>
                      )}
                    </div>
                    {isCancelled && t.cancelled_reason && (
                      <p className="text-[10px] text-rose-600 italic mt-0.5">Reason: {t.cancelled_reason}</p>
                    )}
                    {/* Enrichment: expense/refund → type › sub-type · event · vendor · extra fields · (refund amount + date) · per-allocation breakdown */}
                    {(t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id && expenseRefs[t.reference_id] && (function () {
                      var e = expenseRefs[t.reference_id]
                      var typeName = e.expense_types?.name || ''
                      var subTypeName = e.expense_sub_types?.name || ''
                      var allocs = e.expense_allocations || []
                      var parts = []
                      if (typeName) parts.push((e.expense_types?.icon ? e.expense_types.icon + ' ' : '') + typeName + (subTypeName ? ' › ' + subTypeName : ''))
                      if (e._event_name) parts.push('🎯 ' + e._event_name)
                      var subFields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
                      var meta = e.metadata || {}
                      var extraFieldParts = []
                      var extraFieldValues = []
                      subFields.forEach(function (f) {
                        var val = meta[f.key]
                        if (val == null || val === '') return
                        var display = val
                        if (f.type === 'lookup' && f.source) display = expLookupLabels[f.source + ':' + String(val)] || val
                        extraFieldParts.push((f.label || f.key) + ': ' + display)
                        extraFieldValues.push(String(display))
                      })
                      // The plain vendor_name column is a fallback shown to the same
                      // value a sub-type "vendor" lookup field already surfaces — skip
                      // it here when that's the case so the vendor name isn't repeated.
                      if (e.vendor_name && extraFieldValues.indexOf(e.vendor_name) === -1) parts.push('Vendor: ' + e.vendor_name)
                      parts = parts.concat(extraFieldParts)
                      if (t.reference_type === 'expense_refund' && e.amount_paise) parts.push('orig ' + formatPoints(e.amount_paise) + ' on ' + formatDate(e.expense_date))
                      return (
                        <>
                          {parts.length > 0 && <p className="text-[11px] text-indigo-600 mt-0.5">{parts.join(' · ')}</p>}
                          {allocs.length > 0 && (
                            <div className="mt-0.5 space-y-0.5">
                              {allocs.map(function (a, ai) {
                                var allocType = a.expense_types?.name || ''
                                var allocSubType = a.expense_sub_types?.name || ''
                                return (
                                  <p key={ai} className="text-[10px] text-gray-500">
                                    {(a.department || 'Unassigned')}{allocType ? ' · ' + allocType + (allocSubType ? ' › ' + allocSubType : '') : ''} — {formatPoints(a.amount_paise)}
                                  </p>
                                )
                              })}
                            </div>
                          )}
                        </>
                      )
                    })()}
                    <p className="text-[11px] text-gray-400">
                      {formatDate(t.created_at)}
                      {(function () {
                        var d = new Date(t.created_at); if (isNaN(d)) return ''
                        var hh = String(d.getHours()).padStart(2, '0'); var mm = String(d.getMinutes()).padStart(2, '0')
                        return ' · ' + hh + ':' + mm
                      })()}
                      {t.reference_type ? ' · ' + (REF_TYPE_LABELS[t.reference_type] || t.reference_type) : ''}
                      {t.reference_type && t.reference_id ? ' #' + String(t.reference_id).slice(0, 8) : ''}
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
                    {isPayRow && t.reference_id && paymentRefs[t.reference_id] && (
                      <div onClick={function (ev) { ev.stopPropagation() }}>
                        <PaymentProofThumbs meta={paymentRefs[t.reference_id].metadata} />
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className={"text-sm font-bold " + (isCredit ? "text-green-600" : "text-red-600")}>
                      {isCredit ? '+' : '−'}{formatPoints(Math.abs(t.amount_paise))}
                    </p>
                    <p className="text-[10px] text-gray-400">bal: {formatPoints(t.balance_after_paise)}</p>
                    {canConfirm && (
                      <button onClick={function (ev) { ev.stopPropagation(); setReceiveModal(t); setReceiveImage(null) }}
                        className="mt-1.5 px-2 py-1 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200 transition-colors">
                        📷 Confirm Received
                      </button>
                    )}
                    {t.reference_type === 'collection' && t.receipt_no && (
                      <button onClick={function (ev) { ev.stopPropagation(); printReceipt(t) }}
                        className="mt-1.5 ml-1 px-2 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors">
                        🖨 #{t.receipt_no}
                      </button>
                    )}
                    {(collCancellable || epcCancellable) && (
                      <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, collCancellable ? 'collection' : 'epc') }}
                        className="mt-1.5 ml-1 px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                        🚫 Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {renderIssueModal()}
        {renderReceiveModal()}
        {renderCollectModal()}
        {renderTransferModal()}
        {renderTransferConfirmModal()}
        {renderCancelModal()}
        {renderCollectionDetailModal()}
        {renderPaymentDetailModal()}
        {renderExpenseDetailModal()}
        {renderEnlargedImg()}
      </div>
    )
  }

  return null
}

export default WalletManager
