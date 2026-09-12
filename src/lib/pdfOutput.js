// Every generated PDF in the app used to end in doc.save(filename) — a synthetic
// <a download> click. On desktop that forces an immediate download instead of
// letting the user preview it first, and inside this app's installed-PWA mobile
// context, that synthetic click frequently does nothing visible at all (no share
// sheet, no download, no way to get the file back out) — matching what mobile
// users reported. A plain new-tab open (or jumping straight into the OS share
// sheet, which desktop Chrome on Windows also supports) only gave ONE of
// preview/download/share at a time and picked it for the user by device.
//
// So this renders its own always-available preview instead: a fullscreen
// overlay with the PDF in an <iframe> plus explicit Download and Share buttons,
// the same on every device. Built with plain DOM (not a React component)
// because this one helper is called from ~10 unrelated modules, most of them
// outside any component that could host a portal — Object.assign(...style)
// throughout rather than Tailwind classes so it renders correctly regardless
// of whether a hand-built class string here happens to survive Tailwind's
// content scan.
export async function openOrSharePdf(doc, filename) {
  var blob = doc.output('blob')
  var url = URL.createObjectURL(blob)
  showPdfPreview(blob, url, filename)
}

function showPdfPreview(blob, url, filename) {
  var overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '100000',
    background: '#0b0c10', display: 'flex', flexDirection: 'column',
  })

  var bar = document.createElement('div')
  Object.assign(bar.style, {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
    background: '#111827', flexShrink: '0', boxShadow: '0 1px 0 rgba(255,255,255,0.06)',
  })

  var title = document.createElement('span')
  title.textContent = filename
  Object.assign(title.style, {
    flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: '13px', fontWeight: '600', color: '#fff', fontFamily: 'inherit',
  })

  function mkButton(label, big) {
    var b = document.createElement('button')
    b.textContent = label
    Object.assign(b.style, {
      background: '#4338CA', color: '#fff', border: 'none', borderRadius: '999px',
      padding: big ? '11px 22px' : '7px 14px', fontSize: big ? '14px' : '13px', fontWeight: '600',
      cursor: 'pointer', fontFamily: 'inherit', flexShrink: '0',
    })
    return b
  }

  function download() {
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  var file = null
  try { file = new File([blob], filename, { type: 'application/pdf' }) } catch (_) {}
  var canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }))
  function share() {
    navigator.share({ files: [file] }).catch(function () {})
  }

  var downloadBtn = mkButton('Download')
  downloadBtn.onclick = download
  bar.appendChild(title)
  bar.appendChild(downloadBtn)
  if (canShareFile) {
    var shareBtn = mkButton('Share')
    shareBtn.onclick = share
    bar.appendChild(shareBtn)
  }

  var closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close preview')
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#9ca3af', border: 'none', fontSize: '18px',
    cursor: 'pointer', padding: '4px 10px', lineHeight: '1', fontFamily: 'inherit',
  })
  closeBtn.onclick = close
  bar.appendChild(closeBtn)

  overlay.appendChild(bar)

  // Chrome for Android (and likely other mobile browsers) can only render a PDF
  // through its own full-tab viewer — asked to show one inside an <iframe> it
  // shows an inert "This page has been blocked by Chrome" placeholder instead of
  // the PDF. Desktop browsers render a blob-URL PDF in an iframe fine, so the
  // live inline preview is desktop-only; touch devices get a plain panel with
  // the same Download/Share actions, sized for a thumb instead of a cursor.
  var isTouchDevice = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  if (isTouchDevice) {
    var panel = document.createElement('div')
    Object.assign(panel.style, {
      flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '14px', padding: '24px', color: '#d1d5db', fontFamily: 'inherit', textAlign: 'center',
    })
    var icon = document.createElement('div')
    icon.textContent = '📄'
    icon.style.fontSize = '48px'
    var name = document.createElement('div')
    name.textContent = filename
    Object.assign(name.style, { fontSize: '14px', fontWeight: '600', color: '#fff', wordBreak: 'break-all' })
    var hint = document.createElement('div')
    hint.textContent = 'Preview isn’t available on this device — download or share it instead.'
    Object.assign(hint.style, { fontSize: '13px', maxWidth: '280px', lineHeight: '1.5' })
    var actions = document.createElement('div')
    Object.assign(actions.style, { display: 'flex', gap: '10px', marginTop: '6px' })
    var bigDownload = mkButton('Download', true)
    bigDownload.onclick = download
    actions.appendChild(bigDownload)
    if (canShareFile) {
      var bigShare = mkButton('Share', true)
      bigShare.onclick = share
      actions.appendChild(bigShare)
    }
    panel.appendChild(icon)
    panel.appendChild(name)
    panel.appendChild(hint)
    panel.appendChild(actions)
    overlay.appendChild(panel)
  } else {
    var frame = document.createElement('iframe')
    frame.src = url
    frame.title = filename
    Object.assign(frame.style, { flex: '1', border: 'none', width: '100%', background: '#525659' })
    overlay.appendChild(frame)
  }

  document.body.appendChild(overlay)

  function onKeyDown(e) { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKeyDown)

  function close() {
    document.removeEventListener('keydown', onKeyDown)
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
  }
}
