import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// contact: { phone, name, external_ids?, venue_id? } — a not-yet-tracked lead/guest,
//   upserted into wa_contacts on open. OR pass contactId directly for an existing one.
function QuickSendDrawer({ contact, contactId, defaultTemplateId, onClose, onSent }) {
  var [resolvedContactId, setResolvedContactId] = useState(contactId || null)
  var [resolvedContact, setResolvedContact] = useState(null)
  var [venueName, setVenueName] = useState('')
  var [templates, setTemplates] = useState([])
  var [templateId, setTemplateId] = useState(defaultTemplateId ? String(defaultTemplateId) : '')
  var [compliance, setCompliance] = useState(null)
  var [phoneRevealed, setPhoneRevealed] = useState(false)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [sent, setSent] = useState(false)

  useEffect(function () {
    supabase.from('wa_templates').select('*').eq('sales_approved', true).eq('meta_status', 'approved')
      .then(function (res) { setTemplates(res.data || []) })
  }, [])

  useEffect(function () {
    async function resolve() {
      if (contactId) {
        var res = await supabase.from('wa_contacts').select('*').eq('id', contactId).maybeSingle()
        setResolvedContact(res.data); setResolvedContactId(contactId)
        return
      }
      if (contact && contact.phone) {
        var row = {
          phone: contact.phone, name: contact.name || null,
          source: contact.external_ids ? 'lms' : 'manual',
          external_ids: contact.external_ids || {},
        }
        var upRes = await supabase.rpc('rpc_wa_contact_upsert_bulk', { p_rows: [row] })
        if (upRes.error) { setError(upRes.error.message); return }
        var result = ((upRes.data || {}).results || [])[0]
        if (!result || result.status === 'skipped_invalid_phone') { setError('Invalid phone number for this contact'); return }
        setResolvedContactId(result.contact_id)
        var cRes = await supabase.from('wa_contacts').select('*').eq('id', result.contact_id).maybeSingle()
        setResolvedContact(cRes.data)
        if (contact.venue_id) {
          supabase.from('venues').select('name').eq('id', contact.venue_id).maybeSingle()
            .then(function (vRes) { if (vRes.data) setVenueName(vRes.data.name) })
        }
      }
    }
    resolve()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, contactId])

  var selectedTemplate = templates.find(function (t) { return String(t.id) === templateId })

  useEffect(function () {
    if (resolvedContactId && selectedTemplate) {
      supabase.rpc('fn_wa_can_send', { p_contact_id: resolvedContactId, p_template_category: selectedTemplate.category })
        .then(function (res) { setCompliance((res.data && res.data[0]) || null) })
    } else {
      setCompliance(null)
    }
  }, [resolvedContactId, templateId])

  function autoValues(template) {
    var values = {}
    ;(template.variable_labels || []).forEach(function (label, i) {
      var idx = String(i + 1)
      var key = (label || '').toLowerCase()
      if (key.indexOf('name') !== -1) values[idx] = (resolvedContact && resolvedContact.first_name) || ''
      else if (key.indexOf('venue') !== -1) values[idx] = venueName || ''
      else if (key.indexOf('phone') !== -1) values[idx] = (resolvedContact && resolvedContact.phone_e164) || ''
      else values[idx] = ''
    })
    return values
  }

  var previewBody = ''
  if (selectedTemplate) {
    previewBody = selectedTemplate.body_text
    var values = autoValues(selectedTemplate)
    Object.keys(values).forEach(function (k) { previewBody = previewBody.split('{{' + k + '}}').join(values[k] || ('[' + k + ']')) })
  }

  async function confirmSend() {
    if (saving || !selectedTemplate || !resolvedContactId) return
    if (compliance && !compliance.ok) return
    setSaving(true); setError('')
    var res = await supabase.rpc('rpc_wa_quick_send', {
      p_contact_id: resolvedContactId, p_template_id: selectedTemplate.id, p_variable_values: autoValues(selectedTemplate),
    })
    if (res.error) { setSaving(false); setError(res.error.message); return }
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    await supabase.functions.invoke('wa-send', { body: { message_id: res.data }, headers: token ? { Authorization: 'Bearer ' + token } : {} })
    setSaving(false)
    setSent(true)
    if (onSent) onSent()
    setTimeout(onClose, 2000)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:shadow-2xl sm:border-l sm:border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <button onClick={onClose} className="text-sm text-indigo-600 font-medium">← Close</button>
        <span className="text-sm font-bold text-gray-900">Send WhatsApp{resolvedContact ? ' to ' + (resolvedContact.name || '') : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {sent ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Sent!</p>
        ) : resolvedContact ? (
          <>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900">{resolvedContact.name || 'Unnamed'}</p>
              <p className="text-xs text-gray-500 font-mono cursor-pointer" onClick={function () { setPhoneRevealed(true) }}>
                {phoneRevealed ? resolvedContact.phone_e164 : (resolvedContact.phone_e164 || '').slice(0, 3) + '●●●●●●' + (resolvedContact.phone_e164 || '').slice(-2)}
                {!phoneRevealed && <span className="text-[10px] text-indigo-600 ml-2">tap to reveal</span>}
              </p>
              <span className="text-[10px] font-bold uppercase text-gray-400">{resolvedContact.source}</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Template</label>
              <select value={templateId} onChange={function (ev) { setTemplateId(ev.target.value) }}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
                <option value="">Select a template...</option>
                {templates.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
              </select>
            </div>

            {selectedTemplate && (
              <>
                {(selectedTemplate.variable_labels || []).length > 0 && (
                  <div className="text-xs text-gray-500 space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Auto-filled values</p>
                    {Object.entries(autoValues(selectedTemplate)).map(function (entry) {
                      return <p key={entry[0]}>{'{{' + entry[0] + '}}'}: {entry[1] || <em className="text-gray-300">empty</em>}</p>
                    })}
                  </div>
                )}
                <div className="bg-[#e5ddd5] rounded-lg p-2">
                  <div className="bg-white rounded-lg shadow-sm p-2">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{previewBody}</p>
                  </div>
                </div>
                {compliance && !compliance.ok && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Can't send: {compliance.reason.replace(/_/g, ' ')}</p>
                )}
                {compliance && compliance.ok && selectedTemplate.category === 'utility' && (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">Utility template — sends regardless of session window.</p>
                )}
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-400">Resolving contact...</p>
        )}
      </div>

      {!sent && selectedTemplate && (
        <div className="p-4 border-t border-gray-100 shrink-0">
          <button onClick={confirmSend} disabled={saving || !resolvedContactId || (compliance && !compliance.ok)}
            className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
            {saving ? 'Sending...' : 'Confirm & Send'}
          </button>
        </div>
      )}
    </div>
  )
}

export default QuickSendDrawer
