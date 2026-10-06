import { useEffect, useRef, useState } from 'react'

/**
 * A small "i" badge that opens a popover explaining an option. Click to toggle; click outside or
 * press Escape to close. Used to keep the UI uncluttered while every choice stays explained.
 */
export function InfoDot({
  title,
  children
}: {
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span className="infodot" ref={ref}>
      <button
        type="button"
        className="infodot-badge"
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className="infodot-pop" role="tooltip">
          {title && <strong className="infodot-title">{title}</strong>}
          {children}
        </span>
      )}
    </span>
  )
}
