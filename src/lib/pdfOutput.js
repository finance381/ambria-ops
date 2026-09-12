// Every generated PDF in the app used to end in doc.save(filename) — a synthetic
// <a download> click. On desktop that forces an immediate download instead of
// letting the user preview it first, and inside this app's installed-PWA mobile
// context, that synthetic click frequently does nothing visible at all (no share
// sheet, no download, no way to get the file back out) — matching what mobile
// users reported.
//
// The native Web Share API (with a real File) hands the OS its own share sheet —
// "Save to Files", "Share via WhatsApp", etc. — which works reliably from inside
// an installed PWA and is the closest thing to a universal "share or save" action
// on a phone. Where that's not available (most desktop browsers), opening the
// blob in a new tab uses the browser's own PDF viewer, which has its own
// download/print/share affordances — satisfying "view first" there.
export async function openOrSharePdf(doc, filename) {
  var blob = doc.output('blob')
  try {
    var file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] })
      return
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return // user dismissed the share sheet
  }
  var url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(function () { URL.revokeObjectURL(url) }, 60000)
}
