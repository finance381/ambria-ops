import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import CampaignBuilder from './CampaignBuilder.jsx'
import { BTN_PRIMARY, TH, TD, Chip, EmptyState, CHIP_GOOD, CHIP_WARN, CHIP_BAD, CHIP_INFO, CHIP_NEUTRAL } from './ui'

// Every status the send pipeline can leave a campaign in. `partial` means some
// recipients failed, which is a warning and not a success — it used to share
// amber with `scheduled`, so a half-failed send read as one that had not left
// yet.
var STATUS_TONE = {
  draft: CHIP_NEUTRAL,
  scheduled: CHIP_WARN,
  sending: CHIP_INFO,
  sent: CHIP_GOOD,
  partial: CHIP_WARN,
  failed: CHIP_BAD,
  cancelled: CHIP_NEUTRAL,
}

// Four counts on one line. Failed goes red as soon as it is non-zero — the
// number nobody wants to hunt for was printing in the same grey as the rest.
function StatCell({ campaign }) {
  var items = [
    { label: 'Sent', value: campaign.sent_count },
    { label: 'Delivered', value: campaign.delivered_count },
    { label: 'Read', value: campaign.read_count },
    { label: 'Failed', value: campaign.failed_count, bad: true },
  ]
  var anyValue = items.some(function (it) { return it.value })
  if (!anyValue) return <span className="text-slate-300">—</span>
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {items.map(function (it) {
        var hot = it.bad && it.value > 0
        return (
          <span key={it.label} className="text-[10.5px] text-slate-400 whitespace-nowrap">
            {it.label}{' '}
            <b className={'text-[11.5px] tabular-nums ' + (hot ? 'text-red-600' : 'text-slate-800')} data-notranslate>
              {it.value || 0}
            </b>
          </span>
        )
      })}
    </span>
  )
}

// Icon-only, because three text links per row turned the Actions column into
// the widest thing in the table. title + aria-label carry the name.
function RowAction({ icon, label, tone, onClick }) {
  return (
    <button type="button" title={label} aria-label={label}
      onClick={function (ev) { ev.stopPropagation(); onClick() }}
      className={'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ' +
        (tone === 'danger'
          ? 'text-slate-400 hover:text-red-600 hover:bg-red-50'
          : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50')}>
      <Icon name={icon} size={14} />
    </button>
  )
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

  var countLine = loading ? 'Loading…'
    : campaigns.length + (campaigns.length === 1 ? ' campaign' : ' campaigns')

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Campaigns</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">{countLine}</p>
        </div>
        {canCreate && (
          <button onClick={function () { setOpenId(null) }} className={BTN_PRIMARY}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            New Campaign
          </button>
        )}
      </div>

      {/* overflow-hidden rounds the card, overflow-x-auto scrolls the table.
          Both on one element makes the other axis compute to auto too, which
          is where the stray vertical scrollbar arrows came from. */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="overflow-x-auto ambria-thin-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={TH}>Name</th>
                <th className={TH}>Template</th>
                <th className={TH}>Stats</th>
                <th className={TH}>Status</th>
                <th className={TH}>Sent At</th>
                <th className={TH + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-[12px] text-slate-400 py-8">Loading…</td></tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon="send" title="No campaigns yet"
                      hint="A campaign sends one approved template to a filtered set of contacts." />
                  </td>
                </tr>
              ) : campaigns.map(function (c) {
                var cancellable = canCancel && (c.status === 'draft' || c.status === 'scheduled')
                return (
                  // The whole row opens the builder, not just the name cell —
                  // the name was the only hit target and nothing said so.
                  <tr key={c.id} onClick={function () { setOpenId(c.id) }}
                    className="group border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className={TD + ' font-semibold text-slate-900'}>{c.name}</td>
                    <td className={TD + ' text-slate-500 whitespace-nowrap'}>
                      {templateNames[c.template_id] || <span className="text-slate-300">—</span>}
                    </td>
                    <td className={TD}><StatCell campaign={c} /></td>
                    <td className={TD}><Chip tone={STATUS_TONE[c.status]}>{c.status}</Chip></td>
                    <td className={TD + ' text-slate-500 whitespace-nowrap'}>
                      {c.sent_at ? formatDate(c.sent_at) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={TD + ' text-right whitespace-nowrap'}>
                      <span className="inline-flex items-center gap-0.5">
                        <RowAction icon="eye" label="View campaign" onClick={function () { setOpenId(c.id) }} />
                        {canCreate && <RowAction icon="copy" label="Duplicate as a new draft" onClick={function () { duplicateCampaign(c) }} />}
                        {cancellable && <RowAction icon="close" label="Cancel campaign" tone="danger" onClick={function () { cancelCampaign(c) }} />}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Campaigns
