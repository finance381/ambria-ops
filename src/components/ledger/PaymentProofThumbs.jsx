import { supabase } from '../../lib/supabase'

function PaymentProofThumbs({ meta }) {
  var paths = meta && Array.isArray(meta.payment_images) ? meta.payment_images : []
  var dedPath = meta && typeof meta.deduction_image === 'string' && meta.deduction_image ? meta.deduction_image : null
  if (paths.length === 0 && !dedPath) return null

  return (
    <div className="flex gap-1.5 mt-1.5 flex-wrap">
      {paths.map(function (p, i) {
        var url = supabase.storage.from('receipts').getPublicUrl(p).data.publicUrl
        return (
          <a key={p + '_' + i} href={url} target="_blank" rel="noopener noreferrer"
            className="block w-10 h-10 rounded border border-gray-200 overflow-hidden hover:border-indigo-400 hover:shadow-sm transition-all"
            title={'Payment proof ' + (i + 1) + ' — click to view'}>
            <img src={url} alt={'proof ' + (i + 1)}
              className="w-full h-full object-cover"
              loading="lazy" />
          </a>
        )
      })}
      {dedPath && (function () {
        var dUrl = supabase.storage.from('receipts').getPublicUrl(dedPath).data.publicUrl
        return (
          <a key={'ded_' + dedPath} href={dUrl} target="_blank" rel="noopener noreferrer"
            className="block w-10 h-10 rounded border border-amber-300 overflow-hidden hover:border-amber-500 hover:shadow-sm transition-all ring-1 ring-amber-200"
            title="Updated bill / deduction proof — click to view">
            <img src={dUrl} alt="deduction proof"
              className="w-full h-full object-cover"
              loading="lazy" />
          </a>
        )
      })()}
    </div>
  )
}

export default PaymentProofThumbs