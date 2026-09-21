import { useState } from 'react'
import { getReceiptUrl } from '../../lib/uploadHelper'
import ImageLightbox from '../ui/ImageLightbox'

function PaymentProofThumbs({ meta }) {
  var [preview, setPreview] = useState(null)
  var paths = meta && Array.isArray(meta.payment_images) ? meta.payment_images : []
  var dedPath = meta && typeof meta.deduction_image === 'string' && meta.deduction_image ? meta.deduction_image : null
  if (paths.length === 0 && !dedPath) return null

  return (
    <div className="flex gap-1.5 mt-1.5 flex-wrap">
      {paths.map(function (p, i) {
        var url = getReceiptUrl(p)
        return (
          <button key={p + '_' + i} type="button" onClick={function () { setPreview(url) }}
            className="block w-10 h-10 rounded border border-gray-200 overflow-hidden hover:border-indigo-400 hover:shadow-sm transition-all"
            title={'Payment proof ' + (i + 1) + ' — click to view'}>
            <img src={url} alt={'proof ' + (i + 1)}
              className="w-full h-full object-cover"
              loading="lazy" />
          </button>
        )
      })}
      {dedPath && (function () {
        var dUrl = getReceiptUrl(dedPath)
        return (
          <button key={'ded_' + dedPath} type="button" onClick={function () { setPreview(dUrl) }}
            className="block w-10 h-10 rounded border border-amber-300 overflow-hidden hover:border-amber-500 hover:shadow-sm transition-all ring-1 ring-amber-200"
            title="Updated bill / deduction proof — click to view">
            <img src={dUrl} alt="deduction proof"
              className="w-full h-full object-cover"
              loading="lazy" />
          </button>
        )
      })()}
      {preview && <ImageLightbox url={preview} onClose={function () { setPreview(null) }} />}
    </div>
  )
}

export default PaymentProofThumbs
