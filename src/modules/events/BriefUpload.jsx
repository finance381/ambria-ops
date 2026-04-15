import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'

var ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]
var ALLOWED_EXT = ['.pdf', '.ppt', '.pptx']
var MAX_SIZE = 20 * 1024 * 1024

function BriefUpload({ func, profile, onDone }) {
  var [briefs, setBriefs] = useState([])
  var [loading, setLoading] = useState(true)
  var [uploading, setUploading] = useState(false)
  var [error, setError] = useState('')

  var supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ptksdithbytzrznplfiq.supabase.co'

  useEffect(function () { loadBriefs() }, [])

  async function loadBriefs() {
    var { data } = await supabase
      .from('event_briefs')
      .select('*, profiles:uploaded_by(name)')
      .eq('event_id', func.id)
      .order('created_at', { ascending: false })
    setBriefs(data || [])
    setLoading(false)
  }

  async function handleUpload(e) {
    var file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Validate type
    var ext = '.' + file.name.split('.').pop().toLowerCase()
    if (ALLOWED_EXT.indexOf(ext) === -1) {
      setError('Only PDF, PPT, PPTX files allowed')
      return
    }
    if (file.size > MAX_SIZE) {
      setError('File too large (max 20MB)')
      return
    }

    setUploading(true)
    setError('')

    var path = 'events/' + func.id + '/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    var { error: uploadErr } = await supabase.storage.from('briefs').upload(path, file, { upsert: false })
    if (uploadErr) {
      setError('Upload failed: ' + uploadErr.message)
      setUploading(false)
      return
    }

    var { error: insertErr } = await supabase.from('event_briefs').insert({
      event_id: func.id,
      file_path: path,
      file_name: file.name,
      file_type: ext.replace('.', ''),
      uploaded_by: profile.id,
    })
    if (insertErr) {
      setError('Save failed: ' + insertErr.message)
      setUploading(false)
      return
    }

    logActivity('BRIEF_UPLOAD', func.event_name + ' | ' + file.name)
    loadBriefs()
    setUploading(false)
  }

  async function deleteBrief(brief) {
    if (!confirm('Delete "' + brief.file_name + '"?')) return
    await supabase.storage.from('briefs').remove([brief.file_path])
    await supabase.from('event_briefs').delete().eq('id', brief.id)
    logActivity('BRIEF_DELETE', func.event_name + ' | ' + brief.file_name)
    loadBriefs()
  }

  function getBriefUrl(path) {
    return supabaseUrl + '/storage/v1/object/public/briefs/' + path
  }

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">Decor Briefs: {func.event_name || func.contract_type || '—'}</h3>
        <button onClick={onDone}
          className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">← Back</button>
      </div>

      {/* Upload */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <div className="text-2xl mb-2">📎</div>
        <label className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer transition-colors font-medium inline-block">
          {uploading ? 'Uploading...' : 'Upload Brief (PDF/PPT)'}
          <input type="file" accept=".pdf,.ppt,.pptx" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
        <p className="text-xs text-gray-400 mt-2">PDF, PPT, PPTX — max 20MB</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Existing briefs */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : briefs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No briefs uploaded yet</p>
      ) : (
        <div className="space-y-2">
          {briefs.map(function (brief) {
            var icon = brief.file_type === 'pdf' ? '📄' : '📊'
            var canDelete = brief.uploaded_by === profile.id || isAdmin
            return (
              <div key={brief.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
                <span className="text-xl flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <a href={getBriefUrl(brief.file_path)} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800 truncate block">
                    {brief.file_name}
                  </a>
                  <p className="text-[11px] text-gray-400">
                    {brief.profiles?.name || '—'} · {formatDate(brief.created_at)}
                  </p>
                </div>
                <a href={getBriefUrl(brief.file_path)} target="_blank" rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-medium border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0">
                  View
                </a>
                {canDelete && (
                  <button onClick={function () { deleteBrief(brief) }}
                    className="px-2.5 py-1 text-[11px] font-medium border border-red-200 rounded text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                    Delete
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default BriefUpload