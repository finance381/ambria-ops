import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { formatPaise, formatDate, titleCase } from './format'

var BRAND = [67, 56, 202]
var DARK = [31, 41, 55]
var GRAY = [120, 120, 120]

function newDoc(orientation) {
  return new jsPDF({ orientation: orientation || 'portrait', unit: 'mm', format: 'a4' })
}

function addHeader(doc, title, subtitle) {
  doc.setFontSize(18)
  doc.setTextColor(BRAND[0], BRAND[1], BRAND[2])
  doc.text('AMBRIA', 14, 16)
  doc.setFontSize(13)
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text(title, 14, 25)
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(subtitle, 14, 31)
  }
  doc.setFontSize(8)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text('Generated: ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 196, 16, { align: 'right' })
  doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2])
  doc.setLineWidth(0.5)
  doc.line(14, 34, 196, 34)
  return 40
}

function addMeta(doc, y, pairs) {
  doc.setFontSize(9)
  var col = 0
  pairs.forEach(function (pair) {
    if (!pair[1] && pair[1] !== 0) return
    var x = 14 + (col * 62)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(pair[0] + ':', x, y)
    doc.setTextColor(DARK[0], DARK[1], DARK[2])
    doc.setFont(undefined, 'bold')
    doc.text(String(pair[1]), x, y + 5)
    doc.setFont(undefined, 'normal')
    col++
    if (col >= 3) { col = 0; y += 14 }
  })
  if (col > 0) y += 14
  return y + 2
}

function addTable(doc, y, headers, rows, opts) {
  doc.autoTable(Object.assign({
    startY: y,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, textColor: DARK },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 14, right: 14 },
  }, opts || {}))
  return doc.lastAutoTable.finalY + 6
}

function addSignatures(doc, y, labels) {
  if (y > 250) { doc.addPage(); y = 20 }
  y = y + 10
  doc.setDrawColor(180, 180, 180)
  doc.setFontSize(8)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  var w = (196 - 14) / labels.length
  labels.forEach(function (label, i) {
    var x = 14 + (i * w) + (w / 2)
    doc.line(x - 25, y, x + 25, y)
    doc.text(label, x, y + 5, { align: 'center' })
  })
  return y + 12
}

// ═══════════════════════════════════════
// CHALLAN PDF
// ═══════════════════════════════════════
var TYPE_LABELS = {
  event_dispatch: 'Event Dispatch',
  event_return: 'Event Return',
  inter_store: 'Inter-Store Transfer',
  repair: 'Repair / Vendor Send',
  misc: 'Miscellaneous',
}

