// Shared class tokens for the expense screens.
//
// Two rules drive every value here:
//
//  1. Contrast first. The app is used on a phone in a banquet hall — bright
//     window light one minute, dim service corridor the next. Body copy sits at
//     slate-700/900 and the faintest text allowed is slate-500 (7.0:1 on white).
//     slate-400 is reserved for icons that sit beside a readable label, never
//     for text carrying meaning on its own.
//  2. One scale, four sizes. 22 / 15 / 13 / 11.5 px. Anything that wants to be
//     "a bit smaller" picks the next step down instead of inventing 12.5px.

export var T = {
  page:  'text-[22px] font-bold text-slate-900 tracking-[-0.02em] leading-tight',
  title: 'text-[15px] font-semibold text-slate-900 leading-snug',
  body:  'text-[13px] text-slate-700 leading-normal',
  meta:  'text-[11.5px] font-medium text-slate-500',
  caps:  'text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500',
  label: 'block text-[11px] font-semibold text-slate-600 mb-1.5',
  money: 'text-[15px] font-bold text-slate-900 tabular-nums tracking-[-0.01em]',
}

// Cards carry a real border rather than a shadow alone — a shadow disappears
// against a light-grey page on a dimmed screen, a border does not.
export var CARD = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]'

// slate-300 (not slate-200) so an empty input is still visibly an input at low
// screen brightness. 16px font-size is what stops iOS zooming on focus.
//
// Whole variants rather than `FIELD + " bg-slate-100"`: two utilities from the
// same family (bg-white vs bg-slate-100, w-full vs w-auto) are resolved by
// their order in the generated stylesheet, not by their order in the class
// attribute, so appending an override is a coin flip.
var FIELD_BASE = 'px-3 py-2.5 rounded-xl text-[13px] placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-shadow'
var FIELD_INK = 'bg-white border border-slate-300 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500/20 '

export var FIELD = 'w-full ' + FIELD_INK + FIELD_BASE
// Sits at its natural width in a label-left / control-right row.
export var FIELD_INLINE = 'w-auto shrink-0 ' + FIELD_INK + FIELD_BASE
// Read-only or derived values — visibly not for typing into.
export var FIELD_MUTED = 'w-full bg-slate-100 border border-slate-300 text-slate-600 ' + FIELD_BASE
// Value is out of range (wallet overdrawn, portions mismatched).
export var FIELD_ERR = 'w-full bg-white border border-red-400 text-slate-900 focus:border-red-500 focus:ring-red-500/20 ' + FIELD_BASE
// The search box owns its own height and icon gutters.
export var FIELD_SEARCH = 'w-full h-10 pl-9 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow'

// One rule for colour, applied everywhere:
//   indigo-600  = "do the thing"  (New, Submit, Add) — the only saturated fill
//   slate-900   = "this is on"    (active tab, engaged toggle, chosen filter)
//   semantic    = status only     (blue/emerald/amber/red chips and rails)
// Nothing else gets a fill, so a screenful of controls has exactly one place
// the eye is pulled to.
export var ON = 'bg-slate-900 border-slate-900 text-white'
export var OFF = 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900'

// Label left, control right. Stacking a 13px label above a 40px input spends
// ~70px of height on one short value while the left half of the row sits empty;
// this spends ~44px and fills the width.
export var ROW = 'flex items-center justify-between gap-3 py-1'

export var BTN = {
  primary: 'inline-flex items-center justify-center gap-1.5 font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all',
  quiet:   'inline-flex items-center justify-center gap-1.5 font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all',
  danger:  'inline-flex items-center justify-center gap-1.5 font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 active:scale-[0.98] transition-all',
}

// A 3px rail down the left edge of a row: status readable before a single word
// is, and it costs no vertical space.
export var STATUS_RAIL = {
  recorded: 'bg-blue-500',
  acknowledged: 'bg-emerald-500',
  approved: 'bg-emerald-500',
  flagged: 'bg-amber-500',
  deducted: 'bg-red-500',
  penalized: 'bg-red-500',
  rejected: 'bg-red-500',
  pending: 'bg-yellow-500',
  pending_dept: 'bg-amber-500',
  deleted: 'bg-slate-400',
}

