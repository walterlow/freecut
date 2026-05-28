import { useCallback, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../../stores/timeline-store'
import { expandSelectionWithLinkedItems, getLinkedItemIds } from '../../utils/linked-items'

export interface ContextMenuState {
  closerEdge: 'left' | 'right' | null
  handleContextMenu: (e: React.MouseEvent) => void
}

export function useContextMenuState(item: TimelineItemType): ContextMenuState {
  const [closerEdge, setCloserEdge] = useState<'left' | 'right' | null>(null)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const midpoint = rect.width / 2
      setCloserEdge(x < midpoint ? 'left' : 'right')

      const { selectedItemIds, selectItems } = useSelectionStore.getState()
      const items = useTimelineStore.getState().items
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, item.id) : [item.id]
      const isCurrentSelection = targetIds.every((id) => selectedItemIds.includes(id))

      if (!isCurrentSelection) {
        if (
          selectedItemIds.length === 1 &&
          targetIds.length === 1 &&
          !selectedItemIds.includes(item.id)
        ) {
          selectItems(
            linkedSelectionEnabled
              ? expandSelectionWithLinkedItems(items, [...selectedItemIds, item.id])
              : Array.from(new Set([...selectedItemIds, item.id])),
          )
        } else {
          selectItems(targetIds)
        }
      }
    },
    [item.id],
  )

  return { closerEdge, handleContextMenu }
}
