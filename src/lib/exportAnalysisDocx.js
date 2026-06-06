import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType
} from 'docx'

/* ── helpers ───────────────────────────────────────────── */

function secsToTime(secs) {
  if (secs == null) return '—'
  var h = Math.floor(secs / 3600)
  var m = Math.floor((secs % 3600) / 60)
  var ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm
}

function num(v, d) { return v != null ? Number(v).toFixed(d === undefined ? 1 : d) : '—' }
function pct(v) { return v != null ? Math.round(v) + '%' : '—' }
function rangeFmt(from, to) { return from + '  to  ' + to }

var BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
var BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
var CELL_MARGINS = { top: 60, bottom: 60, left: 80, right: 80 }
var HDR_FILL = { fill: '1E293B', type: ShadingType.CLEAR }
var ALT_FILL = { fill: 'F8FAFC', type: ShadingType.CLEAR }

function hdrCell(text, width) {
  return new TableCell({
    borders: BORDERS, width: { size: width, type: WidthType.DXA },
    shading: HDR_FILL, margins: CELL_MARGINS,
    children: [new Paragraph({ alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: text, bold: true, font: 'Arial', size: 18, color: 'FFFFFF' })]
    })]
  })
}

function dataCell(text, width, opts) {
  var align = (opts && opts.right) ? AlignmentType.RIGHT : AlignmentType.LEFT
  var shading = (opts && opts.alt) ? ALT_FILL : undefined
  var color = (opts && opts.color) || '334155'
  return new TableCell({
    borders: BORDERS, width: { size: width, type: WidthType.DXA },
    shading: shading, margins: CELL_MARGINS,
    children: [new Paragraph({ alignment: align,
      children: [new TextRun({ text: String(text || '—'), font: 'Arial', size: 18, color: color })]
    })]
  })
}

function title(text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: text, bold: true, font: 'Arial', size: 28, color: '0F172A' })]
  })
}

function subtitle(text) {
  return new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: text, font: 'Arial', size: 20, color: '64748B' })]
  })
}

function statLine(label, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: label + ':  ', font: 'Arial', size: 20, color: '64748B' }),
      new TextRun({ text: String(value), bold: true, font: 'Arial', size: 20, color: '0F172A' }),
    ]
  })
}

function spacer() { return new Paragraph({ spacing: { after: 200 }, children: [] }) }

/* ── Timing ────────────────────────────────────────────── */

function buildTimingDoc(data, opts) {
  var avgIn = data.length ? Math.round(data.reduce(function (s, r) { return s + (r.avg_in_secs || 0) }, 0) / data.length) : 0
  var avgOut = data.length ? Math.round(data.reduce(function (s, r) { return s + (r.avg_out_secs || 0) }, 0) / data.length) : 0
  var avgHrs = data.length ? (data.reduce(function (s, r) { return s + (r.avg_hours || 0) }, 0) / data.length).toFixed(1) : '0'

  var colW = [1600, 1800, 700, 1000, 1000, 800, 800, 800, 1200]
  var tableW = colW.reduce(function (s, w) { return s + w }, 0)

  var headerRow = new TableRow({ children: [
    hdrCell('Name', colW[0]), hdrCell('Dept', colW[1]), hdrCell('Days', colW[2]),
    hdrCell('Avg In', colW[3]), hdrCell('Avg Out', colW[4]), hdrCell('Avg Hrs', colW[5]),
    hdrCell('Min', colW[6]), hdrCell('Max', colW[7]), hdrCell('Flag', colW[8]),
  ] })

  var rows = [headerRow]
  data.forEach(function (r, i) {
    var flag = ''
    if (r.avg_hours < 8) flag = 'Low hours'
    if (r.avg_hours >= 10) flag = 'Extended'
    var alt = i % 2 === 1

    rows.push(new TableRow({ children: [
      dataCell(r.name, colW[0], { alt: alt }),
      dataCell(r.department_name, colW[1], { alt: alt }),
      dataCell(r.days_worked, colW[2], { right: true, alt: alt }),
      dataCell(secsToTime(r.avg_in_secs), colW[3], { alt: alt }),
      dataCell(secsToTime(r.avg_out_secs), colW[4], { alt: alt }),
      dataCell(num(r.avg_hours), colW[5], { right: true, alt: alt }),
      dataCell(num(r.min_hours), colW[6], { right: true, alt: alt }),
      dataCell(num(r.max_hours), colW[7], { right: true, alt: alt }),
      dataCell(flag, colW[8], { alt: alt, color: flag ? 'DC2626' : '334155' }),
    ] }))
  })

  return makeDoc('Punch Timing Report', opts, [
    statLine('Employees', data.length),
    statLine('Avg In', secsToTime(avgIn)),
    statLine('Avg Out', secsToTime(avgOut)),
    statLine('Avg Hours', avgHrs + 'h'),
    spacer(),
    new Table({ width: { size: tableW, type: WidthType.DXA }, columnWidths: colW, rows: rows }),
  ])
}

