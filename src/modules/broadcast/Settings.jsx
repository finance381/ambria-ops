import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function Settings() {
  var [settings, setSettings] = useState(null)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [notice, setNotice] = useState('')
  var [account, setAccount] = useState(null)
  var [fetchingAccount, setFetchingAccount] = useState(false)

  function load() {
    supabase.from('wa_settings').select('*').eq('id', 1).maybeSingle().then(function (res) { setSettings(res.data) })
    supabase.from('wa_accounts').select('*').maybeSingle().then(function (res) { setAccount(res.data) })
  }

  useEffect(function () { load() }, [])

  async function save() {
    if (saving || !settings) return
    setSaving(true); setError(''); setNotice('')
    var res = await supabase.from('wa_settings').update({
      marketing_freq_cap_per_week: settings.marketing_freq_cap_per_week,
      send_window_start: settings.send_window_start,
      send_window_end: settings.send_window_end,
      confirmation_threshold_recipients: settings.confirmation_threshold_recipients,
      session_length_hours: settings.session_length_hours,
    }).eq('id', 1)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setNotice('Saved.')
  }

  async function refreshAccount() {
    if (fetchingAccount) return
    setFetchingAccount(true); setError('')
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var res = await supabase.functions.invoke('wa-account-info', { body: {}, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setFetchingAccount(false)
    if (res.error) { setError(res.error.message); return }
    setAccount((res.data || {}).account || null)
  }

  if (!settings) return <p className="text-sm text-gray-400 py-8 text-center">Loading...</p>

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-lg font-bold text-gray-900">API Marketing Settings</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-gray-400 uppercase">WABA Info</p>
          <button onClick={refreshAccount} disabled={fetchingAccount} className="text-[11px] font-bold text-indigo-600 disabled:opacity-50">
            {fetchingAccount ? 'Fetching...' : 'Refresh from Meta'}
          </button>
        </div>
        {account ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><p className="text-[10px] text-gray-400">Phone</p><p className="text-gray-900">{account.display_phone}</p></div>
            <div><p className="text-[10px] text-gray-400">Tier</p><p className="text-gray-900">{account.tier || '—'}</p></div>
            <div><p className="text-[10px] text-gray-400">Quality</p><p className="text-gray-900 capitalize">{account.quality_rating || '—'}</p></div>
            <div><p className="text-[10px] text-gray-400">Quota used today</p><p className="text-gray-900">{account.quota_used_today}</p></div>
          </div>
        ) : <p className="text-xs text-gray-400">Not fetched yet.</p>}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Marketing frequency cap (per week per contact)</label>
          <input type="number" value={settings.marketing_freq_cap_per_week}
            onChange={function (ev) { setSettings(Object.assign({}, settings, { marketing_freq_cap_per_week: Number(ev.target.value) })) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Send window start</label>
            <input type="time" value={settings.send_window_start}
              onChange={function (ev) { setSettings(Object.assign({}, settings, { send_window_start: ev.target.value })) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Send window end</label>
            <input type="time" value={settings.send_window_end}
              onChange={function (ev) { setSettings(Object.assign({}, settings, { send_window_end: ev.target.value })) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Confirmation threshold (recipients)</label>
          <input type="number" value={settings.confirmation_threshold_recipients}
            onChange={function (ev) { setSettings(Object.assign({}, settings, { confirmation_threshold_recipients: Number(ev.target.value) })) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Session length (hours)</label>
          <input type="number" value={settings.session_length_hours}
            onChange={function (ev) { setSettings(Object.assign({}, settings, { session_length_hours: Number(ev.target.value) })) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <button onClick={save} disabled={saving} className="px-3 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Save Settings</button>
      </div>
    </div>
  )
}

export default Settings
