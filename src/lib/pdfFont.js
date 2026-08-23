// Shared jsPDF Unicode font loader.
// NotoSans (Latin + Devanagari + ₹). Cached once per browser session.
// Import: import { registerPdfFont } from '../../lib/pdfFont'
// Usage:  var fontOk = await registerPdfFont(doc); var FONT = fontOk ? 'NotoSans' : 'helvetica'

var _pdfFontCache = { regular: null, bold: null }

async function _fetchTtfBase64(url) {
  var r = await fetch(url)
  if (!r.ok) throw new Error('font ' + url + ' → HTTP ' + r.status)
  var buf = await r.arrayBuffer()
  var bytes = new Uint8Array(buf)
  var chunk = 0x8000
  var pieces = []
  for (var i = 0; i < bytes.length; i += chunk) {
    pieces.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)))
  }
  return btoa(pieces.join(''))
}

// Registers Noto Sans (Latin + Devanagari + ₹) on the given jsPDF doc.
// Returns true on success, false on any failure (caller can fall back to helvetica).
export async function registerPdfFont(doc) {
  try {
    if (!_pdfFontCache.regular || !_pdfFontCache.bold) {
      var REG_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf'
      var BLD_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf'
      var results = await Promise.all([_fetchTtfBase64(REG_URL), _fetchTtfBase64(BLD_URL)])
      _pdfFontCache.regular = results[0]
      _pdfFontCache.bold = results[1]
    }
    doc.addFileToVFS('NotoSans-Regular.ttf', _pdfFontCache.regular)
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
    doc.addFileToVFS('NotoSans-Bold.ttf', _pdfFontCache.bold)
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
    return true
  } catch (e) {
    console.warn('PDF font load failed, using helvetica fallback:', e.message)
    return false
  }
}