/* ── Attendance ────────────────────────────────────────── */

function buildAttendanceDoc(data, opts) {
  var totalPresent = 0, totalHalf = 0, totalAbsent = 0, totalEff = 0
  data.forEach(function (r) {
    totalPresent += (r.days_present || 0)
    totalHalf += (r.days_half || 0)
    totalAbsent += (r.days_absent || 0)
    totalEff += (r.effective_days || 0)
  })
  var overallPct = totalEff > 0 ? ((totalPresent + totalHalf * 0.5) / totalEff * 100).toFixed(1) + '%' : '—'

  var colW = [1600, 1400, 800, 800, 800, 800, 900, 900]
  var tableW = colW.reduce(function (s, w) { return s + w }, 0)

  var headerRow = new TableRow({ children: [
    hdrCell('Name', colW[0]), hdrCell('Dept', colW[1]), hdrCell('Att %', colW[2]),
    hdrCell('Present', colW[3]), hdrCell('Half', colW[4]), hdrCell('Absent', colW[5]),
    hdrCell('Incomplete', colW[6]), hdrCell('Hours', colW[7]),
  ] })

  var rows = [headerRow]
  data.forEach(function (r, i) {
    var attPct = r.attendance_pct != null ? r.attendance_pct :
      (r.effective_days ? ((r.days_present + (r.days_half || 0) * 0.5) / r.effective_days * 100) : 0)
    var alt = i % 2 === 1
    rows.push(new TableRow({ children: [
      dataCell(r.name, colW[0], { alt: alt }),
      dataCell(r.department_name, colW[1], { alt: alt }),
      dataCell(pct(attPct), colW[2], { right: true, alt: alt, color: attPct < 50 ? 'DC2626' : attPct < 75 ? 'D97706' : '059669' }),
      dataCell(r.days_present, colW[3], { right: true, alt: alt }),
      dataCell(r.days_half || 0, colW[4], { right: true, alt: alt }),
      dataCell(r.days_absent || 0, colW[5], { right: true, alt: alt, color: r.days_absent > 3 ? 'DC2626' : '334155' }),
      dataCell(r.days_incomplete || 0, colW[6], { right: true, alt: alt }),
      dataCell(num(r.total_hours, 0), colW[7], { right: true, alt: alt }),
    ] }))
  })

  return makeDoc('Attendance Report', opts, [
    statLine('Staff', data.length),
    statLine('Overall Attendance', overallPct),
    statLine('Total Present Days', totalPresent),
    statLine('Total Absent Days', totalAbsent),
    statLine('Total Half Days', totalHalf),
    spacer(),
    new Table({ width: { size: tableW, type: WidthType.DXA }, columnWidths: colW, rows: rows }),
  ])
}

/* ── Hours ─────────────────────────────────────────────── */

