import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'

var PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-red-100 text-red-700',
}

var STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-50 text-red-400',
}

var STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

var NEXT_STATUS = {
  pending: 'in_progress',
  in_progress: 'done',
}

function EventTasks({ eventId, profile, departments }) {
  var [tasks, setTasks] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [showForm, setShowForm] = useState(false)
  var [profiles, setProfiles] = useState([])
  var [editTask, setEditTask] = useState(null)

  // Form
  var [fTitle, setFTitle] = useState('')
  var [fDesc, setFDesc] = useState('')
  var [fDept, setFDept] = useState('')
  var [fAssigned, setFAssigned] = useState('')
  var [fDue, setFDue] = useState('')
  var [fPriority, setFPriority] = useState('normal')

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var isDeptHead = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var canCreate = isAdmin || isDeptHead

  useEffect(function () {
    loadTasks()
    if (canCreate) loadProfiles()
  }, [eventId])

  async function loadTasks() {
    setLoading(true)
    var { data } = await supabase
      .from('event_tasks')
      .select('id, title, description, department, assigned_to, due_date, priority, status, completed_at, completed_by, created_by, created_at')
      .eq('event_id', eventId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    var rows = data || []
    // Resolve names via RPC
    var userIds = []
    rows.forEach(function (t) {
      if (t.assigned_to && userIds.indexOf(t.assigned_to) === -1) userIds.push(t.assigned_to)
      if (t.created_by && userIds.indexOf(t.created_by) === -1) userIds.push(t.created_by)
      if (t.completed_by && userIds.indexOf(t.completed_by) === -1) userIds.push(t.completed_by)
    })
    var nameMap = {}
    if (userIds.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: userIds })
      ;(names || []).forEach(function (n) { nameMap[n.id] = n.name })
    }
    rows = rows.map(function (t) {
      return Object.assign({}, t, {
        assignee: { name: nameMap[t.assigned_to] || null },
        creator: { name: nameMap[t.created_by] || null },
      })
    })
    setTasks(rows)
    setLoading(false)
  }

  async function loadProfiles() {
    var { data } = await supabase.rpc('get_all_profile_names')
    setProfiles(data || [])
  }

  function resetForm() {
    setFTitle('')
    setFDesc('')
    setFDept('')
    setFAssigned('')
    setFDue('')
    setFPriority('normal')
    setEditTask(null)
    setShowForm(false)
  }

  function openEdit(task) {
    setEditTask(task)
    setFTitle(task.title)
    setFDesc(task.description || '')
    setFDept(task.department || '')
    setFAssigned(task.assigned_to || '')
    setFDue(task.due_date || '')
    setFPriority(task.priority)
    setShowForm(true)
  }

  async function saveTask() {
    if (!fTitle.trim() || saving) return
    setSaving(true)

    var payload = {
      title: fTitle.trim(),
      description: fDesc.trim() || null,
      department: fDept || null,
      assigned_to: fAssigned || null,
      due_date: fDue || null,
      priority: fPriority,
    }

    if (editTask) {
      var { error } = await supabase.from('event_tasks').update(payload).eq('id', editTask.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('TASK_UPDATE', fTitle.trim()) } catch (_) {}
    } else {
      payload.event_id = eventId
      payload.created_by = profile.id
      var { error } = await supabase.from('event_tasks').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('TASK_CREATE', fTitle.trim()) } catch (_) {}
    }

    setSaving(false)
    resetForm()
    loadTasks()
  }

  async function advanceStatus(task) {
    var next = NEXT_STATUS[task.status]
    if (!next) return
    var update = { status: next }
    if (next === 'done') {
      update.completed_at = new Date().toISOString()
      update.completed_by = profile.id
    }
    var { error: advErr } = await supabase.from('event_tasks').update(update).eq('id', task.id)
    if (advErr) { alert('Status update failed: ' + advErr.message); return }
    try { await logActivity('TASK_STATUS', task.title + ' → ' + STATUS_LABELS[next]) } catch (_) {}
    loadTasks()
  }

  async function cancelTask(task) {
    if (!confirm('Cancel task: ' + task.title + '?')) return
    await supabase.from('event_tasks').update({ status: 'cancelled' }).eq('id', task.id)
    try { await logActivity('TASK_CANCEL', task.title) } catch (_) {}
    loadTasks()
  }

  async function deleteTask(task) {
    if (!confirm('Delete task: ' + task.title + '? This cannot be undone.')) return
    await supabase.from('event_tasks').delete().eq('id', task.id)
    try { await logActivity('TASK_DELETE', task.title) } catch (_) {}
    loadTasks()
  }

  function canManage(task) {
    return isAdmin || task.created_by === profile?.id || task.assigned_to === profile?.id
  }

  // Group by status
  var active = tasks.filter(function (t) { return t.status === 'pending' || t.status === 'in_progress' })
  var done = tasks.filter(function (t) { return t.status === 'done' })
  var cancelled = tasks.filter(function (t) { return t.status === 'cancelled' })

  var now = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          Tasks ({tasks.length})
          {active.length > 0 && (
            <span className="text-amber-600 ml-1">{active.length} active</span>
          )}
        </h4>
        {canCreate && !showForm && (
          <button onClick={function () { resetForm(); setShowForm(true) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
            + Add Task
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-bold text-indigo-700 uppercase">
            {editTask ? 'Edit Task' : 'New Task'}
          </p>
          <input type="text" value={fTitle}
            onChange={function (e) { setFTitle(e.target.value) }}
            placeholder="Task title *"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
          <textarea value={fDesc}
            onChange={function (e) { setFDesc(e.target.value) }}
            placeholder="Description (optional)"
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Department</label>
              <select value={fDept} onChange={function (e) { setFDept(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">—</option>
                {(departments || []).map(function (d) {
                  return <option key={d.id} value={d.name}>{d.name}</option>
                })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Assign To</label>
              <select value={fAssigned} onChange={function (e) { setFAssigned(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Unassigned</option>
                {profiles.map(function (p) {
                  return <option key={p.id} value={p.id}>{p.name}</option>
                })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Due Date</label>
              <input type="date" value={fDue}
                onChange={function (e) { setFDue(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Priority</label>
              <select value={fPriority} onChange={function (e) { setFPriority(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveTask} disabled={saving || !fTitle.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editTask ? 'Update' : 'Add Task')}
            </button>
            <button onClick={resetForm}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400 text-center py-4">Loading tasks...</p>}

      {!loading && tasks.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-4">No tasks yet</p>
      )}

      {/* Active tasks */}
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map(function (task) {
            var overdue = task.due_date && task.due_date < now && task.status !== 'done'
            return (
              <div key={task.id} className={"rounded-lg border p-3 transition-colors " +
                (overdue ? "bg-red-50 border-red-200" : "bg-white border-gray-200")}>
                <div className="flex items-start gap-3">
                  {/* Status advance button */}
                  {canManage(task) && NEXT_STATUS[task.status] && (
                    <button onClick={function () { advanceStatus(task) }}
                      className={"w-6 h-6 mt-0.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors " +
                        (task.status === 'in_progress'
                          ? "border-green-400 bg-green-50 hover:bg-green-100 text-green-600"
                          : "border-gray-300 hover:border-indigo-400 hover:bg-indigo-50")}
                      title={task.status === 'in_progress' ? 'Mark done' : 'Start'}>
                      {task.status === 'in_progress' && (
                        <span className="text-xs font-bold">✓</span>
                      )}
                    </button>
                  )}
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">{task.title}</p>
                      <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[task.status] || '')}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      {task.priority !== 'normal' && (
                        <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase " + (PRIORITY_COLORS[task.priority] || '')}>
                          {task.priority}
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1">{task.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-400">
                      {task.assignee?.name && <span>👤 {task.assignee.name}</span>}
                      {task.department && <span>🏢 {task.department}</span>}
                      {task.due_date && (
                        <span className={overdue ? "text-red-600 font-bold" : ""}>
                          📅 {formatDate(task.due_date)}{overdue ? ' — OVERDUE' : ''}
                        </span>
                      )}
                      <span>by {task.creator?.name || '—'}</span>
                    </div>
                  </div>
                  {/* Actions */}
                  {canManage(task) && (
                    <div className="flex gap-1 flex-shrink-0">
                      {(isAdmin || task.created_by === profile?.id) && (
                        <button onClick={function () { openEdit(task) }}
                          className="text-[11px] px-2 py-1 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          title="Edit">✎</button>
                      )}
                      <button onClick={function () { cancelTask(task) }}
                        className="text-[11px] px-2 py-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Cancel">✕</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Completed tasks — collapsible */}
      {done.length > 0 && (
        <details className="group">
          <summary className="text-[11px] font-bold text-green-600 cursor-pointer hover:text-green-700 py-1">
            ✓ Completed ({done.length})
          </summary>
          <div className="space-y-1.5 mt-2">
            {done.map(function (task) {
              return (
                <div key={task.id} className="rounded-lg border border-green-100 bg-green-50 p-2.5 flex items-center gap-3">
                  <span className="text-green-500 flex-shrink-0">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-600 line-through">{task.title}</p>
                    <p className="text-[10px] text-gray-400">
                      {task.completed_at ? formatDate(task.completed_at) : ''} · {task.assignee?.name || task.creator?.name || '—'}
                    </p>
                  </div>
                  {isAdmin && (
                    <button onClick={function () { deleteTask(task) }}
                      className="text-[10px] text-gray-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors">🗑</button>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* Cancelled — collapsible */}
      {cancelled.length > 0 && (
        <details className="group">
          <summary className="text-[11px] font-bold text-gray-400 cursor-pointer hover:text-gray-600 py-1">
            Cancelled ({cancelled.length})
          </summary>
          <div className="space-y-1.5 mt-2">
            {cancelled.map(function (task) {
              return (
                <div key={task.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 flex items-center gap-3">
                  <span className="text-gray-300 flex-shrink-0">✕</span>
                  <p className="text-sm text-gray-400 line-through flex-1">{task.title}</p>
                  {isAdmin && (
                    <button onClick={function () { deleteTask(task) }}
                      className="text-[10px] text-gray-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors">🗑</button>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

export default EventTasks
