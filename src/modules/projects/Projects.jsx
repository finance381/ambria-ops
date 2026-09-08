import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { logActivity } from '../../lib/logger'
import useProjectForm from './useProjectForm'
import useProjectSubmit from './useProjectSubmit'
import {
  BasicsSection, SiteSection, PeopleSection, VendorsSection,
  TimelineBudgetSection, EstimationSection, AttachmentsSection, LinkedEventSection,
} from './ProjectFormShared'
import ProjectLedger from './ProjectLedger'

var STATUS_CLS = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
}

var WIZARD_STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'site', label: 'Site' },
  { key: 'people', label: 'People & Vendors' },
  { key: 'timeline', label: 'Timeline & Budget' },
  { key: 'review', label: 'Estimation & Review' },
]

function Projects({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'projects.view')
  var canCreate = hasPerm(permsNew, 'projects.create')
  var canApprove = hasPerm(permsNew, 'projects.approve')
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canSeeLedgerCost = hasPerm(permsNew, 'projects.ledger.view')

  var refData = useReferenceData()
  var [vendors, setVendors] = useState([])
  var refs = { venues: refData.venues, employees: refData.employees, vendors: vendors }

  var [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true)
  useEffect(function () {
    function onResize() { setIsDesktop(window.innerWidth >= 768) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  var [view, setView] = useState('list') // 'list' | 'form' | 'ledger'
  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [venueFilter, setVenueFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [wizardStep, setWizardStep] = useState(0)

  var formApi = useProjectForm()
  var submitApi = useProjectSubmit(formApi, function (projectId) { loadList(); setView('list'); setWizardStep(0) })

  useEffect(function () {
    if (canView) loadList()
    supabase.from('vendors').select('id, name, active').eq('active', true).order('name')
      .then(function (res) { setVendors(res.data || []) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, venueFilter, statusFilter])

  async function loadList() {
    setLoading(true)
    var q = supabase.from('projects')
      .select('id, project_code, name, project_type, status, venue_id, estimated_cost_paise, project_manager_id, created_at')
      .order('created_at', { ascending: false })
    if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
    if (statusFilter) q = q.eq('status', statusFilter)
    var res = await q
    var data = res.data || []

    var venueName = {}; (refData.venues || []).forEach(function (v) { venueName[v.id] = v.code ? v.code + ' — ' + v.name : v.name })
    var pmName = {}; (refData.employees || []).forEach(function (e) { pmName[e.id] = e.full_name })
    setRows(data.map(function (r) {
      return Object.assign({}, r, { _venueName: venueName[r.venue_id] || '—', _pmName: pmName[r.project_manager_id] || '—' })
    }))
    setLoading(false)
  }

  function startNew() {
    formApi.reset()
    setWizardStep(0)
    setView('form')
  }

  async function openProject(id) {
    var [pRes, vRes, eRes, aRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_vendors').select('vendor_id, trade, contact_override').eq('project_id', id).order('sort_order'),
      supabase.from('project_estimation_items').select('description, quantity, unit, rate_paise, category_tag, notes').eq('project_id', id).order('sort_order'),
      supabase.from('project_attachments').select('id, file_path, kind, caption').eq('project_id', id),
    ])
    if (!pRes.data) { alert('Failed to load project: ' + (pRes.error?.message || 'not found')); return }
    formApi.loadFromExisting(pRes.data, vRes.data, eRes.data, aRes.data)
    setWizardStep(0)
    setView('form')
    try { await logActivity('PROJECT_VIEW', pRes.data.name + ' (#' + id + ')') } catch (_) {}
  }

  function backToList() {
    setView('list')
    loadList()
  }

  async function approveProject() {
    formApi.updateProject({ status: 'approved' })
    await submitApi.submit()
  }

  if (!canView) return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Projects.</p>

  // ═══ LEDGER VIEW ═══
  if (view === 'ledger') {
    return <ProjectLedger profile={profile} project={{
      id: formApi.project.id,
      project_code: formApi.project.project_code,
      name: formApi.project.name,
      status: formApi.project.status,
      approved_budget_paise: formApi.project.approved_budget_rupees ? Math.round(Number(formApi.project.approved_budget_rupees) * 100) : 0,
    }} onBack={function () { setView('form') }} />
  }

  // ═══ FORM VIEW ═══
  if (view === 'form') {
    var p = formApi.project
    var readOnly = !!p.id && !hasPerm(permsNew, 'projects.edit')
    var canEditSensitive = !p.id ? canCreate : hasPerm(permsNew, 'projects.edit')

    if (isDesktop) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <button onClick={backToList} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Projects</button>
              <h2 className="text-lg font-bold text-gray-900">{p.id ? p.name || 'Project' : 'New Project'}</h2>
              <p className="text-xs text-gray-500">
                {p.project_code && <span className="font-mono">{p.project_code}</span>}
                {p.status && <span className={"ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded " + (STATUS_CLS[p.status] || '')}>{p.status.replace(/_/g, ' ')}</span>}
              </p>
            </div>
            <div className="flex gap-2">
              {formApi.error && <span className="text-xs text-red-600 self-center max-w-md">{formApi.error}</span>}
              {p.id && hasPerm(permsNew, 'projects.ledger.view') && (
                <button onClick={function () { setView('ledger') }}
                  className="px-3 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                  📒 Ledger
                </button>
              )}
              {!readOnly && (
                <button onClick={submitApi.submit} disabled={submitApi.saving}
                  className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {submitApi.saving ? 'Saving...' : 'Save Project'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr] gap-4 items-start">
            <div className="space-y-4">
              <BasicsSection formApi={formApi} readOnly={readOnly} />
              <SiteSection formApi={formApi} readOnly={readOnly} refs={refs} />
              <PeopleSection formApi={formApi} readOnly={readOnly} refs={refs} />
              <VendorsSection formApi={formApi} readOnly={readOnly} refs={refs} />
              <TimelineBudgetSection formApi={formApi} readOnly={readOnly} refs={refs} />
              <EstimationSection formApi={formApi} readOnly={readOnly} />
              <AttachmentsSection formApi={formApi} readOnly={readOnly} isAdmin={isAdmin} />
              <LinkedEventSection formApi={formApi} readOnly={readOnly} />
            </div>
            <div className="space-y-4 sticky" style={{ top: '16px' }}>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Live Estimate</p>
                {canSeeLedgerCost ? (
                  <>
                    <p className="text-2xl font-bold text-gray-900">{formatPoints(formApi.estimatedTotalPaise)}</p>
                    <div className="mt-2 space-y-1">
                      {Object.keys(formApi.categoryBreakdown).map(function (cat) {
                        var amt = formApi.categoryBreakdown[cat]
                        var pct = formApi.estimatedTotalPaise > 0 ? Math.round((amt / formApi.estimatedTotalPaise) * 100) : 0
                        if (amt === 0) return null
                        return (
                          <div key={cat} className="flex justify-between text-[11px] text-gray-500">
                            <span className="capitalize">{cat}</span><span>{pct}% · {formatPoints(amt)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : <p className="text-lg font-bold text-gray-300">—</p>}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Approved Budget</p>
                {canSeeLedgerCost ? (
                  <p className="text-lg font-bold text-gray-900">{p.approved_budget_rupees ? formatPoints(Math.round(Number(p.approved_budget_rupees) * 100)) : '—'}</p>
                ) : <p className="text-lg font-bold text-gray-300">—</p>}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Timeline</p>
                <p className="text-xs text-gray-600">{p.start_date ? formatDate(p.start_date) : '—'} → {p.estimated_end_date ? formatDate(p.estimated_end_date) : '—'}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Attachments</p>
                <p className="text-lg font-bold text-gray-900">{formApi.existingAttachments.length + formApi.attachmentsQueue.length}</p>
              </div>
              {canApprove && p.status === 'pending' && (
                <button onClick={approveProject} disabled={submitApi.saving}
                  className="w-full px-4 py-2.5 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                  ✓ Approve Project
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }

    // ═══ MOBILE WIZARD ═══
    var stepKey = WIZARD_STEPS[wizardStep].key
    function stepValid() {
      if (stepKey === 'basics') return !!p.name.trim()
      if (stepKey === 'site') return !!p.venue_id
      return true
    }
    async function saveDraft() {
      formApi.updateProject({ status: 'draft' })
      await submitApi.submit()
    }
    return (
      <div className="space-y-3 pb-4">
        <button onClick={backToList} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">← Back to Projects</button>
        <div className="flex items-center gap-1.5">
          {WIZARD_STEPS.map(function (s, i) {
            var done = i < wizardStep
            var active = i === wizardStep
            return (
              <div key={s.key} className={"flex-1 h-1.5 rounded-full " + (done || active ? "bg-indigo-500" : "bg-gray-200")} title={s.label} />
            )
          })}
        </div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Step {wizardStep + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[wizardStep].label}</p>

        {formApi.error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formApi.error}</p>}

        {stepKey === 'basics' && <BasicsSection formApi={formApi} readOnly={readOnly} />}
        {stepKey === 'site' && <SiteSection formApi={formApi} readOnly={readOnly} refs={refs} />}
        {stepKey === 'people' && (
          <>
            <PeopleSection formApi={formApi} readOnly={readOnly} refs={refs} />
            <VendorsSection formApi={formApi} readOnly={readOnly} refs={refs} />
          </>
        )}
        {stepKey === 'timeline' && (
          <>
            <TimelineBudgetSection formApi={formApi} readOnly={readOnly} refs={refs} />
            <LinkedEventSection formApi={formApi} readOnly={readOnly} />
          </>
        )}
        {stepKey === 'review' && (
          <>
            <EstimationSection formApi={formApi} readOnly={readOnly} />
            <AttachmentsSection formApi={formApi} readOnly={readOnly} isAdmin={isAdmin} />
          </>
        )}

        <div className="sticky bottom-0 bg-gray-50/95 backdrop-blur pt-2 pb-1 flex gap-2">
          {wizardStep > 0 && (
            <button onClick={function () { setWizardStep(wizardStep - 1) }} className="flex-1 py-2.5 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg">← Back</button>
          )}
          {!readOnly && (
            <button onClick={saveDraft} disabled={submitApi.saving} className="flex-1 py-2.5 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg disabled:opacity-50">Save Draft</button>
          )}
          {wizardStep < WIZARD_STEPS.length - 1 ? (
            <button onClick={function () { if (stepValid()) setWizardStep(wizardStep + 1) }} className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg">Next →</button>
          ) : !readOnly ? (
            <button onClick={submitApi.submit} disabled={submitApi.saving} className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
              {submitApi.saving ? 'Submitting...' : 'Submit'}
            </button>
          ) : null}
        </div>
        {canApprove && p.status === 'pending' && (
          <button onClick={approveProject} disabled={submitApi.saving} className="w-full py-2.5 text-sm font-bold text-white bg-green-600 rounded-lg disabled:opacity-50">✓ Approve Project</button>
        )}
        {p.id && hasPerm(permsNew, 'projects.ledger.view') && (
          <button onClick={function () { setView('ledger') }} className="w-full py-2.5 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg">📒 Open Ledger</button>
        )}
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Projects</h2>
          <p className="text-xs text-gray-400">{rows.length} project{rows.length !== 1 ? 's' : ''}</p>
        </div>
        {canCreate && (
          <button onClick={startNew} className="px-3 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">+ New Project</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={venueFilter} onChange={function (ev) { setVenueFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All venues</option>
          {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
        </select>
        <select value={statusFilter} onChange={function (ev) { setStatusFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All status</option>
          {Object.keys(STATUS_CLS).map(function (s) { return <option key={s} value={s}>{s.replace(/_/g, ' ')}</option> })}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No projects yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Code</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Venue</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">PM</th>
                  {canSeeLedgerCost && <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Est. Cost</th>}
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function (r) {
                  return (
                    <tr key={r.id} className="border-b border-gray-100 last:border-b-0 hover:bg-indigo-50/30 cursor-pointer" onClick={function () { openProject(r.id) }}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.project_code}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r._venueName}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 capitalize">{(r.project_type || '').replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2"><span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded " + (STATUS_CLS[r.status] || '')}>{(r.status || '').replace(/_/g, ' ')}</span></td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r._pmName}</td>
                      {canSeeLedgerCost && <td className="px-3 py-2 text-right font-mono text-xs">{formatPoints(r.estimated_cost_paise)}</td>}
                      <td className="px-3 py-2 text-right text-xs text-indigo-600 font-semibold">Open →</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Projects
