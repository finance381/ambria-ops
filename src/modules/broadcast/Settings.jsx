import { useState, useEffect } from 'react'
import { supabase, edgeFnErrorMessage } from '../../lib/supabase'
import Icon from '../../components/ui/Icon'
import { CTRL, BTN_GHOST, BTN_PRIMARY, CARD, Chip, Labeled, Notice, CHIP_GOOD, CHIP_WARN, CHIP_BAD, CHIP_NEUTRAL } from './ui'

// The five fields this page owns. Kept as a list so the dirty check and the
// update payload cannot drift apart — a field added to one and forgotten in
// the other is a setting that silently never saves.
var EDITABLE = [
  'marketing_freq_cap_per_week',
  'send_window_start',
  'send_window_end',
  'confirmation_threshold_recipients',
  'session_length_hours',
]

// Meta's own three ratings. Anything else (or nothing) stays neutral rather
// than being guessed at.
var QUALITY_TONE = { green: CHIP_GOOD, yellow: CHIP_WARN, red: CHIP_BAD }

// A searchable checkbox list of profiles + its own Save/Discard, writing to
// a dedicated subscribers table via `rpcName`. Used for both "who gets
// pushed on a WhatsApp message" and "who gets pushed on a new LMS contract"
// — same shape, different table/RPC, so this is the one place that shape
// lives rather than two near-identical card bodies.
function SubscriberCard({ icon, title, description, allProfiles, ids, setIds, baseline, setBaseline, rpcName }) {
  var [search, setSearch] = useState('')
  var [saving, setSaving] = useState(false)
  var [notice, setNotice] = useState('')
  var [error, setError] = useState('')

  function toggle(id) {
    setNotice(''); setError('')
    setIds(function (prev) { return prev.indexOf(id) !== -1 ? prev.filter(function (x) { return x !== id }) : prev.concat([id]) })
  }

  async function save() {
    if (saving) return
    setSaving(true); setNotice(''); setError('')
    var res = await supabase.rpc(rpcName, { p_user_ids: ids })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setBaseline(ids)
    setNotice('Saved.')
  }

  var dirty = ids.length !== baseline.length || ids.some(function (id) { return baseline.indexOf(id) === -1 })
  var qLower = search.trim().toLowerCase()
  var visible = qLower
    ? allProfiles.filter(function (p) {
        return (p.name || '').toLowerCase().indexOf(qLower) !== -1 || (p.email || '').toLowerCase().indexOf(qLower) !== -1
      })
    : allProfiles

  return (
    <div className={CARD + ' p-4 space-y-3'}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
            <span className="text-slate-900"><Icon name={icon} size={14} /></span>
            {title}
          </p>
          <p className="text-[11.5px] text-slate-500 mt-0.5">{description}</p>
        </div>
        {dirty && <Chip tone={CHIP_WARN}>Unsaved</Chip>}
      </div>

      <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
        placeholder="Search people…" className={CTRL} />

      <div className="max-h-64 overflow-y-auto ambria-thin-scroll border border-slate-200 rounded-xl divide-y divide-slate-100">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-slate-400 text-center">No matches</p>
        ) : visible.map(function (p) {
          var on = ids.indexOf(p.id) !== -1
          return (
            <label key={p.id}
              className={'flex items-center gap-2.5 px-3 py-2 text-[13px] cursor-pointer transition-colors ' + (on ? 'bg-indigo-50/60' : 'hover:bg-slate-50')}>
              <input type="checkbox" checked={on} onChange={function () { toggle(p.id) }}
                className="w-4 h-4 accent-indigo-600 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className={'block font-semibold truncate ' + (on ? 'text-indigo-900' : 'text-slate-800')}>{p.name || '—'}</span>
                {p.email && <span className="block text-[11px] text-slate-400 truncate">{p.email}</span>}
              </span>
            </label>
          )
        })}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving || !dirty}
          title={dirty ? 'Save these subscribers' : 'Nothing has changed yet'}
          className={BTN_PRIMARY}>
          <Icon name="save" size={14} />
          {saving ? 'Saving…' : 'Save Subscribers'}
        </button>
        {dirty && (
          <button onClick={function () { setIds(baseline); setNotice(''); setError('') }}
            disabled={saving} className={BTN_GHOST}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, children }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      {children || <p className="text-[13px] font-semibold text-slate-900 mt-0.5 truncate">{value}</p>}
    </div>
  )
}