export function generateChallanPdf(challan, items, venueMap) {
  var doc = newDoc()
  var srcName = venueMap[challan.source_venue_id] || '—'
  var destName = challan.destination_text || venueMap[challan.destination_venue_id] || '—'

  var y = addHeader(doc, 'Challan #' + challan.challan_no, TYPE_LABELS[challan.type] || challan.type)

  y = addMeta(doc, y, [
    ['From', srcName],
    ['To', destName],
    ['Status', titleCase(challan.status)],
    ['Vehicle', challan.vehicle_no],
    ['Driver', challan.driver_name + (challan.driver_phone ? ' (' + challan.driver_phone + ')' : '')],
    ['Dispatch Date', challan.dispatch_date ? formatDate(challan.dispatch_date) : null],
    ['Dispatched', challan.dispatched_at ? formatDate(challan.dispatched_at) : null],
    ['Received', challan.received_at ? formatDate(challan.received_at) : null],
  ])

  if (challan.notes) {
    doc.setFontSize(8)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text('Notes: ' + challan.notes, 14, y)
    y += 6
  }

  // Items table
  var isReceived = challan.status === 'received' || challan.status === 'closed'
  var headers = ['#', 'Item', 'Box', 'Qty Sent']
  if (isReceived) { headers.push('Qty Recd'); headers.push('Condition') }

  var rows = items.map(function (ci, idx) {
    var row = [
      idx + 1,
      titleCase(ci.item_name) + (ci.item_unit ? ' (' + ci.item_unit + ')' : ''),
      ci.box_code || '—',
      ci.qty_sent,
    ]
    if (isReceived) {
      row.push(ci.qty_received != null ? ci.qty_received : '—')
      row.push(titleCase(ci.condition || 'good'))
    }
    return row
  })

  y = addTable(doc, y, headers, rows)

  // Summary
  var totalSent = 0; var totalRecd = 0
  items.forEach(function (ci) {
    totalSent += (ci.qty_sent || 0)
    totalRecd += (ci.qty_received || 0)
  })
  doc.setFontSize(9)
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text('Total Items: ' + items.length + '   |   Total Qty Sent: ' + totalSent + (isReceived ? '   |   Total Qty Received: ' + totalRecd : ''), 14, y)
  y += 8

  // Shortage highlight
  if (isReceived) {
    var shortages = items.filter(function (ci) { return ci.qty_received != null && ci.qty_received < ci.qty_sent })
    if (shortages.length > 0) {
      doc.setTextColor(200, 0, 0)
      doc.setFontSize(9)
      doc.text('⚠ Shortages: ' + shortages.length + ' item(s)', 14, y)
      y += 6
    }
  }

  y = addSignatures(doc, y, ['Loaded By', 'Driver', 'Received By'])

  doc.save('Challan_' + challan.challan_no + '.pdf')
}

// ═══════════════════════════════════════
// PO PDF
// ═══════════════════════════════════════
export function generatePoPdf(po, items, creatorName) {
  var doc = newDoc('landscape')
  var y = addHeader(doc, 'Purchase Order #' + (po.po_number || po.id.slice(0, 8)), titleCase(po.status))

  y = addMeta(doc, y, [
    ['Created', formatDate(po.created_at)],
    ['Created By', creatorName || '—'],
    ['Assigned To', po.assignee_name || '—'],
    ['Status', titleCase(po.status)],
  ])

  var headers = ['#', 'Item', 'Category', 'Qty', 'Unit', 'Vendor', 'Rate', 'Est Total']
  var rows = items.map(function (it, idx) {
    return [
      idx + 1,
      titleCase(it.item_name),
      it.categories?.name || '—',
      it.qty_ordered,
      it.unit || '',
      it.vendor_name || '—',
      it.vendor_rate_paise ? formatPaise(it.vendor_rate_paise) : '—',
      it.estimated_cost_paise ? formatPaise(it.estimated_cost_paise) : '—',
    ]
  })

  y = addTable(doc, y, headers, rows)

  var totalEst = 0
  items.forEach(function (it) { totalEst += (it.estimated_cost_paise || 0) })
  doc.setFontSize(10)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text('Estimated Total: ' + formatPaise(totalEst), 14, y)

  y = addSignatures(doc, y + 4, ['Prepared By', 'Approved By'])
  doc.save('PO_' + (po.po_number || po.id.slice(0, 8)) + '.pdf')
}

