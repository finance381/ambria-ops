import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import BottomSheet from '../../components/ui/BottomSheet'

var REF_TYPE_LABELS = {
  expense: 'Expense',
  expense_refund: 'Refund',
  transfer: 'Transfer',
  issued: 'Issued',
  deducted: 'Deducted',
  collection: 'Collection',
  opening: 'Opening',
}

function WalletManager({ profile, isAdmin, isAuditor, myWallet, walletBalance, onClose, onBalanceChange }) {
  var [walletView, setWalletView] = useState(null)
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
  var [transferParties, setTransferParties] = useState({})
  var [expenseRefs, setExpenseRefs] = useState({})
  var [collectModal, setCollectModal] = useState(false)
  var [collectEvents, setCollectEvents] = useState([])
  var [collectEventId, setCollectEventId] = useState('')
  var [collectAmount, setCollectAmount] = useState('')
  var [collectDesc, setCollectDesc] = useState('')
  var [collectImage, setCollectImage] = useState(null)
  var [collectSaving, setCollectSaving] = useState(false)

  useEffect(function () {
    if (isAdmin || isAuditor) {
      setWalletView('wallets')
      loadAllWallets()
    }
    loadTransfers()
  }, [])

  // For non-admin/auditor: open own wallet transactions once myWallet is available.
  // Handles race where WalletManager mounts before parent's async wallet fetch resolves.
  useEffect(function () {
    if (isAdmin || isAuditor) return
    if (!myWallet) return
    if (walletView === 'transactions' && selectedWallet) return
    setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
    openWalletTxns(myWallet)
  }, [myWallet, isAdmin, isAuditor])

  function refreshBalance() {
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { onBalanceChange(res.data?.balance_paise || 0) })
  }

  function handleBack() {
    if (walletView === 'transactions' && (isAdmin || isAuditor)) {
      setWalletView('wallets')
      setSelectedWallet(null)
      setWalletTxns([])
      setTxnFrom('')
      setTxnTo('')
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
    var txns = data || []
    var tRefIds = txns.filter(function (t) { return t.reference_type === 'transfer' && t.reference_id }).map(function (t) { return t.reference_id })
    if (tRefIds.length > 0) {
      var { data: tData } = await supabase.from('wallet_transfers').select('id, from_user_id, to_user_id').in('id', tRefIds)
      var tMap = {}
      ;(tData || []).forEach(function (tr) { tMap[tr.id] = tr })
      setTransferParties(tMap)
    } else {
      setTransferParties({})
    }
    // Enrich expense + refund refs with type / sub-type / dept for finance context.
    var expRefIds = txns.filter(function (tt) {
      return (tt.reference_type === 'expense' || tt.reference_type === 'expense_refund') && tt.reference_id
    }).map(function (tt) { return tt.reference_id })
    if (expRefIds.length > 0) {
      var { data: eData } = await supabase.from('expenses')
        .select('id, description, amount_paise, expense_date, expense_types(name, icon), expense_sub_types(name), expense_allocations(department, sub_department_id)')
        .in('id', expRefIds)
      var eMap = {}
      ;(eData || []).forEach(function (e) { eMap[e.id] = e })
      setExpenseRefs(eMap)
    } else {
      setExpenseRefs({})
    }
    setWalletTxns(txns)
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
    openWalletTxns(null)
  }

  async function confirmReceive() {
    if (receiveSaving || !receiveModal) return
    setReceiveSaving(true)
    var imagePath = null
    if (receiveImage) {
      var ext = receiveImage.name.split('.').pop()
      var path = 'wallet/received/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, receiveImage, { upsert: true })
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
    openWalletTxns(null)
  }

  async function loadTransfers() {
    var [incRes, outRes] = await Promise.all([
      supabase.from('wallet_transfers').select('id, from_user_id, amount_paise, description, sender_image_path, status, created_at').eq('to_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('wallet_transfers').select('id, to_user_id, amount_paise, description, sender_image_path, status, created_at').eq('from_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
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
    var toName = (transferUsers.find(function (u) { return u.id === transferTo }) || {}).name || '—'
    var { data: tid, error } = await supabase.rpc('initiate_transfer', {
      p_to_user_id: transferTo,
      p_amount_paise: amountPaise,
      p_description: (transferDesc.trim() || 'Cash transfer') + ' → ' + toName,
      p_sender_image: imagePath,
    })
    if (error) { alert('Transfer failed: ' + error.message); setTransferSaving(false); return }
    try { await logActivity('WALLET_TRANSFER', toName + ' | ' + formatPoints(amountPaise)) } catch (_) {}
    setTransferModal(false)
    setTransferSaving(false)
    refreshBalance()
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
    refreshBalance()
    loadTransfers()
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
    setCollectEventId('')
    setCollectAmount('')
    setCollectDesc('')
    setCollectImage(null)
    if (collectEvents.length === 0) {
      var { data } = await supabase.from('events')
        .select('id, event_name, function_date, venue_name')
        .order('function_date', { ascending: false })
        .limit(200)
      setCollectEvents(data || [])
    }
  }

  async function submitCollection() {
    if (collectSaving || !collectEventId || !collectAmount || Number(collectAmount) <= 0) return
    setCollectSaving(true)
    var amountPaise = Math.round(Number(collectAmount) * 100)
    var imagePath = null
    if (collectImage) {
      var ext = collectImage.name.split('.').pop()
      var path = 'wallet/collection/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, collectImage, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setCollectSaving(false); return }
      imagePath = path
    }
    var evtName = (collectEvents.find(function (e) { return String(e.id) === collectEventId }) || {}).event_name || ''
    var desc = (collectDesc.trim() || 'Collection') + ' — ' + evtName
    var { error } = await supabase.rpc('wallet_self_credit', {
      p_amount_paise: amountPaise,
      p_description: desc,
      p_ref_type: 'collection',
      p_ref_id: collectEventId,
    })
    if (error) { alert('Collection failed: ' + error.message); setCollectSaving(false); return }
    if (imagePath) {
      var { data: latestTxn } = await supabase.from('wallet_transactions')
        .select('id')
        .eq('wallet_id', (myWallet || {}).id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (latestTxn) {
        await supabase.from('wallet_transactions').update({ received_image_path: imagePath }).eq('id', latestTxn.id)
      }
    }
    try { await logActivity('WALLET_COLLECTION', evtName + ' | ' + formatPoints(amountPaise)) } catch (_) {}
    setCollectModal(false)
    setCollectSaving(false)
    refreshBalance()
    openWalletTxns(null)
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
          <button onClick={handleBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">{(isAdmin || isAuditor) ? '← Back to Wallets' : '← Back to Expenses'}</button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{txnUser.name || '—'}</h2>
              <p className="text-xs text-gray-400">{txnUser.email || '—'} · Balance: <span className={"font-bold " + ((selectedWallet.balance_paise || 0) < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(selectedWallet.balance_paise)}</span></p>
            </div>
            <div className="flex gap-2">
              {selectedWallet && selectedWallet.user_id === profile.id && (
                <button onClick={openCollectModal}
                  className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
                  ↓ Collect
                </button>
              )}
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
            var isOwnWallet = selectedWallet && selectedWallet.user_id === profile.id
            var canConfirm = isCredit && t.status === 'pending' && isOwnWallet
            return (
              <div key={t.id} className={"bg-white border rounded-lg p-3 " + (t.status === 'pending' ? "border-amber-300 bg-amber-50/30" : "border-gray-200")}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-gray-800">
                        {t.description || '—'}
                        {t.reference_type === 'transfer' && t.reference_id && transferParties[t.reference_id] && (function () {
                          var tr = transferParties[t.reference_id]
                          var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
                          var cpName = walletProfiles[cpId]?.name
                          if (!cpName) return null
                          return ' ' + (t.type === 'debit' ? '→' : '←') + ' ' + cpName
                        })()}
                      </p>
                      {t.status === 'pending' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Pending</span>
                      )}
                    </div>
                    {/* Enrichment: expense/refund → type › sub-type · dept · (refund amount + date) */}
                    {(t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id && expenseRefs[t.reference_id] && (function () {
                      var e = expenseRefs[t.reference_id]
                      var typeName = e.expense_types?.name || ''
                      var subTypeName = e.expense_sub_types?.name || ''
                      var alloc = (e.expense_allocations && e.expense_allocations[0]) || null
                      var dept = alloc?.department || ''
                      var parts = []
                      if (typeName) parts.push((e.expense_types?.icon ? e.expense_types.icon + ' ' : '') + typeName + (subTypeName ? ' › ' + subTypeName : ''))
                      if (dept) parts.push(dept)
                      if (t.reference_type === 'expense_refund' && e.amount_paise) parts.push('orig ' + formatPoints(e.amount_paise) + ' on ' + formatDate(e.expense_date))
                      if (parts.length === 0) return null
                      return <p className="text-[11px] text-indigo-600 mt-0.5">{parts.join(' · ')}</p>
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
        )}
        {collectModal && (
          <BottomSheet open={true} onClose={function () { setCollectModal(false) }} title="Collect Payment">
            <div className="space-y-4">
              <SearchDropdown label="Event" required
                items={collectEvents.map(function (e) { return { label: e.event_name + (e.function_date ? ' · ' + e.function_date : '') + (e.venue_name ? ' · ' + e.venue_name : ''), value: String(e.id) } })}
                value={collectEventId}
                onChange={function (val) { setCollectEventId(val) }}
                placeholder="Search event..." />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points)</label>
                <input type="number" min="1" step="any" inputMode="decimal" value={collectAmount}
                  onChange={function (e) { setCollectAmount(e.target.value) }}
                  placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={collectDesc} onChange={function (e) { setCollectDesc(e.target.value) }}
                  placeholder="e.g. Advance payment, Final settlement..."
                  maxLength="300" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📷 Receipt Photo</label>
                {collectImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {collectImage.name}</span>
                    <button onClick={function () { setCollectImage(null) }} className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 text-center text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                    Tap to attach photo
                    <input type="file" accept="image/*" capture="environment" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={function () { setCollectModal(false) }}
                  className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
                <button onClick={submitCollection}
                  disabled={collectSaving || !collectEventId || !collectAmount || Number(collectAmount) <= 0}
                  className="flex-1 py-3 text-sm text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors font-semibold">
                  {collectSaving ? 'Saving...' : 'Collect ' + (collectAmount && Number(collectAmount) > 0 ? Number(collectAmount).toLocaleString('en-IN') + ' pts' : '')}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}
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
        )}
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
        )}
        {enlargedWalletImg && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={function () { setEnlargedWalletImg(null) }}>
            <img src={enlargedWalletImg} alt="" className="max-w-full max-h-[80vh] rounded-lg" />
          </div>
        )}
      </div>
    )
  }

  return null
}

export default WalletManager
