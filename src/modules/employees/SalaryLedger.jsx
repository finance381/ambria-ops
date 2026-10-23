import { useState, useEffect, useRef } from 'react'
import { pushBack } from '../../lib/backNav'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import PaySalaryModal from './PaySalaryModal'
import AccrueSalariesModal from './AccrueSalariesModal'
import AdjustSalaryModal from './AdjustSalaryModal'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import LedgerSourceMedia from '../../components/ledger/LedgerSourceMedia'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import Icon from '../../components/ui/Icon'
import ReverseDialog from '../../components/ui/ReverseDialog'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'

function SalaryLedger({ profile, inAdmin }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canSeeSalary = hasPerm(permsNew, 'hr.employees.salary_view')
  var canView = isAdmin || (hasPerm(permsNew, 'finance.ledgers.salary') && canSeeSalary)

  var [view, setView] = useState('list')  // 'list' | 'detail'
  var [employees, setEmployees] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('all')  // 'all' | 'with_balance' | 'stale'
  var [deptFilter, setDeptFilter] = useState('')  // job_department id or ''
  var [jdMap, setJdMap] = useState({})
  var [jdOptions, setJdOptions] = useState([])

  var [selectedEmp, setSelectedEmp] = useState(null)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [showDeleted, setShowDeleted] = useState(false)
  var [entryFrom, setEntryFrom] = useState('')
  var [entryTo, setEntryTo] = useState('')
  var [pdfBusy, setPdfBusy] = useState(false)
  // Opening an employee fully replaces the list's own returned JSX with a
  // separate tree, so the list unmounts rather than just being covered —
  // coming back always landed at the top of the list, regardless of where
  // the person had scrolled to find that row. Captured once on the way out
  // of 'list' below, consumed once on the way back.
  var scrollMemory = useRef(null)
  useEffect(function () {
    if (view === 'list' && scrollMemory.current != null) {
      var y = scrollMemory.current
      scrollMemory.current = null
      requestAnimationFrame(function () { window.scrollTo(0, y) })
    }
  }, [view])
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () {
    if (selectedEmp) loadEntries(selectedEmp, showDeleted)
  })

  var [showPayModal, setShowPayModal] = useState(false)
  var [showAccrueModal, setShowAccrueModal] = useState(false)  // SL-C4
  var [showAdjustModal, setShowAdjustModal] = useState(false)  // SL-C5
  var refData = useReferenceData()

  // Company-wide payroll register for a date range — independent of a
  // single employee's own ledger (that one's further down, inside the
  // detail view). Lives on the list screen since that's what "this ledger
  // page" meant.
  var [regFrom, setRegFrom] = useState('')
  var [regTo, setRegTo] = useState('')
  var [regPdfBusy, setRegPdfBusy] = useState(false)

  async function exportSalaryRegisterPDF() {
    if (regPdfBusy) return
    if (!regFrom || !regTo) { alert('Pick a From and To date for the register'); return }
    setRegPdfBusy(true)
    try {
      var { data, error } = await supabase.from('ledger_entries')
        .select('party_uuid, entry_date, description, credit_paise, debit_paise, ref_type, metadata')
        .eq('ledger_type', 'user_salary')
        .is('deleted_at', null)
        .gte('entry_date', regFrom)
        .lte('entry_date', regTo)
        .order('entry_date', { ascending: true })
      if (error) { alert('Failed to load entries: ' + error.message); return }
      var rows = data || []
      if (rows.length === 0) { alert('No salary entries in that date range'); return }

      var empNameById = {}, empCodeById = {}
      ;(refData.employees || []).forEach(function (e) {
        empNameById[e.id] = e.full_name || e.name || '—'
        empCodeById[e.id] = e.employee_code || ''
      })
      var groups = {}
      rows.forEach(function (r) {
        var key = r.party_uuid
        if (!groups[key]) groups[key] = []
        groups[key].push(r)
      })
      var empIds = Object.keys(groups).sort(function (a, b) {
        return (empNameById[a] || '').localeCompare(empNameById[b] || '')
      })

      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod
      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      var fontOk = await registerPdfFont(doc)
      var FONT = fontOk ? 'NotoSans' : 'helvetica'
      var pageW = doc.internal.pageSize.getWidth()
      var pageH = doc.internal.pageSize.getHeight()
      var mm = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      function fmtD(iso) {
        if (!iso) return '—'
        var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
        return String(d.getDate()).padStart(2, '0') + '-' + mm[d.getMonth()] + '-' + d.getFullYear()
      }
      function fmtN(paise) {
        return ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }

      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('SALARY REGISTER', 10, 14)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), pageW - 10, 14, { align: 'right' })
      doc.setTextColor(0)
      doc.setFontSize(9)
      doc.setFont(FONT, 'bold'); doc.text('Period:', 10, 22)
      doc.setFont(FONT, 'normal'); doc.text(fmtD(regFrom) + '  to  ' + fmtD(regTo) + '     (' + empIds.length + ' employees, ' + rows.length + ' entries)', 28, 22)

      // One flat table — an employee-name header row, that employee's
      // entries, a subtotal row, repeated per employee, a grand total at the
      // end. Bold/shaded rows are tracked by index and painted in
      // didParseCell rather than built as separate tables, so page breaks
      // fall naturally in the middle of a long employee's entries instead of
      // forcing one table per person.
      var body = []
      var rowKind = {}
      var grandCr = 0, grandDb = 0
      empIds.forEach(function (eid) {
        var list = groups[eid].slice().sort(function (a, b) { return new Date(a.entry_date) - new Date(b.entry_date) })
        var name = empNameById[eid] || 'Unknown'
        var code = empCodeById[eid] || ''
        rowKind[body.length] = 'header'
        body.push([{ content: name + (code ? '  (' + code + ')' : ''), colSpan: 5 }])
        var subCr = 0, subDb = 0
        list.forEach(function (e) {
          var meta = e.metadata || {}
          var kind = meta.kind ? meta.kind : e.ref_type
          subCr += (e.credit_paise || 0); subDb += (e.debit_paise || 0)
          body.push([
            fmtD(e.entry_date),
            kind ? String(kind).toUpperCase().replace(/_/g, ' ') : '—',
            e.description || '—',
            e.debit_paise ? fmtN(e.debit_paise) : '',
            e.credit_paise ? fmtN(e.credit_paise) : '',
          ])
        })
        rowKind[body.length] = 'subtotal'
        body.push(['', '', 'Subtotal — ' + name, fmtN(subDb), fmtN(subCr)])
        grandCr += subCr; grandDb += subDb
      })
      rowKind[body.length] = 'grand'
      body.push(['', '', 'GRAND TOTAL', fmtN(grandDb), fmtN(grandCr)])

      autoTable(doc, {
        startY: 27,
        head: [['Date', 'Type', 'Description',
          { content: 'Debit', styles: { halign: 'right' } },
          { content: 'Credit', styles: { halign: 'right' } }]],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 26 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 24, halign: 'right', textColor: [180, 30, 30] },
          4: { cellWidth: 24, halign: 'right', textColor: [16, 128, 60] },
        },
        margin: { left: 10, right: 10 },
        didParseCell: function (data) {
          if (data.section !== 'body') return
          var kind = rowKind[data.row.index]
          if (kind === 'header') {
            data.cell.styles.fillColor = [235, 235, 245]
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = [30, 30, 60]
          } else if (kind === 'subtotal') {
            data.cell.styles.fillColor = [248, 248, 250]
            data.cell.styles.fontStyle = 'bold'
          } else if (kind === 'grand') {
            data.cell.styles.fillColor = [50, 50, 50]
            data.cell.styles.textColor = data.column.index >= 3 ? (data.column.index === 3 ? [255, 180, 180] : [180, 255, 200]) : 255
            data.cell.styles.fontStyle = 'bold'
          }
        },
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Salary register', 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      await openOrSharePdf(doc, 'salary_register_' + regFrom + '_to_' + regTo + '.pdf')
      try { await logActivity('SALARY_REGISTER_PDF_EXPORT', regFrom + ' to ' + regTo + ' | ' + empIds.length + ' employees, ' + rows.length + ' entries') } catch (_) {}
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setRegPdfBusy(false)
    }
  }

  useEffect(function () {
    if (canView) loadEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadEmployees() {
    setLoading(true)
    var res = await Promise.all([
      supabase.from('v_employee_ledger').select('*').order('balance_paise', { ascending: false }),
      supabase.from('job_departments').select('id, name').order('sort_order').order('name')
    ])
    var ledger = (res[0].data) || []
    var emps = refData.employees
    var jds = (res[1].data) || []
    var empMap = {}
    emps.forEach(function (e) { empMap[e.id] = e })
    var jdM = {}
    jds.forEach(function (j) { jdM[j.id] = j.name })
    setJdMap(jdM)
    setJdOptions(jds)
    var merged = ledger.map(function (r) {
      var e = empMap[r.employee_id]
      return Object.assign({}, r, {
        designation: e ? (e.designation || '') : '',
        job_department_ids: e ? (e.job_department_ids || []) : []
      })
    })
    setEmployees(merged)
    setLoading(false)
  }

  async function loadEntries(emp, withDeleted) {
    setEntriesLoading(true)
    setEntries([])
    var q = supabase.from('ledger_entries')
      .select('*')
      .eq('ledger_type', 'user_salary')
      .eq('party_uuid', emp.employee_id)
      .order('entry_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000)
    if (!withDeleted) q = q.is('deleted_at', null)
    var { data, error } = await q
    if (error) { setEntries([]); setEntriesLoading(false); return }

    var rows = data || []

    // Batch-fetch source expense receipts for expense-type rows (bill/voice note on source expense)
    var expIds = []
    rows.forEach(function (r) {
      if (r.ref_type === 'expense' && r.ref_id && /^[0-9]+$/.test(String(r.ref_id))) {
        var id = Number(r.ref_id)
        if (expIds.indexOf(id) === -1) expIds.push(id)
      }
    })

    var receiptsByExpId = {}
    if (expIds.length > 0) {
      var { data: exps } = await supabase.from('expenses')
        .select('id, receipt_paths, receipt_path')
        .in('id', expIds)
      ;(exps || []).forEach(function (ex) {
        var paths = Array.isArray(ex.receipt_paths) && ex.receipt_paths.length > 0
          ? ex.receipt_paths
          : (ex.receipt_path ? [ex.receipt_path] : [])
        if (paths.length > 0) receiptsByExpId[ex.id] = paths
      })
    }

    var merged = rows.map(function (r) {
      if (r.ref_type === 'expense' && r.ref_id) {
        var id = Number(r.ref_id)
        if (receiptsByExpId[id]) return Object.assign({}, r, { _sourceReceipts: receiptsByExpId[id] })
      }
      return r
    })

    setEntries(merged)
    setEntriesLoading(false)
  }

  // On a phone, opening an employee is a step on the app's back stack: the
  // header's arrow and a swipe return to the list, and the page needs no Back
  // of its own. The admin console has no arrow and keeps the button.
  async function openEmployee(emp) {
    scrollMemory.current = window.scrollY
    if (!inAdmin) pushBack(function () { backToList() })
    setSelectedEmp(emp)
    setView('detail')
    setShowDeleted(false)
    setEntryFrom('')
    setEntryTo('')
    await loadEntries(emp, false)
    try { logActivity('SALARY_LEDGER_VIEW', emp.employee_name + ' (' + emp.employee_code + ')') } catch (_) {}
  }

  function toggleShowDeleted(next) {
    setShowDeleted(next)
    if (selectedEmp) loadEntries(selectedEmp, next)
  }

  function backToList() {
    setView('list')
    setSelectedEmp(null)
    setEntries([])
    loadEmployees()
  }

  function openPay() {
    if (!selectedEmp) return
    setShowPayModal(true)
  }

  function onPaymentSuccess() {
    setShowPayModal(false)
    if (selectedEmp) loadEntries(selectedEmp, showDeleted)
    loadEmployees()
  }

  function onAccrueSuccess() {
    setShowAccrueModal(false)
    loadEmployees()
  }

  function onAdjustSuccess() {
    setShowAdjustModal(false)
    if (selectedEmp) loadEntries(selectedEmp, showDeleted)
    loadEmployees()
  }

  var [reverseTarget, setReverseTarget] = useState(null)
  var [reversingEntry, setReversingEntry] = useState(false)

  async function reverseEntry(reason) {
    var entryId = reverseTarget
    if (!entryId) return
    setReversingEntry(true)
    var { error } = await supabase.rpc('reverse_ledger_entry', {
      p_entry_id: entryId,
      p_reason: reason
    })
    setReversingEntry(false)
    if (error) { alert('Reversal failed: ' + error.message); return }
    setReverseTarget(null)
    try { logActivity('LEDGER_REVERSE', 'salary entry #' + entryId) } catch (_) {}
    if (selectedEmp) await loadEntries(selectedEmp, showDeleted)
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Salary Ledger.</p>
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    var q = search.trim().toLowerCase()
    var filtered = employees.filter(function (e) {
      if (q) {
        var hay = ((e.employee_name || '') + ' ' + (e.employee_code || '') + ' ' + (e.designation || '')).toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      if (statusFilter === 'with_balance' && (e.balance_paise || 0) === 0) return false
      if (statusFilter === 'stale' && ((e.unpaid_since_days || 0) < 30)) return false
      if (deptFilter) {
        var ids = e.job_department_ids || []
        if (ids.indexOf(Number(deptFilter)) === -1) return false
      }
      return true
    })

    var totalOutstanding = employees.reduce(function (s, e) { return s + (e.balance_paise || 0) }, 0)
    var totalCash = employees.reduce(function (s, e) { return s + (e.cash_balance_paise || 0) }, 0)
    var totalBank = employees.reduce(function (s, e) { return s + (e.bank_balance_paise || 0) }, 0)
    var empsWithBalance = employees.filter(function (e) { return (e.balance_paise || 0) !== 0 }).length
    var staleEmps = employees.filter(function (e) { return (e.unpaid_since_days || 0) >= 30 })

    return (
      <div className="space-y-4">
        {/* Stale warning banner */}
        {staleEmps.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">⏳</span>
            <p className="text-sm text-amber-800 font-medium">
              {staleEmps.length} employee{staleEmps.length !== 1 ? 's' : ''} with salary unpaid ≥ 30 days
            </p>
          </div>
        )}

        {/* Summary + Accrue button */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Total Owed to Employees</p>
              <p className="text-2xl font-bold text-amber-800">{formatPoints(totalOutstanding)}</p>
              <div className="flex gap-3 mt-1.5 text-[11px] flex-wrap">
                <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(totalCash)}</span></span>
                <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(totalBank)}</span></span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] text-gray-500">With balance</p>
              <p className="text-lg font-bold text-gray-800">{empsWithBalance}</p>
            </div>
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 flex flex-wrap gap-2">
            <button onClick={function () { setShowAccrueModal(true) }}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              📅 Accrue Salaries
            </button>
          </div>
          {/* Payroll register — a dated PDF across every employee, not just
              whoever the search/department filters below happen to show. */}
          <div className="border-t border-gray-100 mt-3 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Payroll register (PDF)</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">From</label>
                <input type="date" value={regFrom} onChange={function (e) { setRegFrom(e.target.value) }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">To</label>
                <input type="date" value={regTo} onChange={function (e) { setRegTo(e.target.value) }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                  style={{ fontSize: '16px' }} />
              </div>
              <button onClick={exportSalaryRegisterPDF} disabled={regPdfBusy || !regFrom || !regTo}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {regPdfBusy ? 'Preparing…' : '⬇ Download PDF'}
              </button>
            </div>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search name / code / designation..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white"
            style={{ fontSize: '16px' }} />
          <select value={deptFilter} onChange={function (e) { setDeptFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }}>
            <option value="">All Departments</option>
            {jdOptions.map(function (j) {
              return <option key={j.id} value={j.id}>{j.name}</option>
            })}
          </select>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 self-start">
            {[
              { key: 'all', label: 'All' },
              { key: 'with_balance', label: 'With Balance' },
              { key: 'stale', label: 'Stale ≥30d' }
            ].map(function (s) {
              return (
                <button key={s.key} onClick={function () { setStatusFilter(s.key) }}
                  className={"px-3 py-1.5 text-xs font-semibold rounded-md transition-colors " +
                    (statusFilter === s.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-12">Loading employees...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">
            {employees.length === 0 ? 'No employees found' : 'No employees match your filter'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(function (e) {
              var bal = e.balance_paise || 0
              var balColor = bal > 0 ? 'text-amber-800' : bal < 0 ? 'text-red-700' : 'text-gray-500'
              var balBg = bal > 0 ? 'bg-amber-50 border-amber-200' : bal < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
              var cashBal = e.cash_balance_paise || 0
              var bankBal = e.bank_balance_paise || 0
              var days = e.unpaid_since_days || 0
              var isStale = days >= 30
              var isTerminated = e.employee_status === 'terminated' || e.employee_status === 'resigned'
              return (
                <button key={e.employee_id} onClick={function () { openEmployee(e) }}
                  className={"text-left border rounded-xl p-3 hover:shadow-sm active:scale-[0.99] transition-all " + balBg + (isStale ? " ring-2 ring-amber-300" : "")}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 truncate">{e.employee_name || '—'}</p>
                      <p className="text-[10px] text-gray-500 truncate">{e.employee_code || '—'}{e.designation ? ' · ' + e.designation : ''}</p>
                      {(e.job_department_ids || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(e.job_department_ids || []).map(function (id) {
                            var name = jdMap[id]
                            if (!name) return null
                            return (
                              <span key={id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/70 text-gray-700 border border-gray-200">
                                {name}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {isStale && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">{days}d</span>
                      )}
                      {isTerminated && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">{e.employee_status}</span>
                      )}
                    </div>
                  </div>
                  <p className={"text-lg font-bold " + balColor}>{formatPoints(bal)}</p>
                  {(cashBal !== 0 || bankBal !== 0) && (
                    <div className="flex gap-2 mt-1 text-[10px] text-gray-600">
                      {cashBal !== 0 && <span>💵 {formatPoints(cashBal)}</span>}
                      {bankBal !== 0 && <span>🏦 {formatPoints(bankBal)}</span>}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-500 mt-1">
                    {(e.entry_count || 0) > 0
                      ? (e.entry_count + ' entries · last ' + (e.last_entry_date || '—'))
                      : 'No activity'}
                  </p>
                </button>
              )
            })}
          </div>
        )}

        {/* Accrue Salaries modal */}
        {showAccrueModal && (
          <AccrueSalariesModal
            onClose={function () { setShowAccrueModal(false) }}
            onSuccess={onAccrueSuccess} />
        )}
      </div>
    )
  }

  // ── DETAIL VIEW ──
  var emp = selectedEmp
  if (!emp) return null

  var running = 0
  var withRunning = entries.map(function (e) {
    if (!e.deleted_at) running += (e.credit_paise || 0) - (e.debit_paise || 0)
    return Object.assign({}, e, { runningBalance: e.deleted_at ? null : running })
  })
  var displayEntries = withRunning.slice().reverse()
  // Running balance is computed over every entry above, unfiltered — only
  // which rows actually show narrows with the date range, same as Vendor
  // Ledger's own from/to filter.
  var visibleEntries = displayEntries.filter(function (e) {
    if (entryFrom && (!e.entry_date || e.entry_date < entryFrom)) return false
    if (entryTo && (!e.entry_date || e.entry_date > entryTo)) return false
    return true
  })

  var currentBalance = running
  var balColor = currentBalance > 0 ? 'text-amber-800' : currentBalance < 0 ? 'text-red-700' : 'text-gray-500'

  // ── PDF EXPORT: bank-statement style salary ledger ──
  async function exportSalaryPDF() {
    if (pdfBusy || !emp || !entries || entries.length === 0) return
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

      // withRunning is already chronological ascending with a running balance
      // per non-deleted entry — the exact series the on-screen list is built
      // from. Printed rows are that same series narrowed to the chosen date
      // range; the opening balance is whatever the running total was just
      // before the first printed row, so a filtered statement still reads
      // correctly on its own.
      var printed = withRunning.filter(function (e) {
        if (e.deleted_at) return false
        if (entryFrom && (!e.entry_date || e.entry_date < entryFrom)) return false
        if (entryTo && (!e.entry_date || e.entry_date > entryTo)) return false
        return true
      })
      var firstIdx = printed.length > 0 ? withRunning.indexOf(printed[0]) : -1
      var opening = 0
      for (var bi = firstIdx - 1; bi >= 0; bi--) {
        if (withRunning[bi].runningBalance != null) { opening = withRunning[bi].runningBalance; break }
      }
      var totalCr = 0, totalDb = 0
      printed.forEach(function (e) { totalCr += (e.credit_paise || 0); totalDb += (e.debit_paise || 0) })
      var closing = printed.length > 0 ? printed[printed.length - 1].runningBalance : opening

      var mm = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      function fmtD(iso) {
        if (!iso) return '—'
        var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
        return String(d.getDate()).padStart(2, '0') + '-' + mm[d.getMonth()] + '-' + d.getFullYear()
      }
      function fmtN(paise) {
        return ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }
      function particularsLinesFor(e) {
        var meta = e.metadata || {}
        var kind = meta.kind ? meta.kind : e.ref_type
        var lines = [{ kind: 'header', text: kind ? String(kind).toUpperCase().replace(/_/g, ' ') : '—' }]
        lines.push({ kind: 'desc', text: e.description || '—' })
        var chipParts = []
        if (meta.mode) chipParts.push(meta.mode === 'cash' ? 'CASH' : 'BANK')
        if (meta.salary_month) chipParts.push(meta.salary_month)
        if (meta.reason) chipParts.push(meta.reason)
        if (chipParts.length > 0) lines.push({ kind: 'chip', text: chipParts.join('   ·   ') })
        return lines
      }

      var periodFrom = entryFrom || (printed[0] && printed[0].entry_date) || ''
      var periodTo = entryTo || (printed[printed.length - 1] && printed[printed.length - 1].entry_date) || ''

      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('SALARY STATEMENT', 10, 14)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), pageW - 10, 14, { align: 'right' })
      doc.setTextColor(0)

      doc.setFontSize(9)
      var y = 22
      doc.setFont(FONT, 'bold'); doc.text('Employee:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text((emp.employee_name || '—') + '   (' + (emp.employee_code || '—') + ')', 32, y)
      y += 5
      doc.setFont(FONT, 'bold'); doc.text('Period:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(fmtD(periodFrom) + '  to  ' + fmtD(periodTo) + '     (' + printed.length + ' entries)', 32, y)
      y += 7

      autoTable(doc, {
        startY: y,
        head: [['Opening Balance', 'Accrued (Credits)', 'Paid (Debits)', 'Closing Balance']],
        body: [[fmtN(opening), '+' + fmtN(totalCr), '-' + fmtN(totalDb), fmtN(closing)]],
        styles: { font: FONT, fontSize: 9, halign: 'right', cellPadding: 2 },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'right', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 47.5 },
          1: { cellWidth: 47.5, textColor: [140, 90, 20] },
          2: { cellWidth: 47.5, textColor: [16, 128, 60] },
          3: { cellWidth: 47.5, fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
      })

      var dateMeta = []
      var particularsMeta = []
      var body = printed.map(function (e) {
        var dm = { top: fmtD(e.entry_date), bottom: '' }
        dateMeta.push(dm)
        var pLines = particularsLinesFor(e)
        particularsMeta.push(pLines)
        var isCredit = (e.credit_paise || 0) > 0
        return [
          plainDateLines(dm, ''),
          plainParticularsLines(pLines).join('\n'),
          isCredit ? '' : fmtN(e.debit_paise || 0),
          isCredit ? fmtN(e.credit_paise || 0) : '',
          fmtN(e.runningBalance),
        ]
      })

      var statementHooks = makeStatementCellHooks(doc, FONT, {
        dateCol: 0, particularsCol: 1, dateMeta: dateMeta, particularsMeta: particularsMeta,
        topLabel: 'DATE', bottomLabel: '',
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
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
        didParseCell: statementHooks.didParseCell,
        willDrawCell: statementHooks.willDrawCell,
        didDrawCell: statementHooks.didDrawCell,
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Salary statement for ' + (emp.employee_name || ''), 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      var safeName = (emp.employee_name || 'employee').replace(/[^a-z0-9]+/gi, '_')
      await openOrSharePdf(doc, 'salary_' + safeName + '_' + new Date().toISOString().split('T')[0] + '.pdf')
      try { await logActivity('SALARY_PDF_EXPORT', (emp.employee_name || '') + ' | ' + printed.length + ' entries') } catch (_) {}
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {inAdmin && (
        <button onClick={backToList} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">
          ← Back to employees
        </button>
      )}

      {/* Employee header card */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900 truncate">{emp.employee_name || '—'}</h3>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{emp.employee_status}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{emp.employee_code} · #{emp.employee_id.slice(0, 8)}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Monthly: 💵 {formatPoints(emp.monthly_cash_paise || 0)} · 🏦 {formatPoints(emp.monthly_bank_paise || 0)}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={openPay} disabled={currentBalance <= 0}
              className={"px-3 py-2 text-xs font-bold rounded-lg transition-colors " +
                (currentBalance > 0 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
              💸 Pay Salary
            </button>
            <button onClick={function () { setShowAdjustModal(true) }}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50">
              ± Adjust
            </button>
            <button onClick={exportSalaryPDF} disabled={pdfBusy || entries.length === 0}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              {pdfBusy ? 'Preparing…' : '⬇ PDF'}
            </button>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Outstanding Balance</p>
          <p className={"text-3xl font-bold " + balColor}>{formatPoints(currentBalance)}</p>
          {((emp.cash_balance_paise || 0) !== 0 || (emp.bank_balance_paise || 0) !== 0) && (
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(emp.cash_balance_paise || 0)}</span></span>
              <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(emp.bank_balance_paise || 0)}</span></span>
            </div>
          )}
          {(emp.unpaid_since_days || 0) >= 30 && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 font-medium">
              ⏳ Unpaid for {emp.unpaid_since_days} days
            </div>
          )}
        </div>
      </div>

      {/* Date filter — narrows which entries show (and the PDF export below),
          the running balance keeps counting from the employee's true opening. */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">From</label>
          <input type="date" value={entryFrom} onChange={function (e) { setEntryFrom(e.target.value) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">To</label>
          <input type="date" value={entryTo} onChange={function (e) { setEntryTo(e.target.value) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>
        {(entryFrom || entryTo) && (
          <button onClick={function () { setEntryFrom(''); setEntryTo('') }}
            className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100">
            Clear dates
          </button>
        )}
      </div>

      {/* Admin toggle: show deleted */}
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showDeleted}
            onChange={function (e) { toggleShowDeleted(e.target.checked) }} />
          Show deleted entries (audit)
        </label>
      )}

      {/* Pay Salary modal (shared component) */}
      {showPayModal && emp && (
        <PaySalaryModal
          employee={emp}
          profile={profile}
          onClose={function () { setShowPayModal(false) }}
          onSuccess={onPaymentSuccess} />
      )}

      {/* Adjust Salary modal */}
      {showAdjustModal && emp && (
        <AdjustSalaryModal
          employee={emp}
          onClose={function () { setShowAdjustModal(false) }}
          onSuccess={onAdjustSuccess} />
      )}

      {/* Entries list */}
      {entriesLoading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading entries...</p>
      ) : visibleEntries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          {displayEntries.length === 0 ? 'No salary entries yet.' : 'No entries in that date range.'}
        </p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {visibleEntries.map(function (e, idx) {
            var isCredit = (e.credit_paise || 0) > 0
            var isDeleted = !!e.deleted_at
            var amt = isCredit ? (e.credit_paise || 0) : (e.debit_paise || 0)
            var kind = e.metadata && e.metadata.kind ? e.metadata.kind : e.ref_type
            var dotColor = isDeleted ? 'bg-gray-300' : isCredit ? 'bg-amber-500' : 'bg-green-500'
            var meta = e.metadata || {}
            var isExpRow = e.ref_type === 'expense' && e.ref_id && /^[0-9]+$/.test(String(e.ref_id)) && !isDeleted
            return (
              <div key={e.id}
                onClick={function () { if (isExpRow) openExpenseDetail(Number(e.ref_id)) }}
                className={"flex items-start gap-3 px-3 py-3 " +
                  (idx < visibleEntries.length - 1 ? "border-b border-gray-100 " : "") +
                  (isDeleted ? "opacity-50" : "") +
                  (isExpRow ? " cursor-pointer hover:bg-indigo-50/40 transition-colors" : "")}>
                <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + dotColor}></div>
                <div className="flex-1 min-w-0">
                  <p className={"text-sm font-medium text-gray-900 " + (isDeleted ? "line-through" : "")}>
                    {e.description || (isCredit ? 'Credit' : 'Debit')}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {formatDate(e.entry_date)} · {kind}
                    {meta.salary_month ? ' · ' + meta.salary_month : ''}
                    {isDeleted && ' · deleted'}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Logged {formatDateTime(e.created_at)}</p>
                  {(meta.mode || meta.reason) && (
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {meta.mode && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                          {meta.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      )}
                      {meta.reason && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-50 text-gray-700 border border-gray-200 rounded">
                          {meta.reason}
                        </span>
                      )}
                    </div>
                  )}
                  <div onClick={function (ev) { ev.stopPropagation() }}>
                    <PaymentProofThumbs meta={meta} />
                  </div>
                  {e._sourceReceipts && e._sourceReceipts.length > 0 && (
                    <div onClick={function (ev) { ev.stopPropagation() }}>
                      <LedgerSourceMedia paths={e._sourceReceipts} />
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={"text-sm font-bold " + (isCredit ? "text-amber-800" : "text-green-700")}>
                    {isCredit ? '+' : '−'}{formatPoints(amt)}
                  </p>
                  {!isDeleted && (
                    <p className="text-[10px] text-gray-400">Bal: {formatPoints(e.runningBalance)}</p>
                  )}
                  {isAdmin && !isDeleted && (
                    <button onClick={function (ev) { ev.stopPropagation(); setReverseTarget(e.id) }}
                      className="mt-1.5 h-[22px] inline-flex items-center gap-1 px-2 rounded-md border border-slate-200 bg-white text-[10px] font-bold uppercase tracking-[0.04em] text-slate-600 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 transition-colors">
                      <Icon name="reverse" size={10} />
                      Reverse
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ReverseDialog
        open={!!reverseTarget}
        busy={reversingEntry}
        onClose={function () { setReverseTarget(null) }}
        onConfirm={reverseEntry}
        reasonLabel="Reason for reversal"
      />
      {expenseDetailModal}
    </div>
  )
}

export default SalaryLedger