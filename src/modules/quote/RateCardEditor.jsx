import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

/* ═══════════════════════════════════════════════════════
   RATE CARD EDITOR — Fully dynamic, admin-only
   All sections: add/remove items, responsive layout
   ═══════════════════════════════════════════════════════ */

var C = {
  maroon: '#4A1111', maroon2: '#8B2D2D', gold: '#D4872C',
  cream: '#F5E6D3', border: '#E8DDD0', muted: '#8B7355', bg: '#FAF7F5',
  red: '#991B1B', green: '#166534', blue: '#0369A1',
}
var TIERS = ['q', 't', 'f']
var TIER_LABELS = ['Quote', 'Target', 'Floor']
var TIER_COLORS = [C.maroon, C.blue, C.red]

var DEFAULT_CATS = [{ label: "King's", color: '#D4872C' }, { label: 'Perfect', color: '#8B2D2D' }, { label: 'Filler', color: '#6B5B4E' }]
var DEFAULT_SLOTS = ['Dinner', 'Sundowner', 'Lunch']
var DECOR_OPTS = [
  { val: 'p', label: 'Pushpanjali' }, { val: 'eg', label: 'EG/Aura' },
  { val: 'f', label: 'Valencia' }, { val: '', label: 'None' },
]

function clone(o) { return JSON.parse(JSON.stringify(o)) }

// ── Shared UI atoms ──

function Card({ title, children, style }) {
  return (
    <div style={Object.assign({ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid ' + C.border }, style || {})}>
      {title && <div style={{ fontSize: 11, fontWeight: 700, color: C.maroon2, textTransform: 'uppercase', letterSpacing: 1.2, paddingBottom: 8, borderBottom: '2px solid ' + C.cream, marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  )
}

function Btn({ label, onClick, disabled, variant, style }) {
  var isPrimary = variant === 'primary'
  var isDanger = variant === 'danger'
  var isSmall = variant === 'small' || variant === 'danger'
  return (
    <button onClick={onClick} disabled={disabled} style={Object.assign({
      padding: isSmall ? '5px 10px' : '12px 16px', borderRadius: isSmall ? 7 : 10, cursor: 'pointer',
      border: isPrimary ? 'none' : isDanger ? '1px solid #FCA5A5' : '1px solid ' + C.border,
      background: isPrimary ? 'linear-gradient(135deg,#4A1111,#8B2D2D)' : isDanger ? '#FEF2F2' : '#fff',
      color: isPrimary ? '#fff' : isDanger ? C.red : C.muted,
      fontSize: isSmall ? 11 : 13, fontWeight: 700, opacity: disabled ? 0.5 : 1,
    }, style || {})}>{label}</button>
  )
}

function Num({ value, onChange }) {
  return (
    <input type="number" inputMode="decimal" step="any" value={value == null ? '' : value}
      onInput={function (e) { onChange(e.target.value === '' ? 0 : +e.target.value) }}
      style={{
        width: '100%', padding: '7px 4px', borderRadius: 7, border: '1px solid ' + C.border,
        fontSize: 13, fontWeight: 600, textAlign: 'center', color: C.maroon, background: C.bg,
        fontFamily: 'inherit', outline: 'none', minWidth: 0,
      }} />
  )
}

function TextIn({ value, onChange, placeholder, style }) {
  return (
    <input value={value || ''} placeholder={placeholder}
      onChange={function (e) { onChange(e.target.value) }}
      style={Object.assign({
        padding: 8, borderRadius: 7, border: '1px solid ' + C.border,
        fontSize: 12, fontWeight: 600, color: C.maroon, fontFamily: 'inherit', minWidth: 0, width: '100%',
      }, style || {})} />
  )
}

function AddRow({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: 10, borderRadius: 9, border: '2px dashed ' + C.border,
      background: 'transparent', color: C.gold, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      marginTop: 8,
    }}>+ {label}</button>
  )
}

function RemoveBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 22, height: 22, borderRadius: 6, border: '1px solid #FCA5A5',
      background: '#FEF2F2', color: C.red, fontSize: 12, fontWeight: 700,
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>×</button>
  )
}

function TierGrid({ cats, children }) {
  var cols = '56px ' + TIERS.map(function () { return '1fr' }).join(' ')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 5, alignItems: 'center' }}>
      <div />
      {TIER_LABELS.map(function (l, i) {
        return <div key={i} style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[i], textAlign: 'center', paddingBottom: 2 }}>{l}</div>
      })}
      {children}
    </div>
  )
}

// ══════════════════════════════════════
//  CATEGORIES & SLOTS EDITOR
// ══════════════════════════════════════

function CategoriesEditor({ config, onSave, saving }) {
  var [cats, setCats] = useState(clone(config.categories || DEFAULT_CATS))
  var [slots, setSlots] = useState(clone(config.slots || DEFAULT_SLOTS))

  useEffect(function () { setCats(clone(config.categories || DEFAULT_CATS)) }, [config.categories])
  useEffect(function () { setSlots(clone(config.slots || DEFAULT_SLOTS)) }, [config.slots])

  function updCat(idx, field, val) { var d = clone(cats); d[idx][field] = val; setCats(d) }
  function addCat() { setCats(cats.concat([{ label: 'New Category', color: '#6B5B4E' }])) }
  function rmCat(idx) {
    if (!window.confirm('Delete this category? Saved quotes (date_category), rentals, and season dates reference categories by position. Deleting shifts all later indexes and can mis-map existing data.')) return
    var d = clone(cats); d.splice(idx, 1); setCats(d)
  }

  function updSlot(idx, val) { var d = clone(slots); d[idx] = val; setSlots(d) }
  function addSlot() { setSlots(slots.concat(['New Slot'])) }
  function rmSlot(idx) {
    if (!window.confirm('Delete this slot? Rental grids and saved quotes reference slots by column index. Deleting shifts columns and can mis-map rates.')) return
    var d = clone(slots); d.splice(idx, 1); setSlots(d)
  }

  return (
    <>
      <Card title="Date Categories">
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Define pricing tiers by date demand. Order matters: index 0 = highest.</div>
        {cats.map(function (c, idx) {
          return (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="color" value={c.color || '#6B5B4E'} onChange={function (e) { updCat(idx, 'color', e.target.value) }}
                style={{ width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }} />
              <TextIn value={c.label} onChange={function (v) { updCat(idx, 'label', v) }} style={{ flex: 1 }} />
              {cats.length > 1 && <RemoveBtn onClick={function () { rmCat(idx) }} />}
            </div>
          )
        })}
        <AddRow label="Add Category" onClick={addCat} />
        <div style={{ marginTop: 12 }}>
          <Btn label="Save Categories" variant="primary" onClick={function () { onSave('categories', cats) }} disabled={saving} style={{ width: '100%' }} />
        </div>
      </Card>

      <Card title="Time Slots">
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Slots available for booking. Order = column index in rental grids.</div>
        {slots.map(function (s, idx) {
          return (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ width: 24, textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, flexShrink: 0 }}>{idx}</div>
              <TextIn value={s} onChange={function (v) { updSlot(idx, v) }} style={{ flex: 1 }} />
              {slots.length > 1 && <RemoveBtn onClick={function () { rmSlot(idx) }} />}
            </div>
          )
        })}
        <AddRow label="Add Slot" onClick={addSlot} />
        <div style={{ marginTop: 12 }}>
          <Btn label="Save Slots" variant="primary" onClick={function () { onSave('slots', slots) }} disabled={saving} style={{ width: '100%' }} />
        </div>
      </Card>
    </>
  )
}

