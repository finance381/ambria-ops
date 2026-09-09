import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'

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

var STATUS_TICK = { queued: '', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '✕' }

function sessionOpen(expiresAt) {
  return !!expiresAt && new Date(expiresAt) > new Date()
}

function ConversationRow({ conv, active, onClick }) {
  var contact = conv.wa_contacts || {}
  var open = sessionOpen(conv.session_expires_at)
  return (
    <div onClick={onClick}
      className={"px-3 py-2.5 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-indigo-50/30 " + (active ? "bg-indigo-50" : "")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 truncate">{contact.name || contact.phone_e164 || 'Unknown'}</p>
        <span className="text-[10px] text-gray-400 shrink-0">{conv.last_message_at ? formatDate(conv.last_message_at) : ''}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <p className="text-xs text-gray-500 truncate">{conv.last_direction === 'out' ? 'You: ' : ''}—</p>
        <div className="flex items-center gap-1 shrink-0">
          {conv.unread_count > 0 && <span className="text-[9px] font-bold bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center">{conv.unread_count}</span>}
          <span className={"text-[9px] font-bold px-1.5 py-0.5 rounded " + (open ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>{open ? 'Open' : 'Closed'}</span>
        </div>
      </div>
    </div>
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

  var filtered = conversations.filter(function (c) {
    var contact = c.wa_contacts || {}
    if (filterMode === 'active' && !sessionOpen(c.session_expires_at)) return false
    if (filterMode === 'closed' && sessionOpen(c.session_expires_at)) return false
    if (filterMode === 'unread' && !(c.unread_count > 0)) return false
    if (search) {
      var q = search.toLowerCase()
      var matches = (contact.name || '').toLowerCase().indexOf(q) !== -1 || (contact.phone_e164 || '').indexOf(search) !== -1
      if (!matches) return false
    }
    return true
  })

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
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-3 h-[75vh]">
      <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
        <div className="p-2 space-y-2 border-b border-gray-100">
          <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
            placeholder="Search..." className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
          <div className="flex gap-1.5 flex-wrap">
            {['all', 'active', 'closed', 'unread'].map(function (m) {
              return (
                <button key={m} onClick={function () { setFilterMode(m) }}
                  className={"px-2 py-1 text-[10px] font-bold capitalize rounded-md " + (filterMode === m ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-500")}>{m}</button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <p className="text-center text-xs text-gray-400 py-6">Loading...</p>
            : filtered.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">No conversations</p>
            : filtered.map(function (c) {
              return <ConversationRow key={c.id} conv={c} active={activeConv && activeConv.id === c.id} onClick={function () { openConversation(c) }} />
            })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
        {!activeConv ? (
          <p className="text-center text-sm text-gray-400 py-10">Select a conversation</p>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{activeConv.wa_contacts.name || 'Unknown'}</p>
                <p className="text-xs text-gray-400 font-mono">{activeConv.wa_contacts.phone_e164}</p>
              </div>
              <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded " + (isOpen ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>{isOpen ? 'Session open' : 'Session closed'}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
              {loadingMsgs ? <p className="text-center text-xs text-gray-400">Loading...</p>
                : messages.map(function (m) {
                  var out = m.direction === 'out'
                  return (
                    <div key={m.id} className={"flex " + (out ? "justify-end" : "justify-start")}>
                      <div className={"max-w-[75%] rounded-lg px-3 py-2 text-sm " + (out ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-800")}>
                        <p className="whitespace-pre-wrap">{m.rendered_body || '(template message)'}</p>
                        {m.wa_templates && <p className={"text-[10px] mt-1 " + (out ? "text-indigo-200" : "text-gray-400")}>Sent via template {m.wa_templates.name}</p>}
                        {out && <p className="text-[10px] text-indigo-200 mt-1 text-right">{STATUS_TICK[m.status] || ''}</p>}
                      </div>
                    </div>
                  )
                })}
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border-t border-red-200 px-3 py-2">{error}</p>}

            <div className="p-3 border-t border-gray-100 space-y-2">
              {templatePickerOpen && (
                <div className="border border-gray-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                  {templates.length === 0 ? <p className="text-xs text-gray-400">No variable-free approved templates available</p>
                    : templates.map(function (t) {
                      return (
                        <div key={t.id} onClick={function () { sendTemplate(t) }} className="text-xs px-2 py-1 rounded hover:bg-indigo-50 cursor-pointer">{t.name}</div>
                      )
                    })}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={function () { setTemplatePickerOpen(!templatePickerOpen) }}
                  className="px-2.5 py-2 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg">Template</button>
                <input type="text" value={composerText} disabled={!isOpen || !canReply}
                  onChange={function (ev) { setComposerText(ev.target.value) }}
                  onKeyDown={function (ev) { if (ev.key === 'Enter') sendFreeForm() }}
                  placeholder={isOpen ? 'Type a message...' : 'Session closed. Send a template to reopen.'}
                  className="flex-1 px-2 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50" style={{ fontSize: '16px' }} />
                <button onClick={sendFreeForm} disabled={sending || !isOpen || !canReply || !composerText.trim()}
                  className="px-3 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Send</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Inbox
