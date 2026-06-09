import { describe, expect, it, vi } from 'vite-plus/test'
import type { AutoKeyframeOperation } from '@/features/editor/deps/keyframes'
import { applyAutoKeyframedTransformChange } from './auto-keyframe-transform'

function createOperation(itemId: string): AutoKeyframeOperation {
  return {
    itemId,
    property: 'x',
    value: 42,
    frame: 10,
  } as AutoKeyframeOperation
}

describe('applyAutoKeyframedTransformChange', () => {
  it('applies auto-keyframe operations and only falls back for non-animated items', () => {
    const applyAutoKeyframeOperations = vi.fn()
    const onTransformChange = vi.fn()
    const animatedOperation = createOperation('animated')

    applyAutoKeyframedTransformChange({
      itemIds: ['animated', 'plain'],
      updates: { x: 42 },
      getOperation: (itemId) => (itemId === 'animated' ? animatedOperation : null),
      applyAutoKeyframeOperations,
      onTransformChange,
    })

    expect(applyAutoKeyframeOperations).toHaveBeenCalledWith([animatedOperation])
    expect(onTransformChange).toHaveBeenCalledWith(['plain'], { x: 42 })
  })

  it('skips fallback updates when every item is auto-keyframed', () => {
    const applyAutoKeyframeOperations = vi.fn()
    const onTransformChange = vi.fn()

    applyAutoKeyframedTransformChange({
      itemIds: ['a', 'b'],
      updates: { opacity: 0.5 },
      getOperation: createOperation,
      applyAutoKeyframeOperations,
      onTransformChange,
    })

    expect(applyAutoKeyframeOperations).toHaveBeenCalledTimes(1)
    expect(onTransformChange).not.toHaveBeenCalled()
  })
})
