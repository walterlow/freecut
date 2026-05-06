import type { TransformProperties } from '@/types/transform'

/**
 * Compute initial fit-to-canvas transform for an item.
 * This locks in the initial size so it doesn't change when canvas changes.
 */
export function computeInitialTransform(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): TransformProperties {
  const scaleX = canvasWidth / sourceWidth
  const scaleY = canvasHeight / sourceHeight
  const fitScale = Math.min(scaleX, scaleY)

  // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
  // Only set opacity explicitly when user changes it, so we can distinguish
  // between "default 100%" and "explicitly set to 100%"
  return {
    x: 0,
    y: 0,
    width: Math.round(sourceWidth * fitScale),
    height: Math.round(sourceHeight * fitScale),
    rotation: 0,
  }
}
