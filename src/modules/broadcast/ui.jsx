import { useState, useEffect } from 'react'
import Icon from '../../components/ui/Icon'
import { supabase } from '../../lib/supabase'

// The shapes every screen in this module shares. They were being retyped per
// file, which is how the five pages drifted into looking like five products:
// three border radii, four label sizes, and buttons that agreed on nothing.
//
// Note there is no inline fontSize anywhere. An inline style beats every
// Tailwind class, so the iOS zoom guard written that way silently overrode
// each text size on the page; text-[16px] sm:text-[13px] keeps the guard on
// phones, where it is actually needed, and nowhere else.
export var CTRL = 'block w-full h-10 px-3 bg-white border border-slate-300 rounded-xl text-[16px] sm:text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow disabled:bg-slate-50 disabled:text-slate-500'
export var TEXTAREA = CTRL.replace('h-10 ', '').replace('block w-full', 'block w-full py-2') + ' resize-y'

export var BTN_GHOST = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all'
export var BTN_PRIMARY = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] shadow-[0_2px_8px_rgba(79,70,229,0.30)] disabled:opacity-50 disabled:shadow-none transition-all'
// Green, not indigo: sending is the one irreversible action in the module and
// it should not look like every other button on the page.
export var BTN_SEND = 'inline-flex items-center justify-center gap-1.5 h-10 px-3.5 text-[13px] font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:scale-[0.98] shadow-[0_2px_8px_rgba(5,150,105,0.30)] disabled:opacity-50 disabled:shadow-none transition-all'
export var BTN_DANGER = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-red-700 bg-white border border-red-200 rounded-xl hover:bg-red-50 hover:border-red-300 active:scale-[0.98] disabled:opacity-50 transition-all'

export var CARD = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
export var TH = 'px-3.5 py-2 text-left text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.04em] whitespace-nowrap'
export var TD = 'px-3.5 py-2.5 text-[13px] align-middle'

export var CHIP_NEUTRAL = 'bg-slate-100 text-slate-500 border-slate-200'
export var CHIP_GOOD = 'bg-emerald-50 text-emerald-700 border-emerald-200'
export var CHIP_WARN = 'bg-amber-50 text-amber-700 border-amber-200'
export var CHIP_BAD = 'bg-red-50 text-red-700 border-red-200'
export var CHIP_INFO = 'bg-indigo-50 text-indigo-700 border-indigo-200'

export function Chip({ tone, children }) {
  return (
    <span className={'inline-flex items-center h-[19px] px-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ' +
      (tone || CHIP_NEUTRAL)}>
      {children}
    </span>
  )
}

