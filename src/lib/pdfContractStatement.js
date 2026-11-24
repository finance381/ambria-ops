// Contract Statement PDF — the "Print" export on a Contract's detail modal
// (ContractList.jsx). Three pages: Overview & Balance, Add-on Contracts,
// Collections & Adjustments. Figures passed in are expected to already be in
// their TRUE, un-masked scale (the caller reveals the hidden ÷10 cash scale
// and LMS's own /2 package-entry habit before handing data here) -- this
// file only lays the numbers out, it never re-derives or re-scales them.
//
// Self-contained (dynamic jsPDF/autoTable import, own NotoSans registration)
// rather than reusing src/lib/pdf.js's addHeader/addMeta/addTable, which
// don't thread a font through -- this is a client/finance-facing statement
// (like pdfReceipt.js / the ledger "statement" exports), where the ₹ glyph
// actually has to render, not an internal ops doc like a challan or PO.
import { registerPdfFont } from './pdfFont'
import { openOrSharePdf } from './pdfOutput'

var BRAND = [79, 70, 229]
var DARK = [28, 31, 38]
var GRAY = [107, 114, 128]
var MUTED = [154, 160, 171]
var GREEN = [4, 120, 87]
var AMBER = [180, 83, 9]

var MARGIN = 14
var PAGE_RIGHT = 196

function fmt(paise) {
  if (paise == null) return '—'
  var rupees = Math.abs(paise) / 100
  var s = rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (paise < 0 ? '-' : '') + '₹' + s
}

function addHeader(doc, FONT, title, meta) {
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(BRAND[0], BRAND[1], BRAND[2])
  doc.text('AMBRIA OPS', MARGIN, 16)
  doc.setFontSize(17); doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text(title, MARGIN, 25)
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(meta.line1 || '', PAGE_RIGHT, 16, { align: 'right' })
  if (meta.line2) doc.text(meta.line2, PAGE_RIGHT, 21, { align: 'right' })
  doc.setDrawColor(DARK[0], DARK[1], DARK[2])
  doc.setLineWidth(0.6)
  doc.line(MARGIN, 30, PAGE_RIGHT, 30)
  return 38
}

function addFooter(doc, FONT, pageNum, totalPages) {
  doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  doc.setDrawColor(230, 231, 235); doc.setLineWidth(0.2)
  doc.line(MARGIN, 285, PAGE_RIGHT, 285)
  doc.text('Ambria Ops — generated statement, not a receipt', MARGIN, 290)
  doc.text('Page ' + pageNum + ' of ' + totalPages, PAGE_RIGHT, 290, { align: 'right' })
}

function sectionLabel(doc, FONT, y, text) {
  doc.setFont(FONT, 'bold'); doc.setFontSize(8.5); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(text.toUpperCase(), MARGIN, y)
  return y + 6
}

function row(doc, FONT, y, label, value, opts) {
  opts = opts || {}
  doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(label, MARGIN, y)
  doc.setFont(FONT, opts.bold ? 'bold' : 'normal')
  doc.setFontSize(opts.big ? 12 : 10)
  var color = opts.color || DARK
  doc.setTextColor(color[0], color[1], color[2])
  doc.text(value == null ? '—' : String(value), PAGE_RIGHT, y, { align: 'right' })
  doc.setDrawColor(238, 240, 243); doc.setLineWidth(0.15)
  if (!opts.noRule) doc.line(MARGIN, y + 2.2, PAGE_RIGHT, y + 2.2)
  return y + (opts.tight ? 6 : 7.5)
}

function twoCol(doc, FONT, y, pairs) {
  var colW = (PAGE_RIGHT - MARGIN) / 2
  var leftY = y, rightY = y
  pairs.forEach(function (p, i) {
    var col = i % 2
    var x0 = MARGIN + col * colW
    var x1 = x0 + colW - 4
    var yy = col === 0 ? leftY : rightY
    doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(p[0], x0, yy)
    doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(DARK[0], DARK[1], DARK[2])
    var val = doc.splitTextToSize(p[1] == null ? '—' : String(p[1]), colW - 4)
    doc.text(val, x1, yy, { align: 'right' })
    doc.setDrawColor(238, 240, 243); doc.setLineWidth(0.15)
    doc.line(x0, yy + 2, x0 + colW - 4, yy + 2)
    var h = 7.5 * val.length
    if (col === 0) leftY += h; else rightY += h
  })
  return Math.max(leftY, rightY) + 2
}

