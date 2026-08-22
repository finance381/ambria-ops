import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import { logActivity } from '../../lib/logger'
import { PERM_GROUPS, DEFAULT_ROLES, countActiveFeatures } from '../../lib/permissions'

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
  var [editPerms, setEditPerms] = useState([])

  // Add-role modal
  var [addOpen, setAddOpen] = useState(false)
  var [addName, setAddName] = useState('')

  // Bulk-apply confirm
  var [bulkTarget, setBulkTarget] = useState(null)   // { role, permissions, user_count }
  var [bulkResult, setBulkResult] = useState('')

  useEffect(function () { if (isAdmin) load() }, [])

  async function load() {
    setLoading(true); setError('')
    var [rdRes, profRes] = await Promise.all([
      supabase.from('role_defaults').select('role, permissions, updated_at, updated_by'),
      supabase.from('profiles').select('role, active'),
    ])
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
      var t = byRole[role] || { role: role, permissions: [], updated_at: null, updated_by: null }
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
    setEditPerms((row.permissions || []).slice())
    setError('')
  }

  function togglePerm(k) {
    setEditPerms(function (prev) {
      if (prev.indexOf(k) >= 0) return prev.filter(function (p) { return p !== k })
      return prev.concat([k])
    })
  }

  async function saveTemplate() {
    if (saving) return
    if (!editRole) return
    setSaving(true); setError('')
    var res = await supabase.from('role_defaults').upsert({
      role: editRole,
      permissions: editPerms,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'role' }).select()
    if (res.error) { setError(res.error.message); setSaving(false); return }
    try { await logActivity('ROLE_TEMPLATE_UPDATE', editRole + ' → ' + editPerms.length + ' perms') } catch (_) {}
    setEditRole(null); setEditPerms([])
    load()
    setSaving(false)
  }

  // ═══ BULK APPLY ═══
  async function runBulkApply() {
    if (saving) return
    if (!bulkTarget) return
    setSaving(true); setError(''); setBulkResult('')
    var seed = (bulkTarget.permissions || []).slice()
    if (seed.indexOf('feature_my_profile') === -1) seed.push('feature_my_profile')

    var res = await supabase.from('profiles')
      .update({ permissions: seed })
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
      permissions: [],
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
          var featCount = countActiveFeatures(t.permissions || [])
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
                <p className="text-[10px] text-gray-400 mt-0.5">{(t.permissions || []).length} raw perm keys</p>
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
            <div className="flex-1 p-4 overflow-y-auto space-y-2">
              {PERM_GROUPS.map(function (grp) {
                var allChildKeys = []
                grp.children.forEach(function (ch) { ch.grants.forEach(function (g) { if (allChildKeys.indexOf(g) === -1) allChildKeys.push(g) }) })
                var groupOn = allChildKeys.every(function (g) { return editPerms.indexOf(g) >= 0 })
                var groupPartial = !groupOn && allChildKeys.some(function (g) { return editPerms.indexOf(g) >= 0 })

                return (
                  <div key={grp.group} className="rounded-xl border border-gray-200 overflow-hidden">
                    <button type="button" onClick={function () {
                      if (groupOn) {
                        var rm = []
                        grp.children.forEach(function (ch) {
                          ch.grants.forEach(function (g) { rm.push(g) });
                          (ch.optional || []).forEach(function (o) { rm.push(o.key) })
                        })
                        setEditPerms(function (prev) { return prev.filter(function (p) { return rm.indexOf(p) === -1 }) })
                      } else {
                        setEditPerms(function (prev) {
                          var m = prev.slice()
                          grp.children.forEach(function (ch) { ch.grants.forEach(function (g) { if (m.indexOf(g) === -1) m.push(g) }) })
                          return m
                        })
                      }
                    }} className={"w-full flex items-center justify-between px-4 py-3 " + (groupOn ? "bg-indigo-50" : groupPartial ? "bg-amber-50" : "bg-gray-50")}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{grp.icon}</span>
                        <span className="text-sm font-bold text-gray-800">{grp.group}</span>
                        <span className="text-[10px] text-gray-400 ml-1">{grp.children.length}</span>
                      </div>
                      <div className={"w-10 h-6 rounded-full transition-colors relative " + (groupOn ? "bg-indigo-600" : groupPartial ? "bg-amber-400" : "bg-gray-300")}>
                        <div className={"absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform " + (groupOn || groupPartial ? "translate-x-4" : "translate-x-0.5")} />
                      </div>
                    </button>
                    {(groupOn || groupPartial) && (
                      <div className="border-t border-gray-100 px-3 py-2 space-y-1 bg-white">
                        {grp.children.map(function (feat) {
                          var isOn = feat.grants.every(function (g) { return editPerms.indexOf(g) >= 0 })
                          return (
                            <div key={feat.key}>
                              <button type="button" onClick={function () {
                                if (isOn) {
                                  var ak = feat.grants.concat((feat.optional || []).map(function (o) { return o.key }))
                                  setEditPerms(function (prev) { return prev.filter(function (p) { return ak.indexOf(p) === -1 }) })
                                } else {
                                  setEditPerms(function (prev) {
                                    var m = prev.slice()
                                    feat.grants.forEach(function (g) { if (m.indexOf(g) === -1) m.push(g) })
                                    return m
                                  })
                                }
                              }} className="w-full flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50">
                                <div className="flex-1 text-left">
                                  <div className={"text-[13px] font-medium " + (isOn ? "text-indigo-700" : "text-gray-500")}>{feat.label}</div>
                                  {feat.note && (
                                    <div className="text-[10px] text-amber-600 mt-0.5">ℹ️ {feat.note}</div>
                                  )}
                                </div>
                                <div className={"w-8 h-5 rounded-full transition-colors relative " + (isOn ? "bg-indigo-500" : "bg-gray-300")}>
                                  <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isOn ? "translate-x-3" : "translate-x-0.5")} />
                                </div>
                              </button>
                              {isOn && feat.optional && feat.optional.length > 0 && (
                                <div className="pl-4 pb-1 flex flex-wrap gap-x-4 gap-y-1">
                                  {feat.optional.map(function (opt) {
                                    var optChecked = editPerms.indexOf(opt.key) >= 0
                                    return (
                                      <label key={opt.key} className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                                        <input type="checkbox" checked={optChecked} onChange={function () { togglePerm(opt.key) }}
                                          className="w-3 h-3 accent-indigo-600" />
                                        <span className="text-[11px]">{opt.label}</span>
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {error && (
              <div className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
            )}

            <div className="border-t border-gray-200 bg-white p-3 flex justify-between items-center gap-3 flex-shrink-0">
              <span className="text-[11px] text-gray-400">
                {editPerms.length} perm{editPerms.length === 1 ? '' : 's'} · {countActiveFeatures(editPerms)} feature{countActiveFeatures(editPerms) === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={function () { setEditRole(null); setEditPerms([]) }}
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
                <strong>{bulkTarget.user_count}</strong> user{bulkTarget.user_count === 1 ? '' : 's'} with role <strong>{bulkTarget.role}</strong> will have their <code>permissions</code> array replaced with the template ({(bulkTarget.permissions || []).length} keys). Any per-user overrides are lost.
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