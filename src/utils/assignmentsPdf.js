import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate, summarizeAssignment, workoutTypeLabel } from './format'

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function groupLabel(index) {
  return index < GROUP_LETTERS.length ? GROUP_LETTERS[index] : String(index + 1)
}

// Builds and downloads a print-friendly PDF of one day's assigned
// workouts, grouped by identical workout — one row per group, in whatever
// order the coach left them in after reviewing (see the assignment grid's
// "Export day" flow, which lets a coach move athletes between groups and
// reorder the groups themselves before calling this). Runs entirely
// client-side; `groups` is `[{ assignments: [assignedWorkoutRow, ...] }]`.
export function downloadAssignmentsPdf(dateStr, groups) {
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text('Assigned workouts', 14, 18)

  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(formatDate(dateStr), 14, 26)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 34,
    head: [['Group', 'Workout', 'Athletes']],
    body: groups.map((g, i) => {
      const rep = g.assignments[0]
      const summary = summarizeAssignment(rep)
      const workoutLines = [`${workoutTypeLabel(rep.type)}${summary ? ` — ${summary}` : ''}`]
      if (rep.notes) workoutLines.push(rep.notes)
      return [
        `Group ${groupLabel(i)}`,
        workoutLines.join('\n'),
        g.assignments.map((a) => a.profiles?.name || 'Unnamed athlete').join('\n'),
      ]
    }),
    headStyles: { fillColor: [124, 58, 237] },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 90 } },
  })

  doc.save(`assignments-${dateStr}.pdf`)
}
