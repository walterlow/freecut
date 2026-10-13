import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import type { MotionPickWhipPresentation } from '@/shared/hooks/use-pick-whip-drag'

interface PropertyLinkDragState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  sourceItemId: string | null
  clipBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  presentation: MotionPickWhipPresentation
}

export function PropertyLinkPickWhipOverlay({ drag }: { drag: PropertyLinkDragState }) {
  return <PickWhipOverlay presentation={drag.presentation} testId="property-link-pick-whip" />
}