// ══════════════════════════════════════
//  EVENT TYPES EDITOR
// ══════════════════════════════════════

function EventTypesEditor({ config, onSave, saving }) {
  var [types, setTypes] = useState(clone(config.event_types || []))
  useEffect(function () { setTypes(clone(config.event_types || [])) }, [config.event_types])

  function upd(idx, field, val) { var d = clone(types); d[idx][field] = val; setTypes(d) }
  function addType() { setTypes(types.concat([{ label: '', icon: '', wedding: false, pinned: false }])) }
  function rmType(idx) { var d = clone(types); d.splice(idx, 1); setTypes(d) }
  function moveUp(idx) { if (idx === 0) return; var d = clone(types); var t = d[idx]; d[idx] = d[idx - 1]; d[idx - 1] = t; setTypes(d) }

  return (
    <Card title="Event Types">
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Manage event types for quotes. Toggle Wedding for wedding-tier pricing. Pinned types show as quick-select chips.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px 40px 1fr 56px 56px 22px 22px', gap: 4, alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textAlign: 'center' }}>#</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textAlign: 'center' }}>Icon</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted }}>Label</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textAlign: 'center' }}>Wedding</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textAlign: 'center' }}>Pinned</div>
        <div /><div />
      </div>
      {types.map(function (t, idx) {
        return (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '28px 40px 1fr 56px 56px 22px 22px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textAlign: 'center' }}>{idx}</div>
            <input value={t.icon || ''} onChange={function (e) { upd(idx, 'icon', e.target.value) }}
              placeholder="💍" maxLength={4}
              style={{ padding: 4, borderRadius: 6, border: '1px solid ' + C.border, fontSize: 14, textAlign: 'center', width: '100%', fontFamily: 'inherit' }} />
            <TextIn value={t.label} onChange={function (v) { upd(idx, 'label', v) }} placeholder="Event name" />
            <div style={{ textAlign: 'center' }}>
              <button onClick={function () { upd(idx, 'wedding', !t.wedding) }} style={{
                width: 36, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: t.wedding ? '#8B2D2D' : '#E8DDD0',
                position: 'relative', transition: 'background 0.2s',
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 9, background: '#fff',
                  position: 'absolute', top: 3, transition: 'left 0.2s',
                  left: t.wedding ? 15 : 3,
                }} />
              </button>
            </div>
            <div style={{ textAlign: 'center' }}>
              <button onClick={function () { upd(idx, 'pinned', !t.pinned) }} style={{
                width: 36, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: t.pinned ? '#D4872C' : '#E8DDD0',
                position: 'relative', transition: 'background 0.2s',
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 9, background: '#fff',
                  position: 'absolute', top: 3, transition: 'left 0.2s',
                  left: t.pinned ? 15 : 3,
                }} />
              </button>
            </div>
            <button onClick={function () { moveUp(idx) }} style={{
              width: 22, height: 22, borderRadius: 6, border: '1px solid ' + C.border,
              background: '#fff', color: C.muted, fontSize: 11, fontWeight: 700,
              cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>↑</button>
            <RemoveBtn onClick={function () { rmType(idx) }} />
          </div>
        )
      })}
      <AddRow label="Add Event Type" onClick={addType} />
      <div style={{ marginTop: 12 }}>
        <Btn label="Save Event Types" variant="primary" onClick={function () { onSave('event_types', types) }} disabled={saving} style={{ width: '100%' }} />
      </div>
    </Card>
  )
}

// ══════════════════════════════════════
//  INQUIRY MODES EDITOR
// ══════════════════════════════════════

function InquiryModesEditor({ config, onSave, saving }) {
  var [modes, setModes] = useState(clone(config.inquiry_modes || []))
  useEffect(function () { setModes(clone(config.inquiry_modes || [])) }, [config.inquiry_modes])

  function updMode(idx, val) { var d = clone(modes); d[idx] = val; setModes(d) }
  function addMode() { setModes(modes.concat([''])) }
  function rmMode(idx) { var d = clone(modes); d.splice(idx, 1); setModes(d) }

  return (
    <Card title="Inquiry Modes">
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Modes of inquiry shown in quote form dropdown. Maps to LMS fis_enq_mode.</div>
      {modes.map(function (m, idx) {
        return (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <div style={{ width: 24, textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, flexShrink: 0 }}>{idx}</div>
            <TextIn value={m} onChange={function (v) { updMode(idx, v) }} placeholder="Mode name" style={{ flex: 1 }} />
            {modes.length > 1 && <RemoveBtn onClick={function () { rmMode(idx) }} />}
          </div>
        )
      })}
      <AddRow label="Add Mode" onClick={addMode} />
      <div style={{ marginTop: 12 }}>
        <Btn label="Save Inquiry Modes" variant="primary" onClick={function () { onSave('inquiry_modes', modes) }} disabled={saving} style={{ width: '100%' }} />
      </div>
    </Card>
  )
}

// ══════════════════════════════════════
//  VENUES EDITOR
// ══════════════════════════════════════

function VenuesEditor({ config, onSave, saving }) {
  var raw = config.venues || []
  var [draft, setDraft] = useState(clone(raw))
  useEffect(function () { setDraft(clone(config.venues || [])) }, [config.venues])

  function upd(idx, field, val) { var d = clone(draft); d[idx][field] = val; setDraft(d) }
  function addVenue() { setDraft(draft.concat([{ name: '', location: '', decor_mode: null, status: 'placeholder' }])) }
  function rmVenue(idx) {
    if (!window.confirm('Delete this venue? Rentals, decor, menu rates and saved quotes reference venues by index. Deleting shifts indexes and can mis-map existing data.')) return
    var d = clone(draft); d.splice(idx, 1); setDraft(d)
  }

  return (
    <Card title="Venues">
      {draft.map(function (v, idx) {
        return (
          <div key={idx} style={{
            marginBottom: 10, padding: 12, borderRadius: 10,
            border: '1px solid ' + C.border, background: v.status === 'placeholder' ? '#F9F5F0' : '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>IDX {idx}</div>
              {draft.length > 1 && <RemoveBtn onClick={function () { rmVenue(idx) }} />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <TextIn value={v.name} onChange={function (val) { upd(idx, 'name', val) }} placeholder="Venue name" />
              <TextIn value={v.location} onChange={function (val) { upd(idx, 'location', val) }} placeholder="Location" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={v.decor_mode || ''}
                onChange={function (e) { upd(idx, 'decor_mode', e.target.value || null) }}
                style={{ padding: 8, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, color: C.muted, background: '#fff', fontFamily: 'inherit' }}>
                {DECOR_OPTS.map(function (o) { return <option key={o.val} value={o.val}>{o.label}</option> })}
              </select>
              <select value={v.status || 'live'}
                onChange={function (e) { upd(idx, 'status', e.target.value) }}
                style={{ padding: 8, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, color: v.status === 'placeholder' ? '#D97706' : C.green, background: '#fff', fontFamily: 'inherit' }}>
                <option value="live">Live</option>
                <option value="placeholder">Placeholder</option>
              </select>
            </div>
          </div>
        )
      })}
      <AddRow label="Add Venue" onClick={addVenue} />
      <Btn label="Save Venues" variant="primary" onClick={function () { onSave('venues', draft) }} disabled={saving} style={{ width: '100%', marginTop: 12 }} />
    </Card>
  )
}

// ══════════════════════════════════════
//  RENTALS EDITOR
// ══════════════════════════════════════

function RentalsEditor({ config, onSave, saving }) {
  var rentals = config.rentals || {}
  var venues = config.venues || []
  var cats = config.categories || DEFAULT_CATS
  var slots = config.slots || DEFAULT_SLOTS
  var [draft, setDraft] = useState(clone(rentals))
  var [selV, setSelV] = useState(-1)

  useEffect(function () { setDraft(clone(config.rentals || {})) }, [config.rentals])

  var liveIdxs = []
  venues.forEach(function (v, i) { if (v.status === 'live') liveIdxs.push(i) })
  useEffect(function () {
    if (selV === -1 && liveIdxs.length > 0) setSelV(liveIdxs[0])
  }, [liveIdxs.length])

  function emptyRental() {
    var r = {}
    TIERS.forEach(function (tier) {
      r[tier] = []
      for (var c = 0; c < cats.length; c++) {
        var row = []
        for (var s = 0; s < slots.length; s++) row.push(0)
        r[tier].push(row)
      }
    })
    return r
  }

  function padRental(rd) {
    var d = clone(rd)
    TIERS.forEach(function (tier) {
      if (!d[tier]) d[tier] = []
      while (d[tier].length < cats.length) {
        var row = []
        for (var s = 0; s < slots.length; s++) row.push(0)
        d[tier].push(row)
      }
      d[tier].forEach(function (row, ci) {
        while (row.length < slots.length) row.push(0)
      })
    })
    return d
  }

  function updateCell(tier, catIdx, slotIdx, val) {
    var d = clone(draft)
    var key = selV + ''
    if (!d[key]) d[key] = emptyRental()
    d[key] = padRental(d[key])
    d[key][tier][catIdx][slotIdx] = val
    setDraft(d)
  }

  var vd = padRental(draft[selV + ''] || emptyRental())

  return (
    <Card title="Rental Rates (₹L)">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {liveIdxs.map(function (idx) {
          var on = selV === idx
          return (
            <button key={idx} onClick={function () { setSelV(idx) }} style={{
              padding: '7px 12px', borderRadius: 9, border: '2px solid ' + (on ? C.maroon2 : C.border),
              background: on ? C.cream : '#fff', color: on ? C.maroon : C.muted,
              fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
            }}>{venues[idx].name}</button>
          )
        })}
      </div>

      {cats.map(function (cat, catIdx) {
        var slotCols = '56px ' + slots.map(function () { return '1fr' }).join(' ')
        return (
          <div key={catIdx} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cat.color || C.muted, marginBottom: 6 }}>{cat.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: slotCols, gap: 5, alignItems: 'center' }}>
              <div />
              {slots.map(function (s, si) {
                return <div key={si} style={{ fontSize: 10, fontWeight: 700, color: C.muted, textAlign: 'center' }}>{s}</div>
              })}
              {TIERS.map(function (tier, ti) {
                return (
                  <React.Fragment key={tier}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[ti] }}>{TIER_LABELS[ti]}</div>
                    {slots.map(function (s, si) {
                      return <Num key={si} value={vd[tier][catIdx] ? vd[tier][catIdx][si] : 0} onChange={function (v) { updateCell(tier, catIdx, si, v) }} />
                    })}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )
      })}
      <Btn label="Save Rentals" variant="primary" onClick={function () { onSave('rentals', draft) }} disabled={saving} style={{ width: '100%', marginTop: 8 }} />
    </Card>
  )
}

// ══════════════════════════════════════
//  DJ EDITOR
// ══════════════════════════════════════

var DJ_SECTIONS = [
  { key: 'dj', label: 'Pushpanjali' },
  { key: 'dj_eg', label: 'EG / Aura' },
  { key: 'dj_valencia', label: 'Valencia' },
]

function DJEditor({ config, onSave, saving }) {
  var cats = config.categories || DEFAULT_CATS
  var [subTab, setSubTab] = useState(0)
  var sec = DJ_SECTIONS[subTab]
  var [draft, setDraft] = useState({ labels: [], q: [], t: [], f: [] })

  useEffect(function () {
    var s = DJ_SECTIONS[subTab]
    var d = clone(config[s.key] || { labels: ['Std DJ - No LED', 'DJ + LED'], q: [], t: [], f: [] })
    if (d.labels && d.labels.length > 0) {
      TIERS.forEach(function (tier) {
        if (!Array.isArray(d[tier])) d[tier] = []
      })
      var clean = {}
      TIERS.forEach(function (tier) { clean[tier] = [] })
      d.labels.forEach(function (_, optIdx) {
        TIERS.forEach(function (tier) {
          var existing = Array.isArray(d[tier][optIdx]) ? d[tier][optIdx] : []
          while (existing.length < cats.length) existing.push(0)
          clean[tier].push(existing)
        })
      })
      TIERS.forEach(function (tier) { d[tier] = clean[tier] })
    }
    setDraft(d)
  }, [subTab, config])

  function updateLabel(idx, val) { var d = clone(draft); d.labels[idx] = val; setDraft(d) }
  function updateTiered(tier, optIdx, catIdx, val) { var d = clone(draft); d[tier][optIdx][catIdx] = val; setDraft(d) }

  function addOption() {
    var d = clone(draft)
    if (!d.labels) d.labels = []
    d.labels.push('New Option')
    TIERS.forEach(function (tier) {
      var row = []
      for (var c = 0; c < cats.length; c++) row.push(0)
      d[tier].push(row)
    })
    setDraft(d)
  }

  function rmOption(idx) {
    var d = clone(draft)
    d.labels.splice(idx, 1)
    TIERS.forEach(function (tier) { d[tier].splice(idx, 1) })
    setDraft(d)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {DJ_SECTIONS.map(function (s, idx) {
          var on = subTab === idx
          return (
            <button key={idx} onClick={function () { setSubTab(idx) }} style={{
              padding: '7px 12px', borderRadius: 9, border: '2px solid ' + (on ? C.gold : C.border),
              background: on ? '#FFF8F0' : '#fff', color: on ? C.gold : C.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{s.label}</button>
          )
        })}
      </div>

      <Card title={sec.label + ' DJ Rates (₹L)'}>
        <div style={{ marginBottom: 12 }}>
          {(draft.labels || []).map(function (l, i) {
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <TextIn value={l} onChange={function (v) { updateLabel(i, v) }} style={{ flex: 1 }} />
                {draft.labels.length > 1 && <RemoveBtn onClick={function () { rmOption(i) }} />}
              </div>
            )
          })}
          <AddRow label="Add DJ Option" onClick={addOption} />
        </div>

        {(draft.labels || []).map(function (optLabel, optIdx) {
          return (
            <div key={optIdx} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 6 }}>{optLabel}</div>
              <TierGrid>
                {cats.map(function (cat, catIdx) {
                  return (
                    <React.Fragment key={catIdx}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: cat.color || C.muted }}>{cat.label}</div>
                      {TIERS.map(function (tier) {
                        return <Num key={tier} value={(draft[tier][optIdx] || [])[catIdx] || 0} onChange={function (v) { updateTiered(tier, optIdx, catIdx, v) }} />
                      })}
                    </React.Fragment>
                  )
                })}
              </TierGrid>
            </div>
          )
        })}

        <Btn label={'Save ' + sec.label + ' DJ'} variant="primary" onClick={function () { onSave(sec.key, draft) }} disabled={saving} style={{ width: '100%', marginTop: 8 }} />
      </Card>
    </>
  )
}

// ══════════════════════════════════════
//  TTD EDITOR
// ══════════════════════════════════════

function TTDEditor({ config, onSave, saving }) {
  var raw = config.ttd || { labels: ['12+ months', '6 months', '3 months', '2 months'], discounts: [0, 0.15, 0.20, 0.375] }
  var [draft, setDraft] = useState(clone(raw))
  useEffect(function () { setDraft(clone(config.ttd || raw)) }, [config.ttd])

  function updateLabel(idx, val) { var d = clone(draft); d.labels[idx] = val; setDraft(d) }
  function updateDiscount(idx, pctVal) { var d = clone(draft); d.discounts[idx] = pctVal / 100; setDraft(d) }

  function addTier() {
    var d = clone(draft)
    d.labels.push('New Tier')
    d.discounts.push(0)
    setDraft(d)
  }

  function rmTier(idx) {
    var d = clone(draft)
    d.labels.splice(idx, 1)
    d.discounts.splice(idx, 1)
    setDraft(d)
  }

  return (
    <Card title="Time-to-Date Discounts">
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Applied to rental only. Enter discount as percentage.</div>
      {(draft.labels || []).map(function (label, idx) {
        var pct = Math.round((draft.discounts[idx] || 0) * 10000) / 100
        return (
          <div key={idx} style={{
            display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8,
            padding: '8px 10px', borderRadius: 9, border: '1px solid ' + C.border,
          }}>
            <TextIn value={label} onChange={function (v) { updateLabel(idx, v) }} style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, width: 80 }}>
              <input type="number" inputMode="decimal" step="0.5" value={pct}
                onInput={function (e) { updateDiscount(idx, +e.target.value || 0) }}
                style={{
                  width: '100%', padding: '7px 4px', borderRadius: 7, border: '1px solid ' + C.border,
                  fontSize: 13, fontWeight: 700, textAlign: 'center', color: pct > 0 ? C.red : C.green, background: C.bg,
                  fontFamily: 'inherit', outline: 'none',
                }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>%</span>
            </div>
            {draft.labels.length > 1 && <RemoveBtn onClick={function () { rmTier(idx) }} />}
          </div>
        )
      })}
      <AddRow label="Add TTD Tier" onClick={addTier} />
      <Btn label="Save TTD" variant="primary" onClick={function () { onSave('ttd', draft) }} disabled={saving} style={{ width: '100%', marginTop: 12 }} />
    </Card>
  )
}