// Label above, control, then one line saying what the field wants. The old
// 10px grey caps labels carried no guidance at all.
export function Labeled({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-900 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

// tone: 'error' | 'ok' | 'warn' | 'info'
var NOTICE_TONES = {
  error: { cls: 'text-red-700 bg-red-50 border-red-200', icon: 'alert' },
  ok: { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: 'checkCircle' },
  warn: { cls: 'text-amber-700 bg-amber-50 border-amber-200', icon: 'alert' },
  info: { cls: 'text-slate-600 bg-slate-50 border-slate-200', icon: 'info' },
}
export function Notice({ tone, children }) {
  var t = NOTICE_TONES[tone] || NOTICE_TONES.info
  return (
    <p className={'flex items-start gap-1.5 text-[12px] rounded-xl px-3 py-2 border ' + t.cls}>
      <span className="shrink-0 mt-px"><Icon name={t.icon} size={13} /></span>
      <span>{children}</span>
    </p>
  )
}

var MEDIA_FALLBACK_LABEL = {
  image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message',
  document: '📄 Document', sticker: 'Sticker',
}

// What a message thread actually shows for one row — split out of Inbox and
// Contacts (which used to just print rendered_body and call anything else
// "(template message)", a label that only ever means something for what *we*
// send — a customer sending a photo or voice note isn't a template, it's
// just content wa-webhook never used to capture at all. One component so a
// third thread view doesn't have to reinvent this again.
export function WaMessageBody({ m, out, mutedCls }) {
  var mutedTone = mutedCls || (out ? 'text-indigo-200' : 'text-slate-400')
  var linkTone = out ? 'text-white underline' : 'text-indigo-700 underline'

  if (m.message_type === 'location' && (m.location_lat != null && m.location_lng != null)) {
    var mapsUrl = 'https://www.google.com/maps?q=' + m.location_lat + ',' + m.location_lng
    return (
      <p className="leading-snug">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className={linkTone + ' font-semibold'}>
          📍 {m.location_name || 'Shared location'}
        </a>
      </p>
    )
  }

  if (m.media_path) {
    var url = supabase.storage.from('wa-inbound-media').getPublicUrl(m.media_path).data?.publicUrl
    if (m.message_type === 'image' || m.message_type === 'sticker') {
      return (
        <div>
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={m.message_type} className="max-w-[220px] max-h-[220px] rounded-lg object-contain border border-black/5" />
          </a>
          {m.media_caption && <p className="leading-snug mt-1">{m.media_caption}</p>}
        </div>
      )
    }
    if (m.message_type === 'video') {
      return (
        <div>
          <video src={url} controls className="max-w-[240px] max-h-[240px] rounded-lg" />
          {m.media_caption && <p className="leading-snug mt-1">{m.media_caption}</p>}
        </div>
      )
    }
    if (m.message_type === 'audio') {
      return <audio src={url} controls className="max-w-[240px] h-9" />
    }
    if (m.message_type === 'document') {
      return (
        <a href={url} target="_blank" rel="noreferrer" className={linkTone + ' flex items-center gap-1.5 font-semibold'}>
          <Icon name="fileText" size={14} /> {m.media_filename || 'Document'}
        </a>
      )
    }
  }

  if (m.rendered_body) return <p className="leading-snug whitespace-pre-wrap">{m.rendered_body}</p>

  // Media that's a known type but has no file (download failed, or Meta's
  // link had already expired by the time we tried) still says what it was,
  // rather than the flatly wrong "(template message)".
  var label = MEDIA_FALLBACK_LABEL[m.message_type]
  return <p className={'leading-snug italic ' + mutedTone}>{label ? label + ' (unavailable)' : '(unsupported message type)'}</p>
}

// Module-level, not per-component state: Campaign Builder and Lists each
// mount their own TagsInput, and the suggestion list (every distinct tag
// actually in use on wa_contacts) doesn't change often enough to justify
// re-fetching it every time either screen opens.
var tagSuggestionsCache = null
export function useTagSuggestions() {
  var [tags, setTags] = useState(tagSuggestionsCache || [])
  useEffect(function () {
    if (tagSuggestionsCache) return
    supabase.rpc('rpc_wa_list_tags').then(function (res) {
      if (!res.error && res.data) { tagSuggestionsCache = res.data; setTags(res.data) }
    })
  }, [])
  return tags
}

// Free-text, comma-separated tag fields had no link to what tags actually
// exist — a typo or a different casing (e.g. "Team" vs "team") silently
// matched nothing, with no error, which is exactly how an exclude filter can
// look applied in the UI while doing nothing in fn_wa_resolve_audience. This
// autocompletes against useTagSuggestions() instead of trusting freehand
// text, while still allowing a brand-new tag to be typed and added — tags
// aren't a closed set (a contact can be given one for the first time here).
export function TagsInput({ value, onChange, suggestions, placeholder }) {
  var [text, setText] = useState('')
  var [open, setOpen] = useState(false)
  var selected = value || []
  var matches = (suggestions || [])
    .filter(function (s) { return selected.indexOf(s) === -1 })
    .filter(function (s) { return !text || s.toLowerCase().indexOf(text.toLowerCase()) !== -1 })
    .slice(0, 8)

  function addTag(raw) {
    var v = raw.trim()
    if (!v || selected.indexOf(v) !== -1) return
    onChange(selected.concat([v]))
    setText('')
  }
  function removeTag(t) {
    onChange(selected.filter(function (s) { return s !== t }))
  }
  function onKeyDown(ev) {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault()
      addTag(text)
    } else if (ev.key === 'Backspace' && !text && selected.length > 0) {
      removeTag(selected[selected.length - 1])
    }
  }

  return (
    <div className="relative">
      <div className={CTRL + ' h-auto min-h-10 py-1.5 flex flex-wrap items-center gap-1.5'}>
        {selected.map(function (t) {
          return (
            <span key={t} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[12px] font-semibold">
              {t}
              <button type="button" onClick={function () { removeTag(t) }}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-indigo-100">
                <Icon name="close" size={10} />
              </button>
            </span>
          )
        })}
        <input type="text" value={text}
          onChange={function (ev) { setText(ev.target.value); setOpen(true) }}
          onFocus={function () { setOpen(true) }}
          onBlur={function () { setTimeout(function () { setOpen(false) }, 120) }}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-[16px] sm:text-[13px] text-slate-900 placeholder:text-slate-400" />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1">
          {matches.map(function (s) {
            return (
              <button key={s} type="button" onMouseDown={function (ev) { ev.preventDefault(); addTag(s) }}
                className="block w-full text-left px-3 py-1.5 text-[13px] text-slate-700 hover:bg-indigo-50">
                {s}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// An empty list that only says "None yet" leaves you looking for the way
// forward, so the hint is not optional here — it says what to do next.
export function EmptyState({ icon, title, hint }) {
  return (
    <div className="px-4 py-9 text-center">
      <span className="inline-flex w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 items-center justify-center mb-2">
        <Icon name={icon || 'info'} size={19} />
      </span>
      <p className="text-[13px] font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
    </div>
  )
}
