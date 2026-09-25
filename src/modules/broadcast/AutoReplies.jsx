import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import { CTRL, TEXTAREA, BTN_PRIMARY, TH, TD, CARD, Chip, Labeled, Notice, EmptyState, CHIP_INFO } from './ui'

// Automatic replies for inbound messages to the number listed on the
// website — wa-webhook checks these (in priority order) right after
// storing an inbound message and sends the first match's reply_text as a
// plain-text message. A reply to something a guest just messaged is always
// within their 24h session window, so no approved template is needed —
// same reasoning Inbox's manual replies already rely on.
//
// Note: a rule fires on every qualifying inbound message, not just the
// first one in a conversation — a keyword rule answering a specific
// question is meant to repeat if asked again, but an "always" catch-all
// will greet on every single message. Keep "always" rules rare/generic and
// lean on keyword rules for anything conversational.
function RuleFormModal({ open, rule, onClose, onSaved }) {
  var isEdit = !!rule
  var [name, setName] = useState('')
  var [triggerType, setTriggerType] = useState('keyword')
  var [keywordsText, setKeywordsText] = useState('')
  var [replyText, setReplyText] = useState('')
  var [priority, setPriority] = useState('0')
  var [active, setActive] = useState(true)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  useEffect(function () {
    if (!open) return
    setName(rule ? rule.name : '')
    setTriggerType(rule ? rule.trigger_type : 'keyword')
    setKeywordsText(rule && rule.keywords ? rule.keywords.join(', ') : '')
    setReplyText(rule ? rule.reply_text : '')
    setPriority(rule ? String(rule.priority) : '0')
    setActive(rule ? rule.active : true)
    setError('')
  }, [open, rule])

  async function save() {
    if (saving || !name.trim() || !replyText.trim()) return
    if (triggerType === 'keyword' && keywordsText.trim().split(',').map(function (k) { return k.trim() }).filter(Boolean).length === 0) {
      setError('Add at least one keyword, or switch to Always'); return
    }
    setSaving(true); setError('')
    var payload = {
      name: name.trim(), trigger_type: triggerType,
      keywords: triggerType === 'keyword' ? keywordsText.split(',').map(function (k) { return k.trim() }).filter(Boolean) : null,
      reply_text: replyText.trim(), priority: Number(priority) || 0, active: active,
    }
    var res = isEdit
      ? await supabase.from('wa_auto_replies').update(payload).eq('id', rule.id).select().single()
      : await supabase.from('wa_auto_replies').insert(payload).select().single()
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved(res.data)
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Auto-Reply' : 'New Auto-Reply'}>
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Labeled label="Name" hint="Internal only, for your own reference">
          <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
            placeholder="Rates enquiry" className={CTRL} />
        </Labeled>
        <Labeled label="Fires on">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={function () { setTriggerType('keyword') }}
              className={'h-10 rounded-xl text-[13px] font-bold border transition-colors ' +
                (triggerType === 'keyword' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}>
              Keyword match
            </button>
            <button type="button" onClick={function () { setTriggerType('always') }}
              className={'h-10 rounded-xl text-[13px] font-bold border transition-colors ' +
                (triggerType === 'always' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}>
              Always
            </button>
          </div>
        </Labeled>
        {triggerType === 'keyword' ? (
          <Labeled label="Keywords" hint="Comma-separated — any one appearing anywhere in the message fires this (not case-sensitive)">
            <input type="text" value={keywordsText} onChange={function (ev) { setKeywordsText(ev.target.value) }}
              placeholder="rate, price, cost, package" className={CTRL} />
          </Labeled>
        ) : (
          <Notice tone="warn">Fires on every inbound message that reaches this rule — keep it short and rare (e.g. a single catch-all greeting), not one per topic.</Notice>
        )}
        <Labeled label="Reply">
          <textarea value={replyText} onChange={function (ev) { setReplyText(ev.target.value) }} rows={4}
            placeholder="Thanks for reaching out to Ambria! Our team will get back to you shortly." className={TEXTAREA} />
        </Labeled>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Labeled label="Priority" hint="Lower checked first — first active match wins">
            <input type="number" value={priority} onChange={function (ev) { setPriority(ev.target.value) }} className={CTRL} />
          </Labeled>
          <div>
            <label className="block text-[12px] font-semibold text-slate-900 mb-1">Active</label>
            <button type="button" onClick={function () { setActive(!active) }} aria-pressed={active}
              className="flex items-center gap-2 h-10 px-3 border border-slate-300 rounded-xl bg-white hover:bg-slate-50 transition-colors">
              <span className={'relative w-9 h-5 rounded-full transition-colors ' + (active ? 'bg-indigo-600' : 'bg-slate-300')}>
                <span className={'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ' + (active ? 'translate-x-4' : 'translate-x-0.5')} />
              </span>
              <span className="text-[13px] font-semibold text-slate-700">{active ? 'On' : 'Off'}</span>
            </button>
          </div>
        </div>
        <button onClick={save} disabled={saving || !name.trim() || !replyText.trim()} className={BTN_PRIMARY + ' w-full h-10'}>
          <Icon name="check" size={14} strokeWidth={2.3} />
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
        </button>
      </div>
    </Modal>
  )
}

function AutoReplies({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canEdit = hasPerm(permsNew, 'broadcast.settings')

  var [rules, setRules] = useState([])
  var [loading, setLoading] = useState(true)
  var [formOpen, setFormOpen] = useState(false)
  var [editing, setEditing] = useState(null)

  function load() {
    setLoading(true)
    supabase.from('wa_auto_replies').select('*').order('priority', { ascending: true })
      .then(function (res) { setRules(res.data || []); setLoading(false) })
  }

  useEffect(function () { load() }, [])

  function openNew() { setEditing(null); setFormOpen(true) }
  function openEdit(r) { setEditing(r); setFormOpen(true) }

  async function toggleActive(r) {
    var res = await supabase.from('wa_auto_replies').update({ active: !r.active }).eq('id', r.id)
    if (!res.error) load()
  }

  async function remove(r) {
    if (!window.confirm('Delete "' + r.name + '"?')) return
    var res = await supabase.from('wa_auto_replies').delete().eq('id', r.id)
    if (!res.error) load()
  }

  if (!canEdit) {
    return <EmptyState icon="alert" title="Admin only" hint="Auto-reply rules are configured by an admin." />
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Auto-Replies</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">Automatic replies for guests messaging your number — checked in priority order, first active match wins.</p>
        </div>
        <button onClick={openNew} className={BTN_PRIMARY}>
          <Icon name="plus" size={14} strokeWidth={2.4} />
          New Rule
        </button>
      </div>

      <div className={CARD + ' overflow-hidden'}>
        <div className="overflow-x-auto ambria-thin-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={TH + ' w-14'}>Priority</th>
                <th className={TH}>Name</th>
                <th className={TH}>Fires on</th>
                <th className={TH}>Reply</th>
                <th className={TH}>Active</th>
                <th className={TH + ' w-32'}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-[12px] text-slate-400 py-8">Loading…</td></tr>
              ) : rules.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState icon="send" title="No auto-replies yet" hint="Create one to respond automatically to guests messaging your number." />
                </td></tr>
              ) : rules.map(function (r) {
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className={TD + ' text-slate-500 tabular-nums'}>{r.priority}</td>
                    <td className={TD + ' font-semibold text-slate-900 whitespace-nowrap'}>{r.name}</td>
                    <td className={TD}>
                      {r.trigger_type === 'always' ? <Chip tone={CHIP_INFO}>always</Chip> : (
                        <span className="flex flex-wrap gap-1">
                          {(r.keywords || []).slice(0, 3).map(function (k) {
                            return <span key={k} className="text-[10.5px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">{k}</span>
                          })}
                          {(r.keywords || []).length > 3 && <span className="text-[10.5px] text-slate-400">+{r.keywords.length - 3}</span>}
                        </span>
                      )}
                    </td>
                    <td className={TD + ' text-slate-600 max-w-xs truncate'} title={r.reply_text}>{r.reply_text}</td>
                    <td className={TD}>
                      <button onClick={function () { toggleActive(r) }} aria-pressed={r.active}
                        className={'relative w-9 h-5 rounded-full transition-colors ' + (r.active ? 'bg-indigo-600' : 'bg-slate-300')}>
                        <span className={'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ' + (r.active ? 'translate-x-4' : 'translate-x-0.5')} />
                      </button>
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={function () { openEdit(r) }} title="Edit"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                          <Icon name="edit" size={14} />
                        </button>
                        <button onClick={function () { remove(r) }} title="Delete"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <RuleFormModal open={formOpen} rule={editing} onClose={function () { setFormOpen(false) }}
        onSaved={function () { setFormOpen(false); load() }} />
    </div>
  )
}

export default AutoReplies
