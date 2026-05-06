import type { TimelineItem } from '@/types/timeline'

export function canApplyDroppedEffectsToItem(item: Pick<TimelineItem, 'type'>): boolean {
  return item.type !== 'audio'
}

export function resolveEffectDropTargetIds(params: {
  hoveredItemId: string
  items: readonly TimelineItem[]
  selectedItemIds: readonly string[]
}): string[] {
  const { hoveredItemId, items, selectedItemIds } = params
  const itemById = new Map(items.map((item) => [item.id, item]))
  const hoveredItem = itemById.get(hoveredItemId)
  if (!hoveredItem || !canApplyDroppedEffectsToItem(hoveredItem)) {
    return []
  }

  if (!selectedItemIds.includes(hoveredItemId) || selectedItemIds.length <= 1) {
    return [hoveredItemId]
  }

  const compatibleSelectedIds = selectedItemIds.filter((id) => {
    const item = itemById.get(id)
    return !!item && canApplyDroppedEffectsToItem(item)
  })

  return compatibleSelectedIds.length > 0 ? compatibleSelectedIds : [hoveredItemId]
}

export function isDragPointInsideElement(
  event: { clientX: number; clientY: number },
  element: Pick<HTMLElement, 'getBoundingClientRect'>,
): boolean {
  const rect = element.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}