function buildHoursDoc(data, opts) {
  var below8 = 0, above10 = 0, totalAvg = 0
  data.forEach(function (r) {
    var daysWorked = (r.days_present || 0) + (r.days_half || 0)
    var avg = daysWorked > 0 ? r.total_hours / daysWorked : 0
    r._avgDaily = avg
    if (avg < 8 && avg > 0) below8++
    if (avg >= 10) above10++
    totalAvg += avg
  })
  var overallAvg = data.length ? (totalAvg / data.length).toFixed(1) : '0'

  var colW = [1800, 1600, 1000, 1000, 1000, 1600]
  var tableW = colW.reduce(function (s, w) { return s + w }, 0)

  var headerRow = new TableRow({ children: [
    hdrCell('Name', colW[0]), hdrCell('Dept', colW[1]), hdrCell('Avg Daily', colW[2]),
    hdrCell('Total Hrs', colW[3]), hdrCell('Days', colW[4]), hdrCell('Flag', colW[5]),
  ] })

  var rows = [headerRow]
  data.forEach(function (r, i) {
    var flag = ''
    if (r._avgDaily < 6) flag = 'Critical — below 6h'
    else if (r._avgDaily < 8) flag = 'Below 8h'
    else if (r._avgDaily >= 10) flag = 'Extended shifts'
    var alt = i % 2 === 1
    rows.push(new TableRow({ children: [
      dataCell(r.name, colW[0], { alt: alt }),
      dataCell(r.department_name, colW[1], { alt: alt }),
      dataCell(num(r._avgDaily), colW[2], { right: true, alt: alt, color: r._avgDaily < 6 ? 'DC2626' : r._avgDaily < 8 ? 'D97706' : '059669' }),
      dataCell(num(r.total_hours, 0), colW[3], { right: true, alt: alt }),
      dataCell((r.days_present || 0) + (r.days_half || 0), colW[4], { right: true, alt: alt }),
      dataCell(flag, colW[5], { alt: alt, color: flag ? 'DC2626' : '334155' }),
    ] }))
  })

  return makeDoc('Hours Report', opts, [
    statLine('Staff', data.length),
    statLine('Avg Daily Hours', overallAvg + 'h'),
    statLine('Below 8h', below8 + ' employees'),
    statLine('Above 10h', above10 + ' employees'),
    spacer(),
    new Table({ width: { size: tableW, type: WidthType.DXA }, columnWidths: colW, rows: rows }),
  ])
}

/* ── DAR Compliance ────────────────────────────────────── */

function buildDarDoc(data, opts) {
  var totalSubmitted = 0, totalRequired = 0
  data.forEach(function (r) {
    totalSubmitted += (r.days_submitted || 0)
    totalRequired += (r.days_present || 0)
  })
  var overallPct = totalRequired > 0 ? (totalSubmitted / totalRequired * 100).toFixed(1) + '%' : '—'
  var high = data.filter(function (r) { return r.days_present > 0 && (r.days_submitted / r.days_present * 100) >= 90 }).length
  var low = data.filter(function (r) { return r.days_present > 0 && (r.days_submitted / r.days_present * 100) < 50 }).length

  var colW = [1800, 1600, 1200, 1100, 1100, 1200]
  var tableW = colW.reduce(function (s, w) { return s + w }, 0)

  var headerRow = new TableRow({ children: [
    hdrCell('Name', colW[0]), hdrCell('Dept', colW[1]), hdrCell('Compliance', colW[2]),
    hdrCell('Submitted', colW[3]), hdrCell('Present', colW[4]), hdrCell('Missing', colW[5]),
  ] })

  var rows = [headerRow]
  data.forEach(function (r, i) {
    var compPct = r.days_present > 0 ? (r.days_submitted / r.days_present * 100) : 0
    var missing = Math.max(0, (r.days_present || 0) - (r.days_submitted || 0))
    var alt = i % 2 === 1
    rows.push(new TableRow({ children: [
      dataCell(r.name, colW[0], { alt: alt }),
      dataCell(r.department_name, colW[1], { alt: alt }),
      dataCell(pct(compPct), colW[2], { right: true, alt: alt, color: compPct < 50 ? 'DC2626' : compPct < 90 ? 'D97706' : '059669' }),
      dataCell(r.days_submitted || 0, colW[3], { right: true, alt: alt }),
      dataCell(r.days_present || 0, colW[4], { right: true, alt: alt }),
      dataCell(missing, colW[5], { right: true, alt: alt, color: missing > 0 ? 'DC2626' : '334155' }),
    ] }))
  })

  return makeDoc('DAR Compliance Report', opts, [
    statLine('Staff Required', data.length),
    statLine('Overall Compliance', overallPct),
    statLine('90%+ Compliant', high + ' employees'),
    statLine('Below 50%', low + ' employees'),
    spacer(),
    new Table({ width: { size: tableW, type: WidthType.DXA }, columnWidths: colW, rows: rows }),
  ])
}

