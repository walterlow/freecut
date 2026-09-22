import { useMemo } from 'react'
import type { ShapeItem, TimelineItem } from '@/types/timeline'
import { useKeyframesStore } from '@/features/editor/deps/timeline-store'
import { hasPathVertexKeyframes } from '@/features/editor/deps/keyframes'
import {
  getShapeSectionControlVisibility,
  type ShapeSectionControlVisibility,
} from './shape-section-visibility'
import { getSharedShapeValues, type ShapeSharedValues } from './shape-section-shared-values'

export interface ShapeSectionSelectionParams {
  items: TimelineItem[]
  /** Mask-editor state that decides whether the path editor is open. */
  isEditing: boolean
  editingItemId: string | null
  penMode: boolean
}

export interface ShapeSectionSelection {
  shapeItems: ShapeItem[]
  /** Ids of {@link shapeItems}, stable across renders while the selection is unchanged. */
  itemIds: string[]
  sharedValues: ShapeSharedValues | null
  /** The single selected path shape, if the selection is exactly one path. */
  singlePathShape: ShapeItem | null
  pathTopologyLocked: boolean
  isEditingPathShape: boolean
  controlVisibility: ShapeSectionControlVisibility
}

/** Everything the shape inspector derives from the current selection. */
export function useShapeSectionSelection({
  items,
  isEditing,
  editingItemId,
  penMode,
}: ShapeSectionSelectionParams): ShapeSectionSelection {
  // Filter to only shape items
  const shapeItems = useMemo(
    () => items.filter((item): item is ShapeItem => item.type === 'shape'),
    [items],
  )

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => shapeItems.map((item) => item.id), [shapeItems])

  // Get shared values across selected shape items
  const sharedValues = useMemo(() => getSharedShapeValues(shapeItems), [shapeItems])

  const singlePathShape =
    shapeItems.length === 1 && shapeItems[0]?.shapeType === 'path' ? shapeItems[0] : null
  const singlePathKeyframes = useKeyframesStore((state) =>
    singlePathShape ? state.keyframesByItemId[singlePathShape.id] : undefined,
  )
  const pathTopologyLocked = hasPathVertexKeyframes(singlePathKeyframes)
  const isEditingPathShape =
    !!singlePathShape && isEditing && !penMode && editingItemId === singlePathShape.id
  const controlVisibility = getShapeSectionControlVisibility(shapeItems)
  return {
    shapeItems,
    itemIds,
    sharedValues,
    singlePathShape,
    pathTopologyLocked,
    isEditingPathShape,
    controlVisibility,
  }
}