function Settings() {
  var [settings, setSettings] = useState(null)
  // What the row looked like when it was loaded, so the page can tell whether
  // anything actually changed instead of offering a pointless write.
  var [baseline, setBaseline] = useState(null)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [notice, setNotice] = useState('')
  var [account, setAccount] = useState(null)
  var [fetchingAccount, setFetchingAccount] = useState(false)

  // Who gets a push when a new WhatsApp message comes in. Its own baseline/
  // dirty/save cycle, separate from the sending-rules card above — the two
  // save independently rather than forcing one Save button to cover both.
  var [allProfiles, setAllProfiles] = useState([])
  var [subscriberIds, setSubscriberIds] = useState([])
  var [subscriberBaseline, setSubscriberBaseline] = useState([])

  // Who gets a push when sync-events pulls in a new LMS contract (any of the
  // 4 departments). Same shape as the WA-inbox subscriber list above, own
  // independent baseline/save.
  var [syncSubscriberIds, setSyncSubscriberIds] = useState([])
  var [syncSubscriberBaseline, setSyncSubscriberBaseline] = useState([])

  function load() {
    supabase.from('wa_settings').select('*').eq('id', 1).maybeSingle().then(function (res) {
      setSettings(res.data)
      setBaseline(res.data)
    })
    supabase.from('wa_accounts').select('*').maybeSingle().then(function (res) { setAccount(res.data) })
    supabase.from('profiles').select('id, name, email').order('name').then(function (res) { setAllProfiles(res.data || []) })
    supabase.from('wa_inbox_notification_subscribers').select('user_id').then(function (res) {
      var ids = (res.data || []).map(function (r) { return r.user_id })
      setSubscriberIds(ids)
      setSubscriberBaseline(ids)
    })
    supabase.from('lms_sync_notification_subscribers').select('user_id').then(function (res) {
      var ids = (res.data || []).map(function (r) { return r.user_id })
      setSyncSubscriberIds(ids)
      setSyncSubscriberBaseline(ids)
    })
  }

  useEffect(function () { load() }, [])

  function patch(key, value) {
    setNotice('')
    setSettings(function (prev) {
      var next = Object.assign({}, prev)
      next[key] = value
      return next
    })
  }

  async function save() {
    if (saving || !settings) return
    setSaving(true); setError(''); setNotice('')
    var payload = {}
    EDITABLE.forEach(function (k) { payload[k] = settings[k] })
    var res = await supabase.from('wa_settings').update(payload).eq('id', 1)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setBaseline(settings)
    setNotice('Settings saved.')
  }

  async function refreshAccount() {
    if (fetchingAccount) return
    setFetchingAccount(true); setError('')
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var res = await supabase.functions.invoke('wa-account-info', { body: {}, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setFetchingAccount(false)
    if (res.error) { setError(await edgeFnErrorMessage(res.error)); return }
    setAccount((res.data || {}).account || null)
  }

  if (!settings) {
    return (
      <div className={CARD + ' p-8 text-center max-w-xl'}>
        <p className="text-[13px] text-slate-400">Loading settings…</p>
      </div>
    )
  }

  var dirty = !baseline || EDITABLE.some(function (k) { return String(settings[k]) !== String(baseline[k]) })
  var quality = (account && account.quality_rating ? String(account.quality_rating) : '').toLowerCase()

  return (
    <div className="max-w-2xl mx-auto space-y-3 pb-1">
      <div>
        <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Settings</h2>
        <p className="text-[11.5px] text-slate-500 mt-0.5">
          One shared configuration for the whole workspace — a change here affects every campaign and every sender.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {/* ── the WhatsApp Business account ── */}
      <div className={CARD + ' overflow-hidden'}>
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100">
          <p className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
            <span className="text-slate-900"><Icon name="bank" size={15} /></span>
            WhatsApp Business Account
          </p>
          <button onClick={refreshAccount} disabled={fetchingAccount}
            title="Fetch the live figures from Meta"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-bold text-indigo-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors">
            <Icon name="refresh" size={12} />
            {fetchingAccount ? 'Fetching…' : 'Refresh from Meta'}
          </button>
        </div>
        <div className="p-3.5">
          {account ? (
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Phone" value={account.display_phone || '—'} />
              <StatTile label="Messaging tier" value={account.tier || '—'} />
              <StatTile label="Quality">
                {quality ? (
                  <p className="mt-1"><Chip tone={QUALITY_TONE[quality] || CHIP_NEUTRAL}>{quality}</Chip></p>
                ) : (
                  <p className="text-[13px] font-semibold text-slate-900 mt-0.5">—</p>
                )}
              </StatTile>
              <StatTile label="Quota used today" value={account.quota_used_today != null ? String(account.quota_used_today) : '—'} />
            </div>
          ) : (
            <p className="text-[12px] text-slate-500 leading-snug">
              These figures live at Meta, not in this database. Press Refresh from Meta to pull them.
            </p>
          )}
        </div>
      </div>

      {/* ── sending rules ──
          The hints state what the database actually enforces (migration 00028
          fn_wa_check_eligibility): the cap and the window apply to marketing
          templates only, and the window is compared in IST. Those two facts
          were invisible here, so the numbers looked like they governed every
          send. */}
      <div className={CARD + ' p-4 space-y-3'}>
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
            <span className="text-slate-900"><Icon name="settings" size={14} /></span>
            Sending rules
          </p>
          {dirty && <Chip tone={CHIP_WARN}>Unsaved</Chip>}
        </div>

        <Labeled label="Marketing frequency cap"
          hint="The most marketing messages one contact can receive in a rolling 7 days. Utility and authentication templates are not counted against it.">
          <input type="number" min="0" value={settings.marketing_freq_cap_per_week}
            onChange={function (ev) { patch('marketing_freq_cap_per_week', Number(ev.target.value)) }}
            className={CTRL + ' tabular-nums'} />
        </Labeled>

        <div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Send window start">
              <input type="time" value={settings.send_window_start}
                onChange={function (ev) { patch('send_window_start', ev.target.value) }}
                className={CTRL + ' tabular-nums'} />
            </Labeled>
            <Labeled label="Send window end">
              <input type="time" value={settings.send_window_end}
                onChange={function (ev) { patch('send_window_end', ev.target.value) }}
                className={CTRL + ' tabular-nums'} />
            </Labeled>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Marketing sends outside these hours are refused. The clock is IST, whatever timezone the sender is in — and again, only marketing templates are affected.
          </p>
        </div>

        <Labeled label="Confirmation threshold"
          hint="Above this many recipients, a campaign send has to be confirmed by typing a token. The database enforces it, so the campaign builder asks for the token at exactly this number.">
          <input type="number" min="1" value={settings.confirmation_threshold_recipients}
            onChange={function (ev) { patch('confirmation_threshold_recipients', Number(ev.target.value)) }}
            className={CTRL + ' tabular-nums'} />
        </Labeled>

        <Labeled label="Session length (hours)"
          hint="How long a contact's reply keeps the free-form window open. Meta allows 24; a longer value here will not make their API accept a late reply.">
          <input type="number" min="1" value={settings.session_length_hours}
            onChange={function (ev) { patch('session_length_hours', Number(ev.target.value)) }}
            className={CTRL + ' tabular-nums'} />
        </Labeled>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || !dirty}
            title={dirty ? 'Save these settings' : 'Nothing has changed yet'}
            className={BTN_PRIMARY}>
            <Icon name="save" size={14} />
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {dirty && (
            <button onClick={function () { setSettings(baseline); setNotice(''); setError('') }}
              disabled={saving} className={BTN_GHOST}>
              Discard changes
            </button>
          )}
        </div>
      </div>

      <SubscriberCard
        icon="bell"
        title="Inbox notifications"
        description="These people get a push the moment someone messages the WhatsApp number — not gated by who can see the Inbox, so it can reach whoever should know even if they don't work in API Marketing day to day."
        allProfiles={allProfiles}
        ids={subscriberIds} setIds={setSubscriberIds}
        baseline={subscriberBaseline} setBaseline={setSubscriberBaseline}
        rpcName="rpc_set_wa_inbox_subscribers"
      />

      <SubscriberCard
        icon="calendar"
        title="Contract sync notifications"
        description="These people get a push whenever a new contract (Venue, Catering, Decor or Entertainment) is synced in from the LMS — useful even for people who don't have Events access."
        allProfiles={allProfiles}
        ids={syncSubscriberIds} setIds={setSyncSubscriberIds}
        baseline={syncSubscriberBaseline} setBaseline={setSyncSubscriberBaseline}
        rpcName="rpc_set_lms_sync_subscribers"
      />
    </div>
  )
}

export default Settings
