// A Decor Var Cost sheet out as an .xlsx laid out like the workbook it came
// from ("CD DATE-VENUE NAME-SALES PERSON NAME SAMPLE.xlsx"): the same rows on
// the same row numbers, the header block (Sr. No., Function Date, Venue, Sub
// Venue), the Day/Night cells merged, and live formulas — Qty = SUM of the
// date columns, Rate and Amount as each row's formula has them, and the
// Grand Total — so the file keeps working as a spreadsheet once opened.
// Each formula also carries its worked-out value, so a viewer that does not
// recalculate (a phone's file preview) still shows the figures.
//
// The workbook had four date columns (D..G). One per saved date here, and
// never fewer than four, so a short sheet still reads like the original.
//
// exceljs is loaded only when an export is asked for; it is not in the
// bundle anyone downloads to open the app.

import { getSheet, sheetTotals, rowCalc, num } from './decorVarCost'

function colName(n) {
  var s = ''
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

function dmy(iso) {
  if (!iso) return ''
  var p = iso.split('-')
  return p[2] + '.' + p[1] + '.' + p[0]
}

// What the file is called: the workbook's own pattern, CD DATE-VENUE-NAME.
export function exportFileName(rec, venueText, creatorName) {
  var bits = [rec.serial_no]
  if (rec.is_function && rec.function_date) bits.push(dmy(rec.function_date))
  if (venueText) bits.push(venueText)
  if (creatorName) bits.push(creatorName)
  return bits.join('-').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.xlsx'
}

// rec: the loaded record (entries sorted by date, sheet: {rates, remarks,
// particulars}). venue / subVenue: names. Returns a Blob.
export async function buildDecorVarCostXlsx(rec, venue, subVenue) {
  var ExcelJS = (await import('exceljs')).default
  var sheet = getSheet(rec.sheet_code)
  var entries = rec.entries || []
  var rates = (rec.sheet && rec.sheet.rates) || {}
  var remarks = (rec.sheet && rec.sheet.remarks) || {}
  var particulars = (rec.sheet && rec.sheet.particulars) || {}
  var totals = sheetTotals(sheet, entries, rates)

  var wb = new ExcelJS.Workbook()
  wb.creator = 'Ambria Ops'
  wb.created = new Date()
  var ws = wb.addWorksheet(sheet.code, { views: [{ state: 'frozen', xSplit: 1, ySplit: 7 }] })

  // Columns: A Particulars, B Unit, C Timing, D.. dates, then Qty, Rate,
  // Amount, Remarks.
  var nDates = Math.max(4, entries.length)
  var D0 = 4
  var DL = D0 + nDates - 1
  var QTY = DL + 1, RATE = DL + 2, AMT = DL + 3, REM = DL + 4
  var cQ = colName(QTY), cR = colName(RATE), cA = colName(AMT)
  var cD0 = colName(D0), cDL = colName(DL)

  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 10
  ws.getColumn(3).width = 10
  for (var c = D0; c <= DL; c++) ws.getColumn(c).width = 11
  ws.getColumn(QTY).width = 10
  ws.getColumn(RATE).width = 12
  ws.getColumn(AMT).width = 14
  ws.getColumn(REM).width = 45

  var thin = { style: 'thin', color: { argb: 'FF94A3B8' } }
  var box = { top: thin, left: thin, bottom: thin, right: thin }
  var bold = { bold: true }
  var money = '#,##0.00'

  function put(addr, value, style) {
    var cell = ws.getCell(addr)
    cell.value = value
    if (style) Object.keys(style).forEach(function (k) { cell[k] = style[k] })
    return cell
  }

  // ── header block ──
  put('A1', 'Sr. No.', { font: bold })
  put('B1', rec.serial_no, { font: bold })
  put('A2', 'Function Date', { font: bold })
  if (rec.is_function && rec.function_date) {
    var p = rec.function_date.split('-')
    put('B2', new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), { numFmt: 'dd-mmm-yyyy', alignment: { horizontal: 'left' } })
  } else {
    put('B2', 'Not for a function')
  }
  put('A3', 'Venue Name :', { font: bold })
  ws.mergeCells('B3:D3')
  put('B3', venue || '')
  ws.mergeCells('E3:F3')
  put('E3', 'Sub Venue Name : ', { font: bold })
  put('G3', subVenue || '')

  ws.mergeCells('A5:' + colName(Math.max(5, DL)) + '5')
  put('A5', sheet.title, { font: { bold: true, size: 12 } })

  // ── column headings (row 6) and the dates under "Dates" (row 7) ──
  var heads = [[1, 'Particulars'], [2, 'Unit/Rs.'], [3, 'Timing'], [D0, 'Dates'], [QTY, 'Qty'], [RATE, 'Rate'], [AMT, 'Amount'], [REM, 'Remarks']]
  if (nDates > 1) ws.mergeCells(cD0 + '6:' + cDL + '6')
  heads.forEach(function (h) {
    put(colName(h[0]) + '6', h[1], { font: bold, alignment: { horizontal: 'center', vertical: 'middle' }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } } })
  })
  for (var di = 0; di < nDates; di++) {
    var e = entries[di]
    var cell = ws.getCell(colName(D0 + di) + '7')
    if (e) {
      var q = e.entry_date.split('-')
      cell.value = new Date(Date.UTC(+q[0], +q[1] - 1, +q[2]))
      cell.numFmt = 'dd-mmm'
    }
    cell.font = bold
    cell.alignment = { horizontal: 'center' }
  }
  for (var hc = 1; hc <= REM; hc++) {
    ws.getCell(colName(hc) + '6').border = box
    ws.getCell(colName(hc) + '7').border = box
  }

  // ── the rows, on the workbook's own row numbers ──
  var lastRow = 7
  sheet.rows.forEach(function (r, i) {
    var row = Number(r.key)
    lastRow = Math.max(lastRow, row)
    var prev = sheet.rows[i - 1]
    var isNightOfPair = !r.free && r.timing === 'Night' && prev && prev.timing === 'Day' && prev.name === r.name
    if (!isNightOfPair) {
      put('A' + row, r.free ? (particulars[r.key] || '') : r.name)
      put('B' + row, r.unit)
    }
    var next = sheet.rows[i + 1]
    if (!r.free && r.timing === 'Day' && next && next.timing === 'Night' && next.name === r.name) {
      ws.mergeCells('A' + row + ':A' + (row + 1))
      ws.mergeCells('B' + row + ':B' + (row + 1))
      ws.getCell('A' + row).alignment = { vertical: 'middle', wrapText: true }
      ws.getCell('B' + row).alignment = { vertical: 'middle', horizontal: 'center' }
    }
    if (r.timing) put('C' + row, r.timing, { alignment: { horizontal: 'center' } })

    entries.forEach(function (en, k) {
      var v = num((en.lines || {})[r.key])
      if (v) ws.getCell(colName(D0 + k) + row).value = v
    })

    var t = totals.byRow[r.key]
    var H = cQ + row, I = cR + row
    put(H, { formula: 'SUM(' + cD0 + row + ':' + cDL + row + ')', result: t.qty })
    var dayCalc = rowCalc(r, t.qty, rates)
    if (r.kind === 'rate') {
      var rv = dayCalc.rate
      if (rv != null) ws.getCell(I).value = rv
      put(cA + row, { formula: H + '*' + I, result: t.amountPaise / 100 })
    } else if (r.kind === 'value') {
      put(I, { formula: H, result: t.qty })
      put(cA + row, { formula: I, result: t.amountPaise / 100 })
    } else if (r.kind === 'factor') {
      put(I, { formula: H + '*' + r.expr, result: dayCalc.rate })
      put(cA + row, { formula: I, result: t.amountPaise / 100 })
    } else if (r.kind === 'factorSq') {
      put(I, { formula: H + '*' + r.expr, result: dayCalc.rate })
      put(cA + row, { formula: H + '*' + I, result: t.amountPaise / 100 })
    }
    ws.getCell(I).numFmt = money
    ws.getCell(cA + row).numFmt = money
    if (remarks[r.key]) put(colName(REM) + row, remarks[r.key], { alignment: { wrapText: true, vertical: 'top' } })

    for (var bc = 1; bc <= REM; bc++) ws.getCell(colName(bc) + row).border = box
  })

  // ── Grand Total, three rows under the last, as on the workbook ──
  var gt = lastRow + 3
  ws.mergeCells(cQ + gt + ':' + cR + gt)
  put(cQ + gt, 'Grand Total', { font: bold, alignment: { horizontal: 'right' } })
  put(cA + gt, { formula: 'SUM(' + cA + '8:' + cA + (gt - 1) + ')', result: totals.totalPaise / 100 }, { font: bold, numFmt: money, border: box })

  var buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Hands the file over: the share sheet on a phone (in the installed app a
// synthetic download often does nothing), a download everywhere else.
export async function deliverFile(blob, filename) {
  var file = null
  try { file = new File([blob], filename, { type: blob.type }) } catch { file = null }
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  if (coarse && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (err) {
      if (err && err.name === 'AbortError') return
    }
  }
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
}
