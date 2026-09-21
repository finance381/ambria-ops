import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import ImageLightbox from '../ui/ImageLightbox'

var AUDIO_EXT = ['webm', 'mp3', 'm4a', 'ogg', 'wav', 'aac']

function extOf(path) {
  if (!path) return ''
  var q = path.indexOf('?')
  var clean = q === -1 ? path : path.slice(0, q)
  var dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
}

function LedgerSourceMedia({ paths }) {
  var [preview, setPreview] = useState(null)
  if (!paths || paths.length === 0) return null

  var items = paths.map(function (p) {
    var url = supabase.storage.from('receipts').getPublicUrl(p).data.publicUrl
    var isAudio = AUDIO_EXT.indexOf(extOf(p)) !== -1
    return { path: p, url: url, isAudio: isAudio }
  })

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1.5">
      {items.map(function (it, i) {
        if (it.isAudio) {
          return (
            <div key={it.path + '_' + i} className="flex items-center gap-1.5 px-2 py-1 rounded border border-indigo-200 bg-indigo-50">
              <span className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wide">🎙 Voice</span>
              <audio src={it.url} controls preload="none" style={{ height: '28px', maxWidth: '200px' }} />
            </div>
          )
        }
        return (
          <button key={it.path + '_' + i} type="button" onClick={function () { setPreview(it.url) }}
            className="block w-10 h-10 rounded border border-gray-200 overflow-hidden hover:border-indigo-400 hover:shadow-sm transition-all"
            title="Source expense receipt — click to view">
            <img src={it.url} alt={'receipt ' + (i + 1)}
              className="w-full h-full object-cover"
              loading="lazy" />
          </button>
        )
      })}
      {preview && <ImageLightbox url={preview} onClose={function () { setPreview(null) }} />}
    </div>
  )
}

export default LedgerSourceMedia
