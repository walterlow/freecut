import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store'

export interface EffectDropTargetState {
  isEffectDropTarget: boolean
  multiEffectDropTargetCount: number
}

/**
 * Effect-drop hover state for a single clip plus the global drag-end cleanup:
 * the preview clears as soon as the browser drag gesture ends anywhere.
 */
export function useEffectDropTarget(itemId: string): EffectDropTargetState {
  // Single shallow read replaces three subscriptions on the same store.
  const effectDropPreview = useEffectDropPreviewStore(
    useShallow(
      useCallback(
        (state) => {
          const targets = state.targetItemIds
          const isTarget = targets.includes(itemId)
          const isSingle = targets.length === 1 && targets[0] === itemId
          const isMulti = isTarget && targets.length > 1
          return {
            isSingle,
            isMulti,
            hoveredMultiCount:
              state.hoveredItemId === itemId && targets.length > 1 ? targets.length : 0,
          }
        },
        [itemId],
      ),
    ),
  )
  const isEffectDropTarget = effectDropPreview.isSingle || effectDropPreview.isMulti

  useEffect(() => {
    if (!isEffectDropTarget) return

    const clearEffectDropTarget = () => useEffectDropPreviewStore.getState().clearPreview()
    window.addEventListener('dragend', clearEffectDropTarget)
    window.addEventListener('drop', clearEffectDropTarget)

    return () => {
      window.removeEventListener('dragend', clearEffectDropTarget)
      window.removeEventListener('drop', clearEffectDropTarget)
    }
  }, [isEffectDropTarget])

  return {
    isEffectDropTarget,
    multiEffectDropTargetCount: effectDropPreview.hoveredMultiCount,
  }
}
