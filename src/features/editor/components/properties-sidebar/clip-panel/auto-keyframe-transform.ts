import type { TransformProperties } from '@/types/transform'
import type { AutoKeyframeOperation } from '@/features/editor/deps/keyframes'

interface ApplyAutoKeyframedTransformChangeOptions {
  itemIds: readonly string[]
  updates: Partial<TransformProperties>
  getOperation: (itemId: string) => AutoKeyframeOperation | null
  applyAutoKeyframeOperations: (operations: AutoKeyframeOperation[]) => void
  onTransformChange: (ids: string[], updates: Partial<TransformProperties>) => void
}

export function applyAutoKeyframedTransformChange({
  itemIds,
  updates,
  getOperation,
  applyAutoKeyframeOperations,
  onTransformChange,
}: ApplyAutoKeyframedTransformChangeOptions): void {
  const autoOps: AutoKeyframeOperation[] = []
  const fallbackItemIds: string[] = []

  for (const itemId of itemIds) {
    const operation = getOperation(itemId)
    if (operation) {
      autoOps.push(operation)
    } else {
      fallbackItemIds.push(itemId)
    }
  }

  if (autoOps.length > 0) {
    applyAutoKeyframeOperations(autoOps)
  }
  if (fallbackItemIds.length > 0) {
    onTransformChange(fallbackItemIds, updates)
  }
}
