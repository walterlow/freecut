import type { ResolvedTransform } from '@/types/transform'

interface PositionTransform {
  x: number
  y: number
}

interface ResolveGizmoDomTranslationParams {
  itemId: string
  positionSourceItemId?: string
  followsActiveItem?: boolean
  activeItemId: string
  activeStartTransform: PositionTransform
  previewTransform: PositionTransform
  renderedTransform: ResolvedTransform
  interactionStartTransform: ResolvedTransform
  scaleX: number
  scaleY: number
}

/**
 * Resolve a small imperative translation that bridges the gap between the
 * latest gizmo store value and the last React-painted item transform.
 *
 * The selected item follows the preview directly. A Position-linked follower
 * or transform descendant receives the same source delta, preserving its
 * offset without re-resolving the full composition tree in the pointer hot
 * path.
 */
export function resolveGizmoDomTranslation({
  itemId,
  positionSourceItemId,
  followsActiveItem = false,
  activeItemId,
  activeStartTransform,
  previewTransform,
  renderedTransform,
  interactionStartTransform,
  scaleX,
  scaleY,
}: ResolveGizmoDomTranslationParams): { x: number; y: number } | null {
  let targetX: number
  let targetY: number

  if (itemId === activeItemId) {
    targetX = previewTransform.x
    targetY = previewTransform.y
  } else if (followsActiveItem || positionSourceItemId === activeItemId) {
    targetX = interactionStartTransform.x + (previewTransform.x - activeStartTransform.x)
    targetY = interactionStartTransform.y + (previewTransform.y - activeStartTransform.y)
  } else {
    return null
  }

  return {
    x: (targetX - renderedTransform.x) * scaleX,
    y: (targetY - renderedTransform.y) * scaleY,
  }
}
