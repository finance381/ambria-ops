import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Contact fields fn_wa_resolve_mapping (migration 00029) actually supports —
// keep this list in sync with that function's CASE branches.
var MAPPABLE_FIELDS = [
  { value: 'contact.first_name', label: 'First name' },
  { value: 'contact.name', label: 'Full name' },
  { value: 'contact.phone_e164', label: 'Phone' },
  { value: 'contact.venue_affinity_name', label: 'Venue name' },
]
var SOURCE_OPTIONS = ['', 'lms', 'contract', 'csv', 'manual', 'inbound']

function CampaignBuilder({ campaignId, onClose, onSaved }) {
  var [templates, setTemplates] = useState([])
  var [venues, setVenues] = useState([])
  var [name, setName] = useState('')
  var [templateId, setTemplateId] = useState('')
  var [tagsText, setTagsText] = useState('')
  var [venueIds, setVenueIds] = useState([])
  var [source, setSource] = useState('')
  var [minLastSentDays, setMinLastSentDays] = useState('')
  var [scheduledAt, setScheduledAt] = useState('')
  var [mapping, setMapping] = useState({})
  var [currentId, setCurrentId] = useState(campaignId || null)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [notice, setNotice] = useState('')

  var [preview, setPreview] = useState(null)
  var [previewLoading, setPreviewLoading] = useState(false)

  var [confirmOpen, setConfirmOpen] = useState(false)
  var [confirmToken, setConfirmToken] = useState('')
  var [sending, setSending] = useState(false)
  var [sendProgress, setSendProgress] = useState(null)

  var selectedTemplate = templates.find(function (t) { return String(t.id) === String(templateId) })

  useEffect(function () {
    supabase.from('wa_templates').select('*').eq('meta_status', 'approved').then(function (res) { setTemplates(res.data || []) })
    supabase.from('venues').select('id, code, name').then(function (res) { setVenues(res.data || []) })
    if (campaignId) {
      supabase.from('wa_campaigns').select('*').eq('id', campaignId).maybeSingle().then(function (res) {
        if (!res.data) return
        var c = res.data
        setName(c.name); setTemplateId(String(c.template_id))
        var f = c.audience_filter_json || {}
        setTagsText((f.tags || []).join(', '))
        setVenueIds((f.venue_ids || []).map(String))
        setSource(f.source || '')
        setMinLastSentDays(f.min_last_sent_days != null ? String(f.min_last_sent_days) : '')
        setScheduledAt(c.scheduled_at ? c.scheduled_at.substring(0, 16) : '')
        setMapping(c.variable_mapping_json || {})
      })
    }
  }, [campaignId])

  function toggleVenue(id) {
    var idStr = String(id)
    setVenueIds(function (prev) {
      var next = prev.slice()
      var i = next.indexOf(idStr)
      if (i === -1) next.push(idStr); else next.splice(i, 1)
      return next
    })
  }

  function buildAudienceFilter() {
    var f = {}
    var tags = tagsText.split(',').map(function (t) { return t.trim() }).filter(Boolean)
    if (tags.length > 0) f.tags = tags
    if (venueIds.length > 0) f.venue_ids = venueIds.map(Number)
    if (source) f.source = source
    if (minLastSentDays) f.min_last_sent_days = Number(minLastSentDays)
    return f
  }

  async function saveDraft() {
    if (saving || !name || !templateId) return
    setSaving(true); setError(''); setNotice('')

    var payload = {
      name: name, template_id: Number(templateId),
      audience_filter_json: buildAudienceFilter(),
      variable_mapping_json: mapping,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    }

    var res
    if (currentId) {
      res = await supabase.from('wa_campaigns').update(payload).eq('id', currentId).select().single()
    } else {
      res = await supabase.from('wa_campaigns').insert(payload).select().single()
    }
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setCurrentId(res.data.id)
    setNotice('Draft saved.')
  }

  async function refreshPreview() {
    if (!currentId) { setError('Save the draft first'); return }
    setPreviewLoading(true); setError('')
    var res = await supabase.rpc('rpc_wa_campaign_preview', { p_campaign_id: currentId })
    setPreviewLoading(false)
    if (res.error) { setError(res.error.message); return }
    setPreview(res.data)
  }

  function openSendConfirm() {
    if (!currentId) { setError('Save the draft first'); return }
    if (!preview) { setError('Refresh the preview first'); return }
    setConfirmToken('')
    setConfirmOpen(true)
  }

  async function confirmSend() {
    if (sending) return
    setSending(true); setError('')
    var needsToken = preview && preview.recipient_count > 20
    var sendRes = await supabase.rpc('rpc_wa_campaign_send', {
      p_campaign_id: currentId,
      p_confirm_token: needsToken ? confirmToken : null,
    })
    if (sendRes.error) { setSending(false); setError(sendRes.error.message); return }

    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    setConfirmOpen(false)
    setSendProgress('sending')

    var invokeRes = await supabase.functions.invoke('wa-send', {
      body: { campaign_id: currentId }, headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    setSending(false)
    if (invokeRes.error) { setError('Send failed: ' + invokeRes.error.message); setSendProgress(null); return }
    setSendProgress('done')
    if (onSaved) onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <button onClick={onClose} className="text-sm text-indigo-600 font-medium">← Back to Campaigns</button>
        <span className="text-sm font-bold text-gray-900">{currentId ? 'Edit Campaign' : 'New Campaign'}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 max-w-5xl mx-auto">
          <div className="space-y-4">
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase">1. Name</p>
              <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase">2. Template</p>
              <select value={templateId} onChange={function (ev) { setTemplateId(ev.target.value); setMapping({}) }}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
                <option value="">Select an approved template...</option>
                {templates.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name} ({t.category})</option> })}
              </select>
              {selectedTemplate && <p className="text-xs text-gray-500 whitespace-pre-wrap">{selectedTemplate.body_text}</p>}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase">3. Audience</p>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Tags (comma-separated)</label>
                <input type="text" value={tagsText} onChange={function (ev) { setTagsText(ev.target.value) }}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Venues</label>
                <div className="flex flex-wrap gap-1.5">
                  {venues.map(function (v) {
                    var active = venueIds.indexOf(String(v.id)) !== -1
                    return (
                      <button key={v.id} onClick={function () { toggleVenue(v.id) }}
                        className={"px-2 py-1 text-[11px] font-semibold rounded-md " + (active ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500")}>
                        {v.code || v.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Source</label>
                  <select value={source} onChange={function (ev) { setSource(ev.target.value) }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
                    {SOURCE_OPTIONS.map(function (s) { return <option key={s} value={s}>{s || 'Any'}</option> })}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Min days since last sent</label>
                  <input type="number" value={minLastSentDays} onChange={function (ev) { setMinLastSentDays(ev.target.value) }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
                </div>
              </div>
            </div>

            {selectedTemplate && selectedTemplate.variable_count > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase">4. Variable mapping</p>
                {Array.from({ length: selectedTemplate.variable_count }).map(function (_, i) {
                  var idx = String(i + 1)
                  var varLabel = (selectedTemplate.variable_labels || [])[i] || ('Variable ' + idx)
                  return (
                    <div key={idx}>
                      <label className="text-[10px] font-bold text-gray-400 uppercase">{'{{' + idx + '}}'} — {varLabel}</label>
                      <select value={mapping[idx] || ''} onChange={function (ev) { setMapping(Object.assign({}, mapping, { [idx]: ev.target.value })) }}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
                        <option value="">Select a contact field...</option>
                        {MAPPABLE_FIELDS.map(function (f) { return <option key={f.value} value={f.value}>{f.label}</option> })}
                      </select>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase">5. Schedule</p>
              <input type="datetime-local" value={scheduledAt} onChange={function (ev) { setScheduledAt(ev.target.value) }}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
              <p className="text-[10px] text-gray-400">Leave blank to send immediately once you click Send.</p>
            </div>

            <button onClick={saveDraft} disabled={saving || !name || !templateId}
              className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Save Draft</button>
          </div>

          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 sticky top-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-400 uppercase">Live Summary</p>
                <button onClick={refreshPreview} disabled={previewLoading || !currentId} className="text-[11px] font-bold text-indigo-600 disabled:opacity-50">
                  {previewLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              {preview ? (
                <div className="space-y-2">
                  <p className="text-2xl font-bold text-gray-900">{preview.recipient_count}</p>
                  <p className="text-xs text-gray-500">reachable recipients</p>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {Object.keys(preview.breakdown_by_reason || {}).map(function (reason) {
                      return <div key={reason} className="flex justify-between"><span className="capitalize">{reason.replace(/_/g, ' ')}</span><span>{preview.breakdown_by_reason[reason]}</span></div>
                    })}
                  </div>
                  {(preview.sample_renders || []).length > 0 && (
                    <div className="border-t border-gray-100 pt-2 space-y-1.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Sample renders</p>
                      {preview.sample_renders.map(function (s, i) {
                        return <p key={i} className="text-xs text-gray-600 bg-gray-50 rounded p-1.5">{s.rendered_body}</p>
                      })}
                    </div>
                  )}
                  <button onClick={openSendConfirm} className="w-full py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg mt-2">Send Campaign</button>
                </div>
              ) : <p className="text-xs text-gray-400">Save the draft, then refresh to see reachable audience.</p>}
            </div>

            {sendProgress && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-700">{sendProgress === 'sending' ? 'Sending...' : 'Send complete'}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmOpen && preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full mx-4 space-y-3">
            <p className="text-sm font-bold text-gray-900">Send to {preview.recipient_count} recipients?</p>
            <p className="text-xs text-gray-500">Template: {selectedTemplate ? selectedTemplate.name : '—'}</p>
            {(preview.sample_renders || []).slice(0, 3).map(function (s, i) {
              return <p key={i} className="text-xs text-gray-600 bg-gray-50 rounded p-1.5">{s.rendered_body}</p>
            })}
            {preview.recipient_count > 20 && (
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Type SEND-{currentId} to confirm</label>
                <input type="text" value={confirmToken} onChange={function (ev) { setConfirmToken(ev.target.value) }}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={function () { setConfirmOpen(false) }} className="flex-1 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={confirmSend} disabled={sending || (preview.recipient_count > 20 && confirmToken !== ('SEND-' + currentId))}
                className="flex-1 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg disabled:opacity-50">
                {sending ? 'Sending...' : 'Confirm Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CampaignBuilder
