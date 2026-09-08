import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

function useProjectSubmit(formApi, onDone) {
  var [saving, setSaving] = useState(false)

  async function submit() {
    if (saving) return
    var validationErr = formApi.validate()
    if (validationErr) { formApi.setError(validationErr); return }

    setSaving(true)
    formApi.setError('')

    var payload = formApi.getPayload()
    var isNew = !payload.project.id
    var { data: projectId, error: rpcErr } = await supabase.rpc('rpc_project_upsert', {
      p_project: payload.project,
      p_vendors: payload.vendors,
      p_estimation_items: payload.estimation_items,
    })
    if (rpcErr) { formApi.setError(rpcErr.message || 'Save failed'); setSaving(false); return }

    // Remove attachments the user unticked while editing
    if (formApi.removedAttachmentIds.length > 0) {
      var { data: toRemove } = await supabase.from('project_attachments')
        .select('id, file_path').in('id', formApi.removedAttachmentIds)
      var pathsToRemove = (toRemove || []).map(function (r) { return r.file_path })
      if (pathsToRemove.length > 0) {
        try { await supabase.storage.from('project-attachments').remove(pathsToRemove) } catch (_) {}
      }
      await supabase.from('project_attachments').delete().in('id', formApi.removedAttachmentIds)
    }

    // Upload newly queued attachments in parallel, then insert their rows
    if (formApi.attachmentsQueue.length > 0) {
      var uploadResults = await Promise.all(formApi.attachmentsQueue.map(async function (a) {
        var clientUuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2, 10))
        var safeName = (a.file.name || 'file').replace(/[\/\\]/g, '_')
        var path = projectId + '/' + clientUuid + '-' + safeName
        var up = await supabase.storage.from('project-attachments').upload(path, a.file, { contentType: a.file.type || undefined })
        if (up.error) return { error: up.error, name: a.file.name }
        return { path: path, kind: a.kind, caption: a.caption }
      }))
      var failedUploads = uploadResults.filter(function (r) { return r.error })
      var okUploads = uploadResults.filter(function (r) { return !r.error })
      if (okUploads.length > 0) {
        await supabase.from('project_attachments').insert(okUploads.map(function (o) {
          return { project_id: projectId, file_path: o.path, kind: o.kind, caption: o.caption || null }
        }))
      }
      if (failedUploads.length > 0) {
        formApi.setError('Project saved, but ' + failedUploads.length + ' attachment(s) failed to upload (' +
          failedUploads.map(function (f) { return f.name }).join(', ') + '). Re-add them by editing this project.')
        setSaving(false)
        if (onDone) onDone(projectId)
        return
      }
    }

    try { await logActivity(isNew ? 'PROJECT_CREATE' : 'PROJECT_UPDATE', payload.project.name + ' (#' + projectId + ')') } catch (_) {}
    setSaving(false)
    if (onDone) onDone(projectId)
  }

  return { submit: submit, saving: saving }
}

export default useProjectSubmit
