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
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text('Split Recorder', 14, 18)
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(formatDate(dateStr), 14, 26)
  doc.setTextColor(0)

  let y = 34
  sections.forEach((section) => {
    if (y > 260) {
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
    const body = section.athletes.map((a) => [a.name, ...Array.from({ length: maxCols }, (_, i) => a.cells[i]?.value || '')])

    autoTable(doc, {
      startY: y,
      head,
      body,
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10
  })

  doc.save(`split-recorder-${dateStr}.pdf`)
}
