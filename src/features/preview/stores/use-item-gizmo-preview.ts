import { useCallback } from 'react'
import { useGizmoStore } from './gizmo-store'

export function useItemGizmoPreview(itemId: string) {
  const activeGizmo = useGizmoStore((state) => state.activeGizmo)
  const previewTransform = useGizmoStore((state) => state.previewTransform)
  const itemPreview = useGizmoStore(useCallback((state) => state.preview?.[itemId], [itemId]))

  return { activeGizmo, previewTransform, itemPreview }
}
