import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface FloatingReadoutProps {
  anchorRef: RefObject<HTMLElement | null>
  children: React.ReactNode
  measureKey?: string
  offsetY?: number
}

export function FloatingReadout({
  anchorRef,
  children,
  measureKey = '',
  offsetY = 6,
}: FloatingReadoutProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    setPosition({
      x: rect.left + rect.width / 2,
      y: Math.max(4, rect.top - offsetY),
    })
  }, [anchorRef, offsetY])

  useLayoutEffect(() => {
    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [measureKey, updatePosition])

  if (!position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10000] -translate-x-1/2 -translate-y-full rounded bg-slate-950/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg whitespace-nowrap"
      style={{ left: position.x, top: position.y }}
    >
      {children}
    </div>,
    document.body,
  )
}
