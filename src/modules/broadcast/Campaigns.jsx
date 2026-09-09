import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import CampaignBuilder from './CampaignBuilder.jsx'

var STATUS_CLS = {
  draft: 'bg-gray-100 text-gray-600', scheduled: 'bg-amber-100 text-amber-700',
  sending: 'bg-indigo-100 text-indigo-700', sent: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function StatPill({ label, value }) {
  return <span className="text-[10px] text-gray-500">{label} <b className="text-gray-800">{value}</b></span>
}

function Campaigns({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canCreate = hasPerm(permsNew, 'broadcast.campaigns.create')
  var canCancel = hasPerm(permsNew, 'broadcast.campaigns.cancel') || canCreate

  var [campaigns, setCampaigns] = useState([])
  var [templateNames, setTemplateNames] = useState({})
  var [loading, setLoading] = useState(true)
  var [openId, setOpenId] = useState(undefined) // undefined = list view, null = new, number = edit

  function loadCampaigns() {
    setLoading(true)
    supabase.from('wa_campaigns').select('*').order('created_at', { ascending: false })
      .then(function (res) {
        var rows = res.data || []
        setCampaigns(rows)
        var ids = Array.from(new Set(rows.map(function (c) { return c.template_id })))
        if (ids.length > 0) {
          supabase.from('wa_templates').select('id, name').in('id', ids).then(function (tRes) {
            var map = {}
            ;(tRes.data || []).forEach(function (t) { map[t.id] = t.name })
            setTemplateNames(map)
          })
        }
        setLoading(false)
      })
  }

  useEffect(function () { loadCampaigns() }, [])

  async function cancelCampaign(c) {
    if (!window.confirm('Cancel this scheduled campaign?')) return
    var res = await supabase.from('wa_campaigns').update({ status: 'cancelled' }).eq('id', c.id)
    if (!res.error) loadCampaigns()
  }

  function duplicateCampaign(c) {
    supabase.from('wa_campaigns').insert({
      name: c.name + ' (copy)', template_id: c.template_id,
      audience_filter_json: c.audience_filter_json, variable_mapping_json: c.variable_mapping_json,
    }).select().single().then(function (res) {
      if (!res.error) setOpenId(res.data.id)
    })
  }

  if (openId !== undefined) {
    return (
      <CampaignBuilder campaignId={openId} onClose={function () { setOpenId(undefined); loadCampaigns() }}
        onSaved={function () { loadCampaigns() }} />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Campaigns</h2>
        {canCreate && (
          <button onClick={function () { setOpenId(null) }} className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg">+ New Campaign</button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Name</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Template</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Stats</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Status</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Sent At</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-6">Loading...</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-6">No campaigns yet</td></tr>
            ) : campaigns.map(function (c) {
              return (
                <tr key={c.id} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-3 py-2 font-medium text-gray-900 cursor-pointer" onClick={function () { setOpenId(c.id) }}>{c.name}</td>
                  <td className="px-3 py-2 text-gray-500">{templateNames[c.template_id] || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 flex-wrap">
                      <StatPill label="Sent" value={c.sent_count} />
                      <StatPill label="Delivered" value={c.delivered_count} />
                      <StatPill label="Read" value={c.read_count} />
                      <StatPill label="Failed" value={c.failed_count} />
                    </div>
                  </td>
                  <td className="px-3 py-2"><span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded " + (STATUS_CLS[c.status] || '')}>{c.status}</span></td>
                  <td className="px-3 py-2 text-gray-500">{c.sent_at ? formatDate(c.sent_at) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button onClick={function () { setOpenId(c.id) }} className="text-[11px] font-bold text-indigo-600">View</button>
                      {canCreate && <button onClick={function () { duplicateCampaign(c) }} className="text-[11px] font-bold text-gray-500">Duplicate</button>}
                      {canCancel && (c.status === 'draft' || c.status === 'scheduled') && (
                        <button onClick={function () { cancelCampaign(c) }} className="text-[11px] font-bold text-red-600">Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Campaigns
