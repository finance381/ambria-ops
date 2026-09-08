import { useState } from 'react'

// Money fields are held as rupee strings in form state (user-facing) and only
// converted to paise integers in getPayload() — never store paise in form state.

function makeKey() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

function makeEmptyProject() {
  return {
    id: null,
    project_code: '',
    name: '',
    project_type: 'renovation',
    priority: 'medium',
    category: '',
    work_details: '',
    status: 'draft',
    venue_id: '',
    sub_venue: '',
    address: '',
    project_manager_id: '',
    pm_contact: '',
    site_supervisor_id: '',
    approved_by: '',
    start_date: '',
    estimated_end_date: '',
    actual_end_date: '',
    approved_budget_rupees: '',
    payment_terms: { type: 'on_completion', advance_pct: '', milestones: [] },
    warranty_months: '',
    event_id: '',
    notes: '',
  }
}

function makeVendorLine() {
  return { _key: makeKey(), vendor_id: '', trade: '', contact_override: '' }
}

function makeEstimationLine() {
  return { _key: makeKey(), description: '', quantity: '', unit: 'Nos', rate_rupees: '', category_tag: 'material', notes: '' }
}

function useProjectForm() {
  var [project, setProject] = useState(makeEmptyProject)
  var [vendorLines, setVendorLines] = useState([makeVendorLine()])
  var [estimationLines, setEstimationLines] = useState([makeEstimationLine()])
  var [attachmentsQueue, setAttachmentsQueue] = useState([])       // [{ _key, file, kind, caption }] — pending upload
  var [existingAttachments, setExistingAttachments] = useState([]) // [{ id, file_path, kind, caption }] — already saved (edit mode)
  var [removedAttachmentIds, setRemovedAttachmentIds] = useState([])
  var [error, setError] = useState('')

  function updateProject(patch) {
    setProject(function (prev) { return Object.assign({}, prev, patch) })
  }

  function updatePaymentTerms(patch) {
    setProject(function (prev) { return Object.assign({}, prev, { payment_terms: Object.assign({}, prev.payment_terms, patch) }) })
  }

  // ── Vendor lines ──
  function addVendorLine() {
    setVendorLines(function (prev) { return prev.concat([makeVendorLine()]) })
  }
  function updateVendorLine(idx, patch) {
    setVendorLines(function (prev) {
      return prev.map(function (v, i) { return i === idx ? Object.assign({}, v, patch) : v })
    })
  }
  function removeVendorLine(idx) {
    setVendorLines(function (prev) {
      if (prev.length <= 1) return prev.map(function (v, i) { return i === idx ? makeVendorLine() : v })
      return prev.filter(function (_, i) { return i !== idx })
    })
  }

  // ── Estimation lines ──
  function addEstimationLine() {
    setEstimationLines(function (prev) { return prev.concat([makeEstimationLine()]) })
  }
  function updateEstimationLine(idx, patch) {
    setEstimationLines(function (prev) {
      return prev.map(function (l, i) { return i === idx ? Object.assign({}, l, patch) : l })
    })
  }
  function removeEstimationLine(idx) {
    setEstimationLines(function (prev) {
      if (prev.length <= 1) return prev.map(function (l, i) { return i === idx ? makeEstimationLine() : l })
      return prev.filter(function (_, i) { return i !== idx })
    })
  }
  function duplicateEstimationLine(idx) {
    setEstimationLines(function (prev) {
      var src = prev[idx]
      if (!src) return prev
      var dup = Object.assign({}, src, { _key: makeKey() })
      var next = prev.slice()
      next.splice(idx + 1, 0, dup)
      return next
    })
  }

  // ── Attachments ──
  function addAttachment(file, kind, caption) {
    setAttachmentsQueue(function (prev) { return prev.concat([{ _key: makeKey(), file: file, kind: kind || 'other', caption: caption || '' }]) })
  }
  function removeQueuedAttachment(idx) {
    setAttachmentsQueue(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }
  function updateQueuedAttachment(idx, patch) {
    setAttachmentsQueue(function (prev) { return prev.map(function (a, i) { return i === idx ? Object.assign({}, a, patch) : a }) })
  }
  function removeExistingAttachment(id) {
    setExistingAttachments(function (prev) { return prev.filter(function (a) { return a.id !== id }) })
    setRemovedAttachmentIds(function (prev) { return prev.indexOf(id) === -1 ? prev.concat([id]) : prev })
  }

  // ── Load existing (edit mode) ──
  function loadFromExisting(row, vendorRows, estimationRows, attachmentRows) {
    setProject({
      id: row.id,
      project_code: row.project_code || '',
      name: row.name || '',
      project_type: row.project_type || 'renovation',
      priority: row.priority || 'medium',
      category: row.category || '',
      work_details: row.work_details || '',
      status: row.status || 'draft',
      venue_id: row.venue_id != null ? String(row.venue_id) : '',
      sub_venue: row.sub_venue || '',
      address: row.address || '',
      project_manager_id: row.project_manager_id || '',
      pm_contact: row.pm_contact || '',
      site_supervisor_id: row.site_supervisor_id || '',
      approved_by: row.approved_by || '',
      start_date: row.start_date || '',
      estimated_end_date: row.estimated_end_date || '',
      actual_end_date: row.actual_end_date || '',
      approved_budget_rupees: row.approved_budget_paise != null ? String(row.approved_budget_paise / 100) : '',
      payment_terms: row.payment_terms || { type: 'on_completion', advance_pct: '', milestones: [] },
      warranty_months: row.warranty_months != null ? String(row.warranty_months) : '',
      event_id: row.event_id != null ? String(row.event_id) : '',
      notes: row.notes || '',
    })
    setVendorLines((vendorRows || []).length > 0
      ? vendorRows.map(function (v) { return { _key: makeKey(), vendor_id: String(v.vendor_id), trade: v.trade || '', contact_override: v.contact_override || '' } })
      : [makeVendorLine()])
    setEstimationLines((estimationRows || []).length > 0
      ? estimationRows.map(function (e) {
          return {
            _key: makeKey(),
            description: e.description || '',
            quantity: e.quantity != null ? String(e.quantity) : '',
            unit: e.unit || 'Nos',
            rate_rupees: e.rate_paise != null ? String(e.rate_paise / 100) : '',
            category_tag: e.category_tag || 'material',
            notes: e.notes || '',
          }
        })
      : [makeEstimationLine()])
    setExistingAttachments(attachmentRows || [])
    setRemovedAttachmentIds([])
    setAttachmentsQueue([])
  }

  function reset() {
    setProject(makeEmptyProject())
    setVendorLines([makeVendorLine()])
    setEstimationLines([makeEstimationLine()])
    setAttachmentsQueue([])
    setExistingAttachments([])
    setRemovedAttachmentIds([])
    setError('')
  }

  // ── Derived ──
  function estimationLinePaise(line) {
    var qty = Number(line.quantity) || 0
    var rate = Math.round((Number(line.rate_rupees) || 0) * 100)
    return Math.round(qty * rate)
  }
  var estimatedTotalPaise = estimationLines.reduce(function (s, l) { return s + estimationLinePaise(l) }, 0)
  var categoryBreakdown = (function () {
    var byCat = { material: 0, labour: 0, transport: 0, other: 0 }
    estimationLines.forEach(function (l) {
      var cat = byCat[l.category_tag] != null ? l.category_tag : 'other'
      byCat[cat] += estimationLinePaise(l)
    })
    return byCat
  })()

  // ── Validation ──
  function validate() {
    if (!project.name.trim()) return 'Project name is required'
    if (!project.venue_id) return 'Select a venue'
    for (var i = 0; i < vendorLines.length; i++) {
      var v = vendorLines[i]
      if (!v.vendor_id && (v.trade || v.contact_override)) return 'Vendor ' + (i + 1) + ': select a vendor'
    }
    for (var j = 0; j < estimationLines.length; j++) {
      var l = estimationLines[j]
      var hasAny = l.description.trim() || l.quantity || l.rate_rupees
      if (!hasAny) continue
      if (!l.description.trim()) return 'Estimation line ' + (j + 1) + ': description required'
      if (!l.quantity || Number(l.quantity) <= 0) return 'Estimation line ' + (j + 1) + ': quantity must be > 0'
    }
    return null
  }

  // ── Payload for rpc_project_upsert ──
  function getPayload() {
    var p = project
    return {
      project: {
        id: p.id,
        name: p.name.trim(),
        project_type: p.project_type,
        priority: p.priority,
        category: p.category || null,
        work_details: p.work_details.trim() || null,
        status: p.status,
        venue_id: p.venue_id ? Number(p.venue_id) : null,
        sub_venue: p.sub_venue.trim() || null,
        address: p.address.trim() || null,
        project_manager_id: p.project_manager_id || null,
        pm_contact: p.pm_contact.trim() || null,
        site_supervisor_id: p.site_supervisor_id || null,
        approved_by: p.approved_by || null,
        start_date: p.start_date || null,
        estimated_end_date: p.estimated_end_date || null,
        actual_end_date: p.actual_end_date || null,
        approved_budget_paise: p.approved_budget_rupees ? Math.round(Number(p.approved_budget_rupees) * 100) : null,
        payment_terms: p.payment_terms,
        warranty_months: p.warranty_months ? Number(p.warranty_months) : null,
        event_id: p.event_id ? Number(p.event_id) : null,
        notes: p.notes.trim() || null,
      },
      vendors: vendorLines
        .filter(function (v) { return v.vendor_id })
        .map(function (v, i) { return { vendor_id: Number(v.vendor_id), trade: v.trade.trim() || null, contact_override: v.contact_override.trim() || null, sort_order: i } }),
      estimation_items: estimationLines
        .filter(function (l) { return l.description.trim() && Number(l.quantity) > 0 })
        .map(function (l, i) {
          return {
            description: l.description.trim(),
            quantity: Number(l.quantity),
            unit: l.unit || 'Nos',
            rate_paise: Math.round((Number(l.rate_rupees) || 0) * 100),
            category_tag: l.category_tag,
            notes: l.notes.trim() || null,
            sort_order: i,
          }
        }),
    }
  }

  return {
    project, updateProject, updatePaymentTerms,
    vendorLines, addVendorLine, updateVendorLine, removeVendorLine,
    estimationLines, addEstimationLine, updateEstimationLine, removeEstimationLine, duplicateEstimationLine,
    attachmentsQueue, addAttachment, removeQueuedAttachment, updateQueuedAttachment,
    existingAttachments, removedAttachmentIds, removeExistingAttachment,
    loadFromExisting, reset,
    estimatedTotalPaise, categoryBreakdown, estimationLinePaise,
    error, setError,
    validate, getPayload,
  }
}

export default useProjectForm
