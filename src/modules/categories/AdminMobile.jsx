import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useLang } from '../../lib/i18n'
import Modal from '../../components/ui/Modal'

function Section({ title, defaultOpen, children }) {
  var [open, setOpen] = useState(defaultOpen || false)
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={function () { setOpen(!open) }}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className={"text-gray-400 text-xs transition-transform " + (open ? "rotate-90" : "")}>▸</span>
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function AdminMobile({ profile }) {
  var { t } = useLang()
  var [pending, setPending] = useState([])
  var [departments, setDepartments] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [venues, setVenues] = useState([])
  var [loading, setLoading] = useState(true)
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [saving, setSaving] = useState(false)

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    var [pendCat, pendSub, pendItem, deptRes, catRes, subRes, venueRes, profilesRes] = await Promise.all([
      supabase.from('categories').select('*').eq('status', 'pending'),
      supabase.from('sub_categories').select('*, categories(name)').eq('status', 'pending'),
      supabase.from('inventory_items').select('*, categories(name)').eq('status', 'pending'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('sub_categories').select('*, categories(name)').order('name'),
      supabase.from('venues').select('*').order('code'),
      supabase.from('profiles').select('id, name, email'),
    ])

    var profileMap = {}
    ;(profilesRes.data || []).forEach(function (p) { profileMap[p.id] = p.name || p.email || '—' })

    var allPending = []
    ;(pendCat.data || []).forEach(function (c) {
      allPending.push({ id: c.id, table: 'categories', type: 'Cat/Sub', name: c.name, category: c.name, by: profileMap[c.added_by] || '—' })
    })
    ;(pendSub.data || []).forEach(function (s) {
      allPending.push({ id: s.id, table: 'sub_categories', type: 'Cat/Sub', name: s.name, category: s.categories?.name || '—', by: profileMap[s.added_by] || '—' })
    })
    ;(pendItem.data || []).forEach(function (i) {
      allPending.push({ id: i.id, table: 'inventory_items', type: 'Item', name: i.name, category: i.categories?.name || '—', by: profileMap[i.submitted_by] || '—' })
    })

    setPending(allPending)
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])
    setSubCategories(subRes.data || [])
    setVenues(venueRes.data || [])
    setLoading(false)
  }

  async function approveItem(item) {
    setSaving(true)
    await supabase.from(item.table).update({ status: 'approved' }).eq('id', item.id)
    logActivity('APPROVE_' + item.type.toUpperCase().replace('/', '_'), item.name)
    loadAll()
    setSaving(false)
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setSaving(true)
    if (rejectTarget.table === 'inventory_items') {
      await supabase.from('venue_allocations').delete().eq('item_id', rejectTarget.id)
    }
    await supabase.from(rejectTarget.table).delete().eq('id', rejectTarget.id)
    logActivity('REJECT_' + rejectTarget.type.toUpperCase().replace('/', '_'), rejectTarget.name + ' | Reason: ' + rejectReason.trim())
    setRejectTarget(null)
    setRejectReason('')
    loadAll()
    setSaving(false)
  }

  function statusLabel(s) {
    if (s === 'approved') return t('approved')
    if (s === 'pending') return t('pending')
    if (s === 'rejected') return t('rejected')
    return s
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">{t('loading')}</p>
  }

  return (
    <div className="space-y-3">
      {/* Open Desktop Dashboard link */}
      <button
        onClick={function () {
          window.open(window.location.origin + window.location.pathname + '?view=admin', '_blank')
        }}
        className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold tracking-wide"
      >
        {"🖥️ " + t('openAdminDashboard')}
      </button>

      {/* Pending Review */}
      <Section title={t('pendingReview')} defaultOpen={pending.length > 0}>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-2">{t('noPending')}</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('type')}</th>
                <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('category')}</th>
                <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('name')}</th>
                <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('by')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pending.map(function (item) {
                return (
                  <tr key={item.table + '-' + item.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-500">{item.type}</td>
                    <td className="py-2 text-gray-500">{item.category}</td>
                    <td className="py-2 font-medium text-gray-900">{titleCase(item.name)}</td>
                    <td className="py-2 text-gray-400 text-[11px]">{item.by}</td>
                    <td className="py-2">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={function () { approveItem(item) }}
                          disabled={saving}
                          className="px-2 py-1 text-[11px] font-bold bg-gray-900 text-white rounded disabled:opacity-50"
                        >✓</button>
                        <button
                          onClick={function () { setRejectTarget(item); setRejectReason('') }}
                          disabled={saving}
                          className="px-2 py-1 text-[11px] font-bold text-red-600 border border-red-200 rounded disabled:opacity-50"
                        >✗</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Departments */}
      <Section title={t('departments')}>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('name')}</th>
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {departments.map(function (d) {
              return (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="py-2 text-gray-800">{d.name}</td>
                  <td className="py-2">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                      (d.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                      {d.active ? t('active') : t('inactive')}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      {/* Categories */}
      <Section title={t('categories')}>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('category')}</th>
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('subCat')}</th>
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(function (cat) {
              var subs = subCategories.filter(function (s) { return s.category_id === cat.id })
              if (subs.length === 0) {
                return (
                  <tr key={cat.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-800">{cat.name}</td>
                    <td className="py-2 text-gray-400">—</td>
                    <td className="py-2">
                      <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                        (cat.status === 'approved' ? "bg-green-100 text-green-700" : cat.status === 'pending' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                        {statusLabel(cat.status)}
                      </span>
                    </td>
                  </tr>
                )
              }
              return subs.map(function (sub, i) {
                return (
                  <tr key={cat.id + '-' + sub.id} className="border-b border-gray-100">
                    {i === 0 && <td className="py-2 text-gray-800" rowSpan={subs.length}>{cat.name}</td>}
                    <td className="py-2 text-gray-600">{sub.name}</td>
                    <td className="py-2">
                      <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                        (sub.status === 'approved' ? "bg-green-100 text-green-700" : sub.status === 'pending' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                        {statusLabel(sub.status)}
                      </span>
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </Section>

      {/* Venues */}
      <Section title={t('venues')}>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('code')}</th>
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('name')}</th>
              <th className="text-left py-2 text-[11px] font-bold text-gray-400 uppercase">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {venues.map(function (v) {
              return (
                <tr key={v.id} className="border-b border-gray-100">
                  <td className="py-2 font-bold text-gray-800 font-mono">{v.code}</td>
                  <td className="py-2 text-gray-600">{v.name}</td>
                  <td className="py-2">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                      (v.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                      {v.active ? t('active') : t('inactive')}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      {/* Reject modal */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title={t('reject') || 'Reject'}>
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Reject "{titleCase(rejectTarget.name)}"?</p>
              <p className="text-xs text-red-600 mt-1">This will permanently delete it.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea
                value={rejectReason}
                onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3"
                maxLength="500"
                placeholder="Reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={function () { setRejectTarget(null) }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={confirmReject} disabled={saving || !rejectReason.trim()}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AdminMobile
