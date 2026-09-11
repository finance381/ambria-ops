import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import SearchField from '../../components/ui/SearchField'
import { CTRL, CARD, Chip, Notice, EmptyState, CHIP_GOOD, CHIP_NEUTRAL } from './ui'

// Known limitation, traced to migration 00033: rpc_wa_conversation_reply never
// populates wa_messages.template_params, so wa-send will fail loudly
// (template_params_missing) for any template with variables sent through this
// path. The template picker below only offers variable-free templates until
// that RPC's signature is extended (see 00033's header comment).
//
// Image/media attachments are NOT built here despite being listed as v1 scope
// in the original spec — that needs Meta's separate Media Upload API and a
// wa-send 'image' message type, neither of which exist yet. Flagging this as
// an actual gap in what ships, not silently dropping it.

// Delivery state, drawn rather than typed. The ticks used to be the literal
// characters ✓ ✓✓ ✕, which render at a different weight and baseline in every
// font — and ✕ for a failed send was easy to read as a close button.
var STATUS_MARK = {
  queued: { icon: 'clock', label: 'Queued' },
  sent: { icon: 'check', label: 'Sent' },
  delivered: { icon: 'checkDouble', label: 'Delivered' },
  read: { icon: 'checkDouble', label: 'Read' },
  failed: { icon: 'alert', label: 'Failed' },
}

var FILTER_MODES = ['all', 'active', 'closed', 'unread']

function sessionOpen(expiresAt) {
  return !!expiresAt && new Date(expiresAt) > new Date()
}

function clockTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

