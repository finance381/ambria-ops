import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import Icon from '../../components/ui/Icon'

var CATEGORY_OPTIONS = ['marketing', 'utility', 'authentication']
var STATUS_CHIPS = ['all', 'draft', 'pending', 'approved', 'rejected', 'disabled', 'paused']

// The three button kinds WhatsApp accepts on a template, and the extra field
// each one needs. `key` is what goes in the stored JSON, so it has to keep
// matching what the send path and Meta expect.
var BUTTON_KINDS = [
  { key: 'quick_reply', label: 'Quick reply', icon: 'undo', hint: 'Sends the button text back as a reply' },
  { key: 'url', label: 'Visit website', icon: 'link', field: 'url', placeholder: 'https://…', hint: 'Opens a link' },
  { key: 'phone_number', label: 'Call phone number', icon: 'user', field: 'phone_number', placeholder: '+91…', hint: 'Starts a call' },
]
var MAX_BUTTONS = 10

// WhatsApp template header media limits (Meta's current published specs) — shown next
// to the upload button so nobody has to go look these up mid-upload.
var HEADER_ACCEPT = { image: 'image/jpeg,image/png', video: 'video/mp4,video/3gpp', document: 'application/pdf' }
var HEADER_MAX_BYTES = { image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, document: 100 * 1024 * 1024 }
var HEADER_SPEC_TEXT = {
  image: 'JPEG or PNG, max 5 MB. Landscape ~1.91:1 (e.g. 1200×628) previews best — WhatsApp doesn\'t hard-enforce a resolution.',
  video: 'MP4 or 3GPP, H.264 video + AAC audio, max 16 MB.',
  document: 'PDF only for template headers, max 100 MB — keep it small (a few MB) for a fast preview.',
}

// From lg up the three columns each own their height and scroll internally,
// so the page itself never moves. Sticky was the earlier attempt and is gone:
// with the page fixed there is nothing to stick to.
//
// min-h-0 on every one of them — a grid item defaults to min-height:auto,
// which refuses to shrink below its content and would push the page into
// scrolling no matter what overflow says.
var SCROLL_COL = 'lg:h-full lg:min-h-0 lg:overflow-y-auto ambria-thin-scroll'

// The preview column instead fits itself to the available height: the phone
// mock is the flexible part and everything else keeps its natural size. No
// scrollbar, and the preview never travels out of sight while you type.
var FIXED_COL = 'flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden'

// WhatsApp's doodle wallpaper, drawn rather than downloaded.
//
// A 160px SVG tile of outline doodles — plane, heart, speech bubble, star,
// smiley, camera, music note — encoded as a data URI so it repeats natively
// as a background-image. No network request, no cache to go stale, and it
// stays crisp at any zoom. The earlier version used four blurred radial
// blobs, which at preview size read as smudges rather than a pattern.
//
// %23 is a literal # — an unescaped hash truncates a data URI at the colour.
var DOODLE = [
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>",
  "<g fill='none' stroke='%23c9c0b2' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.75'>",
  // paper plane
  "<path d='M10 26 L34 14 L26 38 L21 29 Z'/><path d='M21 29 L34 14'/>",
  // heart
  "<path d='M76 24c-2.6-3.4-8.6-1.7-8.6 3.4 0 4.3 8.6 9.4 8.6 9.4s8.6-5.1 8.6-9.4c0-5.1-6-6.8-8.6-3.4z'/>",
  // star
  "<path d='M126 12 l3.2 6.9 7.6 1-5.5 5.3 1.3 7.5-6.6-3.6-6.6 3.6 1.3-7.5-5.5-5.3 7.6-1z'/>",
  // speech bubble with three dots
  "<path d='M96 62h30a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5h-18l-8 7v-7h-4a5 5 0 0 1-5-5V67a5 5 0 0 1 5-5z'/>",
  "<circle cx='105' cy='74' r='1.6'/><circle cx='112' cy='74' r='1.6'/><circle cx='119' cy='74' r='1.6'/>",
  // smiley
  "<circle cx='30' cy='78' r='13'/><circle cx='25' cy='74' r='1.6'/><circle cx='35' cy='74' r='1.6'/><path d='M24 83a8 8 0 0 0 12 0'/>",
  // camera
  "<path d='M20 122h6l3-4h12l3 4h6a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4v-18a4 4 0 0 1 4-4z'/><circle cx='35' cy='135' r='7'/>",
  // music note
  "<path d='M104 148v-24l18-4v24'/><ellipse cx='99' cy='148' rx='5' ry='4'/><ellipse cx='117' cy='144' rx='5' ry='4'/>",
  // small plane, rotated, bottom right
  "<path d='M138 104 l14 6 -13 5 -2 -5 Z'/>",
  '</g></svg>',
].join('')

