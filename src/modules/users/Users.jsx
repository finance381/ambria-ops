import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import { logActivity } from '../../lib/logger'

var DEFAULT_ROLES = ['admin', 'auditor', 'sales', 'production', 'logistics']

var PERM_GROUPS = [
  { group: 'Inventory', icon: '📦', children: [
    { key: 'feature_add', label: 'Add Items', grants: ['feature_add', 'inventory_add'] },
    { key: 'feature_items', label: 'View & Edit', grants: ['feature_items', 'inventory_view', 'inventory_edit'], optional: [{ key: 'inventory_delete', label: 'Delete items' }] },
    { key: 'feature_dept_review', label: 'Dept Review', grants: ['feature_dept_review', 'dept_approve'] },
    { key: 'feature_pending', label: 'Pending Review', grants: ['feature_pending', 'admin_approve'] },
  ]},
  { group: 'Events', icon: '📅', children: [
    { key: 'feature_events', label: 'Events', grants: ['feature_events'], optional: [{ key: 'event_buffer', label: 'Set setup/teardown days' }] },
    { key: 'feature_requisitions', label: 'Requisitions', grants: ['feature_requisitions'] },
    { key: 'feature_production', label: 'Production Orders', grants: ['feature_production'] },
    { key: 'feature_manpower', label: 'Manpower', grants: ['feature_manpower'] },
  ]},
  { group: 'Finance', icon: '💰', children: [
    { key: 'feature_quote', label: 'Quote Calculator', grants: ['feature_quote'] },
    { key: 'feature_ratecard', label: 'Rate Card Editor', grants: ['feature_ratecard'] },
    { key: 'feature_expenses', label: 'Expenses', grants: ['feature_expenses', 'expense_submit'], optional: [{ key: 'expense_approve', label: 'Approve/reject expenses' }] },
  ]},
  { group: 'Operations', icon: '🚚', children: [
    { key: 'feature_purchase', label: 'Purchase Orders', grants: ['feature_purchase'] },
    { key: 'feature_receive', label: 'Receiving', grants: ['feature_receive'] },
    { key: 'feature_boxes', label: 'Boxes', grants: ['feature_boxes'] },
    { key: 'feature_challans', label: 'Challans', grants: ['feature_challans'] },
  ]},
  { group: 'Admin', icon: '⚙️', children: [
    { key: 'feature_admin', label: 'Admin Panel', grants: ['feature_admin'], optional: [{ key: 'admin_masters', label: 'Manage masters' }, { key: 'admin_users', label: 'Manage users' }, { key: 'admin_approve', label: 'Approve items' }] },
  ]},
]