function initialsOf(name, phone) {
  var src = (name || '').trim()
  if (!src) return phone ? phone.slice(-2) : '?'
  var parts = src.split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function ConversationRow({ conv, active, onClick }) {
  var contact = conv.wa_contacts || {}
  var open = sessionOpen(conv.session_expires_at)
  var title = contact.name || contact.phone_e164 || 'Unknown'
  return (
    <button type="button" onClick={onClick}
      className={'w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-100 last:border-b-0 transition-colors ' +
        (active ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
      <span aria-hidden="true" data-notranslate
        className={'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-bold ' +
          (active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
        {initialsOf(contact.name, contact.phone_e164)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={'text-[13px] font-semibold truncate ' + (active ? 'text-indigo-900' : 'text-slate-900')}>{title}</span>
          <span className="shrink-0 text-[10px] text-slate-400" data-notranslate>
            {conv.last_message_at ? formatDate(conv.last_message_at) : ''}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 mt-1">
          {/* Who spoke last, not the message itself: wa_conversations does not
              carry a body, and the old row printed a bare em dash for every
              conversation — worse than saying nothing. */}
          <span className="text-[11px] text-slate-500 truncate">
            {conv.last_direction === 'out' ? 'You replied' : conv.last_direction === 'in' ? 'They messaged' : 'No messages yet'}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {conv.unread_count > 0 && (
              <span data-notranslate
                className="inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-indigo-600 text-white text-[9.5px] font-bold">
                {conv.unread_count}
              </span>
            )}
            <Chip tone={open ? CHIP_GOOD : CHIP_NEUTRAL}>{open ? 'Open' : 'Closed'}</Chip>
          </span>
        </span>
      </span>
    </button>
  )
}

function Inbox({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canReply = hasPerm(permsNew, 'broadcast.inbox.reply')

  var [conversations, setConversations] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [filterMode, setFilterMode] = useState('all')
  var [activeConv, setActiveConv] = useState(null)
  var [messages, setMessages] = useState([])
  var [loadingMsgs, setLoadingMsgs] = useState(false)
  var [templates, setTemplates] = useState([])
  var [composerText, setComposerText] = useState('')
  var [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  var [sending, setSending] = useState(false)
  var [error, setError] = useState('')

  function loadConversations() {
    setLoading(true)
    supabase.from('wa_conversations').select('*, wa_contacts(id, name, phone_e164, venue_affinity)')
      .order('last_message_at', { ascending: false }).limit(200)
      .then(function (res) { setConversations(res.data || []); setLoading(false) })
  }

  useEffect(function () {
    loadConversations()
    supabase.from('wa_templates').select('id, name, body_text, category, variable_count').eq('meta_status', 'approved').eq('variable_count', 0)
      .then(function (res) { setTemplates(res.data || []) })

    var channel = supabase.channel('wa_inbox_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_messages' }, function () {
        loadConversations()
        if (activeConv) loadMessages(activeConv)
      })
      .subscribe()
    return function () { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadMessages(conv) {
    setLoadingMsgs(true)
    supabase.from('wa_messages').select('*, wa_templates(name)').eq('contact_id', conv.wa_contacts.id)
      .order('created_at', { ascending: true }).limit(150)
      .then(function (res) { setMessages(res.data || []); setLoadingMsgs(false) })
  }

  function openConversation(conv) {
    setActiveConv(conv); setComposerText(''); setTemplatePickerOpen(false); setError('')
    loadMessages(conv)
    supabase.rpc('rpc_wa_mark_read', { p_conversation_id: conv.id }).then(function () { loadConversations() })
  }

  function matchesMode(c, mode) {
    if (mode === 'active') return sessionOpen(c.session_expires_at)
    if (mode === 'closed') return !sessionOpen(c.session_expires_at)
    if (mode === 'unread') return c.unread_count > 0
    return true
  }

  function matchesSearch(c) {
    if (!search) return true
    var contact = c.wa_contacts || {}
    var q = search.toLowerCase()
    return (contact.name || '').toLowerCase().indexOf(q) !== -1 || (contact.phone_e164 || '').indexOf(search) !== -1
  }

  var filtered = conversations.filter(function (c) { return matchesMode(c, filterMode) && matchesSearch(c) })

  // Counts respect the search box but not the mode, so each chip says how many
  // it would show — the point of a count is to answer "is it worth switching".
  function countFor(mode) {
    return conversations.filter(function (c) { return matchesMode(c, mode) && matchesSearch(c) }).length
  }

  async function sendFreeForm() {
    if (sending || !composerText.trim() || !activeConv) return
    setSending(true); setError('')
    var res = await supabase.rpc('rpc_wa_conversation_reply', {
      p_contact_id: activeConv.wa_contacts.id, p_body: composerText.trim(), p_template_id: null,
    })
    if (res.error) { setSending(false); setError(res.error.message); return }
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    await supabase.functions.invoke('wa-send', { body: { message_id: res.data }, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setSending(false)
    setComposerText('')
    loadMessages(activeConv)
  }

  async function sendTemplate(template) {
    if (sending || !activeConv) return
    setSending(true); setError('')
    var res = await supabase.rpc('rpc_wa_conversation_reply', {
      p_contact_id: activeConv.wa_contacts.id, p_body: template.body_text, p_template_id: template.id,
    })
    if (res.error) { setSending(false); setError(res.error.message); return }
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    await supabase.functions.invoke('wa-send', { body: { message_id: res.data }, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setSending(false)
    setTemplatePickerOpen(false)
    loadMessages(activeConv)
  }

  var isOpen = activeConv && sessionOpen(activeConv.session_expires_at)

  return (
    // lg:h-full makes the two panes fill the hub's fixed height; below that the
    // page scrolls normally, so a min height keeps them usable instead of
    // collapsing to their content.
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-3 lg:h-full lg:min-h-0">
      <div className={CARD + ' flex flex-col overflow-hidden min-h-[420px] lg:min-h-0'}>
        <div className="shrink-0 p-2.5 space-y-2 border-b border-slate-200">
          <SearchField value={search} onChange={setSearch} placeholder="Search name or phone..." />
          <div className="grid grid-cols-2 gap-1.5">
            {FILTER_MODES.map(function (m) {
              var on = filterMode === m
              return (
                <button key={m} type="button" onClick={function () { setFilterMode(m) }}
                  aria-pressed={on}
                  className={'flex w-full items-center justify-between gap-1.5 h-8 pl-2.5 pr-1.5 text-[11.5px] font-semibold rounded-xl capitalize border transition-colors ' +
                    (on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300')}>
                  {m}
                  <span data-notranslate
                    className={'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10.5px] font-bold tabular-nums ' +
                      (on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
                    {countFor(m)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto ambria-thin-scroll">
          {loading ? (
            <p className="text-center text-[12px] text-slate-400 py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <EmptyState icon="inbox"
              title={conversations.length === 0 ? 'No conversations yet' : 'No matches'}
              hint={conversations.length === 0
                ? 'A conversation appears here the first time a contact replies.'
                : 'Nothing matches this filter or search.'} />
          ) : filtered.map(function (c) {
            return <ConversationRow key={c.id} conv={c} active={activeConv && activeConv.id === c.id} onClick={function () { openConversation(c) }} />
          })}
        </div>
      </div>

      <div className={CARD + ' flex flex-col overflow-hidden min-h-[420px] lg:min-h-0'}>
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon="inbox" title="Select a conversation"
              hint="Pick someone on the left to read the thread and reply." />
          </div>
        ) : (
          <>
            <div className="shrink-0 px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span aria-hidden="true" data-notranslate
                  className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 text-[12px] font-bold">
                  {initialsOf(activeConv.wa_contacts.name, activeConv.wa_contacts.phone_e164)}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-slate-900 truncate">{activeConv.wa_contacts.name || 'Unknown'}</p>
                  <p className="text-[11px] text-slate-500 font-mono truncate" data-notranslate>{activeConv.wa_contacts.phone_e164}</p>
                </div>
              </div>
              <Chip tone={isOpen ? CHIP_GOOD : CHIP_NEUTRAL}>{isOpen ? 'Session open' : 'Session closed'}</Chip>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto ambria-thin-scroll p-3 space-y-1.5 bg-slate-50/60">
              {loadingMsgs ? (
                <p className="text-center text-[12px] text-slate-400 py-4">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-[12px] text-slate-400 py-4">No messages in this thread yet.</p>
              ) : messages.map(function (m) {
                var out = m.direction === 'out'
                var mark = STATUS_MARK[m.status]
                var failed = m.status === 'failed'
                return (
                  <div key={m.id} className={'flex ' + (out ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[78%] px-3 py-2 text-[13px] leading-snug shadow-[0_1px_1px_rgba(15,23,42,0.06)] ' +
                      (out
                        ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-md')}>
                      <p className="whitespace-pre-wrap">{m.rendered_body || '(template message)'}</p>
                      {m.wa_templates && (
                        <p className={'text-[10px] mt-1 ' + (out ? 'text-indigo-200' : 'text-slate-400')}>
                          Sent via template {m.wa_templates.name}
                        </p>
                      )}
                      <p className={'flex items-center justify-end gap-1 text-[10px] mt-0.5 ' +
                        (failed ? 'text-red-200' : out ? 'text-indigo-200' : 'text-slate-400')}>
                        <span data-notranslate>{clockTime(m.created_at)}</span>
                        {out && mark && (
                          // read is the same double tick as delivered, tinted —
                          // the WhatsApp convention, and the only thing that
                          // distinguishes them at this size.
                          <span title={mark.label} aria-label={mark.label}
                            className={m.status === 'read' ? 'text-sky-300' : ''}>
                            <Icon name={mark.icon} size={12} strokeWidth={2.4} />
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="shrink-0 border-t border-slate-200 p-2.5 space-y-2">
              {error && <Notice tone="error">{error}</Notice>}

              {/* The 24-hour window is Meta's rule, not ours, and a disabled
                  box with no explanation reads as a broken page. */}
              {!isOpen && (
                <Notice tone="warn">
                  Free-form replies are only allowed for 24 hours after the contact&apos;s last message. Send a template to reopen the window.
                </Notice>
              )}
              {isOpen && !canReply && (
                <Notice tone="info">You do not have permission to reply in this inbox.</Notice>
              )}

              {templatePickerOpen && (
                <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto ambria-thin-scroll divide-y divide-slate-100">
                  {templates.length === 0 ? (
                    <p className="text-[11.5px] text-slate-500 px-3 py-2.5 leading-snug">
                      No approved templates without variables. Only those can be sent from the inbox.
                    </p>
                  ) : templates.map(function (t) {
                    return (
                      <button key={t.id} type="button" onClick={function () { sendTemplate(t) }}
                        disabled={sending || !canReply}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
                        <span className="block text-[12.5px] font-semibold text-slate-900 truncate">{t.name}</span>
                        <span className="block text-[11px] text-slate-500 leading-snug line-clamp-2">{t.body_text}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button type="button" onClick={function () { setTemplatePickerOpen(!templatePickerOpen) }}
                  title="Send an approved template" aria-label="Send an approved template"
                  aria-expanded={templatePickerOpen}
                  className={'shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl border transition-colors ' +
                    (templatePickerOpen
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50')}>
                  <Icon name="fileText" size={16} />
                </button>
                <input type="text" value={composerText} disabled={!isOpen || !canReply}
                  onChange={function (ev) { setComposerText(ev.target.value) }}
                  onKeyDown={function (ev) { if (ev.key === 'Enter') sendFreeForm() }}
                  aria-label="Message"
                  placeholder={isOpen ? 'Type a message…' : 'Session closed — send a template instead'}
                  className={CTRL + ' flex-1'} />
                <button type="button" onClick={sendFreeForm}
                  disabled={sending || !isOpen || !canReply || !composerText.trim()}
                  title="Send" aria-label="Send"
                  className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] shadow-[0_2px_8px_rgba(79,70,229,0.30)] disabled:opacity-50 disabled:shadow-none transition-all">
                  <Icon name="send" size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Inbox
