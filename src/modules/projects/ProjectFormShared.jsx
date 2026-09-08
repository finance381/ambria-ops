import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { compressImage } from '../../lib/imageCompress'
import SearchDropdown from '../../components/ui/SearchDropdown'
import EventDatePicker from '../../components/ui/EventDatePicker'
import VoiceInput from '../../components/ui/VoiceInput'

// Each section takes { formApi, readOnly, refs } — formApi is the full return value of
// useProjectForm.js, refs bundles the shared lookup lists (venues/employees/vendors)
// loaded once by the parent (Projects.jsx). Reused as-is by both the desktop split-view
// (Phase 5) and the mobile wizard (Phase 6).

var PROJECT_TYPES = ['renovation', 'new_build', 'repair', 'maintenance', 'fit_out', 'mep', 'painting', 'civil', 'other']
var PRIORITIES = ['low', 'medium', 'high', 'urgent']
var CATEGORIES = ['guest_area', 'boh', 'kitchen', 'facade', 'mep', 'landscape', 'other']
var STATUSES = ['draft', 'pending', 'approved', 'in_progress', 'on_hold', 'completed', 'cancelled']
var EST_CATEGORIES = [
  { key: 'material', label: 'Material', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'labour', label: 'Labour', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'transport', label: 'Transport', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'other', label: 'Other', cls: 'bg-gray-50 text-gray-700 border-gray-200' },
]
var ATTACHMENT_KINDS = ['drawing', 'quote', 'invoice', 'photo', 'other']

function labelize(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase() }) }

function fieldCls() {
  return "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
}

