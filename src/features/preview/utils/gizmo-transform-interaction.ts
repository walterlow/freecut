import type { Point, Transform } from '../types/gizmo'

export type TransformOperation = 'move' | 'resize' | 'rotate'

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

  const handleMouseUp = () => {
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
