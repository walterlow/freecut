/**
 * Live pixel geometry sync for the linked Edit timeline axis.
 * The dopesheet pans on the compositor while the main timeline scrolls, so the
 * keyframe surfaces are rewritten straight to DOM through a rAF-throttled
 * scroll listener instead of a React render. The every-render layout effect that
 * follows re-applies the last sync to nodes React added since the previous
 * paint (drag previews, newly revealed rows).
 */

import { useLayoutEffect, type RefObject } from 'react'
import { TIMELINE_LIVE_SCROLL_EVENT } from '@/shared/timeline/live-scroll-sync'
import { syncDopesheetLivePixelGeometry } from './dopesheet-live-pixel-geometry'

export interface UseLivePixelGeometrySyncOptions {
  /** Mirror the last sync into the dragging/marquee DOM writers. */
  syncLivePixelGeometryRef: RefObject<() => void>
  /** Editor root carrying the `data-dopesheet-live-*` geometry hooks. */
  rootRef: RefObject<HTMLDivElement | null>
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
  getTimelineLivePixelsPerSecond?: () => number
  timelinePanBaseScrollLeft?: number
  timelinePanBasePixelsPerSecond?: number
  /** Fallback scale when the linked timeline exposes no live reader. */
  timelinePixelsPerSecond: number
  fps: number
  itemFrom: number
  hasLinkedTimelineAxis: boolean
}

/** Keeps the sheet's DOM geometry on the linked timeline's live scroll axis. */
export function useLivePixelGeometrySync({
  syncLivePixelGeometryRef,
  rootRef,
  timelineScrollContainerRef,
  getTimelineLivePixelsPerSecond,
  timelinePanBaseScrollLeft,
  timelinePanBasePixelsPerSecond,
  timelinePixelsPerSecond,
  fps,
  itemFrom,
  hasLinkedTimelineAxis,
}: UseLivePixelGeometrySyncOptions): void {
  useLayoutEffect(() => {
    const scrollContainer = timelineScrollContainerRef?.current
    const root = rootRef.current
    if (!scrollContainer || !root || timelinePanBaseScrollLeft === undefined) {
      syncLivePixelGeometryRef.current = () => {}
      return
    }

    let scrollFrame: number | null = null
    const syncLiveGeometry = () => {
      const pixelsPerSecond =
        getTimelineLivePixelsPerSecond?.() ??
        timelinePanBasePixelsPerSecond ??
        timelinePixelsPerSecond
      syncDopesheetLivePixelGeometry({
        root,
        pixelsPerSecond,
        fps,
        scrollLeft: scrollContainer.scrollLeft,
        itemFrom,
        // Linked Edit cells retain a one-pixel left border. Their absolutely
        // positioned contents begin just inside it, so compensate without
        // transforming or scaling the surface.
        originOffset: hasLinkedTimelineAxis ? -1 : 0,
      })
    }
    const scheduleScrollSync = () => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        syncLiveGeometry()
      })
    }
    const syncLiveEvent = () => {
      if (scrollFrame !== null) {
        cancelAnimationFrame(scrollFrame)
        scrollFrame = null
      }
      syncLiveGeometry()
    }

    syncLivePixelGeometryRef.current = syncLiveGeometry
    syncLiveGeometry()
    scrollContainer.addEventListener('scroll', scheduleScrollSync, { passive: true })
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollContainer.removeEventListener('scroll', scheduleScrollSync)
      scrollContainer.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
      syncLivePixelGeometryRef.current = () => {}
    }
  }, [
    fps,
    getTimelineLivePixelsPerSecond,
    hasLinkedTimelineAxis,
    itemFrom,
    // Injected refs (stable identities); listed because they are parameters now,
    // not refs created in this scope.
    rootRef,
    syncLivePixelGeometryRef,
    timelinePanBasePixelsPerSecond,
    timelinePanBaseScrollLeft,
    timelinePixelsPerSecond,
    timelineScrollContainerRef,
  ])
  useLayoutEffect(() => {
    // React may add drag previews or filtered rows without changing the live
    // axis inputs. Bring those new nodes onto the same current pixel axis before
    // the browser paints them.
    syncLivePixelGeometryRef.current()
  })
}