// ═══ BASICS ═══
export function BasicsSection({ formApi, readOnly }) {
  var p = formApi.project
  var photoQueue = formApi.attachmentsQueue.filter(function (a) { return a.kind === 'photo' })

  async function handlePhotoAdd(ev) {
    var files = Array.from(ev.target.files || [])
    ev.target.value = ''
    for (var i = 0; i < files.length; i++) {
      try {
        var compressed = await compressImage(files[i], 300)
        formApi.addAttachment(compressed, 'photo', '')
      } catch (_) { /* skip corrupted */ }
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Basics</p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Project Name <span className="text-red-500">*</span></label>
        <input type="text" value={p.name} disabled={readOnly}
          onChange={function (ev) { formApi.updateProject({ name: ev.target.value }) }}
          placeholder="e.g. Grand Ballroom AC Overhaul"
          className={fieldCls()} style={{ fontSize: '16px' }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Project Type</label>
          <select value={p.project_type} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ project_type: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }}>
            {PROJECT_TYPES.map(function (t) { return <option key={t} value={t}>{labelize(t)}</option> })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
          <select value={p.priority} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ priority: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }}>
            {PRIORITIES.map(function (t) { return <option key={t} value={t}>{labelize(t)}</option> })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select value={p.category} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ category: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }}>
            <option value="">—</option>
            {CATEGORIES.map(function (t) { return <option key={t} value={t}>{labelize(t)}</option> })}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Work Details</label>
        <VoiceInput as="textarea" value={p.work_details} disabled={readOnly}
          onChange={function (ev) { formApi.updateProject({ work_details: ev.target.value }) }}
          rows="3" placeholder="Scope of work, specifics..."
          className={fieldCls() + " resize-none"} />
      </div>
      {!readOnly && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference Photos</label>
          <label className="flex items-center justify-center gap-2 py-2.5 px-3 border-2 border-dashed border-indigo-300 rounded-lg text-sm font-medium text-indigo-700 hover:bg-indigo-50 cursor-pointer transition-colors">
            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handlePhotoAdd} />
            📷 Capture / choose photos
          </label>
          {photoQueue.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              {photoQueue.map(function (a) {
                var idx = formApi.attachmentsQueue.indexOf(a)
                return (
                  <div key={a._key} className="relative">
                    <img src={URL.createObjectURL(a.file)} alt="ref" className="w-full h-16 object-cover rounded border border-gray-200" />
                    <button type="button" onClick={function () { formApi.removeQueuedAttachment(idx) }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center">×</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══ SITE ═══
export function SiteSection({ formApi, readOnly, refs }) {
  var p = formApi.project
  var venues = (refs.venues || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })

  function onVenueChange(venueId) {
    var v = venues.find(function (x) { return String(x.id) === venueId })
    formApi.updateProject({ venue_id: venueId, address: (v && v.address) ? v.address : p.address })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Site</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Venue <span className="text-red-500">*</span></label>
          <select value={p.venue_id} disabled={readOnly}
            onChange={function (ev) { onVenueChange(ev.target.value) }}
            className={fieldCls()} style={{ fontSize: '16px' }}>
            <option value="">Select venue...</option>
            {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sub-Venue / Area</label>
          <input type="text" value={p.sub_venue} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ sub_venue: ev.target.value }) }}
            placeholder="e.g. Rooftop, Banquet Hall B"
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
        <textarea value={p.address} disabled={readOnly}
          onChange={function (ev) { formApi.updateProject({ address: ev.target.value }) }}
          rows="2" placeholder="Auto-filled from venue — editable"
          className={fieldCls() + " resize-none"} style={{ fontSize: '16px' }} />
      </div>
    </div>
  )
}

// ═══ PEOPLE ═══
export function PeopleSection({ formApi, readOnly, refs }) {
  var p = formApi.project
  var employees = refs.employees || []
  var empOptions = employees.map(function (e) { return { value: String(e.id), label: e.full_name + (e.designation ? ' — ' + e.designation : '') } })

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">People</p>
      <div className="grid grid-cols-2 gap-3">
        <SearchDropdown label="Project Manager" items={empOptions}
          value={p.project_manager_id} onChange={function (v) { formApi.updateProject({ project_manager_id: v }) }}
          placeholder="Search employee..." />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">PM Contact</label>
          <input type="tel" value={p.pm_contact} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ pm_contact: ev.target.value }) }}
            placeholder="Phone number"
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
      </div>
      <SearchDropdown label="Site Supervisor" items={empOptions}
        value={p.site_supervisor_id} onChange={function (v) { formApi.updateProject({ site_supervisor_id: v }) }}
        placeholder="Search employee..." />
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
        <select value={p.status} disabled={readOnly}
          onChange={function (ev) { formApi.updateProject({ status: ev.target.value }) }}
          className={fieldCls()} style={{ fontSize: '16px' }}>
          {STATUSES.map(function (s) { return <option key={s} value={s}>{labelize(s)}</option> })}
        </select>
      </div>
    </div>
  )
}

