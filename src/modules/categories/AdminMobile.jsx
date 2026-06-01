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
      <a href={window.location.origin + window.location.pathname + '?view=admin'}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold tracking-wide"
      >
        {"🖥️ " + t('openAdminDashboard')}
      </a>
    </div>
  )
}

export default AdminMobile
