import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/* ═══════════════════════════════════════════════════════
   RATE CARD EDITOR — Admin-only quote_config manager
   Phase 1: Venues, Rentals, DJ, TTD
   ═══════════════════════════════════════════════════════ */

var C = {
  maroon: '#4A1111', maroon2: '#8B2D2D', gold: '#D4872C',
  cream: '#F5E6D3', border: '#E8DDD0', muted: '#8B7355', bg: '#FAF7F5',
}
var CAT_LABELS = ["King's", 'Perfect', 'Filler']
var CAT_COLORS = ['#D4872C', '#8B2D2D', '#6B5B4E']
var SLOT_LABELS = ['Dinner', 'Sundowner', 'Lunch']
var TIERS = ['q', 't', 'f']
var TIER_LABELS = ['Quote', 'Target', 'Floor']
var TIER_COLORS = ['#4A1111', '#0369A1', '#991B1B']
var DECOR_OPTS = [
  { val: 'p', label: 'Pushpanjali' },
  { val: 'eg', label: 'EG/Aura' },
  { val: 'f', label: 'Valencia' },
  { val: '', label: 'None' },
]

function clone(o) { return JSON.parse(JSON.stringify(o)) }

// ── Shared sub-components (stable refs, defined outside) ──

function SectionCard({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, marginBottom: 12, border: '1px solid ' + C.border }}>
      {title && <div style={{ fontSize: 11, fontWeight: 700, color: C.maroon2, textTransform: 'uppercase', letterSpacing: 1.5, paddingBottom: 8, borderBottom: '2px solid ' + C.cream, marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  )
}

function SaveBtn({ onClick, saving, label }) {
  return (
    <button onClick={onClick} disabled={saving} style={{
      width: '100%', padding: 13, borderRadius: 10, border: 'none', marginTop: 12,
      background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', color: '#fff',
      fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.5 : 1,
    }}>{saving ? 'Saving...' : (label || 'Save Changes')}</button>
  )
}

function NumCell({ value, onChange, step }) {
  return (
    <input type="number" inputMode="decimal" step={step || 'any'} value={value || ''}
      onInput={function (e) { onChange(e.target.value === '' ? 0 : +e.target.value) }}
      style={{
        width: '100%', padding: '8px 4px', borderRadius: 7, border: '1px solid ' + C.border,
        fontSize: 13, fontWeight: 600, textAlign: 'center', color: C.maroon, background: C.bg,
        fontFamily: 'inherit', outline: 'none',
      }} />
  )
}

function TierHeader() {
  return (
    <>
      <div />
      {TIER_LABELS.map(function (l, i) {
        return <div key={i} style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[i], textAlign: 'center', paddingBottom: 4 }}>{l}</div>
      })}
    </>
  )
}

// ══════════════════════════════════════
//  VENUES EDITOR
// ══════════════════════════════════════