// ══════════════════════════════════════
//  MENU EDITOR
// ══════════════════════════════════════

var FORMULA_FIELDS = [
  { key: 'start_rate', label: 'Start Rate (₹/hd)' }, { key: 'start_pax', label: 'Start Pax' },
  { key: 'step', label: 'Step (₹)' }, { key: 'step_pax', label: 'Step Pax' },
  { key: 'floor_rate', label: 'Floor Rate (₹/hd)' }, { key: 'reset_pax', label: 'Reset Pax' },
  { key: 'reset_rate', label: 'Reset Rate (₹/hd)' }, { key: 'reset_floor', label: 'Reset Floor (₹/hd)' },
]
var FORMULA_DEFAULTS = { start_rate: 1450, start_pax: 300, step: 50, step_pax: 100, floor_rate: 800, reset_pax: 800, reset_rate: 1350, reset_floor: 400 }

function MenuEditor({ config, onSave, saving }) {
  var MENU_DEFAULTS = { labels: ['Magnum', 'Double Magnum', 'Multi Cuisine', 'Luxury'], base_rate: [1250, 1350, 0, 0], nv_upgrade: 300, flat_add: [0, 0, 0, 3], max_pax: [250, 300, 0, 0], is_sliding: [false, false, true, true] }
  var [menu, setMenu] = useState(clone(config.menu || MENU_DEFAULTS))
  var [formula, setFormula] = useState(clone(config.menu_formula || FORMULA_DEFAULTS))

  useEffect(function () { setMenu(clone(config.menu || MENU_DEFAULTS)) }, [config.menu])
  useEffect(function () { setFormula(clone(config.menu_formula || FORMULA_DEFAULTS)) }, [config.menu_formula])

  function updArr(field, idx, val) { var d = clone(menu); d[field][idx] = val; setMenu(d) }

  function addMenu() {
    var d = clone(menu)
    d.labels.push('New Menu')
    d.base_rate.push(0)
    d.flat_add.push(0)
    d.max_pax.push(0)
    d.is_sliding.push(false)
    setMenu(d)
  }

  function rmMenu(idx) {
    var d = clone(menu)
    d.labels.splice(idx, 1)
    d.base_rate.splice(idx, 1)
    d.flat_add.splice(idx, 1)
    d.max_pax.splice(idx, 1)
    d.is_sliding.splice(idx, 1)
    setMenu(d)
  }

  var fl = { fontSize: 10, fontWeight: 600, color: C.muted, marginBottom: 3 }

  return (
    <>
      <Card title="Menu Rates">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: 10, borderRadius: 9, background: C.bg, border: '1px solid ' + C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, flex: 1 }}>NV Upgrade (₹/hd)</div>
          <div style={{ width: 80 }}>
            <Num value={menu.nv_upgrade} onChange={function (v) { var d = clone(menu); d.nv_upgrade = v; setMenu(d) }} />
          </div>
        </div>

        {(menu.labels || []).map(function (label, idx) {
          return (
            <div key={idx} style={{ marginBottom: 10, padding: 12, borderRadius: 10, border: '1px solid ' + C.border }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <TextIn value={label} onChange={function (v) { updArr('labels', idx, v) }} style={{ flex: 1, fontWeight: 700 }} />
                {menu.labels.length > 1 && <RemoveBtn onClick={function () { rmMenu(idx) }} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div><div style={fl}>Base Rate (₹/hd)</div><Num value={menu.base_rate[idx]} onChange={function (v) { updArr('base_rate', idx, v) }} /></div>
                <div><div style={fl}>Flat Add (₹L)</div><Num value={menu.flat_add[idx]} onChange={function (v) { updArr('flat_add', idx, v) }} /></div>
                <div><div style={fl}>Max Pax (0=∞)</div><Num value={menu.max_pax[idx]} onChange={function (v) { updArr('max_pax', idx, v) }} /></div>
              </div>
              <button onClick={function () { updArr('is_sliding', idx, !menu.is_sliding[idx]) }}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '2px solid ' + (menu.is_sliding[idx] ? C.gold : C.border),
                  background: menu.is_sliding[idx] ? '#FFF8F0' : '#fff',
                  color: menu.is_sliding[idx] ? C.gold : C.muted,
                }}>{menu.is_sliding[idx] ? 'Sliding: ON' : 'Sliding: OFF'}</button>
            </div>
          )
        })}
        <AddRow label="Add Menu" onClick={addMenu} />
        <Btn label="Save Menu Rates" variant="primary" onClick={function () { onSave('menu', menu) }} disabled={saving} style={{ width: '100%', marginTop: 12 }} />
      </Card>

      <Card title="Sliding Scale Formula">
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Phase 1: start_rate at start_pax, drops by step every step_pax. Phase 2: resets at reset_pax.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {FORMULA_FIELDS.map(function (f) {
            return (
              <div key={f.key}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginBottom: 3 }}>{f.label}</div>
                <Num value={formula[f.key]} onChange={function (v) { var d = clone(formula); d[f.key] = v; setFormula(d) }} />
              </div>
            )
          })}
        </div>
        <Btn label="Save Formula" variant="primary" onClick={function () { onSave('menu_formula', formula) }} disabled={saving} style={{ width: '100%', marginTop: 12 }} />
      </Card>
    </>
  )
}

