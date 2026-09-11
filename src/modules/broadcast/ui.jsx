import Icon from '../../components/ui/Icon'

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
