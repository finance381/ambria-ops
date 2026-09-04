import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import { logActivity } from '../../lib/logger'
import { DEFAULT_ROLES, countActiveFeatures, normalizePerms } from '../../lib/permissions'
import PermMatrix from '../../components/PermMatrix'

var ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  auditor: 'bg-pink-100 text-pink-700 border-pink-200',
  sales: 'bg-blue-100 text-blue-700 border-blue-200',
  production: 'bg-amber-100 text-amber-700 border-amber-200',
  logistics: 'bg-green-100 text-green-700 border-green-200',
}

function RoleTemplates({ profile }) {
  var isAdmin = profile?.role === 'admin'

  var [templates, setTemplates] = useState([])       // [{ role, permissions, updated_at, updated_by, user_count }]
  var [loading, setLoading] = useState(true)
  var [error, setError] = useState('')
  var [saving, setSaving] = useState(false)

  // Edit modal
  var [editRole, setEditRole] = useState(null)
  var [editValue, setEditValue] = useState({ mobile: [], desktop: [], scopes: {} })
  var [editVenueIds, setEditVenueIds] = useState([])
  var [venues, setVenues] = useState([])

  // Add-role modal
  var [addOpen, setAddOpen] = useState(false)
  var [addName, setAddName] = useState('')

  // Bulk-apply confirm
  var [bulkTarget, setBulkTarget] = useState(null)   // { role, permissions, user_count }
  var [bulkResult, setBulkResult] = useState('')

  useEffect(function () { if (isAdmin) load() }, [])

  async function load() {
    setLoading(true); setError('')
    var [rdRes, profRes, venueRes] = await Promise.all([
      supabase.from('role_defaults').select('role, mobile_permissions, desktop_permissions, data_scopes, venue_ids, updated_at, updated_by'),
      supabase.from('profiles').select('role, active'),
      supabase.from('venues').select('id, code, name, active').eq('active', true).order('id'),
    ])
    setVenues(venueRes.data || [])
    if (rdRes.error) { setError(rdRes.error.message); setLoading(false); return }

    // Distinct roles across role_defaults + profiles + DEFAULT_ROLES
    var counts = {}
    ;(profRes.data || []).forEach(function (p) {
      if (!p.role) return
      if (!counts[p.role]) counts[p.role] = { total: 0, active: 0 }
      counts[p.role].total += 1
      if (p.active) counts[p.role].active += 1
    })

    var byRole = {}
    ;(rdRes.data || []).forEach(function (r) { byRole[r.role] = r })

    var allRoles = []
    DEFAULT_ROLES.forEach(function (r) { if (allRoles.indexOf(r) === -1) allRoles.push(r) })
    Object.keys(byRole).forEach(function (r) { if (allRoles.indexOf(r) === -1) allRoles.push(r) })
    Object.keys(counts).forEach(function (r) { if (allRoles.indexOf(r) === -1) allRoles.push(r) })

    var rows = allRoles.map(function (role) {
      var t = byRole[role] || { role: role, mobile_permissions: [], desktop_permissions: [], data_scopes: {}, updated_at: null, updated_by: null }
      var c = counts[role] || { total: 0, active: 0 }
      return Object.assign({}, t, {
        user_count: c.total,
        active_count: c.active,
        seeded: !!byRole[role],
      })
    })

    setTemplates(rows)
    setLoading(false)
  }

  // ═══ EDIT ═══
  function openEdit(row) {
    setEditRole(row.role)
    setEditValue({
      mobile: (row.mobile_permissions || []).slice(),
      desktop: (row.desktop_permissions || []).slice(),
      scopes: Object.assign({}, row.data_scopes || {}),
    })
    setEditVenueIds((row.venue_ids || []).slice())
    setError('')
  }

  async function saveTemplate() {
    if (saving) return
    if (!editRole) return
    setSaving(true); setError('')
    var res = await supabase.from('role_defaults').upsert({
      role: editRole,
      mobile_permissions: editValue.mobile,
      desktop_permissions: editValue.desktop,
      data_scopes: editValue.scopes,
      venue_ids: editVenueIds,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'role' }).select()
    if (res.error) { setError(res.error.message); setSaving(false); return }
    try { await logActivity('ROLE_TEMPLATE_UPDATE', editRole + ' → ' + editValue.mobile.length + 'm/' + editValue.desktop.length + 'd perms, ' + editVenueIds.length + ' venues') } catch (_) {}
    setEditRole(null); setEditValue({ mobile: [], desktop: [], scopes: {} }); setEditVenueIds([])
    load()
    setSaving(false)
  }

  // ═══ BULK APPLY ═══
  async function runBulkApply() {
    if (saving) return
    if (!bulkTarget) return
    setSaving(true); setError(''); setBulkResult('')
    var _bMob = (bulkTarget.mobile_permissions  || []).slice()
    var _bDsk = (bulkTarget.desktop_permissions || []).slice()
    if (_bMob.indexOf('personal.profile') === -1) _bMob.push('personal.profile')
    if (_bDsk.indexOf('personal.profile') === -1) _bDsk.push('personal.profile')
    var res = await supabase.from('profiles')
      .update({
        mobile_permissions: _bMob,
        desktop_permissions: _bDsk,
        data_scopes: bulkTarget.data_scopes || {},
        venue_ids: bulkTarget.venue_ids || [],
      })
      .eq('role', bulkTarget.role)
      .select('id')
    if (res.error) { setError(res.error.message); setSaving(false); return }

    var n = (res.data || []).length
    try { await logActivity('ROLE_TEMPLATE_BULK_APPLY', bulkTarget.role + ' → ' + n + ' users') } catch (_) {}
    setBulkResult('Applied to ' + n + ' user' + (n === 1 ? '' : 's') + '.')
    setSaving(false)
    setTimeout(function () { setBulkTarget(null); setBulkResult(''); load() }, 1400)
  }

  // ═══ ADD NEW ROLE TEMPLATE ═══
  async function addRoleTemplate() {
    if (saving) return
    var name = addName.trim().toLowerCase()
    if (!name) return
    if (templates.some(function (t) { return t.role === name })) { setError('Role "' + name + '" already exists'); return }
    setSaving(true); setError('')
    var res = await supabase.from('role_defaults').insert({
      role: name,
      mobile_permissions: [],
      desktop_permissions: [],
      data_scopes: {},
      venue_ids: [],
      updated_by: profile.id,
    })
    if (res.error) { setError(res.error.message); setSaving(false); return }
    try { await logActivity('ROLE_TEMPLATE_ADD', name) } catch (_) {}
    setAddOpen(false); setAddName('')
    load()
    setSaving(false)
  }

  // ═══ RENDER ═══
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-gray-400 text-sm">Admin only.</p>
      </div>
    )
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading role templates...</p>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-800">Role Templates</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Default permissions applied when a user is assigned this role. Individual toggles still override per user.
          </p>
        </div>
        <button onClick={function () { setAddOpen(true); setError('') }}
          className="px-3 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
          + New Role
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map(function (t) {
          var _tUnion = (t.mobile_permissions || []).slice()
          ;(t.desktop_permissions || []).forEach(function (k) { if (_tUnion.indexOf(k) === -1) _tUnion.push(k) })
          var _tVenues = (t.venue_ids || [])
          var featCount = countActiveFeatures(_tUnion)
          var badge = ROLE_COLORS[t.role] || 'bg-gray-100 text-gray-600 border-gray-200'
          return (
            <div key={t.role} className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={"inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border " + badge}>
                    {t.role}
                  </span>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {t.user_count} user{t.user_count === 1 ? '' : 's'}
                    {t.active_count !== t.user_count ? ' · ' + t.active_count + ' active' : ''}
                  </p>
                </div>
                {!t.seeded && (
                  <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    NO TEMPLATE
                  </span>
                )}
              </div>

              <div className="border-t border-gray-100 pt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-800">{featCount}</span>
                  <span className="text-[11px] text-gray-400">feature{featCount === 1 ? '' : 's'} enabled</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{(t.mobile_permissions || []).length}m · {(t.desktop_permissions || []).length}d keys</p>
                {_tVenues.length > 0 && (
                  <span className="inline-block mt-1.5 text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                    {_tVenues.length} venue{_tVenues.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <div className="flex gap-2 mt-auto">
                <button onClick={function () { openEdit(t) }}
                  className="flex-1 px-3 py-1.5 text-xs font-bold border border-gray-200 rounded-md hover:border-gray-900 transition-colors">
                  ✏️ Edit
                </button>
                {t.user_count > 0 && t.seeded && (
                  <button onClick={function () { setBulkTarget(t); setBulkResult('') }}
                    className="flex-1 px-3 py-1.5 text-xs font-bold text-amber-700 border border-amber-200 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors">
                    ⚡ Apply to all
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══ EDIT MODAL ═══ */}
      <Modal open={!!editRole} onClose={function () { setEditRole(null); setEditPerms([]) }}
        title={'Edit template: ' + (editRole || '')} wide>
        {editRole && (
          <form onSubmit={function (e) { e.preventDefault(); saveTemplate() }} className="flex flex-col" style={{ minHeight: '400px' }}>
            <div className="flex-1 p-4 overflow-y-auto">
              {venues.length > 0 && (
                <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-gray-700">Default venue access</label>
                    <span className="text-[10px] text-gray-400">
                      {editVenueIds.length === 0 ? 'No restriction' : editVenueIds.length + ' selected'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {venues.map(function (v) {
                      var on = editVenueIds.indexOf(v.id) >= 0
                      return (
                        <button key={v.id} type="button"
                          onClick={function () {
                            if (on) {
                              setEditVenueIds(editVenueIds.filter(function (id) { return id !== v.id }))
                            } else {
                              setEditVenueIds(editVenueIds.concat([v.id]))
                            }
                          }}
                          className={"px-2 py-0.5 rounded-md border transition-colors " +
                            (on
                              ? "bg-indigo-100 border-indigo-300 text-indigo-800 font-semibold"
                              : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50")}
                          style={{ fontSize: '11px' }}>
                          {v.code || v.name}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    Applied to users on "Apply to all" bulk sync. Empty = all venues.
                  </p>
                </div>
              )}
              <PermMatrix value={editValue} onChange={setEditValue} />
            </div>

            {error && (
              <div className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
            )}

            <div className="border-t border-gray-200 bg-white p-3 flex justify-between items-center gap-3 flex-shrink-0">
              <span className="text-[11px] text-gray-400">
                {editValue.mobile.length}m · {editValue.desktop.length}d keys ·
                {' '}{countActiveFeatures(editValue.mobile.concat(editValue.desktop.filter(function (k) { return editValue.mobile.indexOf(k) === -1 })))} features
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={function () { setEditRole(null); setEditValue({ mobile: [], desktop: [], scopes: {} }); setEditVenueIds([]) }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                  {saving ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══ ADD ROLE MODAL ═══ */}
      <Modal open={addOpen} onClose={function () { setAddOpen(false); setAddName(''); setError('') }} title="New Role Template">
        <form onSubmit={function (e) { e.preventDefault(); addRoleTemplate() }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role slug</label>
            <input type="text" value={addName}
              onChange={function (e) { setAddName(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase()) }}
              placeholder="e.g. supervisor, finance_hr"
              style={{ fontSize: '16px' }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <p className="text-[10px] text-gray-400 mt-1">Lowercase, letters/numbers/underscore only. Must match the role assigned in the profiles table.</p>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={function () { setAddOpen(false); setAddName(''); setError('') }}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !addName.trim()}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ═══ BULK APPLY CONFIRM ═══ */}
      <Modal open={!!bulkTarget} onClose={function () { if (!saving) { setBulkTarget(null); setBulkResult('') } }}
        title={'Apply "' + (bulkTarget?.role || '') + '" template to all users'}>
        {bulkTarget && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800 font-medium">⚠️ This will overwrite individual permissions.</p>
              <p className="text-[12px] text-amber-700 mt-1">
                <strong>{bulkTarget.user_count}</strong> user{bulkTarget.user_count === 1 ? '' : 's'} with role <strong>{bulkTarget.role}</strong> will have their mobile / desktop permission arrays and data scopes replaced with the template ({(bulkTarget.mobile_permissions || []).length}m / {(bulkTarget.desktop_permissions || []).length}d keys). Any per-user overrides are lost.
              </p>
            </div>
            {bulkResult && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">✓ {bulkResult}</div>
            )}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={function () { if (!saving) { setBulkTarget(null); setBulkResult('') } }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={runBulkApply} disabled={saving || !!bulkResult}
                className="px-4 py-2 text-sm text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Applying...' : bulkResult ? 'Done' : 'Yes, apply to all'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default RoleTemplates