/* ── Concerns ──────────────────────────────────────────── */

function buildConcernsDoc(concerns, opts) {
  var colW = [600, 1800, 1400, 800, 3400]
  var tableW = colW.reduce(function (s, w) { return s + w }, 0)

  var headerRow = new TableRow({ children: [
    hdrCell('#', colW[0]), hdrCell('Name', colW[1]), hdrCell('Dept', colW[2]),
    hdrCell('Score', colW[3]), hdrCell('Concerns', colW[4]),
  ] })

  var rows = [headerRow]
  concerns.forEach(function (c, i) {
    var alt = i % 2 === 1
    rows.push(new TableRow({ children: [
      dataCell(i + 1, colW[0], { right: true, alt: alt }),
      dataCell(c.name, colW[1], { alt: alt }),
      dataCell(c.dept, colW[2], { alt: alt }),
      dataCell(c.score, colW[3], { right: true, alt: alt, color: c.score >= 50 ? 'DC2626' : c.score >= 25 ? 'D97706' : '334155' }),
      dataCell(c.concerns.join(', '), colW[4], { alt: alt }),
    ] }))
  })

  return makeDoc('Employee Concerns Report', opts, [
    statLine('Flagged Employees', concerns.length),
    spacer(),
    new Table({ width: { size: tableW, type: WidthType.DXA }, columnWidths: colW, rows: rows }),
    spacer(),
    new Paragraph({ spacing: { after: 80 },
      children: [new TextRun({ text: 'Scoring Criteria', bold: true, font: 'Arial', size: 20, color: '0F172A' })]
    }),
    new Paragraph({ children: [new TextRun({ text: 'Late arrival (after 12 PM): up to 30 pts  |  Low hours (<6h): 25 pts, (<8h): 10 pts  |  Attendance <50%: 35 pts, <75%: 20 pts  |  3+ incomplete: 15 pts  |  DAR <30%: 25 pts, <70%: 12 pts', font: 'Arial', size: 16, color: '64748B' })] }),
  ])
}

/* ── doc wrapper ───────────────────────────────────────── */

function makeDoc(reportTitle, opts, children) {
  var dateRange = rangeFmt(opts.fromDate, opts.toDate)
  var deptLabel = opts.deptName ? 'Department: ' + opts.deptName : 'All Departments'

  return new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 15840, height: 12240, orientation: 'landscape' },
          margin: { top: 720, right: 720, bottom: 720, left: 720 }
        }
      },
      children: [
        title('Ambria Attendance — ' + reportTitle),
        subtitle(dateRange + '   •   ' + deptLabel),
        spacer(),
        ...children,
        spacer(),
        new Paragraph({
          children: [new TextRun({ text: 'Generated on ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), font: 'Arial', size: 16, color: '94A3B8', italics: true })]
        }),
      ]
    }]
  })
}

/* ── public API ────────────────────────────────────────── */

export async function exportAnalysisDocx(viewName, data, opts) {
  var doc
  switch (viewName) {
    case 'timing': doc = buildTimingDoc(data, opts); break
    case 'attendance': doc = buildAttendanceDoc(data, opts); break
    case 'hours': doc = buildHoursDoc(data, opts); break
    case 'dar': doc = buildDarDoc(data, opts); break
    case 'concerns': doc = buildConcernsDoc(data, opts); break
    default: return
  }

  var blob = await Packer.toBlob(doc)
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = viewName + '_report_' + opts.fromDate + '_to_' + opts.toDate + '.docx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
