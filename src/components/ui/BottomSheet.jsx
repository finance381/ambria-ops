import { useEffect } from 'react'

function BottomSheet({ open, onClose, title, children }) {
  useEffect(function () {
    if (open) document.body.style.overflow = 'hidden'
    return function () { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 transition-opacity" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={function (e) { e.stopPropagation() }}
      >
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 pb-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 text-lg">
              ×
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export default BottomSheet