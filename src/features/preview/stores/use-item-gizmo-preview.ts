import { useCallback } from 'react'
import { useGizmoStore } from './gizmo-store'

interface ItemGizmoPreviewOptions {
  /**
   * The item wrapper presents translate deltas directly on its DOM node. In
   * that mode React only needs the interaction boundary, not every pointer
   * position.
   */
  imperativeTranslate?: boolean
}

export function useItemGizmoPreview(itemId: string, options: ItemGizmoPreviewOptions = {}) {
  const activeGizmoMode = useGizmoStore((state) =>
    state.activeGizmo?.itemId === itemId ? state.activeGizmo.mode : null,
  )
  const previewTransform = useGizmoStore((state) => {
    if (state.activeGizmo?.itemId !== itemId) return null
    if (options.imperativeTranslate && state.activeGizmo.mode === 'translate') {
      return null
    }
    return state.previewTransform
  })
  const itemPreview = useGizmoStore(useCallback((state) => state.preview?.[itemId], [itemId]))
  const activeGizmo = activeGizmoMode === null ? null : { itemId, mode: activeGizmoMode }

  return { activeGizmo, previewTransform, itemPreview }
}
