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
//  MAIN COMPONENT
// ══════════════════════════════════════

var TABS = ['Venues', 'Rentals', 'DJ', 'TTD']

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
    <div style={{ fontFamily: 'Segoe UI, sans-serif', color: '#3D2B2B', maxWidth: 600, margin: '0 auto' }}>
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
    </div>
  )
}

export default RateCardEditor