// ══════════════════════════════════════
//  DÉCOR EDITOR
// ══════════════════════════════════════

var DECOR_SECTIONS = [
  { key: 'decor', label: 'Pushpanjali' },
  { key: 'decor_eg', label: 'EG / Aura' },
  { key: 'decor_valencia', label: 'Valencia' },
]

function DecorEditor({ config, onSave, saving }) {
  var cats = config.categories || DEFAULT_CATS
  var [subTab, setSubTab] = useState(0)
  var sec = DECOR_SECTIONS[subTab]
  var raw = config[sec.key] || { labels: [], nw_offset: -0.5, q: [], t: [], f: [] }
  var [draft, setDraft] = useState(clone(raw))

  useEffect(function () {
    var s = DECOR_SECTIONS[subTab]
    var d = clone(config[s.key] || { labels: [], nw_offset: -0.5, q: [], t: [], f: [] })
    // Pad each tier's category arrays
    if (d.labels && d.labels.length > 0) {
      var clean = {}
      TIERS.forEach(function (tier) { clean[tier] = [] })
      d.labels.forEach(function (_, tierIdx) {
        TIERS.forEach(function (tier) {
          var existing = Array.isArray(d[tier][tierIdx]) ? d[tier][tierIdx] : []
          while (existing.length < cats.length) existing.push(0)
          clean[tier].push(existing)
        })
      })
      TIERS.forEach(function (tier) { d[tier] = clean[tier] })
    } else if (!d.labels || d.labels.length === 0) {
      // Flat mode (Valencia) — pad flat arrays
      TIERS.forEach(function (tier) {
        if (!Array.isArray(d[tier])) d[tier] = []
        while (d[tier].length < cats.length) d[tier].push(0)
      })
    }
    setDraft(d)
  }, [subTab, config])

  function updateOffset(val) { var d = clone(draft); d.nw_offset = val; setDraft(d) }
  function updateLabel(idx, val) { var d = clone(draft); d.labels[idx] = val; setDraft(d) }
  function updateTiered(tier, tierIdx, catIdx, val) { var d = clone(draft); d[tier][tierIdx][catIdx] = val; setDraft(d) }
  function updateFlat(tier, catIdx, val) { var d = clone(draft); d[tier][catIdx] = val; setDraft(d) }

  var isFlat = !draft.labels || draft.labels.length === 0

  function addTier() {
    var d = clone(draft)
    if (!d.labels) d.labels = []
    var wasFlat = d.labels.length === 0
    d.labels.push('New Tier')
    TIERS.forEach(function (tier) {
      var row = []
      for (var c = 0; c < cats.length; c++) row.push(0)
      if (wasFlat) d[tier] = []
      d[tier].push(row)
    })
    setDraft(d)
  }

  function rmTier(idx) {
    var d = clone(draft)
    d.labels.splice(idx, 1)
    TIERS.forEach(function (tier) { d[tier].splice(idx, 1) })
    setDraft(d)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {DECOR_SECTIONS.map(function (s, idx) {
          var on = subTab === idx
          return (
            <button key={idx} onClick={function () { setSubTab(idx) }} style={{
              padding: '7px 12px', borderRadius: 9, border: '2px solid ' + (on ? C.gold : C.border),
              background: on ? '#FFF8F0' : '#fff', color: on ? C.gold : C.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{s.label}</button>
          )
        })}
      </div>

      <Card title={sec.label + ' Décor (₹L)'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: 10, borderRadius: 9, background: C.bg, border: '1px solid ' + C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, flex: 1 }}>NW Offset (₹L)</div>
          <div style={{ width: 80 }}><Num value={draft.nw_offset} onChange={updateOffset} /></div>
        </div>

        {/* Tier labels */}
        {!isFlat && draft.labels && (
          <div style={{ marginBottom: 12 }}>
            {draft.labels.map(function (l, i) {
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <TextIn value={l} onChange={function (v) { updateLabel(i, v) }} style={{ flex: 1 }} />
                  {draft.labels.length > 1 && <RemoveBtn onClick={function () { rmTier(i) }} />}
                </div>
              )
            })}
            <AddRow label="Add Décor Tier" onClick={addTier} />
          </div>
        )}

        {/* Tiered grids */}
        {!isFlat && (draft.labels || []).map(function (tierLabel, tierIdx) {
          return (
            <div key={tierIdx} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 6 }}>{tierLabel}</div>
              <TierGrid>
                {cats.map(function (cat, catIdx) {
                  return (
                    <React.Fragment key={catIdx}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: cat.color || C.muted }}>{cat.label}</div>
                      {TIERS.map(function (tier) {
                        return <Num key={tier} value={(draft[tier][tierIdx] || [])[catIdx] || 0} onChange={function (v) { updateTiered(tier, tierIdx, catIdx, v) }} />
                      })}
                    </React.Fragment>
                  )
                })}
              </TierGrid>
            </div>
          )
        })}

        {/* Flat grid (Valencia) */}
        {isFlat && (
          <div style={{ marginBottom: 12 }}>
            <TierGrid>
              {cats.map(function (cat, catIdx) {
                return (
                  <React.Fragment key={catIdx}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: cat.color || C.muted }}>{cat.label}</div>
                    {TIERS.map(function (tier) {
                      return <Num key={tier} value={(draft[tier] || [])[catIdx] || 0} onChange={function (v) { updateFlat(tier, catIdx, v) }} />
                    })}
                  </React.Fragment>
                )
              })}
            </TierGrid>
            <AddRow label="Convert to Tiered" onClick={addTier} />
          </div>
        )}

        <Btn label={'Save ' + sec.label} variant="primary" onClick={function () { onSave(sec.key, draft) }} disabled={saving} style={{ width: '100%', marginTop: 8 }} />
      </Card>
    </>
  )
}

