import { useEffect, useRef, useState, useCallback } from 'react'

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipState {
  visible: boolean
  // Skip the open delay + entrance animation when another tooltip was visible
  // moments ago — moving across a toolbar should feel instant after the first.
  instant: boolean
  text: string
  x: number
  y: number
  side: TooltipSide
}

// How long after a tooltip hides that the next one opens instantly (no delay,
// no animation). Matches the standard 300ms show delay.
const INSTANT_WINDOW_MS = 300
const SHOW_DELAY_MS = 300

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

export function GlobalTooltip() {
  const [state, setState] = useState<TooltipState>({
    visible: false,
    instant: false,
    text: '',
    x: 0,
    y: 0,
    side: 'top',
  })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  // Timestamp of the last hide, used to decide whether the next tooltip should
  // open instantly (subsequent-hover skip-delay).
  const lastHiddenAtRef = useRef(0)

  const showTooltip = useCallback((element: HTMLElement, instant: boolean) => {
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

    setState({ visible: true, instant, text, x, y, side })
  }, [])

  const hideTooltip = useCallback(() => {
    lastHiddenAtRef.current = Date.now()
    // Reset instant so the exit always fades, even if it opened instantly.
    setState((s) => ({ ...s, visible: false, instant: false }))
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
        const instant = Date.now() - lastHiddenAtRef.current < INSTANT_WINDOW_MS
        timeoutRef.current = setTimeout(
          () => showTooltip(target, instant),
          instant ? 0 : SHOW_DELAY_MS,
        )
        return
      }

      const target = (eventTarget as Element).closest('[data-tooltip]') as HTMLElement
      if (!target) return

      // Clear any pending hide timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      // Open instantly when another tooltip was visible moments ago, otherwise
      // wait the standard delay to avoid accidental activation.
      const instant = Date.now() - lastHiddenAtRef.current < INSTANT_WINDOW_MS
      timeoutRef.current = setTimeout(
        () => showTooltip(target, instant),
        instant ? 0 : SHOW_DELAY_MS,
      )
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

  // Always render the (invisible, non-interactive) tooltip so there's always a
  // hidden state to transition from — this makes both the entrance and exit
  // animate, including the very first tooltip of the session.
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
      {/* Interruptible opacity+scale transition (not a one-shot keyframe) so
          moving between adjacent triggers retargets smoothly. Origin-aware scale
          gives a subtle directional feel without a separate slide. Subsequent
          hovers snap (duration 0) via the instant flag. */}
      <div
        role="tooltip"
        data-visible={state.visible}
        className="overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground opacity-0 scale-[0.97] transition-[opacity,transform] ease-out-strong data-[visible=true]:opacity-100 data-[visible=true]:scale-100"
        style={{
          transformOrigin: origins[state.side],
          transitionDuration: state.instant ? '0ms' : '125ms',
        }}
      >
        {state.text}
      </div>
    </div>
  )
}
