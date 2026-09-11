import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/ui/Icon'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { CTRL, BTN_GHOST, BTN_PRIMARY, BTN_SEND, CARD, Labeled, Notice } from './ui'

// Contact fields fn_wa_resolve_mapping (migration 00029) actually supports —
// keep this list in sync with that function's CASE branches.
var MAPPABLE_FIELDS = [
  { value: 'contact.first_name', label: 'First name' },
  { value: 'contact.name', label: 'Full name' },
  { value: 'contact.phone_e164', label: 'Phone' },
  { value: 'contact.venue_affinity_name', label: 'Venue name' },
]
var SOURCE_OPTIONS = ['', 'lms', 'contract', 'csv', 'manual', 'inbound']

// The steps are numbered because they are genuinely ordered — the audience
// cannot be previewed before a template is chosen, and the variable step only
// exists for some templates. The badge is what makes that order visible; the
// old bare grey caps line did not.
function StepCard({ n, title, hint, icon, children }) {
  return (
    <div className={CARD + ' p-4'}>
      <div className="flex items-start gap-2.5 mb-3">
        <span aria-hidden="true" data-notranslate
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600 text-white text-[11px] font-bold tabular-nums">
          {n}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900 leading-tight">
            {icon && <span className="text-slate-900"><Icon name={icon} size={14} /></span>}
            {title}
          </p>
          {hint && <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// Sending has four real gates in this file — saveDraft needs a name and a
// template, refreshPreview needs a saved id, and openSendConfirm needs a
// preview. They used to surface only as errors after you pressed the wrong
// button ("Save the draft first"), so the order had to be learnt by failing.
function CheckRow({ done, label, hint }) {
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className={'shrink-0 mt-px inline-flex items-center justify-center w-4 h-4 rounded-full border ' +
        (done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300 text-transparent')}>
        <Icon name="check" size={9} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className={'block text-[12px] ' + (done ? 'text-slate-400 line-through' : 'font-semibold text-slate-800')}>{label}</span>
        {!done && hint && <span className="block text-[11px] text-slate-400 leading-snug">{hint}</span>}
      </span>
    </div>
  )
}

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
  // "Leave blank to send immediately" was a rule you had to read and
  // remember; two choices state it outright, and the common case no longer
  // shows an empty mm/dd/yyyy --:-- control at all.
  var [scheduleLater, setScheduleLater] = useState(false)
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
  // rpc_wa_campaign_send reads confirmation_threshold_recipients from
  // wa_settings and rejects a token-less send above it. This was hardcoded to
  // 20 here, so lowering the setting made the dialog skip the token field and
  // the send fail at the database with an opaque error. 20 is only the
  // fallback until the row loads — it is the column default (migration 00026).
  var [confirmThreshold, setConfirmThreshold] = useState(20)

  var selectedTemplate = templates.find(function (t) { return String(t.id) === String(templateId) })

  useEffect(function () {
    supabase.from('wa_templates').select('*').eq('meta_status', 'approved').then(function (res) { setTemplates(res.data || []) })
    supabase.from('venues').select('id, code, name').then(function (res) { setVenues(res.data || []) })
    supabase.from('wa_settings').select('confirmation_threshold_recipients').eq('id', 1).maybeSingle()
      .then(function (res) {
        if (res.data && res.data.confirmation_threshold_recipients != null) {
          setConfirmThreshold(res.data.confirmation_threshold_recipients)
        }
      })
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
        setScheduleLater(!!c.scheduled_at)
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

  // scheduledAt stays the stored shape (YYYY-MM-DDTHH:mm, which saveDraft
  // hands to new Date()), so the two controls edit halves of that one string
  // rather than keeping separate state that could disagree with it.
  var schedDate = scheduledAt ? scheduledAt.substring(0, 10) : ''
  var schedTime = scheduledAt.length >= 16 ? scheduledAt.substring(11, 16) : ''
  function setSchedParts(d, t) {
    // A date with no time is not a valid datetime-local value, so a picked
    // date defaults to 09:00 rather than saving something half-formed.
    if (!d) { setScheduledAt(''); return }
    setScheduledAt(d + 'T' + (t || '09:00'))
  }
  function chooseScheduleLater(later) {
    setScheduleLater(later)
    if (!later) setScheduledAt('')
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
    var needsToken = preview && preview.recipient_count > confirmThreshold
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

  var varCount = selectedTemplate ? (selectedTemplate.variable_count || 0) : 0
  var scheduleStep = varCount > 0 ? 5 : 4

  return (
    // An in-page view, not a fixed overlay. The overlay was full-viewport but
    // the admin sidebar painted over its left edge and ate the Back button:
    // the shell wraps this page in `relative isolate`, which makes a stacking
    // context, so the whole subtree competes with the sidebar at one level and
    // no z-index inside it can win. Sitting in the flow removes the fight
    // entirely, and the sidebar stays usable while a campaign is open.
    <div className="flex flex-col lg:h-full lg:min-h-0">
      {/* Back and Save Draft frame the title, matching the header every other
          page in this module uses. Save Draft is here rather than at the foot
          of a long form because every later step (preview, send) is gated on a
          saved draft, so it has to be reachable from anywhere in the form. */}
      <div className="shrink-0 flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button onClick={onClose} title="Back to Campaigns" aria-label="Back to Campaigns"
            className={BTN_GHOST + ' shrink-0 w-9 px-0'}>
            <Icon name="arrowLeft" size={16} />
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em] truncate">{currentId ? 'Edit Campaign' : 'New Campaign'}</h2>
            <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">
              {currentId ? 'Changes are saved to the draft, not sent' : 'Nothing sends until you preview and confirm'}
            </p>
          </div>
        </div>
        <button onClick={saveDraft} disabled={saving || !name || !templateId}
          title={!name || !templateId ? 'Give the campaign a name and pick a template first' : 'Save this draft'}
          className={BTN_PRIMARY + ' shrink-0'}>
          <Icon name="save" size={14} />
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
      </div>

      {/* min-h-0 is what lets this shrink below its content so it, and not
          the page, is the thing that scrolls. Below lg the hub scrolls
          normally and this stays in the flow. */}
      <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto ambria-thin-scroll lg:pr-1">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start pb-1">
          <div className="space-y-3">
            {error && <Notice tone="error">{error}</Notice>}
            {notice && <Notice tone="ok">{notice}</Notice>}

            <StepCard n={1} title="Name" icon="typography"
              hint="Internal only — recipients never see it.">
              <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
                placeholder="Diwali offer — Delhi venues" className={CTRL} />
            </StepCard>

            <StepCard n={2} title="Template" icon="fileText"
              hint="Only templates Meta has approved can be sent.">
              <select value={templateId} onChange={function (ev) { setTemplateId(ev.target.value); setMapping({}) }}
                aria-label="Template" className={CTRL}>
                <option value="">Select an approved template…</option>
                {templates.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name} ({t.category})</option> })}
              </select>
              {templates.length === 0 && (
                <Notice tone="warn">
                  No approved templates yet. Submit one from the Templates tab and wait for Meta to approve it.
                </Notice>
              )}
              {selectedTemplate && (
                <p className="text-[12.5px] text-slate-600 whitespace-pre-wrap leading-snug bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  {selectedTemplate.body_text}
                </p>
              )}
            </StepCard>

            <StepCard n={3} title="Audience" icon="users"
              hint="Leave a filter blank to ignore it. Opted-out contacts are always excluded.">
              <Labeled label="Tags" hint="Comma-separated — a contact matching any of them is included">
                <input type="text" value={tagsText} onChange={function (ev) { setTagsText(ev.target.value) }}
                  placeholder="delhi, wedding" className={CTRL} />
              </Labeled>
              <div>
                <label className="block text-[12px] font-semibold text-slate-900 mb-1">Venues</label>
                {venues.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No venues loaded.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {venues.map(function (v) {
                      var active = venueIds.indexOf(String(v.id)) !== -1
                      return (
                        <button key={v.id} type="button" onClick={function () { toggleVenue(v.id) }}
                          aria-pressed={active}
                          className={'inline-flex items-center gap-1 h-8 px-2.5 text-[12px] font-semibold rounded-xl border transition-colors ' +
                            (active
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400')}>
                          {active && <Icon name="check" size={12} strokeWidth={2.6} />}
                          {v.code || v.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">None selected means every venue.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Labeled label="Source" hint="Where the contact came from">
                  <select value={source} onChange={function (ev) { setSource(ev.target.value) }}
                    aria-label="Source" className={CTRL + ' capitalize'}>
                    {SOURCE_OPTIONS.map(function (s) { return <option key={s} value={s}>{s || 'Any'}</option> })}
                  </select>
                </Labeled>
                <Labeled label="Min days since last sent" hint="Skips anyone messaged more recently than this">
                  <input type="number" min="0" value={minLastSentDays}
                    onChange={function (ev) { setMinLastSentDays(ev.target.value) }}
                    placeholder="e.g. 30" className={CTRL} />
                </Labeled>
              </div>
            </StepCard>

            {varCount > 0 && (
              <StepCard n={4} title="Variable mapping" icon="braces"
                hint="Each placeholder in the template is filled from a contact field at send time.">
                {Array.from({ length: varCount }).map(function (_, i) {
                  var idx = String(i + 1)
                  var varLabel = (selectedTemplate.variable_labels || [])[i] || ('Variable ' + idx)
                  return (
                    <div key={idx} className="flex items-stretch gap-2">
                      <span data-notranslate
                        className="shrink-0 inline-flex items-center justify-center w-[62px] rounded-xl border border-slate-200 bg-slate-50 font-mono text-[12px] text-slate-600">
                        {'{{' + idx + '}}'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <select value={mapping[idx] || ''}
                          onChange={function (ev) { setMapping(Object.assign({}, mapping, { [idx]: ev.target.value })) }}
                          aria-label={'Field for variable ' + idx} className={CTRL}>
                          <option value="">Select a contact field…</option>
                          {MAPPABLE_FIELDS.map(function (f) { return <option key={f.value} value={f.value}>{f.label}</option> })}
                        </select>
                        <p className="text-[11px] text-slate-400 mt-1 truncate">{varLabel}</p>
                      </div>
                    </div>
                  )
                })}
              </StepCard>
            )}

            <StepCard n={scheduleStep} title="Schedule" icon="clock"
              hint="When the messages should leave.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { later: false, label: 'Send immediately', hint: 'Goes out when you press Send Campaign' },
                  { later: true, label: 'Schedule for later', hint: 'Queued until the date and time below' },
                ].map(function (opt) {
                  var on = scheduleLater === opt.later
                  return (
                    <button key={String(opt.later)} type="button"
                      onClick={function () { chooseScheduleLater(opt.later) }}
                      aria-pressed={on}
                      className={'text-left rounded-xl border px-3 py-2.5 transition-colors ' +
                        (on ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200 hover:border-slate-300')}>
                      <span className={'flex items-center gap-1.5 text-[12.5px] font-semibold ' + (on ? 'text-indigo-900' : 'text-slate-700')}>
                        <span className={'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border ' +
                          (on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-transparent')}>
                          <Icon name="check" size={8} strokeWidth={3.2} />
                        </span>
                        {opt.label}
                      </span>
                      <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{opt.hint}</span>
                    </button>
                  )
                })}
              </div>

              {scheduleLater && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                  {/* The app's own picker rather than the date half of
                      <input type="datetime-local">: the native control prints
                      mm/dd/yyyy or dd/mm/yyyy at the browser's whim, in its
                      own typeface, and no CSS changes either. Time stays
                      native — there is no in-app time picker, and a bare
                      HH:mm field is not the same eyesore. */}
                  <Labeled label="Date">
                    <EventDatePicker value={schedDate}
                      onChange={function (d) { setSchedParts(d, schedTime) }}
                      collapsible plain />
                  </Labeled>
                  <Labeled label="Time">
                    <input type="time" value={schedTime}
                      onChange={function (ev) { setSchedParts(schedDate || new Date().toISOString().substring(0, 10), ev.target.value) }}
                      aria-label="Scheduled time" className={CTRL + ' tabular-nums'} />
                  </Labeled>
                </div>
              )}
            </StepCard>
          </div>

          {/* sticky works here: the nearest scrolling ancestor is the pane
              above, and the column is an items-start grid child so it has
              room to travel. */}
          <div className="space-y-3 lg:sticky lg:top-0">
            {/* Disappears once all four gates are met — a checklist of ticks
                is just noise, and the Send button below becomes the subject */}
            {!(name && templateId && currentId && preview) && (
              <div className={CARD + ' p-3.5'}>
                <p className="text-[12px] font-bold text-slate-900 mb-2">Before you can send</p>
                <div className="space-y-1.5">
                  <CheckRow done={!!name} label="Name the campaign" hint="Step 1" />
                  <CheckRow done={!!templateId} label="Pick an approved template" hint="Step 2" />
                  <CheckRow done={!!currentId} label="Save the draft" hint="Save Draft, top right" />
                  <CheckRow done={!!preview} label="Preview the audience" hint="Refresh, below" />
                </div>
              </div>
            )}
            <div className={CARD + ' overflow-hidden'}>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100">
                <p className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
                  <span className="text-slate-900"><Icon name="chart" size={15} /></span>
                  Live Summary
                </p>
                <button onClick={refreshPreview} disabled={previewLoading || !currentId}
                  title={currentId ? 'Recount the audience' : 'Save the draft first'}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-bold text-indigo-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors">
                  <Icon name="refresh" size={12} />
                  {previewLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              <div className="p-3.5">
                {preview ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[30px] font-bold text-slate-900 leading-none tabular-nums" data-notranslate>{preview.recipient_count}</p>
                      <p className="text-[11.5px] text-slate-500 mt-1">reachable recipients</p>
                    </div>

                    {Object.keys(preview.breakdown_by_reason || {}).length > 0 && (
                      <div className="border-t border-slate-100 pt-2.5">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Excluded</p>
                        <div className="space-y-0.5">
                          {Object.keys(preview.breakdown_by_reason).map(function (reason) {
                            return (
                              <div key={reason} className="flex items-baseline justify-between gap-2 text-[12px]">
                                <span className="text-slate-600 capitalize truncate">{reason.replace(/_/g, ' ')}</span>
                                <span className="shrink-0 font-semibold text-slate-900 tabular-nums" data-notranslate>{preview.breakdown_by_reason[reason]}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {(preview.sample_renders || []).length > 0 && (
                      <div className="border-t border-slate-100 pt-2.5 space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Sample renders</p>
                        {preview.sample_renders.map(function (s, i) {
                          return (
                            <p key={i} className="text-[12px] text-slate-700 leading-snug bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2">
                              {s.rendered_body}
                            </p>
                          )
                        })}
                      </div>
                    )}

                    <button onClick={openSendConfirm} className={BTN_SEND + ' w-full'}>
                      <Icon name="send" size={14} />
                      Send Campaign
                    </button>
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-500 leading-snug">
                    Save the draft, then Refresh to count who this campaign would actually reach.
                  </p>
                )}
              </div>
            </div>

            {sendProgress && (
              <div className={CARD + ' px-3.5 py-3'}>
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-800">
                  <span className={sendProgress === 'sending' ? 'text-indigo-600' : 'text-emerald-600'}>
                    <Icon name={sendProgress === 'sending' ? 'refresh' : 'checkCircle'} size={15} />
                  </span>
                  {sendProgress === 'sending' ? 'Sending…' : 'Send complete'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Portalled to <body>: this one does have to cover the whole window,
          and from inside the shell's stacking context no z-index can reach
          over the sidebar. EventDatePicker's panel does the same. */}
      {confirmOpen && preview && createPortal((
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600">
                <Icon name="send" size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-slate-900 leading-tight">
                  Send to {preview.recipient_count} recipient{preview.recipient_count === 1 ? '' : 's'}?
                </p>
                <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">
                  Template: {selectedTemplate ? selectedTemplate.name : '—'}
                </p>
              </div>
            </div>

            {/* Sending cannot be taken back once the messages leave, so the
                confirm step shows what will actually go out rather than only
                a count. */}
            {(preview.sample_renders || []).slice(0, 3).map(function (s, i) {
              return (
                <p key={i} className="text-[12px] text-slate-700 leading-snug bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2">
                  {s.rendered_body}
                </p>
              )
            })}

            {preview.recipient_count > confirmThreshold && (
              <Labeled label={'Type SEND-' + currentId + ' to confirm'}
                hint="Typing it out is the guard on a large send — there is no undo.">
                <input type="text" value={confirmToken} onChange={function (ev) { setConfirmToken(ev.target.value) }}
                  placeholder={'SEND-' + currentId} className={CTRL + ' font-mono'} />
              </Labeled>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={function () { setConfirmOpen(false) }} className={BTN_GHOST + ' flex-1 h-10'}>
                Cancel
              </button>
              <button onClick={confirmSend}
                disabled={sending || (preview.recipient_count > confirmThreshold && confirmToken !== ('SEND-' + currentId))}
                className={BTN_SEND + ' flex-1'}>
                <Icon name="send" size={14} />
                {sending ? 'Sending…' : 'Confirm Send'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

export default CampaignBuilder
