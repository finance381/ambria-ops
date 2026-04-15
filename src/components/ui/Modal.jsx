function Modal({ open, onClose, title, wide, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={
        "relative bg-white w-full max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto " +
        "rounded-t-2xl sm:rounded-lg shadow-xl " +
        (wide ? "sm:max-w-4xl" : "sm:max-w-lg") +
        " sm:m-4"
      }>
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-100 z-10">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 truncate pr-4">{title}</h3>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl leading-none flex-shrink-0">
            ×
          </button>
        </div>
        <div className="p-4 sm:p-5 pb-8 sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  )
}

export default Modal