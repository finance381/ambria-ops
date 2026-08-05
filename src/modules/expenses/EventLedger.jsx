import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate } from '../../lib/format'
import EventDatePicker from '../../components/ui/EventDatePicker'

var ENTRY_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'collection', label: 'Collections' },
  { key: 'lms_advance', label: 'LMS Advances' },
  { key: 'expense', label: 'Expenses' },
]

function EventLedger() {
  var [date, setDate] = useState('')
  var [functions, setFunctions] = useState([])
  var [functionsLoading, setFunctionsLoading] = useState(false)
  var [eventId, setEventId] = useState('')
  var [eventDetail, setEventDetail] = useState(null)
  var [balance, setBalance] = useState(null)
  var [balanceLoading, setBalanceLoading] = useState(false)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [filter, setFilter] = useState('all')

  async function loadFunctions(dateStr) {
    setDate(dateStr)
    setEventId('')
    setEventDetail(null)
    setBalance(null)
    setEntries([])
    if (!dateStr) { setFunctions([]); return }
    setFunctionsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, client_name, session, agreed_cash_paise, agreed_bank_paise')
      .eq('function_date', dateStr)
      .order('event_name')
    setFunctions(data || [])
    setFunctionsLoading(false)
    if (data && data.length === 1) selectFunction(String(data[0].id))
  }

  async function selectFunction(fid) {
    setEventId(fid)
    if (!fid) { setEventDetail(null); setBalance(null); setEntries([]); return }
    var detail = functions.find(function (f) { return String(f.id) === fid })
    setEventDetail(detail || null)
    loadBalance(fid)
    loadEntries(fid)
  }

  async function loadBalance(fid) {
    setBalanceLoading(true)
    var { data, error } = await supabase.rpc('fn_event_balance', { p_event_id: Number(fid) })
    if (!error && data && data.length > 0) setBalance(data[0])
    setBalanceLoading(false)
  }

  async function loadEntries(fid) {
    setEntriesLoading(true)
    var { data } = await supabase.from('event_ledger')
      .select('id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by, created_at')
      .eq('event_id', Number(fid))
      .order('created_at', { ascending: false })
    setEntries(data || [])
    setEntriesLoading(false)
  }

  function filteredEntries() {
    if (filter === 'all') return entries
    return entries.filter(function (e) { return e.entry_type === filter })
  }

  function badgeClass(entryType, direction) {
    if (direction === 'in') return 'bg-green-100 text-green-800'
    if (direction === 'out') return 'bg-red-100 text-red-800'
    return 'bg-gray-100 text-gray-700'
  }

  var pendCashP = balance ? Number(balance.pending_cash_paise || 0) : 0
  var pendBankP = balance ? Number(balance.pending_bank_paise || 0) : 0
  var agrCashP = balance ? Number(balance.agreed_cash_paise || 0) : 0
  var agrBankP = balance ? Number(balance.agreed_bank_paise || 0) : 0
  var colCashP = balance ? Number(balance.collected_cash_paise || 0) : 0
  var colBankP = balance ? Number(balance.collected_bank_paise || 0) : 0
  var spentP = balance ? Number(balance.spent_paise || 0) : 0

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Event Ledger</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <EventDatePicker label="Event Date" value={date} onChange={loadFunctions} />
        {date && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Function</label>
            {functionsLoading && <p className="text-xs text-gray-400">Loading...</p>}
            {!functionsLoading && functions.length === 0 && <p className="text-xs text-gray-400">No functions on this date</p>}
            {functions.length > 0 && (
              <select value={eventId} onChange={function (e) { selectFunction(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                style={{ fontSize: '16px' }}>
                <option value="">Select function...</option>
                {functions.map(function (f) { return <option key={f.id} value={String(f.id)}>{f.event_name + (f.client_name ? ' — ' + f.client_name : '') + ' · ' + (f.venue_name || '')}</option> })}
              </select>
            )}
          </div>
        )}
      </div>

      {eventDetail && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div><span className="text-gray-500">Event:</span> <span className="font-semibold">{eventDetail.event_name}</span></div>
            {eventDetail.client_name && <div><span className="text-gray-500">Client:</span> {eventDetail.client_name}</div>}
            {eventDetail.venue_name && <div><span className="text-gray-500">Venue:</span> {eventDetail.venue_name}</div>}
            {eventDetail.session && <div><span className="text-gray-500">Session:</span> {eventDetail.session}</div>}
          </div>
        </div>
      )}

      {eventId && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Agreed Cash</div>
            <div className="text-lg font-semibold">{balanceLoading ? '—' : formatPoints(agrCashP)}</div>
            <div className="text-xs text-gray-500 mt-1">Collected {formatPoints(colCashP)}</div>
            <div className={"text-xs font-semibold " + (pendCashP > 0 ? "text-red-600" : "text-green-600")}>
              Pending {formatPoints(pendCashP)}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Agreed Bank</div>
            <div className="text-lg font-semibold">{balanceLoading ? '—' : formatPoints(agrBankP)}</div>
            <div className="text-xs text-gray-500 mt-1">Collected {formatPoints(colBankP)}</div>
            <div className={"text-xs font-semibold " + (pendBankP > 0 ? "text-red-600" : "text-green-600")}>
              Pending {formatPoints(pendBankP)}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Collected</div>
            <div className="text-lg font-semibold text-green-700">{balanceLoading ? '—' : formatPoints(colCashP + colBankP)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Spent</div>
            <div className="text-lg font-semibold text-red-700">{balanceLoading ? '—' : formatPoints(spentP)}</div>
          </div>
        </div>
      )}

      {eventId && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ENTRY_TYPES.map(function (t) {
            var active = filter === t.key
            return (
              <button key={t.key} onClick={function () { setFilter(t.key) }}
                className={"px-3 py-1.5 rounded-full text-xs font-semibold transition-colors " +
                  (active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                {t.label}
              </button>
            )
          })}
        </div>
      )}

      {eventId && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {entriesLoading ? (
            <p className="text-xs text-gray-400 p-4">Loading entries...</p>
          ) : filteredEntries().length === 0 ? (
            <p className="text-sm text-gray-400 p-4 text-center">No entries</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Mode</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">In</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Out</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries().map(function (e) {
                    return (
                      <tr key={e.id} className="border-b border-gray-100 last:border-b-0">
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatDate(e.created_at)}</td>
                        <td className="px-3 py-2">
                          <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + badgeClass(e.entry_type, e.direction)}>
                            {e.entry_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{e.payment_mode || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-green-700">
                          {e.direction === 'in' ? formatPoints(e.amount_paise) : ''}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-red-700">
                          {e.direction === 'out' ? formatPoints(e.amount_paise) : ''}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{e.description || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default EventLedger