// ═══════════════════════════════════════
// PURCHASE COMPARISON PDF
// ═══════════════════════════════════════
export function generateComparisonPdf(po, items, creatorName) {
  var doc = newDoc('landscape')
  var y = addHeader(doc, 'Purchase Comparison — PO #' + (po.po_number || po.id.slice(0, 8)), 'Estimated vs Actual')

  y = addMeta(doc, y, [
    ['Created', formatDate(po.created_at)],
    ['Created By', creatorName || '—'],
  ])

  var headers = ['#', 'Item', 'Vendor', 'Qty Ord', 'Qty Purch', 'Est Cost', 'Actual Cost', 'Variance', '%']
  var rows = items.map(function (it, idx) {
    var diff = (it.actual_cost_paise || 0) - (it.estimated_cost_paise || 0)
    var pct = it.estimated_cost_paise ? Math.round((diff / it.estimated_cost_paise) * 100) : 0
    return [
      idx + 1,
      titleCase(it.item_name),
      it.vendor_name || '—',
      it.qty_ordered,
      it.actual_qty || '—',
      it.estimated_cost_paise ? formatPaise(it.estimated_cost_paise) : '—',
      it.actual_cost_paise ? formatPaise(it.actual_cost_paise) : '—',
      diff ? (diff > 0 ? '+' : '') + formatPaise(Math.abs(diff)) : '—',
      diff ? (diff > 0 ? '+' : '') + pct + '%' : '—',
    ]
  })

  y = addTable(doc, y, headers, rows, {
    didParseCell: function (data) {
      if (data.section === 'body' && data.column.index === 7) {
        var val = data.cell.raw
        if (typeof val === 'string' && val.indexOf('+') === 0) data.cell.styles.textColor = [200, 0, 0]
        else if (typeof val === 'string' && val.indexOf('-') !== -1 && val !== '—') data.cell.styles.textColor = [0, 150, 0]
      }
    }
  })

  var totalEst = 0; var totalActual = 0
  items.forEach(function (it) { totalEst += (it.estimated_cost_paise || 0); totalActual += (it.actual_cost_paise || 0) })
  var totalVar = totalActual - totalEst
  var totalPct = totalEst > 0 ? Math.round((totalVar / totalEst) * 100) : 0

  doc.setFontSize(10)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text('Estimated: ' + formatPaise(totalEst) + '   |   Actual: ' + formatPaise(totalActual) + '   |   Variance: ' + (totalVar > 0 ? '+' : '') + formatPaise(Math.abs(totalVar)) + ' (' + (totalVar > 0 ? '+' : '') + totalPct + '%)', 14, y)

  doc.save('Comparison_PO_' + (po.po_number || po.id.slice(0, 8)) + '.pdf')
}

// ═══════════════════════════════════════
// RECEIVING PDF
// ═══════════════════════════════════════
export function generateReceivingPdf(po, items, creatorName) {
  var doc = newDoc('landscape')
  var y = addHeader(doc, 'Goods Receipt — PO #' + (po.po_number || po.id.slice(0, 8)), 'Receiving Report')

  y = addMeta(doc, y, [
    ['PO Created', formatDate(po.created_at)],
    ['Created By', creatorName || '—'],
  ])

  var headers = ['#', 'Item', 'Vendor', 'Qty Ordered', 'Qty Received', 'Status', 'Receipt']
  var rows = items.map(function (it, idx) {
    var qtyRecd = it.actual_qty || 0
    var status = it.status === 'received' ? 'Received' : it.status === 'purchased' ? 'Pending' : titleCase(it.status)
    if (it.status === 'received' && qtyRecd < it.qty_ordered) status = 'Partial'
    return [
      idx + 1,
      titleCase(it.item_name),
      it.vendor_name || '—',
      it.qty_ordered + ' ' + (it.unit || ''),
      qtyRecd > 0 ? qtyRecd + ' ' + (it.unit || '') : '—',
      status,
      it.receipt_path ? 'Yes' : '—',
    ]
  })

  y = addTable(doc, y, headers, rows)

  var fullyRecd = 0; var partial = 0; var pending = 0
  items.forEach(function (it) {
    if (it.status === 'received') {
      if ((it.actual_qty || 0) < it.qty_ordered) partial++
      else fullyRecd++
    } else { pending++ }
  })

  doc.setFontSize(9)
  doc.setTextColor(DARK[0], DARK[1], DARK[2])
  doc.text('Fully Received: ' + fullyRecd + '   |   Partial: ' + partial + '   |   Pending: ' + pending + '   |   Total Items: ' + items.length, 14, y)

  y = addSignatures(doc, y + 4, ['Received By', 'Verified By'])
  doc.save('Receiving_PO_' + (po.po_number || po.id.slice(0, 8)) + '.pdf')
}