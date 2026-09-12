import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import ExpenseFormMulti from './ExpenseForm'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import ExpenseTypeMaster from './ExpenseTypeMaster'
import FilterDropdown from '../../components/ui/FilterDropdown'
import AllExpenses from './AllExpenses'
import ExpenseDetail from './ExpenseDetail'
import GVForm from './GVForm'
import { useRealtime } from '../../lib/useRealtime'
import { pushBack, goBack as navBack } from '../../lib/backNav'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import Icon from '../../components/ui/Icon'
import { T, CARD, FIELD_SEARCH, ON, OFF, BTN, STATUS_RAIL } from '../../lib/ui'
import { deptInk } from '../../lib/ui'



var PAGE_SIZE = 20

// One backdrop for every view of this section — Mine, Review, All and the form
// all render it, so they read as one screen you tab between rather than four.
//
// Imported rather than referenced from public/: vite.config.js sets
// base: "/ambria-ops/", so a hand-written "/pc-bg.png" would 404 in production.
// The import also gets it a content hash, so a new backdrop is never served
// from a stale cache.
//
function Expenses({ profile, masterMode, inAdmin }) {
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
  var [editExp, setEditExp] = useState(null)
  // null = not known yet / no wallet row / read failed. 0 means a real zero.
  var [walletBalance, setWalletBalance] = useState(null)
  var [detailRefresh, setDetailRefresh] = useState(0)
  var [subDeptMap, setSubDeptMap] = useState({})

  // Filter panel state
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [moreOpen, setMoreOpen] = useState(false)
  var [deptFilter, setDeptFilter] = useState('')
  var [subDeptFilter, setSubDeptFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [amountMin, setAmountMin] = useState('')
  var [amountMax, setAmountMax] = useState('')

  // Filter lookups
  var [deptOptions, setDeptOptions] = useState([])
  var [subDeptOptions, setSubDeptOptions] = useState([])
  var venueOptions = useReferenceData().venues.filter(function (v) { return v.active }).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })
  var [userOptions, setUserOptions] = useState([])
  var [profileMap, setProfileMap] = useState({})

  var isAdmin = profile?.role === 'admin' || hasPerm(profile?.permsNew, 'finance.expenses.approve')
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = hasPerm(profile?.permsNew, 'review.dept.approve')
  var hasExpenseApprove = hasPerm(profile?.permsNew, 'finance.expenses.approve')
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
    ]).then(function (res) {
      var sds = res[0].data || []
      var map = {}
      sds.forEach(function (sd) { map[sd.id] = sd.name })
      setSubDeptMap(map)
      setSubDeptOptions(sds)
      setDeptOptions(res[1].data || [])
    })
    supabase.from('profiles').select('id, name').order('name').then(function (res) {
      var rows = res.data || []
      if (showApproveTab) setUserOptions(rows)
      var m = {}
      rows.forEach(function (p) { m[p.id] = p.name || '' })
      setProfileMap(m)
    })
  }, [])

   useEffect(function () {
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        // `|| 0` alone collapsed three different situations into "0 pts": a real
        // zero balance, no wallet row for this user, and a failed query. Log the
        // last two so a blocked read is not mistaken for an empty wallet.
        if (res.error) { console.error('WALLET_FETCH_FAIL', res.error); setWalletBalance(null); return }
        if (!res.data) { console.warn('WALLET_MISSING for user', profile.id); setWalletBalance(null); return }
        setWalletBalance(res.data.balance_paise || 0)
      })
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
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, payment_cash_paise, payment_credit_paise, payment_credit_cash_paise, payment_credit_bank_paise, cash_due_date, bank_due_date, expense_types(name), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed)
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
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, payment_cash_paise, payment_credit_paise, payment_credit_cash_paise, payment_credit_bank_paise, cash_due_date, bank_due_date, expense_types(name), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed2)
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

  async function handleFormDone() {
    var wasEditing = editExp
    setEditExp(null)
    setView('saving')

    // Wait for the reload before switching the view, so the list/detail we navigate
    // to already has the just-submitted/edited expense in it — otherwise the view
    // swaps in with the still-stale data and visibly repopulates a moment later once
    // these resolve.
    var walletP = supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        // `|| 0` alone collapsed three different situations into "0 pts": a real
        // zero balance, no wallet row for this user, and a failed query. Log the
        // last two so a blocked read is not mistaken for an empty wallet.
        if (res.error) { console.error('WALLET_FETCH_FAIL', res.error); setWalletBalance(null); return }
        if (!res.data) { console.warn('WALLET_MISSING for user', profile.id); setWalletBalance(null); return }
        setWalletBalance(res.data.balance_paise || 0)
      })

    if (wasEditing && wasEditing.id) {
      var editedP = supabase.from('expenses')
        .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, payment_cash_paise, payment_credit_paise, payment_credit_cash_paise, payment_credit_bank_paise, cash_due_date, bank_due_date, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)')
        .eq('id', wasEditing.id)
        .maybeSingle()
      var results = await Promise.all([loadMyExpenses(false), loadApprovalExpenses(false), walletP, editedP])
      var editedRes = results[3]
      if (editedRes.data) {
        var refreshed = Object.assign({}, editedRes.data, { _fromApprove: wasEditing._fromApprove, _fromAll: wasEditing._fromAll })
        setDetailExp(refreshed)
        setView('detail')
      } else {
        var next = wasEditing._fromApprove ? 'approve' : wasEditing._fromAll ? 'all' : 'list'
        setView(next)
      }
    } else {
      await Promise.all([loadMyExpenses(false), loadApprovalExpenses(false), walletP])
      setView('list')
    }
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

  if (loading) {
    return <p className="text-slate-500 text-[13px] font-medium text-center py-10">Loading…</p>
  }

  // ═══════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════
  if (view === 'form') {
    return (
      // The soft ground bleeds to the viewport edges the way the submit bar
      // does — negative margins out, padding back in — so the form sits on a
      // tinted field instead of the flat page grey. Two very low-opacity
      // radials, no image: nothing to download and nothing to go stale.
      // isolate, so the decor can sit on -z-10 without falling behind the page
      // itself. No overflow-hidden here: the submit bar inside is sticky, and
      // overflow on an ancestor would pin it to a box that scrolls away.
      <div className={"relative isolate space-y-3" + (inAdmin ? "" : " -mx-4 px-4 -mt-4 pt-4 -mb-8 pb-8 min-h-[calc(100dvh-3.5rem)]")}>
        {/* Which mode you are in, and the way out. It was a 10px caps line and
            a text link — the smallest type on the page carrying the only exit. */}
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 sm:py-3 rounded-2xl bg-white/70 border border-indigo-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 text-white inline-flex items-center justify-center shadow-[0_2px_6px_rgba(79,70,229,0.30)]">
              <Icon name="fileText" size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-slate-900 leading-snug">
                {editExp ? 'Edit expense' : 'New expense'}
              </span>
              <span className="block text-[11px] text-slate-500 leading-snug truncate">
                Track your PC &amp; Direct expenses easily
              </span>
            </span>
          </div>
          <button
            onClick={function () { var next = editExp && editExp._fromApprove ? 'approve' : editExp && editExp._fromAll ? 'all' : 'list'; setView(next); setEditExp(null) }}
            className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
        </div>
        <ExpenseFormMulti profile={profile} walletBalance={walletBalance} editExp={editExp} onDone={handleFormDone} />
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // SAVING → shown the instant the form's own submit work finishes, while
  // handleFormDone reloads the list/detail data it's about to hand off to —
  // a placeholder shaped like where we're headed, instead of the old form
  // (already reset to a blank success state) sitting frozen for that gap.
  // ═══════════════════════════════════════════════
  if (view === 'saving') {
    var skelCard = inAdmin ? CARD : "ambria-glass-card rounded-2xl"
    return (
      <div className={"space-y-3" + (inAdmin ? "" : " -mx-4 px-4 -mt-4 pt-4 -mb-8 pb-8 min-h-[calc(100dvh-3.5rem)]")}>
        {[0, 1, 2, 3].map(function (i) {
          return (
            <div key={i} className={skelCard + " p-4 animate-pulse"} style={{ animationDelay: (i * 80) + 'ms' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-24 bg-slate-200/70 rounded-full" />
                <div className="h-3 w-14 bg-slate-200/70 rounded-full" />
              </div>
              <div className="mt-3 h-3.5 w-2/3 bg-slate-200/70 rounded-full" />
              <div className="mt-2 h-3 w-1/3 bg-slate-200/50 rounded-full" />
            </div>
          )
        })}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && detailExp) {
    return (
      <ExpenseDetail
        key={detailExp.id + ':' + detailRefresh}
        exp={detailExp}
        profile={profile}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onUpdated={function () { loadMyExpenses(false); loadApprovalExpenses(false); setView(detailExp._fromApprove ? 'approve' : detailExp._fromAll ? 'all' : 'list'); setDetailExp(null) }}
        onEdit={function () { setEditExp(detailExp); setView('form') }}
        onRaiseGV={function () { setView('gv') }}
      />
    )
  }

  if (view === 'gv' && detailExp) {
    return (
      <GVForm
        exp={detailExp}
        profile={profile}
        onCancel={function () { setView('detail') }}
        onSaved={function () {
          setDetailRefresh(function (n) { return n + 1 })
          setView('detail')
          loadMyExpenses(false)
          loadApprovalExpenses(false)
        }}
      />
    )
  }


  // The phone shell draws artwork behind this screen, so its surfaces are
  // frosted rather than solid white — seven opaque rectangles would blank out
  // the thing they are sitting on. Admin keeps solid cards: the ground there
  // is different and a table of amounts should not be read through glass.
  var glass = !inAdmin

  // Whether anything is narrowing the list. An empty list means two very
  // different things — nothing logged yet, or nothing matching — and offering
  // "log your first one" to someone whose filters simply exclude everything
  // is the wrong instruction.
  var hasAnyFilter = !!(expSearch || statusFilter || dateFrom || dateTo || deptFilter ||
    subDeptFilter || venueFilter || userFilter || amountMin || amountMax)

  // ═══════════════════════════════════════════════
  // LIST / APPROVE VIEW
  // ═══════════════════════════════════════════════
  return (
    /* pb-24 clears the floating "New" button that now sits over the list.
       Same tinted ground and foliage as the form: Mine, Review, All and the
       form are one screen you tab between, so a green form on a grey list read
       as two different apps. -mx-4/px-4 bleeds the tint to the viewport edges;
       isolate lets the decor sit on -z-10 without falling behind the page, and
       there is deliberately no overflow-hidden — the stat strip and any sticky
       child would be pinned to a box that scrolls away. */
    <div className={"relative isolate space-y-3 pb-24" + (inAdmin ? "" : " -mx-4 px-4 -mt-4 pt-4 -mb-8 min-h-[calc(100dvh-3.5rem)]")}>

      {/* Tabs */}
      {showApproveTab && (function () {
        var tabs = [{ v: 'list', label: 'Mine' }, { v: 'approve', label: 'Review', badge: approvalExpenses.length }]
        if (isAdmin || isAuditor || isDeptApprover) tabs.push({ v: 'all', label: (isAdmin || isAuditor) ? 'All' : 'Dept' })
        var activeIdx = tabs.findIndex(function (t) { return t.v === view })
        if (activeIdx < 0) activeIdx = 0
        return (
          <div className={"relative flex h-10 rounded-xl p-1 " + (glass ? "ambria-glass-card" : "bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.05)]")}>
            {/* The tabs sit flush inside a p-1 tray with no gaps, so the pill is
                exactly one nth of the inner width and moves a whole pill per
                step. */}
            <span
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 rounded-lg bg-indigo-50 border border-indigo-200 transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{
                width: 'calc((100% - 0.5rem) / ' + tabs.length + ')',
                transform: 'translateX(' + (activeIdx * 100) + '%)',
              }}
            />
            {tabs.map(function (t) {
              var on = view === t.v
              return (
                <button
                  key={t.v}
                  onClick={function () { setView(t.v); setStatusFilter('') }}
                  aria-pressed={on}
                  className={"relative flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transform-gpu transition-all duration-150 " +
                    (on ? "text-indigo-800" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:scale-[1.03]")}
                >
                  {t.label}
                  {t.badge > 0 && (
                    <span className={"min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold leading-[17px] transition-colors " +
                      (on ? "bg-red-500 text-white" : "bg-red-100 text-red-600")}>
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* Stat strip — what the deleted page heading used to say, on one line */}
      {(view === 'list' || view === 'approve') && (
        /* px-0.5 so the line does not start flush against the card edges
           below it, and no negative margin: -mb-0.5 was pulling it into the
           search row, which read as the two touching.

           A plain block comment rather than a braced JSX one: inside
           cond && ( ... ) only a single expression is allowed, and a braced
           comment counts as a second one. */
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className={T.meta + " min-w-0 truncate"}>
            {view === 'approve' ? (
              approvalExpenses.length === 0 ? 'Nothing pending review' : (
                <>
                  <span data-notranslate className="tabular-nums">{approvalExpenses.length}</span>
                  {' pending review'}
                </>
              )
            ) : monthCount === 0 ? 'No expenses this month' : (
              <>
                <span data-notranslate className="tabular-nums">{monthCount}</span>
                {' this month'}
                {monthTotal > 0 && (
                  <>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="font-bold text-indigo-700 tabular-nums">{formatPoints(monthTotal)}</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {/* All Expenses body — admin/auditor sees everything; dept approver sees only their scoped depts */}
      {view === 'all' && (isAdmin || isAuditor || isDeptApprover) && (
        <AllExpenses
          embedded
          glass={glass}
          scopeDeptIds={(isAdmin || isAuditor) ? null : (profile?.event_dept_ids || [])}
          onOpenDetail={function (exp) { openDetail(Object.assign({}, exp, { _fromAll: true })) }}
        />
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
            {/* Range, search, filters and the overflow menu share one 40px row
                instead of stacking. It wraps rather than squeezing: five
                controls do not fit a phone, and a squashed search box is worse
                than a second line. */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[180px] order-3 sm:order-2">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={expSearch}
                  onChange={function (e) { setExpSearch(e.target.value) }}
                  placeholder="Search expenses"
                  className={FIELD_SEARCH + (glass ? " ambria-glass-chip !border-white/60" : "")}
                  style={{ fontSize: '16px' }}
                />
              </div>
              <button
                onClick={function () { setFiltersOpen(!filtersOpen) }}
                aria-label="Filters"
                aria-expanded={filtersOpen}
                className={"h-10 px-3 shrink-0 order-2 sm:order-3 inline-flex items-center gap-1.5 rounded-xl border text-[12.5px] font-semibold transition-colors " +
                  (filtersOpen || count > 0 ? ON : OFF)}
              >
                <Icon name="filter" className="w-4 h-4" />
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </button>
              {count > 0 && (
                <button
                  onClick={resetFilters}
                  aria-label="Clear filters"
                  className="h-10 w-10 shrink-0 order-2 sm:order-4 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-red-600 transition-colors"
                >
                  <Icon name="close" className="w-4 h-4" />
                </button>
              )}
              {/* Rendered only when it has something in it. An overflow menu
                  that opens on one greyed-out row is worse than no menu. */}
              {view === 'list' && myExpenses.length > 0 && (
                <div className="relative shrink-0 order-2 sm:order-5">
                  <button
                    onClick={function () { setMoreOpen(!moreOpen) }}
                    aria-label="More actions"
                    aria-expanded={moreOpen}
                    className={"h-10 w-10 inline-flex items-center justify-center rounded-xl border transition-colors " + (moreOpen ? ON : OFF)}
                  >
                    <Icon name="more" className="w-4 h-4" />
                  </button>
                  {moreOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={function () { setMoreOpen(false) }} />
                      <div className="absolute right-0 top-full mt-1 z-30 w-52 py-1 bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] overflow-hidden">
                        <button
                          onClick={function () { exportExpenseCSV(); setMoreOpen(false) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                        >
                          <span className="shrink-0 text-slate-400"><Icon name="download" className="w-4 h-4" /></span>
                          <span className="text-[12.5px] font-semibold text-slate-800">Export as CSV</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {filtersOpen && (
              <div className={CARD + " p-3 space-y-3"}>
                {view === 'list' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Status</label>
                    <div className="flex gap-2 flex-wrap">
                      {['', 'recorded', 'acknowledged', 'flagged', 'deducted'].map(function (s) {
                        var label = s ? APPROVAL_STATUS_LABELS[s] : 'All'
                        return (
                          <button key={s} onClick={function () { setStatusFilter(s === statusFilter ? '' : s) }}
                            className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                              (statusFilter === s ? ON : OFF)}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {view === 'approve' && userOptions.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">User</label>
                    <FilterDropdown value={userFilter} placeholder="All users"
                      options={userOptions.map(function (u) { return { label: u.name || '—', value: String(u.id) } })}
                      onChange={setUserFilter} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Department</label>
                    <FilterDropdown value={deptFilter} placeholder="All departments"
                      options={deptOptions.map(function (d) { return { label: d.name, value: String(d.id) } })}
                      onChange={function (v) { setDeptFilter(v); setSubDeptFilter('') }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Sub-Dept</label>
                    <FilterDropdown value={subDeptFilter} placeholder="All sub-depts"
                      options={subDeptFiltered.map(function (sd) { return { label: sd.name, value: String(sd.id) } })}
                      onChange={setSubDeptFilter} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Venue</label>
                    <FilterDropdown value={venueFilter} placeholder="All venues"
                      options={venueOptions.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })}
                      onChange={setVenueFilter} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Min (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMin}
                      onChange={function (e) { setAmountMin(e.target.value) }}
                      placeholder="0"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">Max (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMax}
                      onChange={function (e) { setAmountMax(e.target.value) }}
                      placeholder="∞"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">From</label>
                    <input type="date" value={dateFrom}
                      onChange={function (e) { setDateFrom(e.target.value) }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1">To</label>
                    <input type="date" value={dateTo}
                      onChange={function (e) { setDateTo(e.target.value) }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
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
        <div className={(glass ? "ambria-glass-card rounded-2xl" : CARD) + " px-6 py-14 text-center"}>
          {/* Two rings behind the glyph rather than one flat circle: at this
              size a 44px disc in the middle of a large card reads as a
              missing image. */}
          <div className="relative w-24 h-24 mx-auto mb-4">
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-indigo-50" />
            <span aria-hidden="true" className="absolute inset-3 rounded-full bg-indigo-100/70" />
            <span className="absolute inset-0 flex items-center justify-center text-indigo-500">
              <Icon name={view === 'approve' ? 'checkCircle' : 'receipt'} className="w-9 h-9" strokeWidth={1.6} />
            </span>
          </div>
          <p className="font-display text-[17px] font-extrabold text-slate-900 tracking-[-0.015em]">{view === 'approve' ? 'Nothing to review' : (hasAnyFilter ? 'No matching expenses' : 'No expenses yet')}</p>
          <p className={T.meta + " mt-1 max-w-[300px] mx-auto leading-snug"}>
            {view === 'approve'
              ? 'Pending submissions from your departments will appear here.'
              : hasAnyFilter
                ? 'Nothing matches the current search and filters.'
                : 'Log your first one and it will show up here with its approval status.'}
          </p>
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
          return orderKeys.map(function (gk, gi) {
            var grp = groups[gk]
            var isCollapsed = collapsedGroups[gk]
            var isSingleton = grp.items.length === 1
            return (
              // Staggered rise. Capped at eight steps so a long page is not
              // an eight-second reveal, and index.css turns the whole thing
              // off under prefers-reduced-motion.
              // Same hover as the All list: a lift, a hair of scale, and a
              // warmer border. 1.006 is a few pixels on a card this wide —
              // more than that and the edges swing as the pointer runs down
              // the list.
              <div key={gk}
                className={(glass ? "ambria-glass-card rounded-2xl" : CARD) + " ambria-rise overflow-hidden transform-gpu transition-all duration-150 hover:shadow-lg hover:-translate-y-px hover:scale-[1.006] active:scale-100" + (glass ? "" : " hover:border-indigo-200")}
                style={{ animationDelay: (Math.min(gi, 8) * 25) + 'ms' }}>
                {/* A one-entry batch used to print this bar AND the row below
                    it, saying the same thing twice. Only real batches get it. */}
                {!isSingleton && (
                <button onClick={function () { setCollapsedGroups(function (p) { var n = Object.assign({}, p); n[gk] = !p[gk]; return n }) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors bg-slate-50/70 border-b border-slate-200 hover:bg-slate-100 active:bg-slate-200">
                  <Icon
                    name={isCollapsed ? 'chevronRight' : 'chevronDown'}
                    className="w-4 h-4 shrink-0 text-slate-400"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-snug truncate">
                      {view === 'approve' && grp.submitter ? grp.submitter + ' · ' : ''}
                      {grp.items.length + ' entries'}
                    </p>
                    <p className="text-[11px] font-medium text-slate-500 leading-snug">{grp.latest ? formatDate(grp.latest) : ''}</p>
                  </div>
                  <span className="shrink-0 text-[14px] font-bold text-slate-900 tabular-nums tracking-[-0.01em]">{formatPoints(grp.total)}</span>
                </button>
                )}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {grp.items.map(function (exp) {
                      return (
                        <div key={exp.id}
                          onClick={function () {
                            var e = Object.assign({}, exp, { _fromApprove: view === 'approve' })
                            openDetail(e)
                          }}
                          className="relative pl-3.5 pr-3 py-2.5 hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition-colors">
              {/* 3px rail: status is readable before a single word is, and it
                  costs no height */}
              <span className={"absolute left-0 top-0 bottom-0 w-[3px] " + (STATUS_RAIL[exp.status] || 'bg-slate-300')} />
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-900 leading-snug truncate">
                    {view === 'approve' && isSingleton && grp.submitter ? grp.submitter + ' · ' : ''}
                    {exp.expense_types?.name
                      ? exp.expense_types.name + (exp.expense_sub_types?.name ? ' › ' + exp.expense_sub_types.name : '')
                      : 'Expense'}
                  </p>
                  {exp.description && (
                    <p className="text-[12px] text-slate-600 leading-snug truncate">{exp.description}</p>
                  )}
                  {/* status chip rides the meta line rather than claiming a
                      second row in the amount column */}
                  <p className="mt-1 flex items-center gap-1.5 min-w-0">
                    <span className={"shrink-0 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-slate-100 text-slate-600')}>
                      {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate">
                      {view === 'approve' && !isSingleton && grp.submitter ? grp.submitter + ' · ' : ''}
                      {(function () {
                        var a = (exp.expense_allocations && exp.expense_allocations[0]) || null
                        var d = a ? (a.department || '') : ''
                        var sd = (a && a.sub_department_id) ? (subDeptMap[a.sub_department_id] || '') : ''
                        if (!d && !sd) return null
                        return (
                          <>
                            {d && <span className={deptInk(d)}>{d}</span>}
                            {sd ? ' › ' + sd : ''}
                            {' · '}
                          </>
                        )
                      })()}
                      {formatDate(exp.expense_date)}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-bold text-slate-900 tabular-nums tracking-[-0.01em]">
                  {formatPoints(exp.amount_paise)}
                </span>
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
                  {exp.penalized_by && (
                    <p className="text-[10px] text-red-400 mt-0.5">By {profileMap[exp.penalized_by] || '—'}{exp.penalized_at ? ' · ' + formatDate(exp.penalized_at) : ''}</p>
                  )}
                </div>
              )}
              {exp.status === 'flagged' && exp.flag_reason && (
                <div className="mt-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-amber-600 font-medium">⚠ Resubmit</p>
                  <p className="text-[11px] text-amber-500 mt-0.5 line-clamp-2">{exp.flag_reason}</p>
                  {exp.reviewed_by && (
                    <p className="text-[10px] text-amber-400 mt-0.5">By {profileMap[exp.reviewed_by] || '—'}{exp.reviewed_at ? ' · ' + formatDate(exp.reviewed_at) : ''}</p>
                  )}
                </div>
              )}
              {exp.status === 'acknowledged' && exp.acknowledged_by && (
                <div className="mt-1.5 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-green-700 font-medium">✓ Acknowledged</p>
                  <p className="text-[10px] text-green-600 mt-0.5">By {profileMap[exp.acknowledged_by] || '—'}{exp.acknowledged_at ? ' · ' + formatDate(exp.acknowledged_at) : ''}</p>
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
          className={BTN.quiet + " w-full py-3 text-[13px]"}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {/* New expense floats: it costs no vertical space and lands under the
          thumb.

          On the phone the 540px column IS the page, so its right edge is where
          the thumb sits. In the admin shell that column is centred in a wide
          window, which parked the button in the middle of the screen with
          content either side of it — so there the wrapper spans the content
          area and the button goes to its bottom-right corner instead. The
          sidebar is on the left, so nothing is covered. */}
      <div className="fixed inset-x-0 bottom-0 z-30 pointer-events-none">
        <div className={"flex justify-end " + (inAdmin ? "px-8 pb-6" : "max-w-[540px] mx-auto px-4 pb-5")}>
          <button
            onClick={function () { setEditExp(null); setView('form') }}
            aria-label="New expense"
            className="pointer-events-auto h-12 pl-4 pr-5 inline-flex items-center gap-1.5 rounded-full text-[14px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 shadow-[0_6px_20px_rgba(79,70,229,0.35)] transition-all"
          >
            <Icon name="plus" className="w-[18px] h-[18px]" strokeWidth={2.4} />
            New
          </button>
        </div>
      </div>
    </div>
  )
}

export default Expenses