var CHAT_BG = {
  backgroundColor: '#e5ddd5',
  backgroundImage: 'url("data:image/svg+xml,' + DOODLE + '")',
  backgroundSize: '160px 160px',
}

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

// The distinct {{n}} placeholders in the body, in numeric order. The labels
// are stored positionally (a comma-separated string, index 0 = {{1}}), so the
// UI has to know which numbers exist before it can put a row against each.
// Repeats collapse: {{1}} used twice is still one variable with one label.
function bodyVarNums(bodyText) {
  var out = []
  var found = (bodyText || '').match(/\{\{\d+\}\}/g) || []
  found.forEach(function (tok) {
    var n = tok.replace(/\D/g, '')
    if (out.indexOf(n) === -1) out.push(n)
  })
  return out.sort(function (a, b) { return Number(a) - Number(b) })
}

function StatusChip({ value, count, active, onClick }) {
  return (
    <button onClick={onClick}
      className={"flex w-full items-center justify-between gap-1.5 h-8 pl-2.5 pr-1.5 text-[11.5px] font-semibold rounded-xl capitalize transition-colors border " +
        (active
          ? "bg-slate-900 border-slate-900 text-white"
          : "bg-white border-slate-200 text-slate-700 hover:border-slate-300")}>
      {value}
      {/* The count sits in its own pill rather than trailing the label as
          bare text: at 11px a lone digit beside a word reads as part of it
          ("Draft 0"), and it has to stay legible on the dark active chip. */}
      <span data-notranslate
        className={"inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10.5px] font-bold tabular-nums " +
          (active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500")}>
        {count}
      </span>
    </button>
  )
}

// Label with its glyph, then the control, then one line saying what the
// field wants. The editor had bare 10px caps labels and no guidance at all,
// so "Name (snake_case)" was the only hint anywhere on the form.
function Field({ icon, label, hint, required, children, right, tall, bareField, below }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
          <span className="shrink-0 text-slate-900"><Icon name={icon} size={13} /></span>
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
        {right}
      </div>
      <div className="relative">
        {/* `tall` pins the glyph to the first line instead of centring it —
            a textarea centred icon floats in the middle of an empty box.
            `bareField` drops the gutter glyph where the value itself is
            already punctuation: {} sitting immediately before [] read as one
            mangled token. */}
        {!bareField && (
          <>
            {/* The gutter gets its own tint, so it reads as part of the field
                furniture rather than empty space someone forgot to fill.
                Inset by 1px and with an 11px radius so it sits inside the
                control's 1px border and 12px corner instead of over them. */}
            <span aria-hidden="true"
              className="pointer-events-none absolute left-px top-px bottom-px w-[34px] rounded-l-[11px] bg-slate-50" />
            <span className={"pointer-events-none absolute left-3 z-10 text-slate-400 " +
              (tall ? "top-[9px]" : "top-1/2 -translate-y-1/2")}>
              <Icon name={icon} size={14} />
            </span>
            {/* Full height on every control, textarea included: a stub of a
                rule beside a tall box reads as a stray mark, while the full
                run makes the gutter a column of the field. The glyph still
                sits on the first line. */}
            <span aria-hidden="true"
              className="pointer-events-none absolute left-[34px] top-1.5 bottom-1.5 z-10 w-px bg-slate-200" />
          </>
        )}
        {children}
      </div>
      {below}
      {hint && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

// pl-11 clears the gutter Field draws its glyph and divider in.
var CTRL = "block w-full pl-11 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-[16px] sm:text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow disabled:bg-slate-50 disabled:text-slate-500"
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
  var [btnMenu, setBtnMenu] = useState(false)
  var [uploadingMedia, setUploadingMedia] = useState(false)
  var [mediaUploadError, setMediaUploadError] = useState('')

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

  async function handleMediaUpload(file) {
    if (!file) return
    setMediaUploadError('')
    var maxBytes = HEADER_MAX_BYTES[form.header_type]
    if (maxBytes && file.size > maxBytes) {
      setMediaUploadError('Too large — max ' + Math.round(maxBytes / (1024 * 1024)) + ' MB for a ' + form.header_type + ' header.')
      return
    }
    setUploadingMedia(true)
    var ext = ((file.name || '').split('.').pop() || 'bin').toLowerCase()
    var path = form.header_type + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
    var { error: upErr } = await supabase.storage.from('broadcast-media').upload(path, file, { upsert: true })
    setUploadingMedia(false)
    if (upErr) { setMediaUploadError('Upload failed: ' + upErr.message); return }
    var publicUrl = supabase.storage.from('broadcast-media').getPublicUrl(path).data?.publicUrl
    setForm(Object.assign({}, form, { header_content: publicUrl || path }))
  }

  function duplicateTemplate() {
    setForm(Object.assign({}, form, { id: null, name: form.name + '_copy', meta_status: 'draft', meta_id: null, meta_rejection_reason: null }))
    setNotice('Duplicated as a new draft — give it a unique name before saving.')
  }

  var isLocked = form.id && form.meta_status !== 'draft' && form.meta_status !== 'rejected'

  // buttons_text stays the single source of truth — it is what saveDraft
  // parses — so the builder reads and rewrites that string rather than
  // keeping a parallel array that could drift from it.
  function parseButtons() {
    try {
      var arr = JSON.parse(form.buttons_text || '[]')
      return Array.isArray(arr) ? arr : null
    } catch { return null }
  }
  function writeButtons(arr) {
    setForm(Object.assign({}, form, { buttons_text: JSON.stringify(arr, null, 2) }))
  }
  function addButton(kind) {
    var arr = parseButtons() || []
    if (arr.length >= MAX_BUTTONS) return
    var next = { type: kind.key, text: '' }
    if (kind.field) next[kind.field] = ''
    writeButtons(arr.concat([next]))
    setBtnMenu(false)
  }
  function updateButton(i, patch) {
    var arr = parseButtons()
    if (!arr) return
    writeButtons(arr.map(function (b, j) { return j === i ? Object.assign({}, b, patch) : b }))
  }
  function removeButton(i) {
    var arr = parseButtons()
    if (!arr) return
    writeButtons(arr.filter(function (_b, j) { return j !== i }))
  }

  // variable_labels_text stays the stored shape (saveDraft splits it on
  // commas), so each row edits one position in that string rather than the
  // whole thing. A typed comma is dropped: it would silently split one label
  // into two and shift every label after it onto the wrong variable.
  function setLabelAt(i, val) {
    var arr = (form.variable_labels_text || '').split(',').map(function (x) { return x.trim() })
    while (arr.length <= i) arr.push('')
    arr[i] = val.replace(/,/g, '')
    while (arr.length && arr[arr.length - 1] === '') arr.pop()
    setForm(Object.assign({}, form, { variable_labels_text: arr.join(', ') }))
  }

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

  // The preview shows what the message will read like, so a labelled
  // placeholder is replaced by the label on its own. Bracketing it put
  // punctuation in the preview that will not be in the sent message.
  //
  // A placeholder with no label keeps its {{n}} token: that is literally
  // what would go out if nothing filled it, and inventing a name for it
  // would hide the gap rather than show it.
  var previewBody = form.body_text
  var labels = form.variable_labels_text.split(',').map(function (s) { return s.trim() })
  for (var i = 0; i < labels.length; i++) {
    if (!labels[i]) continue
    previewBody = previewBody.split('{{' + (i + 1) + '}}').join(labels[i])
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr_268px] gap-4 items-start lg:h-full">
      {/* Library */}
      <div className={SCROLL_COL + " bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)] flex flex-col"}>
        <div>
          <p className="font-display text-[15px] font-extrabold text-slate-900 leading-tight tracking-[-0.01em]">Templates</p>
          <p className="text-[11.5px] text-slate-500 leading-snug">Manage your message templates</p>
        </div>

        {canEdit && (
          <button onClick={openNew}
            className="w-full inline-flex items-center justify-center gap-1.5 h-10 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.99] shadow-[0_2px_8px_rgba(79,70,229,0.30)] transition-all">
            <Icon name="plus" size={15} strokeWidth={2.4} />
            New Template
          </button>
        )}

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon name="search" size={14} />
          </span>
          <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
            placeholder="Search templates..." aria-label="Search templates"
            className="w-full h-9 pl-8 pr-3 bg-white border border-slate-300 rounded-xl text-[16px] sm:text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
            />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {STATUS_CHIPS.map(function (st) {
            var n = st === 'all' ? templates.length : templates.filter(function (t) { return t.meta_status === st }).length
            return <StatusChip key={st} value={st} count={n} active={statusFilter === st} onClick={function () { setStatusFilter(st) }} />
          })}
        </div>

        <select value={categoryFilter} onChange={function (ev) { setCategoryFilter(ev.target.value) }}
          aria-label="Filter by category"
          className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl text-[16px] sm:text-[12.5px] text-slate-900 capitalize focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option> })}
        </select>

        <div className="border border-slate-200 rounded-xl overflow-hidden flex-1 min-h-[140px]">
          {loading ? (
            <p className="text-center text-[12px] text-slate-400 py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-7 text-center">
              <span className="inline-flex w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 items-center justify-center mb-2">
                <Icon name="fileText" size={19} />
              </span>
              <p className="text-[13px] font-semibold text-slate-700">No templates yet</p>
              <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">
                {templates.length === 0 ? 'Create your first template to get started with API marketing' : 'Nothing matches these filters'}
              </p>
            </div>
          ) : filtered.map(function (t) {
            var on = form.id === t.id
            return (
              <button key={t.id} type="button" onClick={function () { openTemplate(t) }}
                className={"w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 transition-colors " +
                  (on ? "bg-indigo-50" : "hover:bg-slate-50")}>
                <p className={"text-[13px] font-semibold truncate " + (on ? "text-indigo-900" : "text-slate-900")}>{t.name}</p>
                <p className="text-[10.5px] text-slate-400 capitalize">{t.category} · {t.meta_status}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Editor */}
      <div className={SCROLL_COL + " bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]"}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <span className="shrink-0 w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
            <Icon name="fileText" size={17} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-extrabold text-slate-900 leading-tight tracking-[-0.01em]">{form.id ? 'Edit Template' : 'Create Template'}</p>
            <p className="text-[11.5px] text-slate-500 leading-snug">Define your message content and settings</p>
          </div>
        </div>
        <div className="px-4 pb-4 space-y-3.5">
        {error && <p className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {notice && <p className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}
        {isLocked && (
          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            This template is {form.meta_status} on Meta — content is locked. Duplicate it to make changes.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field icon="fileText" label="Template Name" required hint="Use uppercase letters, numbers and underscores">
            <input type="text" disabled={!canEdit || isLocked} value={form.name}
              placeholder="Enter template name (SNAKE_CASE)"
              onChange={function (ev) { setForm(Object.assign({}, form, { name: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })) }}
              className={CTRL} />
          </Field>
          <Field icon="tag" label="Category" hint="Choose a relevant category">
            <select disabled={!canEdit || isLocked} value={form.category}
              onChange={function (ev) { setForm(Object.assign({}, form, { category: ev.target.value })) }}
              className={CTRL + ' capitalize'}>
              {CATEGORY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option> })}
            </select>
          </Field>
        </div>

        <div className={form.header_type ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : ""}>
          <Field icon="gallery" label="Header Type" hint="Select header type for your template">
            <select disabled={!canEdit || isLocked} value={form.header_type}
              onChange={function (ev) { setMediaUploadError(''); setForm(Object.assign({}, form, { header_type: ev.target.value, header_content: '' })) }}
              className={CTRL}>
              <option value="">None</option>
              <option value="text">Text</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="document">Document</option>
            </select>
          </Field>
          {form.header_type === 'text' && (
            <Field icon="edit" label="Header Content" hint="Shown in bold above the body">
              <input type="text" disabled={!canEdit || isLocked} value={form.header_content}
                onChange={function (ev) { setForm(Object.assign({}, form, { header_content: ev.target.value })) }}
                placeholder="Header text"
                className={CTRL} />
            </Field>
          )}
          {form.header_type && form.header_type !== 'text' && (
            <Field icon="paperclip" label="Header Content" bareField hint={HEADER_SPEC_TEXT[form.header_type]}>
              <div className="flex items-center gap-2">
                <label className={"inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-bold whitespace-nowrap transition-colors " +
                  ((!canEdit || isLocked || uploadingMedia) ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 cursor-pointer")}>
                  <Icon name="paperclip" size={13} />
                  {uploadingMedia ? 'Uploading…' : 'Upload ' + form.header_type}
                  <input type="file" className="hidden" disabled={!canEdit || isLocked || uploadingMedia}
                    accept={HEADER_ACCEPT[form.header_type]}
                    onChange={function (ev) { handleMediaUpload(ev.target.files[0]); ev.target.value = '' }} />
                </label>
                {form.header_content && (
                  <span className="text-[12px] text-slate-500 truncate flex-1">{form.header_content.split('/').pop()}</span>
                )}
                {form.header_content && canEdit && !isLocked && (
                  <button type="button" onClick={function () { setForm(Object.assign({}, form, { header_content: '' })) }}
                    className="text-[12px] font-semibold text-red-500 hover:text-red-700 shrink-0">Remove</button>
                )}
              </div>
              {mediaUploadError && <p className="text-[11.5px] text-red-600 mt-1">{mediaUploadError}</p>}
            </Field>
          )}
        </div>

        <Field icon="typography" label="Body" required tall
          right={canEdit && !isLocked && (
            <button onClick={insertVariable} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
              <Icon name="plus" size={12} strokeWidth={2.4} />
              Insert variable
            </button>
          )}
          below={(
            <div className="flex items-start justify-between gap-3 mt-1">
              <p className="text-[11px] text-slate-400 leading-snug">{countVars(form.body_text)} variable{countVars(form.body_text) !== 1 ? 's' : ''} — use {'{{1}}'}, {'{{2}}'}, …</p>
              <p className="shrink-0 text-[11px] tabular-nums text-slate-400" data-notranslate>{(form.body_text || '').length + '/1024'}</p>
            </div>
          )}>
          <textarea disabled={!canEdit || isLocked} value={form.body_text} rows={3} maxLength={1024}
            placeholder="Type your message here..."
            onChange={function (ev) { setForm(Object.assign({}, form, { body_text: ev.target.value })) }}
            className={CTRL + ' resize-y'} />
        </Field>

        {/* One row per placeholder in the body, not one comma-separated box.
            The old field made the order implicit — you had to count {{n}} in
            the body and keep your labels in the same sequence, and inserting
            one in the middle silently reassigned every label after it. */}
        {(function () {
          var nums = bodyVarNums(form.body_text)
          var labels = (form.variable_labels_text || '').split(',').map(function (x) { return x.trim() })
          var locked = !canEdit || isLocked
          return (
            <div>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
                <span className="shrink-0 text-slate-900"><Icon name="list" size={13} /></span>
                Variable Labels
                <span className="font-normal text-slate-400">· Optional</span>
              </p>

              {nums.length === 0 ? (
                <p className="text-[11px] text-slate-400 leading-snug mt-1">
                  Add {'{{1}}'}, {'{{2}}'} … to the body and a row will appear here for each one.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 leading-snug mt-1">
                    Name each placeholder so whoever sends this template knows what to fill in.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {nums.map(function (n, i) {
                      return (
                        <div key={n} className="flex items-stretch gap-2">
                          <span className="shrink-0 inline-flex items-center justify-center w-[74px] rounded-xl border border-slate-200 bg-slate-50 font-mono text-[12px] text-slate-600"
                            data-notranslate>
                            {'{{' + n + '}}'}
                          </span>
                          <input type="text" disabled={locked}
                            value={labels[i] || ''}
                            onChange={function (ev) { setLabelAt(i, ev.target.value) }}
                            aria-label={'Label for variable ' + n}
                            placeholder="e.g. name"
                            className={CTRL.replace('pl-11', 'pl-3')} />
                        </div>
                      )
                    })}
                  </div>
                  {labels.length > nums.length && (
                    // Labels left over from a body that has since lost a
                    // placeholder — say so rather than dropping them quietly.
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-700 mt-1.5">
                      <span className="shrink-0 mt-px"><Icon name="alert" size={12} /></span>
                      <span>{(labels.length - nums.length) + ' extra label(s) are stored for placeholders the body no longer uses. They will be saved as-is.'}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })()}

        <Field icon="link" label="Footer (Optional)">
          <input type="text" disabled={!canEdit || isLocked} value={form.footer_text}
            onChange={function (ev) { setForm(Object.assign({}, form, { footer_text: ev.target.value })) }}
            placeholder="Add footer text..." className={CTRL} />
        </Field>

        {/* Buttons are built, not typed. Asking for a JSON array meant
            knowing the shape Meta wants and getting the quoting right, and a
            typo failed at save with a parser message. */}
        {(function () {
          var btns = parseButtons()
          var locked = !canEdit || isLocked

          // Hand-edited JSON that no longer parses: show it as text so the
            // work is not silently thrown away by rendering an empty builder.
          if (btns === null) {
            return (
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 mb-1">
                  <span className="shrink-0 text-slate-900"><Icon name="braces" size={13} /></span>
                  Buttons
                </p>
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">
                  <span className="shrink-0 mt-px"><Icon name="alert" size={13} /></span>
                  <span>The buttons on this template are not valid JSON, so the builder cannot show them. Fix or clear the text below.</span>
                </p>
                <textarea disabled={locked} value={form.buttons_text} rows={3}
                  onChange={function (ev) { setForm(Object.assign({}, form, { buttons_text: ev.target.value })) }}
                  className={CTRL.replace('pl-11', 'pl-3') + ' font-mono text-[16px] sm:text-[12px] resize-y'} />
              </div>
            )
          }

          return (
            <div>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
                <span className="shrink-0 text-slate-900"><Icon name="braces" size={13} /></span>
                Buttons
                <span className="font-normal text-slate-400">· Optional</span>
              </p>
              <p className="text-[11px] text-slate-500 leading-snug mt-1">
                Create buttons that let customers respond to your message or take action.
                You can add up to ten buttons. If you add more than three buttons, they will appear in a list.
              </p>

              {!locked && (
                <div className="relative inline-block mt-2.5">
                  <button type="button"
                    onClick={function () { setBtnMenu(!btnMenu) }}
                    disabled={btns.length >= MAX_BUTTONS}
                    className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 transition-all">
                    <Icon name="plus" size={14} strokeWidth={2.4} />
                    Add button
                    <Icon name="chevronDown" size={13} />
                  </button>
                  {btnMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={function () { setBtnMenu(false) }} />
                      <div className="absolute left-0 top-full mt-1 z-20 w-64 py-1 bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] overflow-hidden">
                        {BUTTON_KINDS.map(function (k) {
                          return (
                            <button key={k.key} type="button" onClick={function () { addButton(k) }}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-slate-50 transition-colors">
                              <span className="shrink-0 w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
                                <Icon name={k.icon} size={12} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold text-slate-900 leading-tight">{k.label}</span>
                                <span className="block text-[11px] text-slate-500 leading-tight truncate">{k.hint}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                  {btns.length >= MAX_BUTTONS && (
                    <span className="ml-2 text-[11px] text-slate-400">Ten is the maximum</span>
                  )}
                </div>
              )}

              {btns.length > 0 && (
                <div className="mt-2.5 space-y-2">
                  {btns.map(function (b, i) {
                    var kind = BUTTON_KINDS.find(function (k) { return k.key === b.type }) || BUTTON_KINDS[0]
                    return (
                      <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-lg bg-white border border-slate-200 text-[10.5px] font-bold text-slate-600">
                            <Icon name={kind.icon} size={11} />
                            {kind.label}
                          </span>
                          <span className="text-[10.5px] text-slate-400 truncate">{kind.hint}</span>
                          {!locked && (
                            <button type="button" onClick={function () { removeButton(i) }}
                              aria-label={"Remove button " + (i + 1)} title="Remove"
                              className="ml-auto shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-600 hover:bg-red-50 transition-colors">
                              <Icon name="trash" size={13} />
                            </button>
                          )}
                        </div>
                        <div className={kind.field ? "grid grid-cols-1 sm:grid-cols-2 gap-2" : ""}>
                          <input type="text" disabled={locked} value={b.text || ''} maxLength={25}
                            placeholder="Button text (max 25)"
                            onChange={function (ev) { updateButton(i, { text: ev.target.value }) }}
                            className={CTRL.replace('pl-11', 'pl-3')} />
                          {kind.field && (
                            <input type="text" disabled={locked} value={b[kind.field] || ''}
                              placeholder={kind.placeholder}
                              onChange={function (ev) { var patch = {}; patch[kind.field] = ev.target.value; updateButton(i, patch) }}
                              className={CTRL.replace('pl-11', 'pl-3')} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        <label className="flex items-center gap-2.5 text-[13px] text-slate-700">
          <input type="checkbox" disabled={!canEdit} checked={form.sales_approved}
            onChange={function (ev) { setForm(Object.assign({}, form, { sales_approved: ev.target.checked })) }}
            className="w-4 h-4 rounded accent-indigo-600" />
          Available in Sales Quick Send
        </label>

        {form.meta_rejection_reason && (
          <p className="flex items-start gap-1.5 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <span className="shrink-0 mt-px"><Icon name="alert" size={13} /></span>
            <span>Meta rejected: {form.meta_rejection_reason}</span>
          </p>
        )}

        <p className="text-[10.5px] text-slate-400 leading-snug">Meta typically reviews new templates within a few minutes to 24 hours.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-200">
          {/* The only borderless button in a row of bordered ones read as
              unfinished rather than as quiet. It now carries the same shell as
              its neighbours and earns its weight from colour instead: slate at
              rest, red on hover, so the destructive turn shows on approach
              without a red button shouting from the corner of every form.

              The title spells out what is discarded — the word alone reads as
              if it might delete the saved template, which it does not. */}
          {canEdit && (
            <button onClick={openNew} disabled={saving}
              title="Clear the editor and start a new template"
              className="group inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-red-50 hover:text-red-700 hover:border-red-300 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all">
              <span className="text-slate-400 group-hover:text-red-600 transition-colors">
                <Icon name="trash" size={14} />
              </span>
              Discard
            </button>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {form.id && form.meta_status === 'pending' && (
              <button onClick={syncStatus} disabled={saving}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 transition-all">
                <Icon name="refresh" size={14} />
                Sync Status
              </button>
            )}
            {canEdit && form.id && (
              <button onClick={duplicateTemplate}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all">
                <Icon name="copy" size={14} />
                Duplicate
              </button>
            )}
            {canEdit && !isLocked && (
              <button onClick={saveDraft} disabled={saving || !form.name || !form.body_text}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 transition-all">
                <Icon name="save" size={14} />
                {saving ? 'Saving…' : 'Save as Draft'}
              </button>
            )}
            {canSubmit && form.id && (form.meta_status === 'draft' || form.meta_status === 'rejected') && (
              <button onClick={submitToMeta} disabled={saving}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] shadow-[0_2px_8px_rgba(79,70,229,0.30)] disabled:opacity-50 disabled:shadow-none transition-all">
                <Icon name="send" size={14} />
                Submit for Review
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className={FIXED_COL + " space-y-3"}>
        <div className="flex flex-col lg:flex-1 lg:min-h-0 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          {/* Its own tinted bar rather than a line of text floating on the
              card: the preview is a distinct surface and the header is what
              tells you so before you read the word. */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100">
            <p className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
              <span className="text-slate-900"><Icon name="eye" size={16} /></span>
              Live Preview
            </p>
            <span className="text-indigo-400" title="Rendering differs by platform"><Icon name="info" size={15} /></span>
          </div>
          <div className="p-3.5 flex flex-col lg:flex-1 lg:min-h-0">
          <div className="rounded-xl p-3 min-h-[380px] lg:min-h-0 lg:flex-1 lg:overflow-y-auto ambria-thin-scroll" style={CHAT_BG}>
          <div className="bg-white rounded-lg shadow-[0_1px_1px_rgba(0,0,0,0.12)] p-2.5 space-y-1.5 max-w-full">
            {form.header_type === 'text' && form.header_content && (
              <p className="text-[13px] font-bold text-slate-900">{form.header_content}</p>
            )}
            {form.header_type && form.header_type !== 'text' && (
              form.header_content && form.header_type === 'image' ? (
                <img src={form.header_content} alt="Header" className="w-full h-24 object-cover rounded" />
              ) : form.header_content && form.header_type === 'video' ? (
                <video src={form.header_content} className="w-full h-24 object-cover rounded" controls />
              ) : form.header_content && form.header_type === 'document' ? (
                <div className="w-full h-12 bg-slate-100 rounded flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 truncate px-2">📄 {form.header_content.split('/').pop()}</div>
              ) : (
                <div className="w-full h-24 bg-slate-100 rounded flex items-center justify-center text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{form.header_type}</div>
              )
            )}
            <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-snug">{previewBody || 'Body text preview...'}</p>
            {form.footer_text && <p className="text-[11px] text-slate-400">{form.footer_text}</p>}
            {(function () {
              var btns = []
              try { btns = JSON.parse(form.buttons_text || '[]') } catch { btns = [] }
              return btns.length > 0 && (
                <div className="pt-1 space-y-1 border-t border-slate-100 mt-1">
                  {btns.map(function (b, i) {
                    return <div key={i} className="text-center text-[12px] text-indigo-600 font-medium py-1">{b.text}</div>
                  })}
                </div>
              )
            })()}
            {/* A real bubble carries a timestamp; without it the preview reads
                as a plain card and people misjudge how the message will look. */}
            <p className="text-right text-[10px] text-slate-400 leading-none pt-0.5" data-notranslate>
              {new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          </div>
          <p className="shrink-0 text-[11px] text-slate-400 text-center leading-snug mt-2.5">
            This is a visual preview. Actual rendering may vary depending on the platform.
          </p>
          </div>
        </div>

        <div className="shrink-0 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3.5">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-indigo-900 mb-1">
            <span className="text-indigo-500"><Icon name="sparkle" size={15} /></span>
            Pro Tip
          </p>
          <p className="text-[11.5px] text-indigo-800/80 leading-snug">
            Use variables to personalize your messages and increase engagement.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Templates
