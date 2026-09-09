import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'

var CATEGORY_OPTIONS = ['marketing', 'utility', 'authentication']
var STATUS_CHIPS = ['all', 'draft', 'pending', 'approved', 'rejected', 'disabled', 'paused']

function emptyForm() {
  return {
    id: null, name: '', category: 'marketing', header_type: '', header_content: '',
    body_text: '', footer_text: '', buttons_text: '[]', variable_labels_text: '',
    sales_approved: false, meta_status: 'draft', meta_id: null, meta_rejection_reason: null,
  }
}

function countVars(bodyText) {
  var matches = (bodyText || '').match(/\{\{\d+\}\}/g)
  return matches ? matches.length : 0
}

function StatusChip({ value, active, onClick }) {
  return (
    <button onClick={onClick}
      className={"px-2.5 py-1 text-[11px] font-semibold rounded-md capitalize transition-colors " +
        (active ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:text-gray-800")}>
      {value}
    </button>
  )
}

function Templates({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canEdit = hasPerm(permsNew, 'broadcast.templates.edit')
  var canSubmit = hasPerm(permsNew, 'broadcast.templates.submit')

  var [templates, setTemplates] = useState([])
  var [loading, setLoading] = useState(true)
  var [statusFilter, setStatusFilter] = useState('all')
  var [categoryFilter, setCategoryFilter] = useState('')
  var [search, setSearch] = useState('')
  var [form, setForm] = useState(emptyForm)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [notice, setNotice] = useState('')

  function loadTemplates() {
    setLoading(true)
    supabase.from('wa_templates').select('*').order('updated_at', { ascending: false })
      .then(function (res) {
        if (!res.error) setTemplates(res.data || [])
        setLoading(false)
      })
  }

  useEffect(function () { loadTemplates() }, [])

  var filtered = templates.filter(function (t) {
    if (statusFilter !== 'all' && t.meta_status !== statusFilter) return false
    if (categoryFilter && t.category !== categoryFilter) return false
    if (search && t.name.toLowerCase().indexOf(search.toLowerCase()) === -1) return false
    return true
  })

  function openTemplate(t) {
    setError(''); setNotice('')
    setForm({
      id: t.id, name: t.name, category: t.category,
      header_type: t.header_type || '', header_content: t.header_content || '',
      body_text: t.body_text || '', footer_text: t.footer_text || '',
      buttons_text: JSON.stringify(t.buttons_json || [], null, 2),
      variable_labels_text: (t.variable_labels || []).join(', '),
      sales_approved: !!t.sales_approved,
      meta_status: t.meta_status, meta_id: t.meta_id, meta_rejection_reason: t.meta_rejection_reason,
    })
  }

  function openNew() {
    setError(''); setNotice('')
    setForm(emptyForm())
  }

  function duplicateTemplate() {
    setForm(Object.assign({}, form, { id: null, name: form.name + '_copy', meta_status: 'draft', meta_id: null, meta_rejection_reason: null }))
    setNotice('Duplicated as a new draft — give it a unique name before saving.')
  }

  var isLocked = form.id && form.meta_status !== 'draft' && form.meta_status !== 'rejected'

  async function saveDraft() {
    if (saving) return
    setSaving(true); setError(''); setNotice('')
    var buttonsJson
    try { buttonsJson = JSON.parse(form.buttons_text || '[]') }
    catch (e) { setSaving(false); setError('Buttons JSON is invalid: ' + e.message); return }

    var payload = {
      id: form.id, name: form.name, language: 'en', category: form.category,
      header_type: form.header_type || null, header_content: form.header_content || null,
      body_text: form.body_text, footer_text: form.footer_text || null,
      buttons_json: buttonsJson,
      variable_labels: form.variable_labels_text.split(',').map(function (s) { return s.trim() }).filter(Boolean),
      sales_approved: form.sales_approved,
    }

    var res = await supabase.rpc('rpc_wa_template_upsert', { p_template: payload })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setNotice('Draft saved.')
    loadTemplates()
    var newId = res.data
    supabase.from('wa_templates').select('*').eq('id', newId).maybeSingle().then(function (r) {
      if (r.data) openTemplate(r.data)
    })
  }

  async function submitToMeta() {
    if (saving || !form.id) return
    setSaving(true); setError(''); setNotice('')

    var flipRes = await supabase.rpc('rpc_wa_template_submit', { p_template_id: form.id })
    if (flipRes.error) { setSaving(false); setError(flipRes.error.message); return }

    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var callRes = await supabase.functions.invoke('wa-template-meta', {
      body: { action: 'submit', template_id: form.id },
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    setSaving(false)
    if (callRes.error) { setError('Submitted, but Meta call failed: ' + callRes.error.message); loadTemplates(); return }
    setNotice('Submitted to Meta for review.')
    loadTemplates()
    supabase.from('wa_templates').select('*').eq('id', form.id).maybeSingle().then(function (r) { if (r.data) openTemplate(r.data) })
  }

  async function syncStatus() {
    if (saving || !form.id) return
    setSaving(true); setError(''); setNotice('')
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var callRes = await supabase.functions.invoke('wa-template-meta', {
      body: { action: 'sync', template_id: form.id },
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    setSaving(false)
    if (callRes.error) { setError(callRes.error.message); return }
    setNotice('Status refreshed from Meta.')
    loadTemplates()
    supabase.from('wa_templates').select('*').eq('id', form.id).maybeSingle().then(function (r) { if (r.data) openTemplate(r.data) })
  }

  function insertVariable() {
    var n = countVars(form.body_text) + 1
    setForm(Object.assign({}, form, { body_text: form.body_text + ' {{' + n + '}}' }))
  }

  var previewBody = form.body_text
  var labels = form.variable_labels_text.split(',').map(function (s) { return s.trim() }).filter(Boolean)
  for (var i = 0; i < labels.length; i++) {
    previewBody = previewBody.split('{{' + (i + 1) + '}}').join('[' + labels[i] + ']')
  }
  previewBody = previewBody.replace(/\{\{\d+\}\}/g, function (m) { return '[var' + m.replace(/\D/g, '') + ']' })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_260px] gap-4">
      {/* Library */}
      <div className="space-y-3">
        {canEdit && (
          <button onClick={openNew} className="w-full py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg">+ New Template</button>
        )}
        <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
          placeholder="Search templates..." className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_CHIPS.map(function (s) {
            return <StatusChip key={s} value={s} active={statusFilter === s} onClick={function () { setStatusFilter(s) }} />
          })}
        </div>
        <select value={categoryFilter} onChange={function (ev) { setCategoryFilter(ev.target.value) }}
          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option> })}
        </select>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {loading ? <p className="text-center text-xs text-gray-400 py-6">Loading...</p>
            : filtered.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">No templates</p>
            : filtered.map(function (t) {
              return (
                <div key={t.id} onClick={function () { openTemplate(t) }}
                  className={"px-3 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-indigo-50/40 " + (form.id === t.id ? "bg-indigo-50" : "")}>
                  <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                  <p className="text-[10px] text-gray-400 capitalize">{t.category} · {t.meta_status}</p>
                </div>
              )
            })}
        </div>
      </div>

      {/* Editor */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}
        {isLocked && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This template is {form.meta_status} on Meta — content is locked. Duplicate it to make changes.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Name (snake_case)</label>
            <input type="text" disabled={!canEdit || isLocked} value={form.name}
              onChange={function (ev) { setForm(Object.assign({}, form, { name: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Category</label>
            <select disabled={!canEdit || isLocked} value={form.category}
              onChange={function (ev) { setForm(Object.assign({}, form, { category: ev.target.value })) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white disabled:bg-gray-50" style={{ fontSize: '16px' }}>
              {CATEGORY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option> })}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Header type</label>
            <select disabled={!canEdit || isLocked} value={form.header_type}
              onChange={function (ev) { setForm(Object.assign({}, form, { header_type: ev.target.value })) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white disabled:bg-gray-50" style={{ fontSize: '16px' }}>
              <option value="">None</option>
              <option value="text">Text</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="document">Document</option>
            </select>
          </div>
          {form.header_type && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Header content</label>
              <input type="text" disabled={!canEdit || isLocked} value={form.header_content}
                onChange={function (ev) { setForm(Object.assign({}, form, { header_content: ev.target.value })) }}
                placeholder={form.header_type === 'text' ? 'Header text' : 'Storage path / URL'}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-gray-400 uppercase">Body</label>
            {canEdit && !isLocked && (
              <button onClick={insertVariable} className="text-[11px] font-bold text-indigo-600">+ Insert variable</button>
            )}
          </div>
          <textarea disabled={!canEdit || isLocked} value={form.body_text} rows={5}
            onChange={function (ev) { setForm(Object.assign({}, form, { body_text: ev.target.value })) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
          <p className="text-[10px] text-gray-400 mt-1">{countVars(form.body_text)} variable{countVars(form.body_text) !== 1 ? 's' : ''} — use {'{{1}}'}, {'{{2}}'}, ...</p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Variable labels (comma-separated, in order)</label>
          <input type="text" disabled={!canEdit || isLocked} value={form.variable_labels_text}
            onChange={function (ev) { setForm(Object.assign({}, form, { variable_labels_text: ev.target.value })) }}
            placeholder="name, venue" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Footer (optional)</label>
          <input type="text" disabled={!canEdit || isLocked} value={form.footer_text}
            onChange={function (ev) { setForm(Object.assign({}, form, { footer_text: ev.target.value })) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Buttons (JSON array)</label>
          <textarea disabled={!canEdit || isLocked} value={form.buttons_text} rows={3}
            onChange={function (ev) { setForm(Object.assign({}, form, { buttons_text: ev.target.value })) }}
            placeholder='[{"type":"quick_reply","text":"Yes"}]'
            className="w-full px-2 py-1.5 text-xs font-mono border border-gray-200 rounded-md disabled:bg-gray-50" style={{ fontSize: '16px' }} />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" disabled={!canEdit} checked={form.sales_approved}
            onChange={function (ev) { setForm(Object.assign({}, form, { sales_approved: ev.target.checked })) }} />
          Available in Sales Quick Send
        </label>

        {form.meta_rejection_reason && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Meta rejected: {form.meta_rejection_reason}</p>
        )}

        <p className="text-[10px] text-gray-400">Meta typically reviews new templates within a few minutes to 24 hours.</p>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {canEdit && !isLocked && (
            <button onClick={saveDraft} disabled={saving || !form.name || !form.body_text}
              className="px-3 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Save Draft</button>
          )}
          {canSubmit && form.id && (form.meta_status === 'draft' || form.meta_status === 'rejected') && (
            <button onClick={submitToMeta} disabled={saving}
              className="px-3 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 rounded-lg disabled:opacity-50">Submit to Meta</button>
          )}
          {form.id && form.meta_status === 'pending' && (
            <button onClick={syncStatus} disabled={saving}
              className="px-3 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg disabled:opacity-50">Sync Status</button>
          )}
          {canEdit && form.id && (
            <button onClick={duplicateTemplate} className="px-3 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg">Duplicate</button>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold text-gray-400 uppercase">Preview</p>
        <div className="bg-[#e5ddd5] rounded-xl p-3">
          <div className="bg-white rounded-lg shadow-sm p-3 space-y-1.5 max-w-full">
            {form.header_type === 'text' && form.header_content && (
              <p className="text-sm font-bold text-gray-900">{form.header_content}</p>
            )}
            {form.header_type && form.header_type !== 'text' && (
              <div className="w-full h-24 bg-gray-100 rounded flex items-center justify-center text-[10px] text-gray-400 uppercase">{form.header_type}</div>
            )}
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{previewBody || 'Body text preview...'}</p>
            {form.footer_text && <p className="text-xs text-gray-400">{form.footer_text}</p>}
            {(function () {
              var btns = []
              try { btns = JSON.parse(form.buttons_text || '[]') } catch (e) { btns = [] }
              return btns.length > 0 && (
                <div className="pt-1 space-y-1 border-t border-gray-100 mt-1">
                  {btns.map(function (b, i) {
                    return <div key={i} className="text-center text-xs text-indigo-600 font-medium py-1">{b.text}</div>
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Templates
