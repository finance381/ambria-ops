// The dot colour a venue gets on a calendar, in one place.
//
// The month grid inside EventDatePicker and the full calendar on the Event
// ledger both draw these dots. Kept as two copies, a venue that changed colour
// in one of them would read as a different venue in the other — a bug nobody
// would think to look for, because both screens would look internally
// consistent.
export var VENUE_COLORS = {
  'Ambria Pushpanjali': '#6B21A8',
  'Ambria Manaktala':   '#16A34A',
  'Ambria Exotica':     '#EA580C',
  'Ambria Restro':      '#DC2626',
  'Villa':              '#374151',
  'Ambria Design & Decor': '#CA8A04',
  'Ambria Cuisine':     '#0D9488',
  'Ambria Events':      '#DB2777',
  'Tender':             '#115E59',
  'Wedding Services':   '#3B82F6',
  'Outdoor Decor':      '#CA8A04',
  'Outdoor Catering':   '#0D9488',
  'Outdoor Venue':      '#374151',
  'Outdoor Entertainment': '#DB2777',
}

export var DEFAULT_VENUE_COLOR = '#6366F1'

export function venueColor(name) {
  return VENUE_COLORS[name] || DEFAULT_VENUE_COLOR
}

// The four the legend names. Every venue above gets a colour, but a legend
// listing fourteen of them would be a second calendar's worth of furniture —
// these are the ones that carry the volume, and the rest fall back to indigo.
export var VENUE_LEGEND = [
  { code: 'AP', name: 'Ambria Pushpanjali' },
  { code: 'AM', name: 'Ambria Manaktala' },
  { code: 'AE', name: 'Ambria Exotica' },
  { code: 'AR', name: 'Ambria Restro' },
]
