import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import type { MotionPickWhipPresentation } from '@/shared/hooks/use-pick-whip-drag'

interface TransformParentDragState {
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

export function TransformParentPickWhipOverlay({ drag }: { drag: TransformParentDragState }) {
  return <PickWhipOverlay presentation={drag.presentation} testId="transform-parent-pick-whip" />
}
