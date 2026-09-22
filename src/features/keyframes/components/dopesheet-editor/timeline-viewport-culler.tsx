/**
 * Dopesheet row culler.
 * Keeps a stable module-level identity so the sheet's memoized row cells never
 * remount (and lose their IntersectionObserver state) when the editor re-renders.
 */

import { memo, useEffect, useRef, useState } from 'react'

export const TimelineViewportCuller = memo(function TimelineViewportCuller({
  children,
}: {
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(true)

  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    // Classic Edit has its own scroller. Observing against the browser viewport
    // can report every row as hidden while the panel is opening and stay stale.
    const scrollRoot =
      node.closest('[data-dopesheet-scroll-viewport]') ??
      node.closest('[data-testid="motion-layer-scroll-area"]')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (!entry.isIntersecting && node.contains(document.activeElement)) return
        setIsNearViewport(entry.isIntersecting)
      },
      {
        root: scrollRoot,
        rootMargin: '96px 0px',
      },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="min-w-0 overflow-hidden">
      {isNearViewport ? children : null}
    </div>
  )
})
