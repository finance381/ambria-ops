// Shared "this is the description" treatment — an eyebrow label (option 2)
// over a tinted callout block (option 4), merged per request. Reused for any
// free-text field a user typed (description/remarks/purpose/notes) so it
// reads the same way everywhere instead of blending into muted metadata.
function DescriptionNote({ text, label, truncate, className }) {
  if (!text) return null
  return (
    <div className={className || 'mt-1.5'}>
      <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-indigo-300 mb-1">{label || 'Description'}</p>
      <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-indigo-100">
        <p className={"text-[12.5px] text-slate-700 font-medium leading-snug " + (truncate === false ? '' : 'truncate')}>{text}</p>
      </div>
    </div>
  )
}

export default DescriptionNote
