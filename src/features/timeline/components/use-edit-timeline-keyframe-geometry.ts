/**
 * Edit-timeline geometry for the docked keyframe editor.
 *
 * Perf-critical: live wheel zoom must NOT re-render the editor tree — the
 * settle-then-commit geometry from useSettledTimelineGeometry is what the
 * keyframe graph panel's render-isolation test pins, so this block moves
 * verbatim (same subscriptions, same order, same memo dependencies).
 */

import { useCallback, useMemo, type RefObject } from 'react'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'
import { notifyTimelineLiveScroll } from '@/shared/timeline/live-scroll-sync'
import { getContentBoundedEdgeScrollLeft } from '../utils/timeline-layout'
import { useSettledTimelineGeometry } from './use-settled-timeline-scroll-left'
import type { KeyframeEditorSurface } from './keyframe-graph-panel-model'
import type { TimelineItem } from '@/types/timeline'

interface EditTimelineKeyframeGeometryParams {
  timelineScrollContainerRef: RefObject<HTMLDivElement | null> | undefined
  surface: KeyframeEditorSurface
  isOpen: boolean
  maxItemEndFrame: number
  selectedItemForEditor: TimelineItem | null
}

export function useEditTimelineKeyframeGeometry({
  timelineScrollContainerRef,
  surface,
  isOpen,
  maxItemEndFrame,
  selectedItemForEditor,
}: EditTimelineKeyframeGeometryParams) {
  const editTimelineViewportWidth = useTimelineViewportStore((state) => state.viewportWidth)
  // The expensive editor tree follows settled geometry. Live wheel zoom is
  // applied by the dopesheet root's compositor axis transform instead.
  const editTimelineContentPixelsPerSecond = useZoomStore((state) => state.contentPixelsPerSecond)
  const editTimelineFps = useTimelineSettingsStore((state) => state.fps)
  const editTimelineGeometry = useSettledTimelineGeometry(
    timelineScrollContainerRef,
    surface === 'edit' && isOpen,
    editTimelineContentPixelsPerSecond,
  )
  const editTimelineScrollLeft = editTimelineGeometry.scrollLeft
  const editTimelinePixelsPerSecond = editTimelineGeometry.pixelsPerSecond
  const editTimelineFrameViewport = useMemo(() => {
    if (
      surface !== 'edit' ||
      !selectedItemForEditor ||
      editTimelineViewportWidth <= 0 ||
      editTimelinePixelsPerSecond <= 0
    ) {
      return undefined
    }
    const startGlobalFrame =
      (editTimelineScrollLeft / editTimelinePixelsPerSecond) * editTimelineFps
    const endGlobalFrame =
      ((editTimelineScrollLeft + editTimelineViewportWidth) / editTimelinePixelsPerSecond) *
      editTimelineFps
    return {
      startFrame: startGlobalFrame - selectedItemForEditor.from,
      endFrame: endGlobalFrame - selectedItemForEditor.from,
    }
  }, [
    editTimelineFps,
    editTimelinePixelsPerSecond,
    editTimelineScrollLeft,
    editTimelineViewportWidth,
    selectedItemForEditor,
    surface,
  ])
  const editTimelineGlobalFrameToPixels = useCallback(
    (globalFrame: number) => {
      // The main timeline content moves natively with scrollLeft on every frame,
      // while the general viewport store is intentionally throttled for heavy
      // culling subscribers. Playheads are lightweight, so read the live DOM
      // axis here to keep the upper and lower lines in the same scroll frame.
      const pixelsPerSecond = timelineScrollContainerRef?.current
        ? useZoomStore.getState().pixelsPerSecond
        : editTimelinePixelsPerSecond
      const scrollLeft =
        timelineScrollContainerRef?.current?.scrollLeft ??
        useTimelineViewportStore.getState().scrollLeft
      // Match TimelinePlayhead's whole-pixel frame position exactly. Keeping
      // the lower line sub-pixel while the main line rounds makes an otherwise
      // synchronized playhead look faintly doubled at some zoom levels.
      return Math.round((globalFrame / editTimelineFps) * pixelsPerSecond) - scrollLeft
    },
    [editTimelineFps, editTimelinePixelsPerSecond, timelineScrollContainerRef],
  )
  const getEditTimelineLivePixelsPerSecond = useCallback(
    () => useZoomStore.getState().pixelsPerSecond,
    [],
  )
  const handleEditTimelineEdgeScroll = useCallback(
    (deltaPixels: number) => {
      if (surface !== 'edit') return 0
      const container = timelineScrollContainerRef?.current
      if (!container) return 0

      const previousScrollLeft = container.scrollLeft
      const pixelsPerSecond = useZoomStore.getState().pixelsPerSecond
      const viewportWidth = useTimelineViewportStore.getState().viewportWidth
      const contentDuration = Math.max(maxItemEndFrame / editTimelineFps, 10)
      container.scrollLeft = getContentBoundedEdgeScrollLeft({
        contentWidth: contentDuration * pixelsPerSecond,
        viewportWidth,
        scrollLeft: previousScrollLeft,
        deltaPixels,
      })
      const nextScrollLeft = container.scrollLeft
      const appliedPixels = nextScrollLeft - previousScrollLeft
      if (appliedPixels !== 0) {
        // Native scroll may arrive after the next paint. Broadcast the applied
        // DOM position so both playheads consume this scrollLeft immediately.
        notifyTimelineLiveScroll(container)
        const timelineViewport = useTimelineViewportStore.getState()
        timelineViewport.setViewportImmediate({
          scrollLeft: nextScrollLeft,
          scrollTop: timelineViewport.scrollTop,
          viewportWidth: timelineViewport.viewportWidth,
          viewportHeight: timelineViewport.viewportHeight,
        })
      }
      return appliedPixels
    },
    [editTimelineFps, maxItemEndFrame, surface, timelineScrollContainerRef],
  )

  return {
    editTimelineViewportWidth,
    editTimelineFps,
    editTimelineScrollLeft,
    editTimelinePixelsPerSecond,
    editTimelineFrameViewport,
    editTimelineGlobalFrameToPixels,
    getEditTimelineLivePixelsPerSecond,
    handleEditTimelineEdgeScroll,
  }
}
