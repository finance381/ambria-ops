import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import Icon from '../../components/ui/Icon'
import { CARD, Chip, Notice, EmptyState, CHIP_INFO, CHIP_WARN } from './ui'

// Which messages a salesperson sees in Quick Send, in what order, and —
// for the Quote sequence only — whether a step can be sent more than once
// (a follow-up) and how often. The Booked sequence has no repeat concept:
// those are one-shot milestones (confirmation, payment reminders), each
// sent once. See src/modules/broadcast/SalesQuickSend.jsx for the screen
// this configures.
var SEQUENCES = [{ key: 'booked', label: 'Booked sequence' }, { key: 'quote', label: 'Quote sequence' }]

function QuickSendSequences({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canEdit = hasPerm(permsNew, 'broadcast.settings')

  var [active, setActive] = useState('booked')
  var [templates, setTemplates] = useState([])
  var [steps, setSteps] = useState([])
  var [loading, setLoading] = useState(true)
  var [error, setError] = useState('')
  var [busy, setBusy] = useState('')

  function load() {
    setLoading(true)
    Promise.all([
      supabase.from('wa_templates').select('id, name, category').eq('sales_approved', true).eq('meta_status', 'approved').order('name'),
      supabase.from('wa_quicksend_steps').select('*').order('order_index'),
    ]).then(function (res) {
      setTemplates(res[0].data || [])
      setSteps(res[1].data || [])
      setLoading(false)
    })
  }
  useEffect(function () { load() }, [])

  var templateById = {}
  templates.forEach(function (t) { templateById[t.id] = t })

  var seqSteps = steps.filter(function (s) { return s.sequence === active }).slice().sort(function (a, b) { return a.order_index - b.order_index })
  var usedTemplateIds = steps.filter(function (s) { return s.sequence === active }).map(function (s) { return s.template_id })
  var availTemplates = templates.filter(function (t) { return usedTemplateIds.indexOf(t.id) === -1 })

  async function reorder(orderedIds) {
    setBusy('reorder')
    var { error: err } = await supabase.rpc('rpc_wa_quicksend_reorder', { p_sequence: active, p_ordered_ids: orderedIds })
    setBusy('')
    if (err) { setError(err.message); return }
    load()
  }
  function moveUp(step) {
    var i = seqSteps.findIndex(function (s) { return s.id === step.id })
    if (i <= 0) return
    var ids = seqSteps.map(function (s) { return s.id })
    var t = ids[i - 1]; ids[i - 1] = ids[i]; ids[i] = t
    reorder(ids)
  }
  function moveDown(step) {
    var i = seqSteps.findIndex(function (s) { return s.id === step.id })
    if (i === -1 || i >= seqSteps.length - 1) return
    var ids = seqSteps.map(function (s) { return s.id })
    var t = ids[i + 1]; ids[i + 1] = ids[i]; ids[i] = t
    reorder(ids)
  }

  async function addStep(templateId) {
    setBusy('add' + templateId); setError('')
    var { error: err } = await supabase.rpc('rpc_wa_quicksend_upsert_step', { p_sequence: active, p_template_id: templateId })
    setBusy('')
    if (err) { setError(err.message); return }
    load()
  }
  async function removeStep(step) {
    setBusy('rm' + step.id); setError('')
    var { error: err } = await supabase.rpc('rpc_wa_quicksend_remove_step', { p_step_id: step.id })
    setBusy('')
    if (err) { setError(err.message); return }
    load()
  }
  async function saveStep(step, patch) {
    setBusy('save' + step.id); setError('')
    var { error: err } = await supabase.rpc('rpc_wa_quicksend_upsert_step', {
      p_sequence: active, p_template_id: step.template_id,
      p_repeatable: patch.repeatable != null ? patch.repeatable : step.repeatable,
      p_repeat_interval_days: patch.repeat_interval_days !== undefined ? patch.repeat_interval_days : step.repeat_interval_days,
      p_repeat_max_count: patch.repeat_max_count !== undefined ? patch.repeat_max_count : step.repeat_max_count,
    })
    setBusy('')
    if (err) { setError(err.message); return }
    load()
  }
  function toggleRepeatable(step) {
    saveStep(step, { repeatable: !step.repeatable, repeat_interval_days: step.repeat_interval_days || 3, repeat_max_count: step.repeat_max_count })
  }
  function bumpInterval(step, delta) {
    saveStep(step, { repeat_interval_days: Math.max(1, (step.repeat_interval_days || 3) + delta) })
  }
  function bumpMax(step, delta) {
    var base = step.repeat_max_count == null ? 0 : step.repeat_max_count
    var next = base + delta
    saveStep(step, { repeat_max_count: next <= 0 ? null : next })
  }

  if (!canEdit) {
    return <EmptyState icon="alert" title="Admin only" hint="Quick Send sequences are configured by an admin." />
  }
  if (loading) return <p className="text-center text-[13px] text-slate-400 py-10">Loading…</p>

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Quick Send Sequences</h2>
        <p className="text-[11.5px] text-slate-500 mt-0.5">
          Booked clients and clients still deciding on a quote get different message sequences. Build or edit a message's content in Templates — this only controls the sequence it belongs to, its order, and — for quote follow-ups — how often it can repeat.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200">
        {SEQUENCES.map(function (s) {
          var on = active === s.key
          return (
            <button key={s.key} type="button" onClick={function () { setActive(s.key) }} aria-pressed={on}
              className={'h-8 px-3.5 rounded-lg text-[12.5px] font-bold transition-colors ' + (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
              {s.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 items-start">
        <div className={CARD + ' overflow-hidden'}>
          <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-900">In the {active === 'booked' ? 'Booked' : 'Quote'} sequence</span>
            <span className="text-[11px] text-slate-400">{seqSteps.length} message{seqSteps.length === 1 ? '' : 's'} · reorder with the arrows</span>
          </div>

          {seqSteps.length === 0 ? (
            <EmptyState icon="send" title="Nothing in this sequence yet" hint="Add a template from the list on the right." />
          ) : seqSteps.map(function (step, i) {
            var t = templateById[step.template_id]
            return (
              <div key={step.id} className="px-3.5 py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1 shrink-0">
                    <button type="button" onClick={function () { moveUp(step) }} disabled={i === 0 || !!busy}
                      className="w-6 h-6 rounded-md border border-slate-200 bg-white text-slate-500 disabled:opacity-30 inline-flex items-center justify-center hover:bg-slate-50">
                      <Icon name="chevronUp" size={12} />
                    </button>
                    <button type="button" onClick={function () { moveDown(step) }} disabled={i === seqSteps.length - 1 || !!busy}
                      className="w-6 h-6 rounded-md border border-slate-200 bg-white text-slate-500 disabled:opacity-30 inline-flex items-center justify-center hover:bg-slate-50">
                      <Icon name="chevronDown" size={12} />
                    </button>
                  </div>

                  <span className="shrink-0 w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 inline-flex items-center justify-center text-[12px] font-extrabold">{i + 1}</span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold text-slate-900">{t ? t.name : 'Template #' + step.template_id}</span>
                      {t && <Chip tone={t.category === 'marketing' ? CHIP_WARN : CHIP_INFO}>{t.category}</Chip>}
                      {step.repeatable && <Chip tone={CHIP_WARN}>repeats</Chip>}
                    </div>
                  </div>

                  {active === 'quote' && (
                    <button type="button" onClick={function () { toggleRepeatable(step) }} title="Allow this to be sent more than once"
                      className={'relative inline-flex shrink-0 w-9 h-5 rounded-full transition-colors ' + (step.repeatable ? 'bg-indigo-600' : 'bg-slate-300')}>
                      <span className={'absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ' + (step.repeatable ? 'translate-x-4' : 'translate-x-0')} />
                    </button>
                  )}

                  <button type="button" onClick={function () { removeStep(step) }} disabled={busy === 'rm' + step.id} title="Remove from sequence"
                    className="shrink-0 w-7 h-7 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 inline-flex items-center justify-center disabled:opacity-40">
                    <Icon name="close" size={14} />
                  </button>
                </div>

                {step.repeatable && (
                  <div className="mt-2 ml-[4.75rem] flex items-center gap-2 flex-wrap text-[11.5px] text-slate-500">
                    <span>Repeat every</span>
                    <span className="inline-flex items-center border border-slate-200 rounded-md overflow-hidden">
                      <button type="button" onClick={function () { bumpInterval(step, -1) }} className="w-6 h-6 text-slate-500 hover:bg-slate-50">−</button>
                      <span className="w-7 text-center text-[12px] font-bold text-slate-900 tabular-nums">{step.repeat_interval_days || 3}</span>
                      <button type="button" onClick={function () { bumpInterval(step, 1) }} className="w-6 h-6 text-slate-500 hover:bg-slate-50">+</button>
                    </span>
                    <span>days, up to</span>
                    <span className="inline-flex items-center border border-slate-200 rounded-md overflow-hidden">
                      <button type="button" onClick={function () { bumpMax(step, -1) }} className="w-6 h-6 text-slate-500 hover:bg-slate-50">−</button>
                      <span className="w-7 text-center text-[12px] font-bold text-slate-900 tabular-nums">{step.repeat_max_count ? step.repeat_max_count : '∞'}</span>
                      <button type="button" onClick={function () { bumpMax(step, 1) }} className="w-6 h-6 text-slate-500 hover:bg-slate-50">+</button>
                    </span>
                    <span>times</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className={CARD + ' overflow-hidden'}>
          <div className="px-3.5 py-2.5 border-b border-slate-100">
            <span className="text-[13px] font-bold text-slate-900">Available templates</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Sales-approved templates not yet in this sequence.</p>
          </div>
          {availTemplates.length === 0 ? (
            <p className="px-3.5 py-6 text-[12px] text-slate-400">Every sales-approved template is already in this sequence.</p>
          ) : availTemplates.map(function (t) {
            return (
              <div key={t.id} className="px-3.5 py-2.5 border-b border-slate-50 last:border-0 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-slate-700 truncate">{t.name}</span>
                  <Chip tone={t.category === 'marketing' ? CHIP_WARN : CHIP_INFO}>{t.category}</Chip>
                </div>
                <button type="button" onClick={function () { addStep(t.id) }} disabled={busy === 'add' + t.id}
                  className="shrink-0 h-7 px-2.5 rounded-lg bg-indigo-50 text-indigo-700 text-[11.5px] font-bold hover:bg-indigo-100 disabled:opacity-40 inline-flex items-center gap-1">
                  <Icon name="plus" size={11} strokeWidth={2.6} />
                  Add
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-[11.5px] text-slate-400 leading-relaxed">
        A client moves from the Quote sequence to the Booked sequence once their event is confirmed — any quote follow-ups in progress just stop being offered. "Repeats" messages show a Send-again button in Quick Send instead of a one-time checkbox, and stop offering once the cap above is reached.
      </p>
    </div>
  )
}

export default QuickSendSequences
