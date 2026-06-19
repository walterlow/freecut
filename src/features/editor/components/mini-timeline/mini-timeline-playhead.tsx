import { memo, useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import { MINI_TIMELINE_MIN_FRAMES } from './constants'
import { getMiniTimelineDisplayFrame } from './utils'

/**
 * Self-tracking playhead overlay. Subscribes to the playback store and moves
 * itself via a transform so per-frame scrub updates never re-render the host
 * strip (see CLAUDE.md render gotchas). Pass `suppressPreviewRef` to pin the
 * playhead at the committed frame during an IO drag while the preview canvas
 * keeps updating.
 */
export const MiniTimelinePlayhead = memo(function MiniTimelinePlayhead({
  labelWidth,
  maxFrame,
  handle = 'flag',
  pointer = false,
  suppressPreviewRef,
  testId,
}: {
  labelWidth: number
  maxFrame: number
  handle?: ComponentProps<typeof PlayheadMarks>['handle']
  pointer?: boolean
  suppressPreviewRef?: { current: boolean }
  testId?: string
}) {
  const playheadRef = useRef<HTMLDivElement>(null)
  const maxFrameRef = useRef(maxFrame)
  maxFrameRef.current = maxFrame
  // Container width is cached so per-frame position updates stay layout-free
  // (getBoundingClientRect forces layout on every playback store change).
  const containerWidthRef = useRef(0)

  const updatePosition = useCallback(
    (frame: number) => {
      const playhead = playheadRef.current
      if (!playhead) return
      if (containerWidthRef.current <= 0) {
        containerWidthRef.current = playhead.parentElement?.getBoundingClientRect().width ?? 0
      }
      const contentWidth = Math.max(0, containerWidthRef.current - labelWidth)
      const maxFrameValue = Math.max(MINI_TIMELINE_MIN_FRAMES, maxFrameRef.current, frame + 1)
      const ratio = maxFrameValue > 0 ? Math.max(0, Math.min(1, frame / maxFrameValue)) : 0
      playhead.style.transform = `translate3d(${Math.round(labelWidth + contentWidth * ratio)}px, 0, 0)`
    },
    [labelWidth],
  )

  useEffect(() => {
    updatePosition(getMiniTimelineDisplayFrame(suppressPreviewRef?.current === true))

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      const frame = suppressPreviewRef?.current
        ? state.currentFrame
        : (state.previewFrame ?? state.currentFrame)
      updatePosition(frame)
    })

    const container = playheadRef.current?.parentElement
    if (typeof ResizeObserver === 'undefined' || !container) return unsubscribe

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) containerWidthRef.current = width
      updatePosition(getMiniTimelineDisplayFrame(suppressPreviewRef?.current === true))
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      unsubscribe()
    }
  }, [updatePosition, suppressPreviewRef])

  useLayoutEffect(() => {
    updatePosition(getMiniTimelineDisplayFrame(suppressPreviewRef?.current === true))
  }, [labelWidth, maxFrame, updatePosition, suppressPreviewRef])

  return (
    <div
      ref={playheadRef}
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-0"
      data-testid={testId}
      aria-hidden="true"
    >
      <PlayheadMarks handle={handle} pointer={pointer} />
    </div>
  )
})