// ══════════════════════════════════════
//  LUNCH RATES EDITOR
// ══════════════════════════════════════

var LUNCH_SECTIONS = [
  { key: 'lunch_decor', label: 'Pushpanjali' },
  { key: 'lunch_decor_eg', label: 'EG / Aura' },
  { key: 'lunch_decor_valencia', label: 'Valencia' },
]

function LunchRatesEditor({ config, onSave, saving }) {
  var cats = config.categories || DEFAULT_CATS
  var [subTab, setSubTab] = useState(0)
  var sec = LUNCH_SECTIONS[subTab]
  var raw = config[sec.key] || { labels: [], nw_offset: -0.5, q: [], t: [], f: [] }
  var [draft, setDraft] = useState(clone(raw))

  useEffect(function () {
    var s = LUNCH_SECTIONS[subTab]
    var d = clone(config[s.key] || { labels: [], nw_offset: -0.5, q: [], t: [], f: [] })
    if (d.labels && d.labels.length > 0) {
      var clean = {}
      TIERS.forEach(function (tier) { clean[tier] = [] })
      d.labels.forEach(function (_, tierIdx) {
        TIERS.forEach(function (tier) {
          var existing = Array.isArray(d[tier][tierIdx]) ? d[tier][tierIdx] : []
          while (existing.length < cats.length) existing.push(0)
          clean[tier].push(existing)
        })
      })
      TIERS.forEach(function (tier) { d[tier] = clean[tier] })
    } else if (!d.labels || d.labels.length === 0) {
      TIERS.forEach(function (tier) {
        if (!Array.isArray(d[tier])) d[tier] = []
        while (d[tier].length < cats.length) d[tier].push(0)
      })
    }
    setDraft(d)
  }, [subTab, config])

  function updateOffset(val) { var d = clone(draft); d.nw_offset = val; setDraft(d) }
  function updateLabel(idx, val) { var d = clone(draft); d.labels[idx] = val; setDraft(d) }
  function updateTiered(tier, tierIdx, catIdx, val) { var d = clone(draft); d[tier][tierIdx][catIdx] = val; setDraft(d) }
  function updateFlat(tier, catIdx, val) { var d = clone(draft); d[tier][catIdx] = val; setDraft(d) }

  var isFlat = !draft.labels || draft.labels.length === 0

  function addTier() {
    var d = clone(draft)
    if (!d.labels) d.labels = []
    var wasFlat = d.labels.length === 0
    d.labels.push('New Tier')
    TIERS.forEach(function (tier) {
      var row = []
      for (var c = 0; c < cats.length; c++) row.push(0)
      if (wasFlat) d[tier] = []
      d[tier].push(row)
    })
    setDraft(d)
  }

  function rmTier(idx) {
    var d = clone(draft)
    d.labels.splice(idx, 1)
    TIERS.forEach(function (tier) { d[tier].splice(idx, 1) })
    setDraft(d)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {LUNCH_SECTIONS.map(function (s, idx) {
          var on = subTab === idx
          return (
            <button key={idx} onClick={function () { setSubTab(idx) }} style={{
              padding: '7px 12px', borderRadius: 9, border: '2px solid ' + (on ? C.gold : C.border),
              background: on ? '#FFF8F0' : '#fff', color: on ? C.gold : C.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{s.label}</button>
          )
        })}
      </div>

      <Card title={sec.label + ' Lunch Décor (₹L)'}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Décor rates applied when Lunch slot is selected. Overrides standard décor for lunch bookings.</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: 10, borderRadius: 9, background: C.bg, border: '1px solid ' + C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, flex: 1 }}>NW Offset (₹L)</div>
          <div style={{ width: 80 }}><Num value={draft.nw_offset} onChange={updateOffset} /></div>
        </div>

        {!isFlat && draft.labels && (
          <div style={{ marginBottom: 12 }}>
            {draft.labels.map(function (l, i) {
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <TextIn value={l} onChange={function (v) { updateLabel(i, v) }} style={{ flex: 1 }} />
                  {draft.labels.length > 1 && <RemoveBtn onClick={function () { rmTier(i) }} />}
                </div>
              )
            })}
            <AddRow label="Add Lunch Tier" onClick={addTier} />
          </div>
        )}

        {!isFlat && (draft.labels || []).map(function (tierLabel, tierIdx) {
          return (
            <div key={tierIdx} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 6 }}>{tierLabel}</div>
              <TierGrid>
                {cats.map(function (cat, catIdx) {
                  return (
                    <React.Fragment key={catIdx}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: cat.color || C.muted }}>{cat.label}</div>
                      {TIERS.map(function (tier) {
                        return <Num key={tier} value={(draft[tier][tierIdx] || [])[catIdx] || 0} onChange={function (v) { updateTiered(tier, tierIdx, catIdx, v) }} />
                      })}
                    </React.Fragment>
                  )
                })}
              </TierGrid>
            </div>
          )
        })}

        {isFlat && (
          <div style={{ marginBottom: 12 }}>
            <TierGrid>
              {cats.map(function (cat, catIdx) {
                return (
                  <React.Fragment key={catIdx}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: cat.color || C.muted }}>{cat.label}</div>
                    {TIERS.map(function (tier) {
                      return <Num key={tier} value={(draft[tier] || [])[catIdx] || 0} onChange={function (v) { updateFlat(tier, catIdx, v) }} />
                    })}
                  </React.Fragment>
                )
              })}
            </TierGrid>
            <AddRow label="Convert to Tiered" onClick={addTier} />
          </div>
        )}

        <Btn label={'Save ' + sec.label + ' Lunch'} variant="primary" onClick={function () { onSave(sec.key, draft) }} disabled={saving} style={{ width: '100%', marginTop: 8 }} />
      </Card>
    </>
  )
}

