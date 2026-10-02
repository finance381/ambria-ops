import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from './Icon'

// A searchable checkbox list of profiles + its own Save/Discard, writing to
// a dedicated subscribers table via an RPC taking { p_user_ids }. Shared by
// every "who gets pushed when X happens" admin picker — the WhatsApp inbox
// one (Settings.jsx) and the LMS contract-sync one (Events.jsx) are the
// same shape, just a different table/RPC underneath.
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
    <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
            <span className="text-slate-900"><Icon name={icon} size={14} /></span>
            {title}
          </p>
          <p className="text-[11.5px] text-slate-500 mt-0.5">{description}</p>
        </div>
        {dirty && (
          <span className="inline-flex items-center h-[19px] px-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap bg-amber-50 text-amber-700 border-amber-200">
            Unsaved
          </span>
        )}
      </div>

      <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
        placeholder="Search people…"
        className="block w-full h-10 px-3 bg-white border border-slate-300 rounded-xl text-[16px] sm:text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" />

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

      {error && (
        <p className="flex items-start gap-1.5 text-[12px] rounded-xl px-3 py-2 border text-red-700 bg-red-50 border-red-200">
          <span className="shrink-0 mt-px"><Icon name="alert" size={13} /></span>
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-1.5 text-[12px] rounded-xl px-3 py-2 border text-emerald-700 bg-emerald-50 border-emerald-200">
          <span className="shrink-0 mt-px"><Icon name="checkCircle" size={13} /></span>
          <span>{notice}</span>
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving || !dirty}
          title={dirty ? 'Save these subscribers' : 'Nothing has changed yet'}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] shadow-[0_2px_8px_rgba(79,70,229,0.30)] disabled:opacity-50 disabled:shadow-none transition-all">
          <Icon name="save" size={14} />
          {saving ? 'Saving…' : 'Save Subscribers'}
        </button>
        {dirty && (
          <button onClick={function () { setIds(baseline); setNotice(''); setError('') }}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all">
            Discard changes
          </button>
        )}
      </div>
    </div>
  )
}

export default SubscriberCard