// ═══ PAGE 1 — Overview & Balance ═══
async function drawOverviewBalancePage(doc, FONT, autoTable, d) {
  var y = addHeader(doc, FONT, 'Contract Statement', {
    line1: 'Contract #' + d.contractNo,
    line2: 'Printed ' + d.printedOn,
  })

  y = sectionLabel(doc, FONT, y + 2, 'Guest & Contract')
  y = twoCol(doc, FONT, y, [
    ['Client', d.clientName], ['Contact number', d.contact],
    ['Contract date', d.contractDate], ['Function date', d.functionDate],
  ])

  y = sectionLabel(doc, FONT, y + 4, 'Venue')
  y = twoCol(doc, FONT, y, [
    ['Department', d.department], ['Session', d.session],
    ['Venue', d.venue], ['Venue type', d.venueType],
    ['Location', d.location], ['Address', d.address],
  ])

  // Multi-function contract (Lunch+Dinner+Sagan etc., all one contract_no) --
  // ahead of the Plate stats below, since those stats are only ever this one
  // function's own, not a sum across the group.
  if (d.functions && d.functions.length > 1) {
    y = sectionLabel(doc, FONT, y + 4, 'Functions (' + d.functions.length + ')')
    autoTable(doc, {
      startY: y,
      head: [['Function', 'Date', 'Session', 'Venue', 'Pax']],
      body: d.functions.map(function (f) { return [f.name, f.date, f.session, f.venue, f.pax != null ? String(f.pax) : '—'] }),
      theme: 'grid',
      styles: { font: FONT, fontSize: 8, cellPadding: 2, textColor: DARK },
      headStyles: { font: FONT, fillColor: [241, 242, 245], textColor: DARK, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 4: { halign: 'right' } },
      margin: { left: MARGIN, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  if (d.totalPlates != null) {
    y += 4
    var stats = [['Total plates', d.totalPlates], ['Pax', d.pax], ['Extra', d.extra]]
    var statW = (PAGE_RIGHT - MARGIN - 8) / 3
    stats.forEach(function (s, i) {
      var x = MARGIN + i * (statW + 4)
      doc.setDrawColor(238, 240, 243); doc.setFillColor(248, 249, 251)
      doc.roundedRect(x, y, statW, 16, 1.5, 1.5, 'FD')
      doc.setFont(FONT, 'bold'); doc.setFontSize(13); doc.setTextColor(DARK[0], DARK[1], DARK[2])
      doc.text(String(s[1]), x + statW / 2, y + 8, { align: 'center' })
      doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(String(s[0]).toUpperCase(), x + statW / 2, y + 13, { align: 'center' })
    })
    y += 22
  }

  // LMS's own per-department split of this contract's total (Menu rate/
  // Venue rental/Venue+Menu/Decor amount/Entertainment amount) -- distinct
  // from both the itemized Add-ons below (LMS's own addons_json list) and
  // the Add-on Decor/Entertainment CONTRACTS on page 2 (each its own
  // separate contract_no, not a split field on this one).
  if (d.packageBreakdown && d.packageBreakdown.length > 0) {
    y = sectionLabel(doc, FONT, y + 4, 'Package Breakdown (LMS)')
    d.packageBreakdown.forEach(function (it) { y = row(doc, FONT, y, it.label, fmt(it.amountPaise), { tight: true }) })
    y += 3
  }

  // LMS's own itemized Addons list on this contract (e.g. "L.L. ₹25,000") --
  // distinct from the per-department Decor/Entertainment ADD-ON CONTRACTS on
  // page 2, which are each a whole separate contract, not a line item here.
  if (d.addonItems && d.addonItems.length > 0) {
    y = sectionLabel(doc, FONT, y + 4, 'Add-ons')
    d.addonItems.forEach(function (it) { y = row(doc, FONT, y, it.label, fmt(it.amountPaise), { tight: true }) })
    y = row(doc, FONT, y, 'Total add-ons', fmt(d.addonItemsTotalPaise), { bold: true, noRule: true })
    y += 3
  }

  // Balance
  y += 2
  doc.setDrawColor(238, 240, 243); doc.setFillColor(248, 249, 251)
  var balTop = y
  doc.setFont(FONT, 'bold'); doc.setFontSize(8.5); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text('BALANCE', MARGIN + 4, y + 7)
  if (d.status) {
    doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(GREEN[0], GREEN[1], GREEN[2])
    doc.text(d.status.toUpperCase(), PAGE_RIGHT - 4, y + 7, { align: 'right' })
  }
  y += 13
  d.packageLines.forEach(function (p) {
    var val = p.taxPaise > 0 ? fmt(p.pkgPaise) + '  +  ' + fmt(p.taxPaise) + ' tax' : fmt(p.pkgPaise)
    y = row(doc, FONT, y, p.label, val)
  })
  y = row(doc, FONT, y, 'Total Deal', fmt(d.totalDealPaise), { bold: true, big: true })
  y += 1
  y = row(doc, FONT, y, 'Advance received — cash', fmt(d.advCashPaise))
  y = row(doc, FONT, y, 'Advance received — bank', fmt(d.advBankPaise))
  y += 1
  y = row(doc, FONT, y, 'Pending — cash', fmt(Math.max(d.pendingCashPaise, 0)), { color: GREEN })
  y = row(doc, FONT, y, 'Pending — bank', fmt(Math.max(d.pendingBankPaise, 0)), { color: GREEN, noRule: d.surplusPaise <= 0 })
  if (d.surplusPaise > 0) {
    y += 1
    y = row(doc, FONT, y, 'Surplus (over LMS total)', fmt(d.surplusPaise), { bold: true, color: AMBER, noRule: true })
  }
  doc.setDrawColor(230, 231, 235); doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, balTop, PAGE_RIGHT - MARGIN, y - balTop + 3, 1.5, 1.5)
  y += 8

  doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  doc.text('Cash and package figures above are the real, un-masked amounts — the ÷10 cash scale and', MARGIN, y)
  doc.text('LMS\'s own half-value package entry are both reversed for this statement.', MARGIN, y + 4)
}

// ═══ PAGE 2 — Add-on Contracts ═══
function drawAddonsPage(doc, FONT, d) {
  var y = addHeader(doc, FONT, 'Add-on Contracts', {
    line1: 'Linked to Contract #' + d.contractNo,
    line2: d.clientName + ' — ' + d.functionDate,
  })

  d.addonContracts.forEach(function (a) {
    doc.setDrawColor(238, 240, 243); doc.setLineWidth(0.3)
    var top = y
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(BRAND[0], BRAND[1], BRAND[2])
    doc.text(a.chipLabel, MARGIN + 4, y + 8)
    y += 14
    y = row(doc, FONT, y, a.department + ' contract #', a.contractNo)
    y = row(doc, FONT, y, 'Linked Venue contract', '#' + d.contractNo)
    y = row(doc, FONT, y, 'Function date', a.functionDate)
    y = row(doc, FONT, y, 'Session', a.session)
    y = row(doc, FONT, y, a.department + ' package', fmt(a.pkgPaise))
    y = row(doc, FONT, y, 'Tax', fmt(a.taxPaise))
    y = row(doc, FONT, y, 'Total — ' + a.department, fmt(a.pkgPaise + a.taxPaise), { bold: true, noRule: true })
    y += 3
    doc.roundedRect(MARGIN, top, PAGE_RIGHT - MARGIN, y - top + 3, 1.5, 1.5)
    y += 10
  })

  if (d.missingAddonDepts.length > 0) {
    d.missingAddonDepts.forEach(function (dep) {
      doc.setDrawColor(216, 219, 226); doc.setLineWidth(0.3)
      doc.setLineDashPattern([1.2, 1.2], 0)
      doc.roundedRect(MARGIN, y, PAGE_RIGHT - MARGIN, 12, 1.5, 1.5)
      doc.setLineDashPattern([], 0)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
      doc.text('No Add-on ' + dep + ' contract on this deal.', MARGIN + 4, y + 7.5)
      y += 16
    })
  }

  if (d.addonContracts.length === 0 && d.missingAddonDepts.length === 0) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text('No add-on contracts on this deal.', MARGIN, y + 4)
  }
}

// ═══ PAGE 3 — Collections & Adjustments ═══
async function drawTransactionsPage(doc, FONT, autoTable, d) {
  var y = addHeader(doc, FONT, 'Collections & Adjustments', {
    line1: 'Contract #' + d.contractNo,
    line2: d.clientName + ' — ' + d.functionDate,
  })

  var rows = d.transactions.map(function (t) {
    return [
      t.date + (t.time ? '\n' + t.time : ''),
      t.type + (t.note ? '\n' + t.note : ''),
      t.mode,
      (t.isReversal ? '-' : '') + fmt(t.amountPaise),
      t.handledBy || '—',
      t.statusLabel,
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Type', 'Mode', 'Amount', 'Handled by', 'Status']],
    body: rows,
    theme: 'grid',
    styles: { font: FONT, fontSize: 8, cellPadding: 2.4, textColor: DARK, valign: 'top' },
    headStyles: { font: FONT, fillColor: DARK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 3: { halign: 'right' } },
    margin: { left: MARGIN, right: 14 },
    didParseCell: function (data) {
      if (data.section !== 'body') return
      var t = d.transactions[data.row.index]
      if (!t) return
      // A voided original and the reversal that undoes it are one correction
      // episode, not two separate signals -- grey + strikethrough on one and
      // red on the other read as two different kinds of thing when they're
      // the same pair. Both get the same muted tone; the amount's own "-"
      // prefix and the Status column's wording ("Cancelled" / "Reversed")
      // already say which leg is which. What the reversal actually did to
      // the total is the Out figure below, not a color on this row.
      if (t.voided) {
        data.cell.styles.textColor = MUTED
        if (data.column.index === 3) data.cell.styles.fontStyle = 'italic'
      } else if (t.isReversal) {
        data.cell.styles.textColor = MUTED
      }
    },
  })

  var afterY = doc.lastAutoTable.finalY + 8
  doc.setDrawColor(238, 240, 243); doc.setFillColor(248, 249, 251)
  doc.roundedRect(MARGIN, afterY, PAGE_RIGHT - MARGIN, 14, 1.5, 1.5, 'FD')
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(GREEN[0], GREEN[1], GREEN[2])
  doc.text('In ' + fmt(d.totals.inPaise), MARGIN + 4, afterY + 9)
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text('Out ' + fmt(d.totals.outPaise), MARGIN + 44, afterY + 9)
  doc.setFont(FONT, 'bold'); doc.setFontSize(10)
  doc.text('Net ' + fmt(d.totals.netPaise), PAGE_RIGHT - 4, afterY + 9, { align: 'right' })

  doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  doc.text('In / Out / Net above are totalled from exactly the rows listed — a cancelled entry counts toward', MARGIN, afterY + 20)
  doc.text('neither; its reversal (where one exists) counts toward Out.', MARGIN, afterY + 24)
}

export async function generateContractStatementPdf(d) {
  var jsPDFmod = await import('jspdf')
  var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
  var autoTableMod = await import('jspdf-autotable')
  var autoTable = autoTableMod.default || autoTableMod

  var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  var fontOk = await registerPdfFont(doc)
  var FONT = fontOk ? 'NotoSans' : 'helvetica'
  doc.setFont(FONT, 'normal')

  await drawOverviewBalancePage(doc, FONT, autoTable, d)
  addFooter(doc, FONT, 1, 3)

  doc.addPage()
  drawAddonsPage(doc, FONT, d)
  addFooter(doc, FONT, 2, 3)

  doc.addPage()
  await drawTransactionsPage(doc, FONT, autoTable, d)
  addFooter(doc, FONT, 3, 3)

  await openOrSharePdf(doc, 'Contract_Statement_' + (d.contractNo || 'contract') + '.pdf')
}
