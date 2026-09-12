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
// overlay with the PDF plus explicit Download and Share buttons, the same on
// every device. Built with plain DOM (not a React component) because this one
// helper is called from ~10 unrelated modules, most of them outside any
// component that could host a portal — Object.assign(...style) throughout
// rather than Tailwind classes so it renders correctly regardless of whether a
// hand-built class string here happens to survive Tailwind's content scan.
export async function openOrSharePdf(doc, filename) {
  var blob = doc.output('blob')
  var url = URL.createObjectURL(blob)
  await showPdfPreview(blob, url, filename)
}

async function showPdfPreview(blob, url, filename) {
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
  // the PDF. So touch devices skip the browser's own PDF handling entirely and
  // render every page as a plain <canvas> via pdf.js instead — that works the
  // same everywhere because it never asks the browser to display a PDF at all,
  // it just paints pixels. Desktop keeps the native iframe viewer (it already
  // works there, and it comes with the browser's own zoom/search/print/select).
  var isTouchDevice = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  if (isTouchDevice) {
    var pagesWrap = document.createElement('div')
    Object.assign(pagesWrap.style, {
      flex: '1', overflowY: 'auto', overflowX: 'hidden', padding: '12px', WebkitOverflowScrolling: 'touch',
    })
    var status = document.createElement('div')
    status.textContent = 'Loading preview…'
    Object.assign(status.style, { color: '#9ca3af', fontFamily: 'inherit', fontSize: '13px', textAlign: 'center', padding: '40px 0' })
    pagesWrap.appendChild(status)
    overlay.appendChild(pagesWrap)
    renderPagesToCanvas(blob, pagesWrap, status).catch(function () {
      status.textContent = 'Preview isn’t available for this file — download or share it instead.'
    })
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

// Draws every page of the PDF as a plain <canvas> inside `container`, appended
// one at a time as each finishes so the first page shows up as soon as it's
// ready instead of the whole document rendering as one blocking batch.
async function renderPagesToCanvas(blob, container, status) {
  var pdfjsLib = await import('pdfjs-dist')
  var workerUrlMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default

  var data = await blob.arrayBuffer()
  var pdfDoc = await pdfjsLib.getDocument({ data: data }).promise

  container.removeChild(status)
  var targetWidth = Math.min(container.clientWidth - 4, 900)
  var dpr = window.devicePixelRatio || 1

  for (var i = 1; i <= pdfDoc.numPages; i++) {
    var page = await pdfDoc.getPage(i)
    var baseViewport = page.getViewport({ scale: 1 })
    var scale = targetWidth / baseViewport.width
    var viewport = page.getViewport({ scale: scale * dpr })

    var canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    Object.assign(canvas.style, {
      display: 'block', width: (viewport.width / dpr) + 'px', height: (viewport.height / dpr) + 'px',
      margin: '0 auto 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', background: '#fff',
    })
    container.appendChild(canvas)

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise
  }
}
