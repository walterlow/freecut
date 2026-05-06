import { useSyncExternalStore } from 'react'
import { getMarqueeRect, type MarqueeController } from '@/hooks/use-marquee-selection'

interface MarqueeOverlayProps {
  /** Subscription-based controller returned from `useMarqueeSelection` */
  marquee: MarqueeController

  /** Custom className for styling */
  className?: string
}

/**
 * Visual overlay for marquee selection rectangle
 *
 * Renders a draggable selection box that appears when the user
 * click-drags to select multiple items. Subscribes directly to the
 * marquee controller so only this component re-renders per pointer move —
 * the tree above stays quiet.
 */
export function MarqueeOverlay({ marquee, className }: MarqueeOverlayProps) {
  const state = useSyncExternalStore(marquee.subscribe, marquee.getSnapshot, marquee.getSnapshot)

  if (!state.active) return null

  const rect = getMarqueeRect(state.startX, state.startY, state.currentX, state.currentY)

  return (
    <div
      className={`
        absolute pointer-events-none z-50
        border-2 border-dashed border-primary bg-primary/10
        ${className || ''}
      `}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    />
  )
}
