import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate } from './format'

// Prints the split-recorder sheet as a PDF, honoring the coach's own
// divider groupings (see SplitRecorder.jsx's `dividers` state) — one table
// per group, in whatever order the athletes/dividers were left in on
// screen. `sections` is `[{ label, athletes: [{ name, cells: [{header,
// value}, ...] }] }]`; a group with no label (no divider placed above it)
// renders as a plain table with no heading. Columns are derived per-group
// from whichever athlete in that group has the most, since grouping is
// usually by shared workout in the first place — an athlete with fewer
// just shows blank cells past their own count.
export function downloadSplitRecorderPdf(dateStr, sections) {
  const doc = new jsPDF({ orientation: 'landscape' })

  doc.setFontSize(18)
  doc.text('Split Recorder', 14, 18)
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(formatDate(dateStr), 14, 26)
  doc.setTextColor(0)

  let y = 34
  sections.forEach((section) => {
    if (y > 175) {
      doc.addPage()
      y = 20
    }
    if (section.label) {
      doc.setFontSize(13)
      doc.setTextColor(30)
      doc.text(section.label, 14, y)
      doc.setTextColor(0)
      y += 6
    }

    const maxCols = Math.max(0, ...section.athletes.map((a) => a.cells.length))
    const headerFor = (i) => section.athletes.find((a) => a.cells[i])?.cells[i]?.header || ''
    const head = [['Athlete', ...Array.from({ length: maxCols }, (_, i) => headerFor(i))]]
    // Cell text is drawn by hand in didDrawCell below (inside the box), not
    // by autoTable itself — the body stays blank so there's nothing for it
    // to render that the box would then have to be drawn on top of.
    const body = section.athletes.map((a) => [a.name, ...Array.from({ length: maxCols }, () => '')])

    autoTable(doc, {
      startY: y,
      head,
      body,
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9, cellPadding: 2 },
      bodyStyles: { minCellHeight: 14 },
      margin: { left: 14, right: 14 },
      // A blank box under each split a coach needs to record — meant to be
      // printed and filled in by hand at practice/a meet, same spot an
      // already-entered time (typed in the app before exporting) shows up
      // printed inside instead of left blank. Skipped for a column past
      // that particular athlete's own segment count (`cells[i]` undefined)
      // — those stay a plain empty cell, same as the app's own N/A columns,
      // since there's nothing that athlete is meant to record there.
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index === 0) return
        const athlete = section.athletes[data.row.index]
        const cell = athlete?.cells[data.column.index - 1]
        if (!cell) return

        const pad = 1.5
        const boxX = data.cell.x + pad
        const boxY = data.cell.y + pad
        const boxW = data.cell.width - pad * 2
        const boxH = data.cell.height - pad * 2
        doc.setDrawColor(140)
        doc.rect(boxX, boxY, boxW, boxH)

        if (cell.value) {
          doc.setFontSize(9)
          doc.setTextColor(0)
          doc.text(cell.value, boxX + boxW / 2, boxY + boxH / 2 + 1.2, { align: 'center' })
        }
      },
    })
    y = doc.lastAutoTable.finalY + 10
  })

  doc.save(`split-recorder-${dateStr}.pdf`)
}