// ══════════════════════════════════════
//  SEASON DATE CALENDAR
// ══════════════════════════════════════

var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
var DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function pad2(n) { return n < 10 ? '0' + n : '' + n }

function cellFromEvent(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-m]') : null
  if (!el) return null
  return { m: +el.getAttribute('data-m'), d: +el.getAttribute('data-d') }
}

var DayCell = React.memo(function DayCell({ monthIdx, day, cat, bg, fg }) {
  return (
    <div data-m={monthIdx} data-d={day} style={{
      aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
      background: bg, color: fg,
      border: '1px solid ' + (cat >= 0 ? fg + '33' : 'transparent'),
      userSelect: 'none', touchAction: 'none',
    }}>
      {day}
      {cat >= 0 && <div style={{ width: 4, height: 4, borderRadius: 2, background: fg, marginTop: 1 }} />}
    </div>
  )
})

function SeasonCalendar({ config, onSave, saving }) {
  var cats = config.categories || DEFAULT_CATS
  var raw = config.season_dates || {}
  var [draft, setDraft] = useState(clone(raw))
  var [brush, setBrush] = useState(0)
  var [viewYear, setViewYear] = useState(new Date().getFullYear())
  var pointerRef = useRef(false)
  var lastPainted = useRef(null)
  var draftRef = useRef(draft)
  var rafRef = useRef(null)
  var paintMode = useRef('paint')
  var csvRef = useRef(null)

  useEffect(function () { draftRef.current = draft }, [draft])
  useEffect(function () { var d = clone(config.season_dates || {}); setDraft(d); draftRef.current = d }, [config.season_dates])

  function flushDraft() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(function () {
      rafRef.current = null
      setDraft(Object.assign({}, draftRef.current))
    })
  }

  function toggleDate(mm, dd) {
    var key = pad2(mm + 1) + '-' + pad2(dd)
    if (draftRef.current[key] === brush) { delete draftRef.current[key] } else { draftRef.current[key] = brush }
    flushDraft()
  }

  function fillRange(fromMonth, fromDay, toMonth, toDay) {
    var start = new Date(viewYear, fromMonth, fromDay)
    var end = new Date(viewYear, toMonth, toDay)
    if (end < start) { var tmp = start; start = end; end = tmp }
    var cur = new Date(start)
    while (cur <= end) {
      var mm = cur.getMonth(), dd = cur.getDate()
      var key = pad2(mm + 1) + '-' + pad2(dd)
      if (paintMode.current === 'erase') { delete draftRef.current[key] } else { draftRef.current[key] = brush }
      cur.setDate(cur.getDate() + 1)
    }
    flushDraft()
  }

  function handleImport(e) {
    var file = e.target.files && e.target.files[0]
    if (!file) return
    e.target.value = ''
    var reader = new FileReader()
    reader.onload = function (evt) {
      var text = evt.target.result
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() })
      var catMap = {}
      cats.forEach(function (c, i) { catMap[c.label.toLowerCase()] = i })
      var imported = Object.assign({}, draftRef.current)
      var count = 0
      var skipped = 0
      for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].split(',').map(function (s) { return s.trim().replace(/^"|"$/g, '') })
        if (parts.length < 2) continue
        var dateStr = parts[0]
        var catName = parts[1]
        if (!dateStr || !catName) continue
        if (dateStr.toLowerCase() === 'date') continue
        var mmdd = ''
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          if (parseInt(dateStr.substring(0, 4)) !== viewYear) continue
          mmdd = dateStr.substring(5)
        } else if (/^\d{2}-\d{2}$/.test(dateStr)) {
          mmdd = dateStr
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
          var slashParts = dateStr.split('/')
          if (parseInt(slashParts[2]) !== viewYear) continue
          mmdd = pad2(parseInt(slashParts[1])) + '-' + pad2(parseInt(slashParts[0]))
        } else if (/^\d{1,2}\/\d{1,2}$/.test(dateStr)) {
          var shortParts = dateStr.split('/')
          mmdd = pad2(parseInt(shortParts[1])) + '-' + pad2(parseInt(shortParts[0]))
        } else { skipped++; continue }
        var mm = parseInt(mmdd.substring(0, 2))
        var dd = parseInt(mmdd.substring(3))
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) { skipped++; continue }
        var catIdx = catMap[catName.toLowerCase()]
        if (catIdx == null) { skipped++; continue }
        imported[mmdd] = catIdx
        count++
      }
      draftRef.current = imported
      setDraft(Object.assign({}, imported))
      var msg = 'Imported ' + count + ' dates'
      if (skipped > 0) msg += ' (' + skipped + ' skipped)'
      alert(msg)
    }
    reader.readAsText(file)
  }

  function handleExport() {
    var lines = ['date,category']
    var keys = Object.keys(draftRef.current).sort()
    for (var i = 0; i < keys.length; i++) {
      var cat = cats[draftRef.current[keys[i]]]
      if (cat) lines.push(keys[i] + ',' + cat.label)
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url; a.download = 'season_dates_' + viewYear + '.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function getCat(mm, dd) {
    var key = pad2(mm + 1) + '-' + pad2(dd)
    var val = draftRef.current[key]
    return val != null ? val : -1
  }

  function onGridDown(e) {
    var c = cellFromEvent(e); if (!c) return
    e.preventDefault()
    paintMode.current = draftRef.current[pad2(c.m + 1) + '-' + pad2(c.d)] === brush ? 'erase' : 'paint'
    pointerRef.current = true; lastPainted.current = { m: c.m, d: c.d }
    toggleDate(c.m, c.d)
  }

  function onGridOver(e) {
    if (!pointerRef.current) return
    var c = cellFromEvent(e); if (!c) return
    var lp = lastPainted.current
    if (lp && lp.m === c.m && lp.d === c.d) return
    if (lp) fillRange(lp.m, lp.d, c.m, c.d)
    lastPainted.current = { m: c.m, d: c.d }
  }

  function renderDay(monthIdx, day) {
    var cat = getCat(monthIdx, day)
    var catObj = cats[cat] || null
    var bg = catObj ? catObj.color + '18' : '#fff'
    var fg = catObj ? catObj.color : C.muted
    return <DayCell key={day} monthIdx={monthIdx} day={day} cat={cat} bg={bg} fg={fg} />
  }

  function renderMonth(monthIdx) {
    var firstDay = new Date(viewYear, monthIdx, 1).getDay()
    var daysInMonth = new Date(viewYear, monthIdx + 1, 0).getDate()
    var cells = []
    for (var blank = 0; blank < firstDay; blank++) cells.push(<div key={'b' + blank} />)
    for (var day = 1; day <= daysInMonth; day++) cells.push(renderDay(monthIdx, day))
    return cells
  }

  // Stats per category
  var counts = {}
  cats.forEach(function (c, i) { counts[i] = 0 })
  Object.keys(draft).forEach(function (k) { if (counts[draft[k]] != null) counts[draft[k]]++ })

  return (
    <Card title="Season Dates">
      {/* Brush selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {cats.map(function (c, idx) {
          var on = brush === idx
          return (
            <button key={idx} onClick={function () { setBrush(idx) }} style={{
              flex: 1, minWidth: 70, padding: '8px 6px', borderRadius: 9,
              border: '2px solid ' + (on ? c.color : C.border),
              background: on ? c.color + '18' : '#fff', color: on ? c.color : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{c.label} ({counts[idx] || 0})</button>
          )
        })}
      </div>

      <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, textAlign: 'center' }}>
        Click or drag to paint. Untagged dates default to last category.
      </div>

      {/* Year nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 14 }}>
        <button onClick={function () { setViewYear(viewYear - 1) }} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: C.maroon }}>‹</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.maroon }}>{viewYear}</div>
        <button onClick={function () { setViewYear(viewYear + 1) }} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid ' + C.border, background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: C.maroon }}>›</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
        <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
        <button onClick={function () { csvRef.current && csvRef.current.click() }} style={{ padding: '5px 14px', borderRadius: 7, border: '1px solid ' + C.border, background: '#fff', fontSize: 11, fontWeight: 600, color: C.maroon, cursor: 'pointer' }}>Import CSV</button>
        <button onClick={handleExport} style={{ padding: '5px 14px', borderRadius: 7, border: '1px solid ' + C.border, background: '#fff', fontSize: 11, fontWeight: 600, color: C.maroon, cursor: 'pointer' }}>Export CSV</button>
      </div>
      {/* Month grids — responsive */}
      <div onPointerDown={onGridDown} onPointerOver={onGridOver}
        onPointerUp={function () { pointerRef.current = false; setDraft(Object.assign({}, draftRef.current)) }} onPointerLeave={function () { pointerRef.current = false; setDraft(Object.assign({}, draftRef.current)) }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {MONTH_NAMES.map(function (mName, mIdx) {
          return (
            <div key={mIdx} style={{ padding: 10, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 6, textAlign: 'center' }}>{mName}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {DAY_HEADERS.map(function (dh) {
                  return <div key={dh} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.muted, paddingBottom: 2 }}>{dh}</div>
                })}
                {renderMonth(mIdx)}
              </div>
            </div>
          )
        })}
      </div>

      <Btn label="Save Season Dates" variant="primary" onClick={function () { onSave('season_dates', draftRef.current) }} disabled={saving} style={{ width: '100%', marginTop: 14 }} />
    </Card>
  )
}

