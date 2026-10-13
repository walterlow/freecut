import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { emitUiSound } from '@/shared/ui/ui-sound'
import type { TimelineItem } from '@/types/timeline'
import { useTimelineStore } from '../stores/timeline-store'
import { expandSelectionWithLinkedItems, getLinkedItemIds } from '../utils/linked-items'
import {
  buildTimelineDensityBuckets,
  findTimelineDensityBucketItem,
} from '../utils/timeline-density-overview'
import { DENSE_TIMELINE_MAX_OVERVIEW_BUCKETS_PER_TRACK } from '../utils/timeline-dom-density'
import { registerTimelineDensityMarqueeBucket } from '../utils/timeline-density-marquee-preview'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'

interface TimelineDensityOverviewProps {
  items: ReadonlyArray<TimelineItem>
  selectedItemIds: ReadonlySet<string>
  trackLocked: boolean
  trackHidden: boolean
}

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

function getBucketColorClasses(item: TimelineItem): string {
  switch (item.type) {
    case 'video':
    case 'composition':
      return 'bg-timeline-video border-timeline-video'
    case 'audio':
      return 'bg-timeline-audio border-timeline-audio'
    case 'image':
      return 'bg-timeline-image/40 border-timeline-image'
    case 'text':
      return 'bg-timeline-text/40 border-timeline-text'
    case 'shape':
      return 'bg-timeline-shape/40 border-timeline-shape'
    case 'adjustment':
      return 'bg-violet-950/80 border-violet-500/70'
    default:
      return 'bg-muted border-border'
  }
}

function suppressTransferredPointerClick() {
  let fallbackTimer = 0
  const cleanup = () => {
    document.removeEventListener('click', handleClick, true)
    document.removeEventListener('mouseup', handleMouseUp, true)
    window.clearTimeout(fallbackTimer)
  }
  const handleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    cleanup()
  }
  const handleMouseUp = () => {
    // A click is dispatched after mouseup in the same task. Keep the capture
    // listener through that dispatch, then remove it if this became a drag.
    window.setTimeout(cleanup, 0)
  }

  document.addEventListener('click', handleClick, true)
  document.addEventListener('mouseup', handleMouseUp, true)
  fallbackTimer = window.setTimeout(cleanup, 1000)
}

export const TimelineDensityOverview = memo(function TimelineDensityOverview({
  items,
  selectedItemIds,
  trackLocked,
  trackHidden,
}: TimelineDensityOverviewProps) {
  const overviewRef = useRef<HTMLDivElement>(null)
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const previewUpdates = useLinkedEditPreviewStore(
    useShallow(
      useCallback((state) => itemIds.map((itemId) => state.updatesById[itemId] ?? null), [itemIds]),
    ),
  )
  const previewItems = useMemo(
    () =>
      items.flatMap((item, index) => {
        const update = previewUpdates[index]
        if (!update) return [item]
        if (update.hidden) return []
        return [{ ...item, ...update } as TimelineItem]
      }),
    [items, previewUpdates],
  )
  const buckets = useMemo(
    () => buildTimelineDensityBuckets(previewItems, DENSE_TIMELINE_MAX_OVERVIEW_BUCKETS_PER_TRACK),
    [previewItems],
  )

  useEffect(() => {
    const overview = overviewRef.current
    if (!overview) return
    const elements = overview.querySelectorAll<HTMLElement>('[data-timeline-density-bucket]')
    const unregisterBuckets = buckets.map((bucket, index) => {
      const element = elements[index]
      return element
        ? registerTimelineDensityMarqueeBucket(
            element,
            bucket.items.map((item) => item.id),
          )
        : () => {}
    })
    return () => unregisterBuckets.forEach((unregister) => unregister())
  }, [buckets])

  return (
    <div
      ref={overviewRef}
      data-timeline-density-overview
      data-density-bucket-count={buckets.length}
      className="absolute inset-0"
      style={{ contain: 'layout style paint' }}
    >
      {buckets.map((bucket) => {
        const hasSelectedItem = bucket.items.some((item) => selectedItemIds.has(item.id))
        return (
          <div
            key={bucket.index}
            data-timeline-density-bucket
            data-density-bucket-index={bucket.index}
            data-density-item-count={bucket.items.length}
            aria-label={`${bucket.items.length} clips`}
            className={cn(
              'absolute inset-y-px rounded-sm border overflow-hidden',
              getBucketColorClasses(bucket.items[0]!),
              trackLocked ? 'cursor-not-allowed' : 'cursor-default hover:brightness-110',
              hasSelectedItem && 'ring-1 ring-primary ring-inset',
            )}
            style={{
              left: getFramePositionStyle(bucket.from),
              width: getFramePositionStyle(bucket.durationInFrames),
              opacity: trackHidden ? 0.3 : trackLocked ? 0.6 : 1,
              contain: 'layout style paint',
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              if (trackLocked) {
                emitUiSound('error')
                return
              }

              const rect = event.currentTarget.getBoundingClientRect()
              const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
              const frame = bucket.from + ratio * bucket.durationInFrames
              const item = findTimelineDensityBucketItem(bucket, frame)
              const selection = useSelectionStore.getState()
              const activeTool = selection.activeTool
              const allItems = useTimelineStore.getState().items
              const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
              const targetIds = linkedSelectionEnabled
                ? getLinkedItemIds(allItems, item.id)
                : [item.id]
              if (event.metaKey || event.ctrlKey) {
                const targetSet = new Set(targetIds)
                const alreadySelected = targetIds.some((id) =>
                  selection.selectedItemIds.includes(id),
                )
                flushSync(() =>
                  selection.selectItems(
                    alreadySelected
                      ? selection.selectedItemIds.filter((id) => !targetSet.has(id))
                      : linkedSelectionEnabled
                        ? expandSelectionWithLinkedItems(allItems, [
                            ...selection.selectedItemIds,
                            ...targetIds,
                          ])
                        : Array.from(new Set([...selection.selectedItemIds, ...targetIds])),
                  ),
                )
                suppressTransferredPointerClick()
                return
              }

              emitUiSound('select')
              // The native root must exist before the physical pointer is
              // released so its drag/trim listeners receive the real mouseup.
              flushSync(() => selection.selectItems(targetIds))
              const { clientX, clientY, shiftKey, altKey } = event
              const promoted = Array.from(
                document.querySelectorAll<HTMLElement>('[data-timeline-item][data-item-id]'),
              ).find((element) => element.dataset.itemId === item.id)
              promoted?.dispatchEvent(
                new MouseEvent('mousedown', {
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                  buttons: 1,
                  clientX,
                  clientY,
                  shiftKey,
                  altKey,
                }),
              )
              // Promotion changes the physical mouseup target, so the browser
              // will not synthesize a click for the original bucket. Razor has
              // no held gesture; transfer its click while the native root is live.
              if (activeTool === 'razor') {
                promoted?.dispatchEvent(
                  new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    clientX,
                    clientY,
                    shiftKey,
                    altKey,
                  }),
                )
              }
              suppressTransferredPointerClick()
            }}
            onClick={(event) => event.stopPropagation()}
          />
        )
      })}
    </div>
  )
})