// ═══ VENDORS ═══
export function VendorsSection({ formApi, readOnly, refs }) {
  var vendors = (refs.vendors || []).filter(function (v) { return v.active }).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })
  var vendorOptions = vendors.map(function (v) { return { value: String(v.id), label: v.name } })

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Vendors</p>
        {!readOnly && (
          <button type="button" onClick={formApi.addVendorLine} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add vendor</button>
        )}
      </div>
      <div className="space-y-2">
        {formApi.vendorLines.map(function (v, idx) {
          return (
            <div key={v._key} className="flex gap-2 items-start border-t border-gray-100 pt-2 first:border-0 first:pt-0">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <SearchDropdown items={vendorOptions} value={v.vendor_id}
                  onChange={function (val) { formApi.updateVendorLine(idx, { vendor_id: val }) }}
                  placeholder="Vendor..." />
                <input type="text" value={v.trade} disabled={readOnly}
                  onChange={function (ev) { formApi.updateVendorLine(idx, { trade: ev.target.value }) }}
                  placeholder="Trade (e.g. Electrical)"
                  className={fieldCls()} style={{ fontSize: '16px' }} />
                <input type="text" value={v.contact_override} disabled={readOnly}
                  onChange={function (ev) { formApi.updateVendorLine(idx, { contact_override: ev.target.value }) }}
                  placeholder="Contact override"
                  className={fieldCls()} style={{ fontSize: '16px' }} />
              </div>
              {!readOnly && formApi.vendorLines.length > 1 && (
                <button type="button" onClick={function () { formApi.removeVendorLine(idx) }}
                  className="text-red-400 hover:text-red-600 text-sm mt-2">✕</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══ TIMELINE + BUDGET ═══
export function TimelineBudgetSection({ formApi, readOnly, refs }) {
  var p = formApi.project
  var pt = p.payment_terms || { type: 'on_completion', advance_pct: '', milestones: [] }
  var variancePaise = p.approved_budget_rupees ? Math.round(Number(p.approved_budget_rupees) * 100) - formApi.estimatedTotalPaise : null

  function addMilestone() {
    formApi.updatePaymentTerms({ milestones: (pt.milestones || []).concat([{ label: '', pct: '' }]) })
  }
  function updateMilestone(idx, patch) {
    formApi.updatePaymentTerms({ milestones: (pt.milestones || []).map(function (m, i) { return i === idx ? Object.assign({}, m, patch) : m }) })
  }
  function removeMilestone(idx) {
    formApi.updatePaymentTerms({ milestones: (pt.milestones || []).filter(function (_, i) { return i !== idx }) })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Timeline & Budget</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
          <input type="date" value={p.start_date} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ start_date: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Estimated End</label>
          <input type="date" value={p.estimated_end_date} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ estimated_end_date: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Actual End</label>
          <input type="date" value={p.actual_end_date} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ actual_end_date: ev.target.value }) }}
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Approved Budget (₹)</label>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={p.approved_budget_rupees} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ approved_budget_rupees: ev.target.value }) }}
            placeholder="0.00"
            className={fieldCls()} style={{ fontSize: '16px' }} />
          {variancePaise != null && (
            <p className={"text-[11px] mt-1 font-medium " + (variancePaise < 0 ? "text-red-600" : "text-green-600")}>
              {variancePaise < 0 ? 'Over estimate by ' + formatPoints(Math.abs(variancePaise)) : 'Under estimate by ' + formatPoints(variancePaise)}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Warranty (months)</label>
          <input type="number" min="0" value={p.warranty_months} disabled={readOnly}
            onChange={function (ev) { formApi.updateProject({ warranty_months: ev.target.value }) }}
            placeholder="e.g. 12"
            className={fieldCls()} style={{ fontSize: '16px' }} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
        <select value={pt.type} disabled={readOnly}
          onChange={function (ev) { formApi.updatePaymentTerms({ type: ev.target.value }) }}
          className={fieldCls()} style={{ fontSize: '16px' }}>
          <option value="on_completion">On Completion</option>
          <option value="advance_pct">Advance %</option>
          <option value="milestone">Milestone</option>
        </select>
        {pt.type === 'advance_pct' && (
          <input type="number" min="0" max="100" value={pt.advance_pct} disabled={readOnly}
            onChange={function (ev) { formApi.updatePaymentTerms({ advance_pct: ev.target.value }) }}
            placeholder="Advance %"
            className={fieldCls() + " mt-2"} style={{ fontSize: '16px' }} />
        )}
        {pt.type === 'milestone' && (
          <div className="mt-2 space-y-1.5">
            {(pt.milestones || []).map(function (m, idx) {
              return (
                <div key={idx} className="flex gap-2">
                  <input type="text" value={m.label} disabled={readOnly}
                    onChange={function (ev) { updateMilestone(idx, { label: ev.target.value }) }}
                    placeholder="Milestone label" className={fieldCls()} style={{ fontSize: '16px' }} />
                  <input type="number" min="0" max="100" value={m.pct} disabled={readOnly}
                    onChange={function (ev) { updateMilestone(idx, { pct: ev.target.value }) }}
                    placeholder="%" className={fieldCls() + " w-24"} style={{ fontSize: '16px' }} />
                  {!readOnly && <button type="button" onClick={function () { removeMilestone(idx) }} className="text-red-400 hover:text-red-600 text-sm">✕</button>}
                </div>
              )
            })}
            {!readOnly && <button type="button" onClick={addMilestone} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add milestone</button>}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══ ESTIMATION ═══
export function EstimationSection({ formApi, readOnly }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Estimation</p>
        {!readOnly && (
          <button type="button" onClick={formApi.addEstimationLine} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add line</button>
        )}
      </div>
      <div className="space-y-2">
        {formApi.estimationLines.map(function (l, idx) {
          var linePaise = formApi.estimationLinePaise(l)
          return (
            <div key={l._key} className="border-t border-gray-100 pt-2 first:border-0 first:pt-0 space-y-1.5">
              <div className="flex gap-2 items-start">
                <VoiceInput type="text" value={l.description} disabled={readOnly}
                  onChange={function (ev) { formApi.updateEstimationLine(idx, { description: ev.target.value }) }}
                  placeholder="Description"
                  className={fieldCls() + " flex-1"} />
                {!readOnly && formApi.estimationLines.length > 1 && (
                  <button type="button" onClick={function () { formApi.removeEstimationLine(idx) }} className="text-red-400 hover:text-red-600 text-sm mt-2">✕</button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <input type="number" min="0" step="0.001" inputMode="decimal" value={l.quantity} disabled={readOnly}
                  onChange={function (ev) { formApi.updateEstimationLine(idx, { quantity: ev.target.value }) }}
                  placeholder="Qty" className={fieldCls()} style={{ fontSize: '16px' }} />
                <input type="text" value={l.unit} disabled={readOnly}
                  onChange={function (ev) { formApi.updateEstimationLine(idx, { unit: ev.target.value }) }}
                  placeholder="Unit" className={fieldCls()} style={{ fontSize: '16px' }} />
                <input type="number" min="0" step="0.01" inputMode="decimal" value={l.rate_rupees} disabled={readOnly}
                  onChange={function (ev) { formApi.updateEstimationLine(idx, { rate_rupees: ev.target.value }) }}
                  placeholder="Rate ₹" className={fieldCls()} style={{ fontSize: '16px' }} />
                <div className="flex items-center justify-end text-sm font-semibold text-gray-800 px-1">{formatPoints(linePaise)}</div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {EST_CATEGORIES.map(function (c) {
                  var active = l.category_tag === c.key
                  return (
                    <button key={c.key} type="button" disabled={readOnly}
                      onClick={function () { formApi.updateEstimationLine(idx, { category_tag: c.key }) }}
                      className={"px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors " + (active ? c.cls : "bg-white text-gray-400 border-gray-200")}>
                      {c.label}
                    </button>
                  )
                })}
              </div>
              <VoiceInput type="text" value={l.notes} disabled={readOnly}
                onChange={function (ev) { formApi.updateEstimationLine(idx, { notes: ev.target.value }) }}
                placeholder="Notes (optional)"
                className={fieldCls()} />
            </div>
          )
        })}
      </div>
      <div className="pt-2 border-t border-gray-100 flex justify-between text-sm font-bold text-gray-800">
        <span>Total</span>
        <span>{formatPoints(formApi.estimatedTotalPaise)}</span>
      </div>
    </div>
  )
}

// ═══ ATTACHMENTS ═══
// Removing an *existing* (already-uploaded) attachment is admin-only — both
// project_attachments' and the storage bucket's DELETE policies are admin-only by
// design (RLS), so showing this button to any editor would silently no-op the delete
// (0 rows affected, no error) while the UI optimistically removed it from the list —
// it would just reappear on next load. Queued (not-yet-uploaded) attachments are pure
// local state and can always be removed by whoever is editing.
export function AttachmentsSection({ formApi, readOnly, isAdmin }) {
  var nonPhotoQueue = formApi.attachmentsQueue.filter(function (a) { return a.kind !== 'photo' })

  async function handleFileAdd(ev) {
    var files = Array.from(ev.target.files || [])
    ev.target.value = ''
    files.forEach(function (f) { formApi.addAttachment(f, 'other', '') })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Attachments</p>
      {formApi.existingAttachments.length > 0 && (
        <div className="space-y-1.5">
          {formApi.existingAttachments.map(function (a) {
            var url = supabase.storage.from('project-attachments').getPublicUrl(a.file_path).data?.publicUrl
            return (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">{a.caption || a.file_path.split('/').pop()}</a>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">{a.kind}</span>
                {!readOnly && isAdmin && <button type="button" onClick={function () { formApi.removeExistingAttachment(a.id) }} className="text-red-400 hover:text-red-600 text-sm">✕</button>}
              </div>
            )
          })}
        </div>
      )}
      {!readOnly && (
        <>
          <label className="flex items-center justify-center gap-2 py-2.5 px-3 border-2 border-dashed border-indigo-300 rounded-lg text-sm font-medium text-indigo-700 hover:bg-indigo-50 cursor-pointer transition-colors">
            <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleFileAdd} />
            📎 Add drawing / quote / invoice
          </label>
          {nonPhotoQueue.length > 0 && (
            <div className="space-y-1.5">
              {nonPhotoQueue.map(function (a) {
                var idx = formApi.attachmentsQueue.indexOf(a)
                return (
                  <div key={a._key} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-gray-700">{a.file.name}</span>
                    <select value={a.kind} onChange={function (ev) { formApi.updateQueuedAttachment(idx, { kind: ev.target.value }) }}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5">
                      {ATTACHMENT_KINDS.map(function (k) { return <option key={k} value={k}>{k}</option> })}
                    </select>
                    <button type="button" onClick={function () { formApi.removeQueuedAttachment(idx) }} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ═══ LINKED EVENT ═══
export function LinkedEventSection({ formApi, readOnly }) {
  var p = formApi.project
  var [eventDate, setEventDate] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(function () {
    if (p.event_id && !selectedEvent) {
      supabase.from('events').select('id, event_name, client_name, function_date').eq('id', Number(p.event_id)).maybeSingle()
        .then(function (res) { if (res.data) setSelectedEvent(res.data) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.event_id])

  function loadEventsByDate(dateStr) {
    setEventDate(dateStr)
    if (!dateStr) { setEvents([]); return }
    setEventsLoading(true)
    supabase.from('events').select('id, event_name, client_name, function_date').eq('function_date', dateStr).order('event_name')
      .then(function (res) { setEvents(res.data || []); setEventsLoading(false) })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Linked Event (optional)</p>
      {!readOnly && (
        <>
          <EventDatePicker label="Event Date" value={eventDate} onChange={loadEventsByDate} includePast />
          {eventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
          {eventDate && !eventsLoading && events.length === 0 && <p className="text-xs text-gray-400">No events on this date</p>}
          {events.length > 0 && (
            <select value={p.event_id} onChange={function (ev) {
              var id = ev.target.value
              formApi.updateProject({ event_id: id })
              setSelectedEvent(events.find(function (e) { return String(e.id) === id }) || null)
            }} className={fieldCls()} style={{ fontSize: '16px' }}>
              <option value="">No linked event</option>
              {events.map(function (e) { return <option key={e.id} value={e.id}>{e.event_name}{e.client_name ? ' — ' + e.client_name : ''}</option> })}
            </select>
          )}
        </>
      )}
      {p.event_id && selectedEvent && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
          <p className="text-sm font-bold text-indigo-800">{selectedEvent.event_name}</p>
          <p className="text-xs text-indigo-600">{selectedEvent.client_name}{selectedEvent.function_date ? ' · ' + formatDate(selectedEvent.function_date) : ''}</p>
          <p className="text-[11px] text-amber-700 font-medium">⚠ Postings on this project's ledger will mirror to this event's ledger.</p>
        </div>
      )}
    </div>
  )
}