// ── Departments ───────────────────────────────────────────────────────────────
//
// One contract is one department, and a client's evening is four of them stacked
// on the same date and venue. Reading the department off a wall of text is the
// slowest part of picking the right contract, so it gets a colour — and the
// colour has to be the SAME colour on the events list, the ledger, the plate
// screen and the expense picker, or it stops being a shortcut and becomes one
// more thing to decode. Hence: this map, and nothing else, decides.
//
// `chip` / `rail` are full literal class strings (never composed) so Tailwind's
// scanner can see them. `hex` is for the places a class cannot reach — native
// <option> text, canvas, PDF.
var DEPT_PALETTE = {
  blue:    { chip: 'bg-blue-100 text-blue-800 border-blue-200',          rail: 'bg-blue-500',    ink: 'text-blue-700',    hex: '#1d4ed8' },
  purple:  { chip: 'bg-purple-100 text-purple-800 border-purple-200',    rail: 'bg-purple-500',  ink: 'text-purple-700',  hex: '#7e22ce' },
  amber:   { chip: 'bg-amber-100 text-amber-800 border-amber-200',       rail: 'bg-amber-500',   ink: 'text-amber-700',   hex: '#b45309' },
  pink:    { chip: 'bg-pink-100 text-pink-800 border-pink-200',          rail: 'bg-pink-500',    ink: 'text-pink-700',    hex: '#be185d' },
  teal:    { chip: 'bg-teal-100 text-teal-800 border-teal-200',          rail: 'bg-teal-500',    ink: 'text-teal-700',    hex: '#0f766e' },
  sky:     { chip: 'bg-sky-100 text-sky-800 border-sky-200',             rail: 'bg-sky-500',     ink: 'text-sky-700',     hex: '#0369a1' },
  rose:    { chip: 'bg-rose-100 text-rose-800 border-rose-200',          rail: 'bg-rose-500',    ink: 'text-rose-700',    hex: '#be123c' },
  emerald: { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', rail: 'bg-emerald-500', ink: 'text-emerald-700', hex: '#047857' },
  violet:  { chip: 'bg-violet-100 text-violet-800 border-violet-200',    rail: 'bg-violet-500',  ink: 'text-violet-700',  hex: '#6d28d9' },
  orange:  { chip: 'bg-orange-100 text-orange-800 border-orange-200',    rail: 'bg-orange-500',  ink: 'text-orange-700',  hex: '#c2410c' },
  slate:   { chip: 'bg-slate-100 text-slate-700 border-slate-200',       rail: 'bg-slate-400',   ink: 'text-slate-600',   hex: '#475569' },
}


// The four operating departments, pinned. Order is the order they run in on the
// night, which is also the order a contract group should list them in.
var DEPT_FIXED = {
  venue:         { tone: 'blue',   order: 0 },
  decor:         { tone: 'purple', order: 1 },
  catering:      { tone: 'amber',  order: 2 },
  entertainment: { tone: 'pink',   order: 3 },
}

// Departments are rows in a table, so a fifth one can appear without a deploy.
// Anything unpinned hashes to a colour from the pool: distinct from its
// neighbours, and stable — the same name is the same colour on every screen and
// after every reload, which a rotating index or a random pick would not be.
var DEPT_POOL = ['teal', 'sky', 'rose', 'emerald', 'violet', 'orange']

function deptTone(name) {
  var key = String(name || '').trim().toLowerCase()
  if (!key) return 'slate'
  if (DEPT_FIXED[key]) return DEPT_FIXED[key].tone
  var h = 0
  for (var i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0
  return DEPT_POOL[Math.abs(h) % DEPT_POOL.length]
}

// Chip classes for a department name — bg + text + border, no padding or size,
// so each caller keeps its own dimensions.
export function deptCls(name) { return DEPT_PALETTE[deptTone(name)].chip }
// 3px left rail, same vocabulary as STATUS_RAIL.
export function deptRail(name) { return DEPT_PALETTE[deptTone(name)].rail }
// Text colour only, for a department sitting inside a meta line of its own
// ("Ravi · Catering · 12 Aug") where a chip would break the sentence and add a
// row of height to every card in the list.
export function deptInk(name) { return DEPT_PALETTE[deptTone(name)].ink }
// Raw ink for a native <option>, a canvas or a PDF cell.
export function deptHex(name) { return DEPT_PALETTE[deptTone(name)].hex }
// Sort key. Pinned departments first in running order, everything else after.
export function deptOrder(name) {
  var key = String(name || '').trim().toLowerCase()
  return DEPT_FIXED[key] ? DEPT_FIXED[key].order : 9
}
