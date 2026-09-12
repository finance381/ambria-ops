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

  function mkButton(label) {
    var b = document.createElement('button')
    b.textContent = label
    Object.assign(b.style, {
      background: '#4338CA', color: '#fff', border: 'none', borderRadius: '999px',
      padding: '7px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
      fontFamily: 'inherit', flexShrink: '0',
    })
    return b
  }

  var downloadBtn = mkButton('Download')
  downloadBtn.onclick = function () {
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  bar.appendChild(title)
  bar.appendChild(downloadBtn)

  var file = null
  try { file = new File([blob], filename, { type: 'application/pdf' }) } catch (_) {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    var shareBtn = mkButton('Share')
    shareBtn.onclick = function () {
      navigator.share({ files: [file] }).catch(function () {})
    }
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

  var frame = document.createElement('iframe')
  frame.src = url
  frame.title = filename
  Object.assign(frame.style, { flex: '1', border: 'none', width: '100%', background: '#525659' })

  overlay.appendChild(bar)
  overlay.appendChild(frame)
  document.body.appendChild(overlay)

  function onKeyDown(e) { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKeyDown)

  function close() {
    document.removeEventListener('keydown', onKeyDown)
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
  }
}
