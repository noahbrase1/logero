import { useEffect } from 'react'
import { IconX } from '@tabler/icons-react'

// Generic overlay/modal — new, this app's first (the messaging feature's
// image lightbox is similar but deliberately kept as its own separate,
// proven CSS/JSX rather than shared, per this codebase's convention of
// concrete-over-shared-abstraction for similar-but-separate UI). Backdrop
// click or Escape closes; clicking the panel itself does not.
export default function Modal({ onClose, children, labelledBy }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="cell-modal-overlay" onClick={onClose}>
      <div
        className="cell-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="cell-modal-close" onClick={onClose} aria-label="Close">
          <IconX size={20} />
        </button>
        {children}
      </div>
    </div>
  )
}
