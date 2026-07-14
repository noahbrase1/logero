import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate, formatTime } from './format'
import { groupAthletesByTeam } from './lineup'

// Builds and downloads a print-friendly PDF of an event's lineup — meant to
// be posted on a wall or handed out at the meet. Runs entirely client-side.
export function downloadLineupPdf(event, entries) {
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text(event.name, 14, 18)

  doc.setFontSize(11)
  doc.setTextColor(90)
  const subtitle = [formatDate(event.date), event.location].filter(Boolean).join('  —  ')
  doc.text(subtitle, 14, 26)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 34,
    head: [['Time', 'Event', 'Athletes']],
    body: entries.map((entry) => [
      formatTime(entry.scheduled_time),
      entry.event_name,
      groupAthletesByTeam(entry.event_entry_athletes)
        .map(([label, teamAthletes]) => {
          const names = teamAthletes.map((ea) => ea.profiles?.name || 'Unnamed').join(', ')
          return label ? `${label}: ${names}` : names
        })
        .join('\n') || '—',
    ]),
    headStyles: { fillColor: [124, 58, 237] },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 50 } },
  })

  const fileSafeName = event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  doc.save(`${fileSafeName || 'meet'}-lineup.pdf`)
}
