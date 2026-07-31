import { IconPlus } from '@tabler/icons-react'

// Mobile-only floating action button — replaces a page's top-of-page
// primary create button (e.g. "+ Quick note", "+ New event") on small
// screens; the inline button stays for desktop (see each page's own
// `.page-header-inline-action` class and the FAB's own CSS, which hide
// each other via the same 860px breakpoint NavBar/BottomNav use, no JS
// branching needed). Always renders the team's own theme color, same as
// every other primary action button.
export default function Fab({ onClick, label }) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={label}>
      <IconPlus size={26} stroke={2} />
    </button>
  )
}