function VenuesEditor({ config, onSave, saving }) {
  var raw = config.venues || []
  var [draft, setDraft] = useState(clone(raw))
  useEffect(function () { setDraft(clone(config.venues || [])) }, [config.venues])

  function upd(idx, field, val) {
    var d = clone(draft)
    d[idx][field] = val
    setDraft(d)
  }

  return (
    <SectionCard title="Venues">
      {draft.map(function (v, idx) {
        return (
          <div key={idx} style={{
            marginBottom: 10, padding: 12, borderRadius: 10,
            border: '1px solid ' + C.border, background: v.status === 'placeholder' ? '#F9F5F0' : '#fff',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 8 }}>IDX {idx}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input value={v.name || ''} placeholder="Venue name"
                onChange={function (e) { upd(idx, 'name', e.target.value) }}
                style={{ padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 13, fontWeight: 600, color: C.maroon, fontFamily: 'inherit' }} />
              <input value={v.location || ''} placeholder="Location"
                onChange={function (e) { upd(idx, 'location', e.target.value) }}
                style={{ padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 13, color: C.muted, fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={v.decor_mode || ''}
                onChange={function (e) { upd(idx, 'decor_mode', e.target.value || null) }}
                style={{ padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, color: C.muted, background: '#fff', fontFamily: 'inherit' }}>
                {DECOR_OPTS.map(function (o) { return <option key={o.val} value={o.val}>{o.label}</option> })}
              </select>
              <select value={v.status || 'live'}
                onChange={function (e) { upd(idx, 'status', e.target.value) }}
                style={{ padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, color: v.status === 'placeholder' ? '#D97706' : '#166534', background: '#fff', fontFamily: 'inherit' }}>
                <option value="live">Live</option>
                <option value="placeholder">Placeholder</option>
              </select>
            </div>
          </div>
        )
      })}
      <SaveBtn onClick={function () { onSave('venues', draft) }} saving={saving} label="Save Venues" />
    </SectionCard>
  )
}

// ══════════════════════════════════════
//  RENTALS EDITOR
// ══════════════════════════════════════

var EMPTY_RENTAL = { q: [[0,0,0],[0,0,0],[0,0,0]], t: [[0,0,0],[0,0,0],[0,0,0]], f: [[0,0,0],[0,0,0],[0,0,0]] }

function RentalsEditor({ config, onSave, saving }) {
  var rentals = config.rentals || {}
  var venues = config.venues || []
  var [draft, setDraft] = useState(clone(rentals))
  var [selV, setSelV] = useState(-1)

  useEffect(function () { setDraft(clone(config.rentals || {})) }, [config.rentals])

  // Find live venue idxs
  var liveIdxs = []
  venues.forEach(function (v, i) { if (v.status === 'live') liveIdxs.push(i) })
  if (selV === -1 && liveIdxs.length > 0) setSelV(liveIdxs[0])

  function updateCell(tier, catIdx, slotIdx, val) {
    var d = clone(draft)
    var key = selV + ''
    if (!d[key]) d[key] = clone(EMPTY_RENTAL)
    d[key][tier][catIdx][slotIdx] = val
    setDraft(d)
  }

  var vd = draft[selV + ''] || clone(EMPTY_RENTAL)

  return (
    <SectionCard title="Rental Rates (₹L)">
      {/* Venue pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {liveIdxs.map(function (idx) {
          var on = selV === idx
          return (
            <button key={idx} onClick={function () { setSelV(idx) }} style={{
              padding: '8px 14px', borderRadius: 9, border: '2px solid ' + (on ? C.maroon2 : C.border),
              background: on ? C.cream : '#fff', color: on ? C.maroon : C.muted,
              fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
            }}>{venues[idx].name}</button>
          )
        })}
      </div>

      {/* Per category grid */}
      {CAT_LABELS.map(function (catLabel, catIdx) {
        return (
          <div key={catIdx} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: CAT_COLORS[catIdx], marginBottom: 8 }}>{catLabel}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', gap: 6, alignItems: 'center' }}>
              <TierHeader />
              {SLOT_LABELS.map(function (slotLabel, slotIdx) {
                return (
                  <div key={slotIdx} style={{ display: 'contents' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{slotLabel}</div>
                    {TIERS.map(function (tier, ti) {
                      return <NumCell key={tier} value={vd[tier][catIdx][slotIdx]} onChange={function (v) { updateCell(tier, catIdx, slotIdx, v) }} />
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <SaveBtn onClick={function () { onSave('rentals', draft) }} saving={saving} label="Save Rentals" />
    </SectionCard>
  )
}

// ══════════════════════════════════════
//  DJ EDITOR
// ══════════════════════════════════════

function DJEditor({ config, onSave, saving }) {
  var raw = config.dj || { labels: ['Std DJ - No LED', 'DJ + LED'], pushpanjali: { q: [0,0], t: [0,0], f: [0,0] }, other: { q: [0,0], t: [0,0], f: [0,0] } }
  var [draft, setDraft] = useState(clone(raw))
  useEffect(function () { setDraft(clone(config.dj || raw)) }, [config.dj])

  function updateCell(group, tier, optIdx, val) {
    var d = clone(draft)
    d[group][tier][optIdx] = val
    setDraft(d)
  }

  function updateLabel(idx, val) {
    var d = clone(draft)
    d.labels[idx] = val
    setDraft(d)
  }

  var labels = draft.labels || ['Std', 'LED']
  var groups = [
    { key: 'pushpanjali', label: 'Pushpanjali' },
    { key: 'other', label: 'Other Venues' },
  ]

  return (
    <SectionCard title="DJ Rates (₹L)">
      {/* Labels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {labels.map(function (l, i) {
          return (
            <input key={i} value={l} onChange={function (e) { updateLabel(i, e.target.value) }}
              style={{ padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, fontWeight: 600, color: C.maroon, fontFamily: 'inherit' }} />
          )
        })}
      </div>

      {groups.map(function (grp) {
        var gd = draft[grp.key] || { q: [0,0], t: [0,0], f: [0,0] }
        return (
          <div key={grp.key} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 8 }}>{grp.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', gap: 6, alignItems: 'center' }}>
              <TierHeader />
              {labels.map(function (optLabel, optIdx) {
                return (
                  <div key={optIdx} style={{ display: 'contents' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{optLabel.length > 10 ? optLabel.substring(0, 10) + '..' : optLabel}</div>
                    {TIERS.map(function (tier) {
                      return <NumCell key={tier} value={gd[tier][optIdx]} onChange={function (v) { updateCell(grp.key, tier, optIdx, v) }} />
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <SaveBtn onClick={function () { onSave('dj', draft) }} saving={saving} label="Save DJ Rates" />
    </SectionCard>
  )
}

// ══════════════════════════════════════
//  TTD EDITOR
// ══════════════════════════════════════

function TTDEditor({ config, onSave, saving }) {
  var raw = config.ttd || { labels: ['12+ months', '6 months', '3 months', '2 months'], discounts: [0, 0.15, 0.20, 0.375] }
  var [draft, setDraft] = useState(clone(raw))
  useEffect(function () { setDraft(clone(config.ttd || raw)) }, [config.ttd])

  function updateLabel(idx, val) {
    var d = clone(draft)
    d.labels[idx] = val
    setDraft(d)
  }

  function updateDiscount(idx, pctVal) {
    var d = clone(draft)
    d.discounts[idx] = pctVal / 100
    setDraft(d)
  }

  return (
    <SectionCard title="Time-to-Date Discounts">
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Applied to rental only. Enter discount as percentage.</div>
      {(draft.labels || []).map(function (label, idx) {
        var pct = Math.round((draft.discounts[idx] || 0) * 10000) / 100
        return (
          <div key={idx} style={{
            display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10, alignItems: 'center',
            marginBottom: 8, padding: '8px 12px', borderRadius: 9, border: '1px solid ' + C.border,
          }}>
            <input value={label} onChange={function (e) { updateLabel(idx, e.target.value) }}
              style={{ padding: 8, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 13, fontWeight: 600, color: C.maroon, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" inputMode="decimal" step="0.5" value={pct}
                onInput={function (e) { updateDiscount(idx, +e.target.value || 0) }}
                style={{
                  width: '100%', padding: '8px 4px', borderRadius: 7, border: '1px solid ' + C.border,
                  fontSize: 13, fontWeight: 700, textAlign: 'center', color: pct > 0 ? '#DC2626' : '#166534', background: C.bg,
                  fontFamily: 'inherit', outline: 'none',
                }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>%</span>
            </div>
          </div>
        )
      })}
      <SaveBtn onClick={function () { onSave('ttd', draft) }} saving={saving} label="Save TTD" />
    </SectionCard>
  )
}

// ══════════════════════════════════════
//  MENU EDITOR
// ══════════════════════════════════════

var MENU_DEFAULTS = {
  labels: ['Magnum', 'Double Magnum', 'Multi Cuisine', 'Luxury'],
  base_rate: [1250, 1350, 0, 0], nv_upgrade: 300,
  flat_add: [0, 0, 0, 3], max_pax: [250, 300, 0, 0],
  is_sliding: [false, false, true, true],
}
var FORMULA_DEFAULTS = {
  start_rate: 1450, start_pax: 300, step: 50, step_pax: 100,
  floor_rate: 800, reset_pax: 800, reset_rate: 1350, reset_floor: 400,
}
var FORMULA_FIELDS = [
  { key: 'start_rate', label: 'Start Rate (₹/hd)', hint: 'Phase 1 starting per-head' },
  { key: 'start_pax', label: 'Start Pax', hint: 'Pax where Phase 1 begins' },
  { key: 'step', label: 'Step (₹)', hint: 'Rate drop per step' },
  { key: 'step_pax', label: 'Step Pax', hint: 'Pax interval per step' },
  { key: 'floor_rate', label: 'Floor Rate (₹/hd)', hint: 'Phase 1 minimum rate' },
  { key: 'reset_pax', label: 'Reset Pax', hint: 'Pax where Phase 2 starts' },
  { key: 'reset_rate', label: 'Reset Rate (₹/hd)', hint: 'Phase 2 starting rate' },
  { key: 'reset_floor', label: 'Reset Floor (₹/hd)', hint: 'Phase 2 minimum rate' },
]

var fieldLabel = { fontSize: 10, fontWeight: 600, color: C.muted, marginBottom: 3 }

function MenuEditor({ config, onSave, saving }) {
  var menuRaw = config.menu || MENU_DEFAULTS
  var formulaRaw = config.menu_formula || FORMULA_DEFAULTS
  var [menu, setMenu] = useState(clone(menuRaw))
  var [formula, setFormula] = useState(clone(formulaRaw))

  useEffect(function () { setMenu(clone(config.menu || MENU_DEFAULTS)) }, [config.menu])
  useEffect(function () { setFormula(clone(config.menu_formula || FORMULA_DEFAULTS)) }, [config.menu_formula])

  function updArr(field, idx, val) {
    var d = clone(menu)
    d[field][idx] = val
    setMenu(d)
  }

  return (
    <>
      <SectionCard title="Menu Rates">
        {/* NV Upgrade */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: 10, borderRadius: 9, background: C.bg, border: '1px solid ' + C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, flex: 1 }}>NV Upgrade (₹/hd)</div>
          <div style={{ width: 90 }}>
            <NumCell value={menu.nv_upgrade} onChange={function (v) { var d = clone(menu); d.nv_upgrade = v; setMenu(d) }} />
          </div>
        </div>

        {/* Per-menu cards */}
        {(menu.labels || []).map(function (label, idx) {
          return (
            <div key={idx} style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff' }}>
              <input value={label} onChange={function (e) { updArr('labels', idx, e.target.value) }}
                style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 13, fontWeight: 700, color: C.maroon, fontFamily: 'inherit', marginBottom: 10 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={fieldLabel}>Base Rate (₹/hd)</div>
                  <NumCell value={menu.base_rate[idx]} onChange={function (v) { updArr('base_rate', idx, v) }} />
                </div>
                <div>
                  <div style={fieldLabel}>Flat Add (₹L)</div>
                  <NumCell value={menu.flat_add[idx]} onChange={function (v) { updArr('flat_add', idx, v) }} />
                </div>
                <div>
                  <div style={fieldLabel}>Max Pax (0=∞)</div>
                  <NumCell value={menu.max_pax[idx]} onChange={function (v) { updArr('max_pax', idx, v) }} />
                </div>
              </div>
              <button onClick={function () { updArr('is_sliding', idx, !menu.is_sliding[idx]) }}
                style={{
                  padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '2px solid ' + (menu.is_sliding[idx] ? '#D4872C' : C.border),
                  background: menu.is_sliding[idx] ? '#FFF8F0' : '#fff',
                  color: menu.is_sliding[idx] ? '#D4872C' : C.muted,
                }}>{menu.is_sliding[idx] ? 'Sliding: ON' : 'Sliding: OFF'}</button>
            </div>
          )
        })}
        <SaveBtn onClick={function () { onSave('menu', menu) }} saving={saving} label="Save Menu Rates" />
      </SectionCard>

      <SectionCard title="Sliding Scale Formula">
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Phase 1: start_rate at start_pax, drops by step every step_pax, floor at floor_rate. Phase 2: resets at reset_pax.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {FORMULA_FIELDS.map(function (f) {
            return (
              <div key={f.key}>
                <div style={fieldLabel}>{f.label}</div>
                <NumCell value={formula[f.key]} onChange={function (v) { var d = clone(formula); d[f.key] = v; setFormula(d) }} />
              </div>
            )
          })}
        </div>
        <SaveBtn onClick={function () { onSave('menu_formula', formula) }} saving={saving} label="Save Formula" />
      </SectionCard>
    </>
  )
}

// ══════════════════════════════════════
//  DÉCOR EDITOR
// ══════════════════════════════════════

var DECOR_SECTIONS = [
  { key: 'decor', label: 'Pushpanjali', tiers: 3, defaultLabels: ['Premium', 'Standard', 'Banquet'] },
  { key: 'decor_eg', label: 'EG / Aura', tiers: 2, defaultLabels: ['Standard', 'Banquet'] },
  { key: 'decor_valencia', label: 'Valencia', tiers: 0, defaultLabels: [] },
]

function makeEmptyDecor(tierCount) {
  if (tierCount === 0) return { nw_offset: -0.5, q: [0, 0, 0], t: [0, 0, 0], f: [0, 0, 0] }
  var empty = []
  for (var i = 0; i < tierCount; i++) empty.push([0, 0, 0])
  return { labels: DECOR_SECTIONS[tierCount === 3 ? 0 : 1].defaultLabels.slice(), nw_offset: -0.5, q: clone(empty), t: clone(empty), f: clone(empty) }
}

function DecorEditor({ config, onSave, saving }) {
  var [subTab, setSubTab] = useState(0)
  var sec = DECOR_SECTIONS[subTab]

  var raw = config[sec.key] || makeEmptyDecor(sec.tiers)
  var [draft, setDraft] = useState(clone(raw))

  useEffect(function () {
    var s = DECOR_SECTIONS[subTab]
    setDraft(clone(config[s.key] || makeEmptyDecor(s.tiers)))
  }, [subTab, config])

  function updateOffset(val) {
    var d = clone(draft)
    d.nw_offset = val
    setDraft(d)
  }

  function updateLabel(idx, val) {
    var d = clone(draft)
    d.labels[idx] = val
    setDraft(d)
  }

  // For tiered venues: tier × category × Q/T/F
  function updateTiered(tier, tierIdx, catIdx, val) {
    var d = clone(draft)
    d[tier][tierIdx][catIdx] = val
    setDraft(d)
  }

  // For Valencia: flat category × Q/T/F
  function updateFlat(tier, catIdx, val) {
    var d = clone(draft)
    d[tier][catIdx] = val
    setDraft(d)
  }

  var isFlat = sec.tiers === 0

  return (
    <>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {DECOR_SECTIONS.map(function (s, idx) {
          var on = subTab === idx
          return (
            <button key={idx} onClick={function () { setSubTab(idx) }} style={{
              padding: '8px 14px', borderRadius: 9, border: '2px solid ' + (on ? C.gold : C.border),
              background: on ? '#FFF8F0' : '#fff', color: on ? C.gold : C.muted,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{s.label}</button>
          )
        })}
      </div>

      <SectionCard title={sec.label + ' Décor (₹L)'}>
        {/* NW Offset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: 10, borderRadius: 9, background: C.bg, border: '1px solid ' + C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, flex: 1 }}>NW Offset (₹L)</div>
          <div style={{ width: 90 }}>
            <NumCell value={draft.nw_offset} onChange={updateOffset} />
          </div>
        </div>

        {/* Tier labels (not for Valencia) */}
        {!isFlat && draft.labels && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {draft.labels.map(function (l, i) {
              return (
                <input key={i} value={l} onChange={function (e) { updateLabel(i, e.target.value) }}
                  style={{ flex: 1, padding: 8, borderRadius: 7, border: '1px solid ' + C.border, fontSize: 12, fontWeight: 600, color: C.maroon, fontFamily: 'inherit' }} />
              )
            })}
          </div>
        )}

        {/* Tiered grids (Pushpanjali / EG) */}
        {!isFlat && (draft.labels || []).map(function (tierLabel, tierIdx) {
          return (
            <div key={tierIdx} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.maroon2, marginBottom: 8 }}>{tierLabel}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', gap: 6, alignItems: 'center' }}>
                <TierHeader />
                {CAT_LABELS.map(function (catLabel, catIdx) {
                  return (
                    <div key={catIdx} style={{ display: 'contents' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: CAT_COLORS[catIdx] }}>{catLabel}</div>
                      {TIERS.map(function (tier) {
                        return <NumCell key={tier} value={(draft[tier][tierIdx] || [])[catIdx] || 0} onChange={function (v) { updateTiered(tier, tierIdx, catIdx, v) }} />
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Flat grid (Valencia) */}
        {isFlat && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', gap: 6, alignItems: 'center' }}>
              <TierHeader />
              {CAT_LABELS.map(function (catLabel, catIdx) {
                return (
                  <div key={catIdx} style={{ display: 'contents' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: CAT_COLORS[catIdx] }}>{catLabel}</div>
                    {TIERS.map(function (tier) {
                      return <NumCell key={tier} value={(draft[tier] || [])[catIdx] || 0} onChange={function (v) { updateFlat(tier, catIdx, v) }} />
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <SaveBtn onClick={function () { onSave(sec.key, draft) }} saving={saving} label={'Save ' + sec.label} />
      </SectionCard>
    </>
  )
}

// ══════════════════════════════════════
//  SEASON DATE CALENDAR
// ══════════════════════════════════════

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
var DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa']
var BRUSH_OPTS = [
  { cat: 0, label: "King's", color: '#D4872C', bg: '#FFF8F0' },
  { cat: 1, label: 'Perfect', color: '#8B2D2D', bg: '#FDF2F2' },
  { cat: 2, label: 'Filler', color: '#6B5B4E', bg: '#F7F5F3' },
]

function pad2(n) { return n < 10 ? '0' + n : '' + n }

function SeasonCalendar({ config, onSave, saving }) {
  var raw = config.season_dates || {}
  var [draft, setDraft] = useState(clone(raw))
  var [brush, setBrush] = useState(0)
  var [viewYear, setViewYear] = useState(new Date().getFullYear())
  var [pointer, setPointer] = useState(false)

  useEffect(function () { setDraft(clone(config.season_dates || {})) }, [config.season_dates])

  function toggleDate(mm, dd) {
    var key = pad2(mm + 1) + '-' + pad2(dd)
    var d = clone(draft)
    if (d[key] === brush) {
      delete d[key]
    } else {
      d[key] = brush
    }
    setDraft(d)
  }

  function getCat(mm, dd) {
    var key = pad2(mm + 1) + '-' + pad2(dd)
    return draft[key] != null ? draft[key] : -1
  }

  function renderMonth(monthIdx) {
    var firstDay = new Date(viewYear, monthIdx, 1).getDay()
    var daysInMonth = new Date(viewYear, monthIdx + 1, 0).getDate()
    var cells = []
    for (var blank = 0; blank < firstDay; blank++) {
      cells.push(<div key={'b' + blank} />)
    }
    for (var day = 1; day <= daysInMonth; day++) {
      cells.push(renderDay(monthIdx, day))
    }
    return cells
  }

  function renderDay(monthIdx, day) {
      var cat = getCat(monthIdx, day)
      var dotColor = cat === 0 ? '#D4872C' : cat === 1 ? '#8B2D2D' : cat === 2 ? '#6B5B4E' : 'transparent'
      var bgColor = cat === 0 ? '#FFF8F0' : cat === 1 ? '#FDF2F2' : cat === 2 ? '#F7F5F3' : '#fff'
      return (
        <div key={day}
          onPointerDown={function (e) { e.preventDefault(); setPointer(true); toggleDate(monthIdx, day) }}
          onPointerEnter={function () { if (pointer) toggleDate(monthIdx, day) }}
          style={{
            aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: bgColor, color: cat >= 0 ? BRUSH_OPTS[cat].color : C.muted,
            border: '1px solid ' + (cat >= 0 ? BRUSH_OPTS[cat].color + '44' : 'transparent'),
            userSelect: 'none', touchAction: 'none',
          }}>
          {day}
          {cat >= 0 && <div style={{ width: 4, height: 4, borderRadius: 2, background: dotColor, marginTop: 1 }} />}
        </div>
      )
  }

  // Stats
  var kings = 0, perfect = 0
  Object.keys(draft).forEach(function (k) { if (draft[k] === 0) kings++; if (draft[k] === 1) perfect++ })

  return (
    <>
      <SectionCard title="Season Dates">
        {/* Brush selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {BRUSH_OPTS.map(function (b) {
            var on = brush === b.cat
            return (
              <button key={b.cat} onClick={function () { setBrush(b.cat) }} style={{
                flex: 1, padding: '9px 6px', borderRadius: 9,
                border: '2px solid ' + (on ? b.color : C.border),
                background: on ? b.bg : '#fff', color: on ? b.color : C.muted,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>{b.label}</button>
            )
          })}
        </div>

        <div style={{ fontSize: 10, color: C.muted, marginBottom: 12, textAlign: 'center' }}>
          Tap dates to tag. Untagged = Filler by default.
          &nbsp;&nbsp;👑 {kings} &nbsp; ⚔️ {perfect}
        </div>

        {/* Year nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}
          onPointerUp={function () { setPointer(false) }}
          onPointerCancel={function () { setPointer(false) }}>
          <button onClick={function () { setViewYear(viewYear - 1) }} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid ' + C.border,
            background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: C.maroon,
          }}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.maroon }}>{viewYear}</div>
          <button onClick={function () { setViewYear(viewYear + 1) }} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid ' + C.border,
            background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: C.maroon,
          }}>›</button>
        </div>

        {/* Month grids */}
        <div onPointerUp={function () { setPointer(false) }} onPointerLeave={function () { setPointer(false) }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {MONTH_NAMES.map(function (mName, mIdx) {
            return (
              <div key={mIdx} style={{ padding: 12, borderRadius: 10, border: '1px solid ' + C.border, background: '#fff' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.maroon2, marginBottom: 8, textAlign: 'center' }}>{mName}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                  {DAY_HEADERS.map(function (dh) {
                    return <div key={dh} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.muted, paddingBottom: 4 }}>{dh}</div>
                  })}
                  {renderMonth(mIdx)}
                </div>
              </div>
            )
          })}
        </div>

        <SaveBtn onClick={function () { onSave('season_dates', draft) }} saving={saving} label="Save Season Dates" />
      </SectionCard>
    </>
  )
}

// ══════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════

var TABS = ['Venues', 'Rentals', 'DJ', 'TTD', 'Menu', 'Décor', 'Season']

function RateCardEditor({ profile }) {
  if (profile.role !== 'admin') return (
    <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 14 }}>Admin access required</div>
  )

  var [tab, setTab] = useState(0)
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
    var { error } = await supabase.from('quote_config')
      .update({ value: value, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) {
      setSaveMsg('Error: ' + error.message)
    } else {
      setSaveMsg('Saved: ' + key)
      var updated = Object.assign({}, config)
      updated[key] = value
      setConfig(updated)
    }
    setSaving(false)
    setTimeout(function () { setSaveMsg('') }, 3000)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading config...</div>

  return (
    <div style={{ fontFamily: 'Segoe UI, sans-serif', color: '#3D2B2B', maxWidth: tab === 6 ? 960 : 600, margin: '0 auto' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(function (label, idx) {
          var on = tab === idx
          return (
            <button key={idx} onClick={function () { setTab(idx) }} style={{
              padding: '9px 16px', borderRadius: 9,
              border: '2px solid ' + (on ? C.maroon2 : C.border),
              background: on ? 'linear-gradient(135deg,#4A1111,#8B2D2D)' : '#fff',
              color: on ? '#fff' : C.muted, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
          )
        })}
      </div>

      {/* Save feedback */}
      {saveMsg && (
        <div style={{
          textAlign: 'center', marginBottom: 12, fontSize: 12, padding: 10, borderRadius: 9,
          background: saveMsg.indexOf('Error') === 0 ? '#FEE2E2' : '#DCFCE7',
          color: saveMsg.indexOf('Error') === 0 ? '#991B1B' : '#166534',
          fontWeight: 600,
        }}>{saveMsg}</div>
      )}

      {tab === 0 && <VenuesEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 1 && <RentalsEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 2 && <DJEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 3 && <TTDEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 4 && <MenuEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 5 && <DecorEditor config={config} onSave={saveKey} saving={saving} />}
      {tab === 6 && <SeasonCalendar config={config} onSave={saveKey} saving={saving} />}
    </div>
  )
}

export default RateCardEditor