// ══════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════

var TABS = [
  { key: 'masters', label: 'Masters' },
  { key: 'config', label: 'Config' },
  { key: 'venues', label: 'Venues' },
  { key: 'rentals', label: 'Rentals' },
  { key: 'dj', label: 'DJ' },
  { key: 'ttd', label: 'TTD' },
  { key: 'menu', label: 'Menu' },
  { key: 'decor', label: 'Décor' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'season', label: 'Season' },
]
var WIDE_TABS = ['season', 'rentals']

function RateCardEditor({ profile }) {
  var canEdit = profile.role === 'admin' || (profile.permissions && profile.permissions.indexOf('feature_ratecard') >= 0)
  if (!canEdit) return (
    <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 14 }}>Rate card edit access required</div>
  )
  var [tab, setTab] = useState('venues')
  var [config, setConfig] = useState({})
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [saveMsg, setSaveMsg] = useState('')

  useEffect(function () {
    supabase.from('quote_config').select('key, value').then(function (res) {
      if (res.data) {
        var map = {}
        res.data.forEach(function (r) { map[r.key] = r.value })
        setConfig(map)
      }
      setLoading(false)
    })
  }, [])

  async function saveKey(key, value) {
    setSaving(true); setSaveMsg('')
    // Upsert — insert if missing, update if exists
    var { error } = await supabase.from('quote_config').upsert(
      { key: key, value: value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    if (error) {
      setSaveMsg('Error: ' + error.message)
    } else {
      setSaveMsg('Saved: ' + key)
      var updated = Object.assign({}, config)
      updated[key] = value
      setConfig(updated)
      try { localStorage.removeItem('qc_config_v1') } catch (e) {}
    }
    setSaving(false)
    setTimeout(function () { setSaveMsg('') }, 3000)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading config...</div>

  var isWide = WIDE_TABS.indexOf(tab) >= 0

  return (
    <div style={{ fontFamily: 'Segoe UI, sans-serif', color: '#3D2B2B', maxWidth: isWide ? 960 : 560, margin: '0 auto', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(function (t) {
          var on = tab === t.key
          return (
            <button key={t.key} onClick={function () { setTab(t.key) }} style={{
              padding: '7px 0', borderRadius: 8, flex: '1 1 auto', minWidth: 'calc(25% - 4px)', textAlign: 'center',
              border: '2px solid ' + (on ? C.maroon2 : C.border),
              background: on ? 'linear-gradient(135deg,#4A1111,#8B2D2D)' : '#fff',
              color: on ? '#fff' : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{t.label}</button>
          )
        })}
      </div>

      {/* Save feedback */}
      {saveMsg && (
        <div style={{
          textAlign: 'center', marginBottom: 10, fontSize: 12, padding: 9, borderRadius: 9,
          background: saveMsg.indexOf('Error') === 0 ? '#FEE2E2' : '#DCFCE7',
          color: saveMsg.indexOf('Error') === 0 ? C.red : C.green, fontWeight: 600,
        }}>{saveMsg}</div>
      )}

      {tab === 'masters' && <><EventTypesEditor config={config} onSave={saveKey} saving={saving} /><InquiryModesEditor config={config} onSave={saveKey} saving={saving} /></>}
      {tab === 'config' && <CategoriesEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'venues' && <VenuesEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'rentals' && <RentalsEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'dj' && <DJEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'ttd' && <TTDEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'menu' && <MenuEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'decor' && <DecorEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'lunch' && <LunchRatesEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 'season' && <SeasonCalendar config={config} onSave={saveKey} saving={saving} />}
    </div>
  )
}

export default RateCardEditor
