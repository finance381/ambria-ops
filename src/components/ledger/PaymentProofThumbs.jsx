import { supabase } from '../../lib/supabase'

function PaymentProofThumbs({ meta }) {
  var paths = meta && Array.isArray(meta.payment_images) ? meta.payment_images : []
  if (paths.length === 0) return null

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
    </div>
  )
}

export default PaymentProofThumbs