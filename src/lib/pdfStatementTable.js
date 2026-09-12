// Shared hand-drawn Date/Particulars rendering for every ledger-style ("statement")
// PDF export in the app — first built for the Expense Statement (AllExpenses.jsx),
// then lifted out here so Ledgers.jsx / VendorLedger.jsx / WalletManager.jsx could
// match it instead of each re-implementing the same autoTable hooks.
//
// Two data shapes drive it, built by the caller in the same order as its `body` rows:
//   dateMeta[i]         — { top, bottom } already-formatted date strings. `bottom` is
//                          optional (e.g. no separate logged time) — the divider line
//                          and bottom label are skipped when it's falsy.
//   particularsMeta[i]  — an array of { kind, text, amount? } line descriptors, kind one of:
//     'header'  bold, 8pt — e.g. "Type › Sub-type"
//     'desc'    normal, 8pt — free-text description
//     'chip'    grey, 6.8pt — short "Label: value  ·  Label: value" facts line
//     'alloc'   grey/indigo, 7pt, left rule — a labelled line with its amount pinned to
//               one fixed right edge, for a per-row breakdown (allocations, splits)
//     'foot'    same as 'alloc' but styled a shade lighter — a subtotal/tax line
//     'status'  grey, 6.8pt, parenthetical — "(flagged)" etc.
export function fmtAmt(paise) {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Plain-text fallback for the Particulars column — what actually seeds autoTable's
// automatic row-height calculation (the hand-drawn cell reproduces the same line
// count), and what a reader gets from copy/paste or a screen reader.
export function plainParticularsLines(lines) {
  return lines.map(function (l) {
    if (l.kind === 'alloc' || l.kind === 'foot') return '  ' + l.text + '   ' + l.amount
    if (l.kind === 'status') return '(' + l.text + ')'
    return l.text
  })
}

// Same fallback purpose for the Date column.
export function plainDateLines(dm, bottomPrefix) {
  return dm.top + '\n\n' + (dm.bottom ? (bottomPrefix || '') + dm.bottom : '')
}

// opts: { dateCol, particularsCol, dateMeta, particularsMeta, topLabel, bottomLabel }
// topLabel/bottomLabel default to 'DATE'/'LOGGED' — pass the pair that fits the
// statement (e.g. 'EXPENSE'/'ENTERED', 'TXN'/'LOGGED').
export function makeStatementCellHooks(doc, FONT, opts) {
  var dateMeta = opts.dateMeta
  var particularsMeta = opts.particularsMeta
  var dateCol = opts.dateCol
  var particularsCol = opts.particularsCol
  var topLabel = opts.topLabel || 'DATE'
  var bottomLabel = opts.bottomLabel || 'LOGGED'

  // Guards against both the trailing colSpan summary rows (row.index reaches or
  // exceeds particularsMeta.length, since those rows have no meta entry) and the
  // synthetic "remainder" row jspdf-autotable creates (index -1) when a row's
  // content is too tall to fit and gets split across a page break.
  function inRange(data) {
    return data.section === 'body' && data.row.index >= 0 && data.row.index < particularsMeta.length
  }

  function willDrawCell(data) {
    if (!inRange(data)) return
    if (data.column.index === dateCol || data.column.index === particularsCol) data.cell.text = []
  }

  function didDrawCell(data) {
    if (!inRange(data)) return
    var rowIdx = data.row.index
    var x0 = data.cell.x, y0 = data.cell.y, w = data.cell.width
    var padL = data.cell.padding('left')
    var padT = data.cell.padding('top')
    var innerW = w - padL - data.cell.padding('right')

    if (data.column.index === dateCol) {
      var dm = dateMeta[rowIdx]
      if (!dm) return
      var y = y0 + padT + 2.2
      doc.setFont(FONT, 'normal'); doc.setFontSize(5.6); doc.setTextColor(130)
      doc.text(topLabel, x0 + padL, y)
      y += 3.4
      doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(20)
      doc.text(dm.top, x0 + padL, y)
      y += 2.6
      if (dm.bottom) {
        doc.setDrawColor(210); doc.setLineWidth(0.15)
        doc.line(x0 + padL, y, x0 + padL + 10, y)
        y += 3.4
        doc.setFont(FONT, 'normal'); doc.setFontSize(5.6); doc.setTextColor(130)
        doc.text(bottomLabel, x0 + padL, y)
        y += 3.2
        doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(90)
        doc.text(dm.bottom, x0 + padL, y)
      }
      doc.setTextColor(0)
    }

    if (data.column.index === particularsCol) {
      var lines = particularsMeta[rowIdx]
      if (!lines) return
      var yy = y0 + padT + 2.6
      var lineH = 3.6
      lines.forEach(function (l) {
        if (l.kind === 'header') {
          doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(20)
          doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH })
        } else if (l.kind === 'desc') {
          doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(40)
          doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH })
        } else if (l.kind === 'chip') {
          doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(80)
          doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH - 0.3 })
        } else if (l.kind === 'alloc' || l.kind === 'foot') {
          var indentX = x0 + padL + 2
          doc.setDrawColor(220); doc.setLineWidth(0.15)
          doc.line(indentX - 1.2, yy - 2.6, indentX - 1.2, yy + 0.6)
          doc.setFont(FONT, 'normal'); doc.setFontSize(7)
          doc.setTextColor(l.kind === 'foot' ? 130 : 90)
          var labelWrapped = doc.splitTextToSize(l.text, innerW - 22)
          doc.text(labelWrapped[0], indentX, yy)
          doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(20)
          doc.text(l.amount, x0 + w - data.cell.padding('right'), yy, { align: 'right' })
          yy += lineH
        } else if (l.kind === 'status') {
          doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(120)
          doc.text('(' + l.text + ')', x0 + padL, yy); yy += lineH
        }
      })
      doc.setTextColor(0)
    }
  }

  return { willDrawCell: willDrawCell, didDrawCell: didDrawCell }
}
