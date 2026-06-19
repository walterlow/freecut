import { useRef, useEffect, useLayoutEffect } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { formatTimecode } from '@/shared/utils/time-utils'
import { IO_LANE_HEIGHT } from './timeline-markers'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'

// Playhead flag tab height (matches PlayheadMarks' h-3).
const FLAG_HEIGHT = 12

interface TimelinePreviewScrubberProps {
  inRuler?: boolean
  maxFrame?: number
}

/**
 * Ghost playhead that follows mouse hover position on the timeline.
 *
 * Uses the same manual subscription pattern as TimelinePlayhead:
 * - No React re-renders during updates
 * - DOM is updated directly via refs
 * - pointer-events: none so it doesn't interfere with clicks/drags
 */
export function TimelinePreviewScrubber({
  inRuler = false,
  maxFrame,
}: TimelinePreviewScrubberProps) {
  const { frameToPixels, fps } = useTimelineZoomContext()
  const scrubberRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const frameToPixelsRef = useRef(frameToPixels)
  const fpsRef = useRef(fps)
  const maxFrameRef = useRef(maxFrame)

  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    fpsRef.current = fps
    maxFrameRef.current = maxFrame
  }, [frameToPixels, fps, maxFrame])

  // Subscribe to previewFrame and update DOM directly (zero re-renders)
  useEffect(() => {
    const updatePosition = (previewFrame: number | null) => {
      if (!scrubberRef.current) return

      // Hidden during an IO-marker drag: the preview canvas still refreshes via
      // `previewFrame`, but the ghost skimmer must not chase the marker.
      if (previewFrame === null || previewScrubberSuppressRef.current) {
        scrubberRef.current.style.display = 'none'
        return
      }

      let clampedFrame = Math.max(0, previewFrame)
      if (maxFrameRef.current !== undefined) {
        clampedFrame = Math.min(clampedFrame, maxFrameRef.current)
      }

      const leftPosition = Math.round(frameToPixelsRef.current(clampedFrame))
      scrubberRef.current.style.display = ''
      // Use transform (compositor-only) instead of style.left (triggers layout).
      scrubberRef.current.style.transform = `translate3d(${leftPosition}px, 0, 0)`

      // Update tooltip text
      if (tooltipRef.current) {
        tooltipRef.current.textContent = formatTimecode(clampedFrame, fpsRef.current)
      }
    }

    // Initial state
    updatePosition(usePlaybackStore.getState().previewFrame)

    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame)
    })
  }, [])

  // Reposition on zoom changes
  useLayoutEffect(() => {
    if (!scrubberRef.current) return
    const previewFrame = usePlaybackStore.getState().previewFrame
    if (previewFrame === null) return
    let clampedFrame = Math.max(0, previewFrame)
    if (maxFrame !== undefined) {
      clampedFrame = Math.min(clampedFrame, maxFrame)
    }
    const leftPosition = Math.round(frameToPixels(clampedFrame))
    scrubberRef.current.style.transform = `translate3d(${leftPosition}px, 0, 0)`
  }, [frameToPixels, maxFrame])

  // Change color based on active tool: red for razor, purple for rate-stretch
  useEffect(() => {
    const updateColor = (tool: string) => {
      const isRazor = tool === 'razor'
      const isRateStretch = tool === 'rate-stretch'
      const isTrimEdit = tool === 'trim-edit'
      const lineColor = isRazor
        ? 'rgba(239, 68, 68, 0.7)'
        : isRateStretch
          ? 'rgba(168, 85, 247, 0.7)'
          : isTrimEdit
            ? 'rgba(234, 179, 8, 0.7)'
            : 'rgba(255, 255, 255, 0.3)'
      const handleColor = isRazor
        ? 'rgba(239, 68, 68, 0.8)'
        : isRateStretch
          ? 'rgba(168, 85, 247, 0.8)'
          : isTrimEdit
            ? 'rgba(234, 179, 8, 0.8)'
            : 'rgba(255, 255, 255, 0.4)'

      if (lineRef.current) lineRef.current.style.backgroundColor = lineColor
      if (handleRef.current) handleRef.current.style.backgroundColor = handleColor
    }

    updateColor(useSelectionStore.getState().activeTool)

    return useSelectionStore.subscribe((state, prev) => {
      if (state.activeTool !== prev.activeTool) {
        updateColor(state.activeTool)
      }
    })
  }, [])

  return (
    <div
      ref={scrubberRef}
      className="absolute top-0 bottom-0"
      style={{
        display: 'none', // Hidden by default, shown via ref subscription
        width: '1px',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {/* Ghost line. In the ruler it starts below the flag (which sits in the
          tick lane under the IO bar) so it doesn't show through the translucent
          tab; in the tracks it spans full height. */}
      <div
        ref={lineRef}
        className="absolute bg-white/30"
        style={{ top: inRuler ? IO_LANE_HEIGHT + FLAG_HEIGHT : 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Ruler area: flag handle + time tooltip */}
      {inRuler && (
        <>
          {/* Flag tab — matches the real playhead's handle shape, but kept
              translucent and tool-colored (set via ref) so the skim ghost stays
              distinct from the solid playhead. */}
          <div
            ref={handleRef}
            className="absolute rounded-b-[2px] bg-white/40"
            style={{
              top: `${IO_LANE_HEIGHT}px`,
              left: '50%',
              width: '8px',
              height: `${FLAG_HEIGHT}px`,
              transform: 'translateX(-50%)',
            }}
          />

          {/* Time tooltip */}
          <div
            ref={tooltipRef}
            className="absolute bg-black/80 text-white font-mono rounded px-1.5 py-0.5 whitespace-nowrap"
            style={{
              top: '-22px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '10px',
              lineHeight: '12px',
            }}
          />
        </>
      )}
    </div>
  )
}
