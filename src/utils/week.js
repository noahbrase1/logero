// Pure local-date arithmetic — never toISOString() for date-only values,
// since that converts to UTC and can shift the date near midnight in
// negative-offset timezones. Every date here is built from/read back via
// local Y/M/D fields, matching the convention already used throughout the
// app's date handling (see src/utils/format.js, EventCalendar.jsx).

// "YYYY-MM-DD" from a local Date — moved here from EventCalendar.jsx, which
// now imports it, since it's genuinely shared pure date math rather than
// UI-specific.
export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Inverse of toDateStr — "YYYY-MM-DD" -> local Date (midnight local time).
export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Monday (local midnight) of the week containing `date`. getDay() is
// 0=Sunday..6=Saturday, so Monday is 1 day after Sunday and 0 days after
// itself — the (day + 6) % 7 trick maps Sunday to 6 days back and every
// other day to (day - 1) days back, landing on Monday either way.
export function startOfWeek(date) {
  const day = date.getDay()
  const diff = (day + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff)
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

const SHORT_MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// "Jul 20 – 26, 2026" for a Monday-of-week date; spells out the end month
// too ("Jul 28 – Aug 3, 2026") when the week crosses a month boundary.
export function formatWeekRangeLabel(monday) {
  const sunday = addDays(monday, 6)
  const startMonth = SHORT_MONTH_LABELS[monday.getMonth()]
  const endMonth = SHORT_MONTH_LABELS[sunday.getMonth()]
  const range =
    startMonth === endMonth
      ? `${startMonth} ${monday.getDate()} – ${sunday.getDate()}`
      : `${startMonth} ${monday.getDate()} – ${endMonth} ${sunday.getDate()}`
  return `${range}, ${sunday.getFullYear()}`
}
