function amountInWordsIndian(paise) {
  var rupees = Math.floor(Math.abs(paise) / 100)
  if (rupees === 0) return 'Zero'
  var ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  var tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function twoDigit(n) {
    if (n < 20) return ones[n]
    return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '')
  }
  function threeDigit(n) {
    var h = Math.floor(n/100), r = n%100
    var out = ''
    if (h) out += ones[h] + ' Hundred'
    if (h && r) out += ' '
    if (r) out += twoDigit(r)
    return out
  }
  var crore = Math.floor(rupees / 10000000); rupees %= 10000000
  var lakh = Math.floor(rupees / 100000); rupees %= 100000
  var thousand = Math.floor(rupees / 1000); rupees %= 1000
  var parts = []
  if (crore) parts.push(twoDigit(crore) + ' Crore')
  if (lakh) parts.push(twoDigit(lakh) + ' Lakh')
  if (thousand) parts.push(twoDigit(thousand) + ' Thousand')
  if (rupees) parts.push(threeDigit(rupees))
  return parts.join(' ')
}

function fmtDDMMYYYY(dateStr) {
  var d = new Date(dateStr)
  if (isNaN(d)) return ''
  var dd = String(d.getDate()).padStart(2, '0')
  var mm = String(d.getMonth()+1).padStart(2, '0')
  var yyyy = d.getFullYear()
  return dd + '/' + mm + '/' + yyyy
}

export async function generateCollectionReceiptPdf(data) {
  var jsPDFmod = await import('jspdf')
  var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
  var autoTableMod = await import('jspdf-autotable')
  var autoTable = autoTableMod.default || autoTableMod

  var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  var pageW = doc.internal.pageSize.getWidth()
  var margin = 12

  doc.setLineWidth(0.3); doc.rect(margin, 12, pageW - 2*margin, 24)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('GET YOUR VENUE EVENT PVT. LTD.', margin + 2, 18)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('F-20, Dwarka Link Rd, Samalka, New Delhi, Delhi, 110037', margin + 2, 23)
  doc.text('Contact Details: +91 8826522444, sales@ambria.in', margin + 2, 27.5)
  doc.text('GSTIN:', margin + 2, 32)

  doc.setFillColor(0, 0, 0)
  doc.rect(pageW - margin - 32, 15, 30, 15, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('AMBRIA', pageW - margin - 17, 24, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  var titleY = 40
  doc.setFillColor(230, 230, 230)
  doc.rect(margin, titleY, pageW - 2*margin, 7, 'F')
  doc.setLineWidth(0.3); doc.rect(margin, titleY, pageW - 2*margin, 7)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('Receive Receipt', pageW / 2, titleY + 5, { align: 'center' })

  var isBank = data.paymentMode === 'bank'
  var netAmount = data.amountPaise / 100
  var netStr = netAmount.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  var body = [
    ['Receipt No.', { content: data.receiptNo || '', styles: { fontStyle: 'bold' } }, 'Receipt Date', fmtDDMMYYYY(data.createdAt)],
    ['Pay Mode', { content: (data.paymentMode || '').toUpperCase(), styles: { fontStyle: 'bold' } }, 'Remarks', data.description || ''],
    ['Contract No.', { content: data.contractNo || '', styles: { fontStyle: 'bold' } }, '', ''],
  ]
  if (isBank) body.push(['Cheque No.', '0', 'Cheque Date', ''])
  body.push(
    ['Payment Amount', { content: netStr, styles: { halign: 'right' } }, 'TDS Amount', { content: '0.0', styles: { halign: 'right' } }],
    ['Deduction', { content: '0.0', styles: { halign: 'right' } }, 'Net Amount', { content: netStr, styles: { halign: 'right', fontStyle: 'bold' } }],
  )

  autoTable(doc, {
    startY: titleY + 7,
    body: body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, lineColor: [80, 80, 80], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 40, fillColor: [245, 245, 245] },
      1: { cellWidth: 55 },
      2: { cellWidth: 40, fillColor: [245, 245, 245] },
      3: { cellWidth: 51 },
    },
    margin: { left: margin, right: margin },
  })

  var afterY = doc.lastAutoTable.finalY
  autoTable(doc, {
    startY: afterY,
    body: [[{
      content: 'Net Amount in Words: ' + amountInWordsIndian(data.amountPaise) + ' Only/-',
      styles: { fontStyle: 'bold', halign: 'left' }
    }]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.2 },
    columnStyles: { 0: { cellWidth: pageW - 2*margin } },
    margin: { left: margin, right: margin },
  })

  var url = doc.output('bloburl')
  window.open(url, '_blank')
}