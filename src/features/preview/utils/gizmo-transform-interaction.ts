import type { Point, Transform } from '../types/gizmo'

export type TransformOperation = 'move' | 'resize' | 'rotate'

/**
 * A mouse drag can still synthesize a click after mouseup. If the dragged
 * handle moved away from the pointer, that click may be retargeted to the
 * preview background and clear selection. Consume only that same-turn click;
 * the listener is removed before a later, explicit user click can occur.
 */
export function suppressReleaseClick(): void {
  let timeoutId: number | null = null
  const cleanup = () => {
    window.removeEventListener('click', handleClick, true)
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
  const handleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    cleanup()
  }

  window.addEventListener('click', handleClick, true)
  timeoutId = window.setTimeout(cleanup, 0)
}

function hasTransformChanged(a: Transform, b: Transform): boolean {
  const tolerance = 0.01
  return (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.width - b.width) > tolerance ||
    Math.abs(a.height - b.height) > tolerance ||
    Math.abs(a.rotation - b.rotation) > tolerance
  )
}

function finishWindowTransformInteraction({
  removeListeners,
  startTransform,
  endInteraction,
  onTransformEnd,
  operation,
  afterFinish,
}: {
  removeListeners: () => void
  startTransform: Transform
  endInteraction: () => Transform | null
  onTransformEnd: (transform: Transform, operation: TransformOperation) => void
  operation: TransformOperation
  afterFinish?: () => void
}): void {
  removeListeners()
  document.body.style.cursor = ''

  const finalTransform = endInteraction()
  if (finalTransform && hasTransformChanged(startTransform, finalTransform)) {
    onTransformEnd(finalTransform, operation)
  }

  afterFinish?.()
}

export function attachWindowTransformInteraction({
  toCanvasPoint,
  updateInteraction,
  startTransform,
  endInteraction,
  onTransformEnd,
  operation,
  afterFinish,
}: {
  toCanvasPoint: (event: MouseEvent) => Point
  updateInteraction: (point: Point, shiftKey: boolean, ctrlKey: boolean, altKey: boolean) => void
  startTransform: Transform
  endInteraction: () => Transform | null
  onTransformEnd: (transform: Transform, operation: TransformOperation) => void
  operation: TransformOperation
  afterFinish?: () => void
}): void {
  const handleMouseMove = (moveEvent: MouseEvent) => {
    const movePoint = toCanvasPoint(moveEvent)
    updateInteraction(movePoint, moveEvent.shiftKey, moveEvent.ctrlKey, moveEvent.altKey)
  }

  const handleMouseUp = (upEvent: MouseEvent) => {
    // Mousemove delivery is not guaranteed to include the pointer's exact
    // release position (especially after a long or fast drag). Apply the
    // mouseup sample before reading the final transform so the committed value
    // and the visible gizmo always share the same endpoint.
    updateInteraction(toCanvasPoint(upEvent), upEvent.shiftKey, upEvent.ctrlKey, upEvent.altKey)
    finishWindowTransformInteraction({
      removeListeners: () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      },
      startTransform,
      endInteraction,
      onTransformEnd,
      operation,
      afterFinish,
    })
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}
