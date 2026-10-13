import type { Rect } from '@/shared/marquee/use-marquee-selection'
import type { TimelineItem } from '@/types/timeline'

function readRect(element: Element): Rect {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Capture timeline geometry once at marquee activation. Native clip roots win
 * when present; compact density clips use frame geometry plus their track row.
 * Resolving the remaining items is O(n) arithmetic with no per-item DOM query.
 */
export function resolveTimelineMarqueeItems(
  container: HTMLElement,
  itemIds: ReadonlyArray<string>,
  itemById: Readonly<Record<string, TimelineItem>>,
  totalFrames: number,
): Array<{ id: string; rect: Rect | null }> {
  const nativeRects = new Map<string, Rect>()
  for (const element of container.querySelectorAll<HTMLElement>(
    '[data-timeline-item][data-item-id]',
  )) {
    const id = element.dataset.itemId
    if (id) nativeRects.set(id, readRect(element))
  }

  const surface = container.querySelector<HTMLElement>('[data-timeline-committed-surface="tracks"]')
  const trackGeometry = new Map<string, { rowRect: Rect; contentRect: Rect }>()
  if (surface) {
    for (const element of surface.querySelectorAll<HTMLElement>('[data-track-id]')) {
      const trackId = element.dataset.trackId
      if (!trackId || trackGeometry.has(trackId)) continue
      const contentLayer = element.querySelector<HTMLElement>('[data-timeline-track-content-layer]')
      trackGeometry.set(trackId, {
        rowRect: readRect(element),
        contentRect: readRect(contentLayer ?? element),
      })
    }
  }

  return itemIds.map((id) => {
    const nativeRect = nativeRects.get(id)
    if (nativeRect) return { id, rect: nativeRect }

    const item = itemById[id]
    const geometry = item ? trackGeometry.get(item.trackId) : undefined
    if (!item || !geometry || totalFrames <= 0) {
      return { id, rect: null }
    }

    // Clips resolve their percentage-based horizontal geometry against the
    // registered content layer, not the wider track row. The row includes
    // deliberate right-side scroll room; folding that padding into the frame
    // scale accumulates a visible marquee offset late in long timelines.
    const { rowRect, contentRect } = geometry
    const pixelsPerFrame = contentRect.width / totalFrames
    const left = contentRect.left + item.from * pixelsPerFrame
    const width = Math.max(0, item.durationInFrames * pixelsPerFrame)
    return {
      id,
      rect: {
        left,
        top: rowRect.top + 1,
        right: left + width,
        bottom: rowRect.bottom - 1,
        width,
        height: Math.max(0, rowRect.height - 2),
      },
    }
  })
}