function Users() {
  var [users, setUsers] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Edit user state
  var [editUser, setEditUser] = useState(null)
  var [editRole, setEditRole] = useState('')
  var [editPhone, setEditPhone] = useState('')
  var [editPerms, setEditPerms] = useState([])
  var [editActive, setEditActive] = useState(true)
  var [editCatIds, setEditCatIds] = useState([])
  var [editSubCatIds, setEditSubCatIds] = useState([])
  var [deleteConfirm, setDeleteConfirm] = useState(null)
  var [editEmail, setEditEmail] = useState('')

  // Add user state
  var [addOpen, setAddOpen] = useState(false)
  var [addName, setAddName] = useState('')
  var [addRole, setAddRole] = useState('logistics')
  var [addEmail, setAddEmail] = useState('')
  var [pendingUsers, setPendingUsers] = useState([])

  // Lookups
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [editSubDeptIds, setEditSubDeptIds] = useState([])
  var [editEventDeptIds, setEditEventDeptIds] = useState([])
  var [departments, setDepartments] = useState([])
  var [roles, setRoles] = useState(DEFAULT_ROLES)
  var [roleSearch, setRoleSearch] = useState('')
  var [roleDropOpen, setRoleDropOpen] = useState(false)

  useEffect(function () { loadUsers(); loadLookups() }, [])

  async function loadUsers() {
    var [profRes, pendRes] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('approved_emails').select('*').order('name'),
    ])
    var data = profRes.data || []
    setUsers(data || [])
    var customRoles = (data || []).map(function (u) { return u.role }).filter(function (r) {
      return r && !DEFAULT_ROLES.includes(r)
    })
    if (customRoles.length > 0) {
      setRoles(function (prev) {
        var merged = [...prev]
        customRoles.forEach(function (r) { if (!merged.includes(r)) merged.push(r) })
        return merged
      })
    }
    setPendingUsers((pendRes.data || []).map(function (p) {
      return {
        id: '__pending__' + p.email,
        _source: 'approved',
        _email_key: p.email,
        name: p.name || '',
        email: p.email,
        phone: p.phone || '',
        role: p.role || 'logistics',
        permissions: p.permissions || [],
        category_ids: p.category_ids || [],
        sub_category_ids: p.sub_category_ids || [],
        sub_department_ids: p.sub_department_ids || [],
        event_dept_ids: p.event_dept_ids || [],
        active: null,
      }
    }))
    setLoading(false)
  }

  async function loadLookups() {
    var [catRes, subCatRes, subDeptRes, deptRes] = await Promise.all([
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('sub_departments').select('id, name, department_id, active').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
    ])
    setCategories(catRes.data || [])
    setSubCategories(subCatRes.data || [])
    setSubDepartments(subDeptRes.data || [])
    setDepartments(deptRes.data || [])
  }

  // ═══ EDIT USER ═══
  function openEdit(user) {
    setEditUser(user)
    setEditRole(user.role)
    setEditPhone(user.phone || '')
    setEditPerms(user.permissions || [])
    setEditActive(user.active)
    setEditCatIds(user.category_ids || [])
    setEditSubCatIds(user.sub_category_ids || [])
    setEditSubDeptIds(user.sub_department_ids || [])
    setEditEventDeptIds(user.event_dept_ids || [])
    setError('')
    setRoleSearch('')
    setRoleDropOpen(false)
    setEditEmail(user.email || '')
    setDeleteConfirm(null)
    setSaving(false)
  }

  function togglePerm(perm) {
    setEditPerms(function (prev) {
      if (prev.includes(perm)) return prev.filter(function (p) { return p !== perm })
      return [...prev, perm]
    })
  }

  function toggleCatId(id) {
    var removing = editCatIds.includes(id)

    // Get sub-categories under this category (cascade auto-select-all on add)
    var catSubCatIds = subCategories.filter(function (sc) { return sc.category_id === id }).map(function (sc) { return sc.id })

    if (removing) {
      // Remove category + its sub-cats
      setEditCatIds(function (prev) { return prev.filter(function (c) { return c !== id }) })
      setEditSubCatIds(function (prev) {
        return prev.filter(function (sid) { return !catSubCatIds.includes(sid) })
      })
    } else {
      // Add category + all its sub-cats
      setEditCatIds(function (prev) { return [...prev, id] })
      setEditSubCatIds(function (prev) {
        var merged = prev.slice()
        catSubCatIds.forEach(function (sid) { if (!merged.includes(sid)) merged.push(sid) })
        return merged
      })
    }
  }

  function toggleSubCatId(id) {
    setEditSubCatIds(function (prev) {
      if (prev.includes(id)) return prev.filter(function (c) { return c !== id })
      return [...prev, id]
    })
  }

  function toggleSubDeptId(id) {
    setEditSubDeptIds(function (prev) {
      if (prev.includes(id)) return prev.filter(function (c) { return c !== id })
      return [...prev, id]
    })
  }

  function toggleEventDeptId(id) {
    var removing = editEventDeptIds.includes(id)
    if (removing) {
      // Cascade: sub-depts belong to this dept — clear them so orphans aren't saved silently
      var deptSdIds = subDepartments.filter(function (sd) { return sd.department_id === id }).map(function (sd) { return sd.id })
      if (deptSdIds.length > 0) {
        setEditSubDeptIds(function (prev) { return prev.filter(function (sid) { return deptSdIds.indexOf(sid) === -1 }) })
      }
    }
    setEditEventDeptIds(function (prev) {
      if (prev.includes(id)) return prev.filter(function (c) { return c !== id })
      return [...prev, id]
    })
  }

  function addCustomRole(val) {
    var trimmed = val.trim().toLowerCase()
    if (!trimmed) return
    if (!roles.includes(trimmed)) {
      setRoles(function (prev) { return [...prev, trimmed] })
    }
    setEditRole(trimmed)
    setRoleSearch('')
    setRoleDropOpen(false)
  }

  async function saveUser(e) {
    e.preventDefault()
    setSaving(true); setError('')
    var err
    if (editUser._source === 'approved') {
      var res = await supabase.from('approved_emails').update({
        name: editUser.name,
        role: editRole,
        phone: editPhone.trim() || null,
        permissions: editPerms,
        category_ids: editCatIds,
        sub_category_ids: editSubCatIds,
        sub_department_ids: editSubDeptIds,
        event_dept_ids: editEventDeptIds,
      }).eq('email', editUser._email_key)
      err = res.error
    } else {
      var res = await supabase.from('profiles').update({
        role: editRole,
        phone: editPhone.trim() || null,
        permissions: editPerms,
        active: editActive,
        category_ids: editCatIds,
        sub_category_ids: editSubCatIds,
        sub_department_ids: editSubDeptIds,
        event_dept_ids: editEventDeptIds,
        email: editEmail.trim().toLowerCase() || null,
      }).eq('id', editUser.id)
      err = res.error
    }

    if (err) {
      setError(err.message)
    } else {
      setEditUser(null)
      loadUsers()
      try { await logActivity('USER_UPDATE', editUser.email + ' → role:' + editRole) } catch (_) {}
    }
    setSaving(false)
  }

  async function deleteUser(userId) {
    setSaving(true); setError('')
    var target = editUser
    var err
    if (target && target._source === 'approved') {
      var res = await supabase.from('approved_emails').delete().eq('email', target._email_key)
      err = res.error
    } else {
      var res = await supabase.from('profiles').delete().eq('id', userId)
      err = res.error
    }
    if (err) {
      setError(err.message)
    } else {
      setDeleteConfirm(null)
      setEditUser(null)
      loadUsers()
      try { await logActivity('USER_DELETE', target?.email || userId) } catch (_) {}
    }
    setSaving(false)
  }

  // ═══ ADD USER ═══
  async function addUser(e) {
    e.preventDefault()
    if (!addName.trim() || !addEmail.trim()) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('approved_emails').insert({
      email: addEmail.trim().toLowerCase(),
      name: addName.trim(),
      role: addRole,
      permissions: [],
    })
    if (err) {
      setError(err.message)
    } else {
      setAddOpen(false)
      setAddName(''); setAddEmail(''); setAddRole('logistics')
      loadUsers()
      try { await logActivity('USER_ADD', addEmail.trim()) } catch (_) {}
    }
    setSaving(false)
  }

  // ═══ COMPUTED ═══
  var allUsers = users.map(function (u) { return Object.assign({}, u, { _source: 'profile' }) }).concat(pendingUsers)
  var searchLower = search.toLowerCase()
  var filtered = allUsers.filter(function (u) {
    return !search ||
      (u.name || '').toLowerCase().includes(searchLower) ||
      (u.email || '').toLowerCase().includes(searchLower) ||
      (u.phone || '').includes(search) ||
      (u.role || '').toLowerCase().includes(searchLower)
  })

  var filteredSubCats = editCatIds.length > 0
    ? subCategories.filter(function (sc) { return editCatIds.includes(sc.category_id) })
    : subCategories

  var roleColors = {
    admin: 'bg-purple-100 text-purple-700',
    auditor: 'bg-pink-100 text-pink-700',
    sales: 'bg-blue-100 text-blue-700',
    production: 'bg-amber-100 text-amber-700',
    logistics: 'bg-green-100 text-green-700',
  }

  var filteredRoles = roles.filter(function (r) {
    return !roleSearch || r.includes(roleSearch.toLowerCase())
  })
  var showAddRole = roleSearch.trim() && !roles.includes(roleSearch.trim().toLowerCase())

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading users...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search by name, phone, role..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="text-sm text-gray-400 self-center">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={function () { setAddOpen(true); setError('') }}
          className="px-4 py-2.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
        >
          + Add User
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Phone</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Categories</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3" style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(function (user) {
              var userCats = (user.category_ids || []).map(function (cid) {
                var cat = categories.find(function (c) { return c.id === cid })
                return cat ? cat.name : null
              }).filter(Boolean)

              return (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-[12px]">{user.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-[12px]">{user.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " + (roleColors[user.role] || 'bg-gray-100 text-gray-600')}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {userCats.length > 0 ? userCats.map(function (name) {
                        return (
                          <span key={name} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                            {name}
                          </span>
                        )
                      }) : <span className="text-[11px] text-gray-400">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                      (user._source === 'approved' ? "bg-blue-100 text-blue-700" :
                       user.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                      {user._source === 'approved' ? 'Awaiting Sign-in' : user.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={function () { openEdit(user) }}
                      className="px-3 py-1 text-[12px] font-semibold border border-gray-200 rounded-md hover:border-gray-900 transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="7" className="px-4 py-8 text-center text-gray-400">No users found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ EDIT USER MODAL ═══ */}
      <Modal open={!!editUser} onClose={function () { setEditUser(null) }} title={'Edit: ' + (editUser?.name || '')}>
        {editUser && (
          <form onSubmit={saveUser} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{editUser.name}</p>
              <p className="text-xs text-gray-400 mb-2">{editUser.id}</p>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={editEmail} onChange={function (e) { setEditEmail(e.target.value) }}
                placeholder="user@ambria.in"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
              <input type="tel" value={editPhone} onChange={function (e) { setEditPhone(e.target.value) }}
                placeholder="+91 XXXXX XXXXX"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            {/* Role — searchable with add-new */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <div className="relative">
                <input type="text"
                  value={roleDropOpen ? roleSearch : editRole}
                  onChange={function (e) { setRoleSearch(e.target.value); setRoleDropOpen(true) }}
                  onFocus={function () { setRoleSearch(''); setRoleDropOpen(true) }}
                  placeholder="Search or add role..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {roleDropOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filteredRoles.map(function (r) {
                      return (
                        <button key={r} type="button"
                          onClick={function () { setEditRole(r); setRoleDropOpen(false); setRoleSearch('') }}
                          className={"w-full text-left px-3 py-2 text-sm hover:bg-gray-50 " +
                            (r === editRole ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700")}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </button>
                      )
                    })}
                    {showAddRole && (
                      <button type="button" onClick={function () { addCustomRole(roleSearch) }}
                        className="w-full text-left px-3 py-2 text-sm text-indigo-600 font-medium hover:bg-indigo-50">
                        + Add "{roleSearch.trim()}"
                      </button>
                    )}
                    {filteredRoles.length === 0 && !showAddRole && (
                      <p className="px-3 py-2 text-sm text-gray-400">No roles found</p>
                    )}
                  </div>
                )}
              </div>
              {editRole && !roleDropOpen && (
                <span className={"inline-block mt-1 text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " + (roleColors[editRole] || 'bg-gray-100 text-gray-600')}>
                  {editRole}
                </span>
              )}
            </div>
            {/* Departments */}
            {departments.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Departments</label>
                <div className="bg-gray-50 rounded-lg p-3 max-h-36 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2">
                    {departments.map(function (d) {
                      var isChecked = editEventDeptIds.includes(d.id)
                      return (
                        <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={isChecked} onChange={function () { toggleEventDeptId(d.id) }}
                            className="w-4 h-4 accent-indigo-600" />
                          <span>{d.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Assigned departments limit what user sees in requisition/expense forms</p>
              </div>
            )}
            {/* Sub-departments */}
            {subDepartments.length > 0 && editEventDeptIds.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Sub-departments</label>
                <div className="bg-gray-50 rounded-lg p-3 max-h-36 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2">
                    {subDepartments.filter(function (sd) { return sd.active && editEventDeptIds.indexOf(sd.department_id) !== -1 }).map(function (sd) {
                      var isChecked = editSubDeptIds.includes(sd.id)
                      return (
                        <label key={sd.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={isChecked} onChange={function () { toggleSubDeptId(sd.id) }}
                            className="w-4 h-4 accent-indigo-600" />
                          <span>{sd.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Sub-departments this user can log expenses against.</p>
              </div>
            )}

            {/* Categories — inventory access, independent of sub-dept */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Categories</label>
              <p className="text-[11px] text-gray-400 mb-2">Inventory categories this user can see and act on.</p>
              <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {categories.length === 0 && <p className="text-xs text-gray-400">No categories</p>}
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(function (cat) {
                    var isChecked = editCatIds.includes(cat.id)
                    return (
                      <label key={cat.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={isChecked}
                          onChange={function () { toggleCatId(cat.id) }}
                          className="w-4 h-4 accent-indigo-600" />
                        <span>{cat.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Sub-categories — filtered by selected categories */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assigned Sub-categories
                {editCatIds.length > 0 && <span className="text-xs text-gray-400 ml-1">(filtered by selected categories)</span>}
              </label>
              <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {filteredSubCats.length === 0 && <p className="text-xs text-gray-400">No sub-categories{editCatIds.length > 0 ? ' for selected categories' : ''}</p>}
                <div className="grid grid-cols-2 gap-2">
                  {filteredSubCats.map(function (sc) {
                    var isChecked = editSubCatIds.includes(sc.id)
                    var parentCat = categories.find(function (c) { return c.id === sc.category_id })
                    return (
                      <label key={sc.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={isChecked}
                          onChange={function () { toggleSubCatId(sc.id) }}
                          className="w-4 h-4 accent-indigo-600" />
                        <span>{sc.name} {parentCat ? <span className="text-[10px] text-gray-400">({parentCat.name})</span> : ''}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            {/* Permissions — Grouped */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
              <div className="space-y-2">
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
                                  <span className={"text-[13px] font-medium " + (isOn ? "text-indigo-700" : "text-gray-500")}>{feat.label}</span>
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
            </div>

            {/* Active toggle — only for signed-in users */}
            {editUser._source !== 'approved' && (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <span className="text-sm font-medium text-gray-700">Account Active</span>
                <button type="button" onClick={function () { setEditActive(!editActive) }}
                  className={"px-3 py-1 text-sm font-medium rounded-full transition-colors " +
                    (editActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                  {editActive ? 'Active' : 'Inactive'}
                </button>
              </div>
            )}
            {editUser._source === 'approved' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-700 font-medium">This user hasn't signed in yet. Settings will apply when they first sign in with Google.</p>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
            )}

            <div className="flex gap-3 justify-between pt-1">
              {/* Delete — left side */}
              {deleteConfirm === editUser.id ? (
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-red-600">Sure?</span>
                  <button type="button" onClick={function () { deleteUser(editUser.id) }}
                    className="px-3 py-1.5 text-xs text-white bg-red-600 rounded-md hover:bg-red-700 font-medium">
                    Yes, Delete
                  </button>
                  <button type="button" onClick={function () { setDeleteConfirm(null) }}
                    className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200">
                    No
                  </button>
                </div>
              ) : (
                <button type="button" onClick={function () { setDeleteConfirm(editUser.id) }}
                  className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-md hover:bg-red-50 transition-colors">
                  Delete User
                </button>
              )}
              {/* Save/Cancel — right side */}
              <div className="flex gap-3">
                <button type="button" onClick={function () { setEditUser(null) }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══ ADD USER MODAL ═══ */}
      <Modal open={addOpen} onClose={function () { setAddOpen(false) }} title="Add User">
        <form onSubmit={addUser} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={addName} onChange={function (e) { setAddName(e.target.value) }}
              placeholder="Full name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={addEmail} onChange={function (e) { setAddEmail(e.target.value) }}
              placeholder="user@ambria.in"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={addRole} onChange={function (e) { setAddRole(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {roles.map(function (r) {
                return <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              })}
            </select>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={function () { setAddOpen(false) }}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !addName.trim() || !addEmail.trim()}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default Users
