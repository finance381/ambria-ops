// Inline SVG icon set — replaces the emoji glyphs the expense screens used to
// print. Emoji render differently on every Android skin (and half of them are
// colour-blobs at 11px), so the UI now draws its own 24×24 stroke paths that
// inherit `currentColor` and scale with the surrounding text.
//
// Usage:  <Icon name="plus" className="w-4 h-4" />
//         <Icon name="receipt" size={18} />

var PATHS = {
  // ── actions ──────────────────────────────────────────────
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkDouble: <><path d="m2 12.5 4 4 8-9" /><path d="m10.5 16.8 1.5 1.7L22 8.5" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>,
  undo: <><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></>,
  download: <><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,

  // ── chevrons / arrows ────────────────────────────────────
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,

  // ── money / docs ─────────────────────────────────────────
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5" /><circle cx="16" cy="14" r="1.2" /></>,
  banknote: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v9M19 10v9M9.5 10v9M14.5 10v9" /><path d="M3 20h18" /></>,
  receipt: <><path d="M6 3v18l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V3l-2 1.4L14 3l-2 1.4L10 3 8 4.4 6 3Z" /><path d="M9 9h6M9 13h4" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" /></>,
  fileText: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  paperclip: <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />,
  tag: <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,

  // ── media ────────────────────────────────────────────────
  camera: <><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" /><circle cx="12" cy="13" r="3.5" /></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m4 17 5-5 4 4 3-3 4 4" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  play: <path d="M6 4.5v15l13-7.5-13-7.5Z" />,
  zoom: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M11 8v6M8 11h6" /></>,
  eye: <><path d="M2.2 12S6 5.5 12 5.5 21.8 12 21.8 12 18 18.5 12 18.5 2.2 12 2.2 12Z" /><circle cx="12" cy="12" r="3.2" /></>,

  // ── status ───────────────────────────────────────────────
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  alert: <><path d="M10.3 4 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>,
  sparkle: <><path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.6 10.4 12.2 5 10.6 10.4 9 12 3.5Z" /><path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8 18.5 16.5Z" /></>,
  star: <path d="m12 3.6 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.95l-5.25 2.8 1-5.85L3.5 9.75l5.9-.85L12 3.6Z" />,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,

  // ── objects ──────────────────────────────────────────────
  box: <><path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z" /><path d="M3.5 7.5 12 12l8.5-4.5" /><path d="M12 12v9" /></>,
  split: <><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 21v-8.3a4 4 0 0 0-1.2-2.8L3 3" /><path d="m15 9 6-6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4M16 3v4" /></>,
  mapPin: <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6" /><path d="M18 14.6A6.5 6.5 0 0 1 21.5 20" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" /><path d="M10 21v-3h4v3" /></>,
  save: <><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 3v6h7V3" /><path d="M8 15h8" /></>,
  send: <><path d="M21.5 2.5 10.5 13.5" /><path d="M21.5 2.5 15 21.5l-4.5-8-8-4.5 19-6.5Z" /></>,
  // A capital T, for a body-of-text field.
  typography: <><path d="M5 6.5V4.5h14v2" /><path d="M12 4.5v15" /><path d="M8.5 19.5h7" /></>,
  // Bulleted list, for an ordered set of labels.
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
  // Chain link, for a footer line or a URL.
  link: <><path d="M10.2 13.8a4.5 4.5 0 0 0 6.8.5l2.5-2.5a4.5 4.5 0 0 0-6.4-6.4L11.7 6.8" /><path d="M13.8 10.2a4.5 4.5 0 0 0-6.8-.5L4.5 12.2a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" /></>,
  // Curly braces, for a JSON field.
  braces: <><path d="M8.5 3.5C6.6 3.5 6 4.6 6 6.2v2.6c0 1.4-.8 2.4-2 3.2 1.2.8 2 1.8 2 3.2v2.6c0 1.6.6 2.7 2.5 2.7" /><path d="M15.5 3.5c1.9 0 2.5 1.1 2.5 2.7v2.6c0 1.4.8 2.4 2 3.2-1.2.8-2 1.8-2 3.2v2.6c0 1.6-.6 2.7-2.5 2.7" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M4.8 5.6 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.8-7.4A2 2 0 0 0 17.3 4H6.7a2 2 0 0 0-1.9 1.6Z" /></>,
  edit: <><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M14.5 6.5 17.5 9.5" /></>,
  home: <><path d="m3 10.2 9-7 9 7" /><path d="M5.5 8.7V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.7" /><path d="M9.5 21v-5.5a2.5 2.5 0 0 1 5 0V21" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3.2 9h17.6M3.2 15h17.6" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" /></>,
  monitor: <><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8.5 20.5h7" /><path d="M12 16.5v4" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,

  // -- nav / module glyphs (replace the emoji the group grid used to print) --
  idCard: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8.5" cy="11" r="2.2" /><path d="M5 16.2a4 4 0 0 1 7 0" /><path d="M14.5 10h4M14.5 13.5h4" /></>,
  cart: <><circle cx="9.5" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2.5 3h2.2l2.4 11.4a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 7H6" /></>,
  truck: <><path d="M2.5 6.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1V16H2.5V6.5Z" /><path d="M15 9.5h3.4a1 1 0 0 1 .8.4l2.1 2.8a1 1 0 0 1 .2.6V16h-6.5V9.5Z" /><circle cx="7" cy="18.5" r="1.6" /><circle cx="18" cy="18.5" r="1.6" /></>,
  wrench: <path d="M20.4 6.2a5.5 5.5 0 0 1-7.2 7.2L6 20.6a2.1 2.1 0 0 1-3-3l7.2-7.2a5.5 5.5 0 0 1 7.2-7.2l-3.3 3.3.9 3.3 3.3.9 2.1-4.5Z" />,
  calculator: <><rect x="4.5" y="2.5" width="15" height="19" rx="2" /><rect x="7.5" y="5.5" width="9" height="3.5" rx="0.8" /><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" /></>,
  utensils: <><path d="M6 2.5v7a2.5 2.5 0 0 0 5 0v-7" /><path d="M8.5 9.5V21.5" /><path d="M17.5 2.5c-1.7 1-2.5 3-2.5 5.5 0 1.8.7 3 2.5 3.5V21.5" /></>,
  creditCard: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19" /><path d="M6 14.5h3.5" /></>,
  transfer: <><path d="M4 8h15" /><path d="m15.5 4.5 3.5 3.5-3.5 3.5" /><path d="M20 16H5" /><path d="m8.5 12.5-3.5 3.5 3.5 3.5" /></>,
}

function Icon({ name, size, className, strokeWidth, style }) {
  var d = PATHS[name]
  if (!d) return null
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size || undefined}
      height={size || undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth || 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className || 'w-4 h-4'}
      style={style}
    >
      {d}
    </svg>
  )
}

export default Icon
