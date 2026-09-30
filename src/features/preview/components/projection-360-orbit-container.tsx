import { memo, useMemo } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '@/features/preview/deps/timeline-store'
import { Projection360OrbitOverlay } from './projection-360-orbit-overlay'
import { useProjection360OrbitStore } from '../stores/projection-360-orbit-store'

interface Projection360OrbitContainerProps {
  containerRect: DOMRect | null
}

export const Projection360OrbitContainer = memo(function Projection360OrbitContainer({
  containerRect,
}: Projection360OrbitContainerProps) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const items = useItemsStore((s) => s.items)
  const isOrbitActive = useProjection360OrbitStore((s) => s.isOrbitActive)

  const active360Item = useMemo(() => {
    if (!isOrbitActive || selectedItemIds.length !== 1) return null
    const item = items.find((i) => i.id === selectedItemIds[0])
    if (!item || !item.projection360?.enabled) return null
    return item
  }, [isOrbitActive, items, selectedItemIds])

  if (!active360Item) return null

  return (
    <Projection360OrbitOverlay
      item={active360Item}
      containerRect={containerRect}
    />
  )
})
