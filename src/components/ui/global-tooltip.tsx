import { useEffect, useRef, useState, useCallback } from 'react'

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipState {
  visible: boolean
  text: string
  x: number
  y: number
  side: TooltipSide
}

/**
 * Global Tooltip Component
 *
 * Single instance tooltip that reads from data-tooltip attributes.
 * Much more performant than per-element Tooltip components.
 *
 * Usage: Add data-tooltip="Your tooltip text" to any element
 * Optional: data-tooltip-side="top|bottom|left|right" (default: top)
 */
// Transform based on side for proper positioning
const transforms: Record<TooltipSide, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
}

// Transform origin based on side (where tooltip "points" to)
const origins: Record<TooltipSide, string> = {
  top: 'bottom center',
  bottom: 'top center',
  left: 'right center',
  right: 'left center',
}

// Slide animation based on side (matches Radix tooltip)
const slideAnimations: Record<TooltipSide, string> = {
  top: 'slide-in-from-bottom-2',
  bottom: 'slide-in-from-top-2',
  left: 'slide-in-from-right-2',
  right: 'slide-in-from-left-2',
}

export function GlobalTooltip() {
  const [state, setState] = useState<TooltipState>({
    visible: false,
    text: '',
    x: 0,
    y: 0,
    side: 'top',
  })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const showTooltip = useCallback((element: HTMLElement) => {
    const text = element.getAttribute('data-tooltip')
    if (!text) return

    const rect = element.getBoundingClientRect()
    const side = (element.getAttribute('data-tooltip-side') || 'top') as TooltipSide
    const sideOffset = 4 // Match Radix default sideOffset

    let x: number
    let y: number

    switch (side) {
      case 'bottom':
        x = rect.left + rect.width / 2
        y = rect.bottom + sideOffset
        break
      case 'left':
        x = rect.left - sideOffset
        y = rect.top + rect.height / 2
        break
      case 'right':
        x = rect.right + sideOffset
        y = rect.top + rect.height / 2
        break
      case 'top':
      default:
        x = rect.left + rect.width / 2
        y = rect.top - sideOffset
        break
    }

    setState({ visible: true, text, x, y, side })
  }, [])

  const hideTooltip = useCallback(() => {
    setState((s) => ({ ...s, visible: false }))
  }, [])

  useEffect(() => {
    const handleMouseEnter = (e: MouseEvent) => {
      // e.target might be a text node, so check for closest method
      const eventTarget = e.target as Node
      if (!eventTarget || typeof (eventTarget as Element).closest !== 'function') {
        // If it's a text node, try parent element
        const parent = eventTarget?.parentElement
        if (!parent) return
        const target = parent.closest('[data-tooltip]') as HTMLElement
        if (!target) return

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        timeoutRef.current = setTimeout(() => showTooltip(target), 300)
        return
      }

      const target = (eventTarget as Element).closest('[data-tooltip]') as HTMLElement
      if (!target) return

      // Clear any pending hide timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      // Delay showing tooltip (300ms like TooltipProvider)
      timeoutRef.current = setTimeout(() => {
        showTooltip(target)
      }, 300)
    }

    const handleMouseLeave = (e: MouseEvent) => {
      // e.target might be a text node, so check for closest method
      const eventTarget = e.target as Node
      const element =
        eventTarget?.nodeType === Node.ELEMENT_NODE
          ? (eventTarget as Element)
          : eventTarget?.parentElement

      if (!element || !element.closest('[data-tooltip]')) return

      // Clear show timeout if leaving before it fires
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      hideTooltip()
    }

    const handleClick = (e: MouseEvent) => {
      // Hide tooltip on any click on a tooltip element
      const eventTarget = e.target as Node
      const element =
        eventTarget?.nodeType === Node.ELEMENT_NODE
          ? (eventTarget as Element)
          : eventTarget?.parentElement

      if (!element || !element.closest('[data-tooltip]')) return

      // Clear any pending show timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      hideTooltip()
    }

    // Use capture phase to catch events before they bubble
    document.addEventListener('mouseenter', handleMouseEnter, true)
    document.addEventListener('mouseleave', handleMouseLeave, true)
    document.addEventListener('click', handleClick, true)

    return () => {
      document.removeEventListener('mouseenter', handleMouseEnter, true)
      document.removeEventListener('mouseleave', handleMouseLeave, true)
      document.removeEventListener('click', handleClick, true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [showTooltip, hideTooltip])

  // Don't render anything if not visible
  if (!state.visible) return null

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        transform: transforms[state.side],
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <div
        role="tooltip"
        className={`overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 ${slideAnimations[state.side]}`}
        style={{ transformOrigin: origins[state.side] }}
      >
        {state.text}
      </div>
    </div>
  )
}
