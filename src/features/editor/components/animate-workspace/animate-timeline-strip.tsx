import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  createScrubThrottleState,
  shouldCommitScrubFrame,
} from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

const LABEL_WIDTH = 32
const RULER_HEIGHT = 18
const TRACK_AREA_HEIGHT = 56
const MIN_TIMELINE_FRAMES = 300

interface StripClip {
  id: string
  type: TimelineItem['type']
  label: string
  trackId: string
  from: number
  durationInFrames: number
}

function isStripTrack(track: TimelineTrack): boolean {
  return !track.isGroup
}

function getStripLabel(item: TimelineItem): string {
  const label = item.label.trim()
  return label || item.type
}

function resolveMaxFrame(items: readonly TimelineItem[]): number {
  const itemMax = items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  return Math.max(MIN_TIMELINE_FRAMES, itemMax)
}

function formatStripTime(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, Math.floor(frame / safeFps))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getDisplayFrame() {
  const playbackState = usePlaybackStore.getState()
  return playbackState.previewFrame ?? playbackState.currentFrame
}

/**
 * Self-tracking playhead overlay. Subscribes to the playback store and moves
 * itself via a transform so per-frame scrub updates never re-render the strip
 * (mirrors the Color navigator + Edit playhead pattern — see CLAUDE.md render
 * gotchas).
 */
const AnimateStripPlayhead = memo(function AnimateStripPlayhead({
  timelineMaxFrame,
}: {
  timelineMaxFrame: number
}) {
  const playheadRef = useRef<HTMLDivElement>(null)
  const maxFrameRef = useRef(timelineMaxFrame)
  maxFrameRef.current = timelineMaxFrame
  const containerWidthRef = useRef(0)

  const updatePosition = useCallback((frame: number) => {
    const playhead = playheadRef.current
    if (!playhead) return
    if (containerWidthRef.current <= 0) {
      containerWidthRef.current = playhead.parentElement?.getBoundingClientRect().width ?? 0
    }
    const contentWidth = Math.max(0, containerWidthRef.current - LABEL_WIDTH)
    const maxFrame = Math.max(MIN_TIMELINE_FRAMES, maxFrameRef.current, frame + 1)
    const ratio = maxFrame > 0 ? Math.max(0, Math.min(1, frame / maxFrame)) : 0
    playhead.style.transform = `translate3d(${Math.round(LABEL_WIDTH + contentWidth * ratio)}px, 0, 0)`
  }, [])

  useEffect(() => {
    updatePosition(getDisplayFrame())
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame ?? state.currentFrame)
    })
    const container = playheadRef.current?.parentElement
    if (typeof ResizeObserver === 'undefined' || !container) return unsubscribe
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) containerWidthRef.current = width
      updatePosition(getDisplayFrame())
    })
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      unsubscribe()
    }
  }, [updatePosition])

  return (
    <div
      ref={playheadRef}
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-0"
      data-testid="animate-timeline-playhead"
      aria-hidden="true"
    >
      <span className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.65)]" />
      <span className="absolute left-0 top-0 h-3 w-2 -translate-x-1/2 rounded-b-[2px] border border-red-300/60 bg-red-500" />
    </div>
  )
})

/**
 * Thin timeline strip for the Animate workspace. Shows every animatable clip as
 * a compact lane per track, lets the user pick the animation target by clicking
 * a clip (selecting it), and scrubs the shared playhead via the fast-scrub path
 * so the preview and keyframe editors stay in sync. Purpose-built rather than a
 * compact mode of the main Timeline (which has none).
 */
export const AnimateTimelineStrip = memo(function AnimateTimelineStrip() {
  const { t } = useTranslation()
  const { items, tracks } = useItemsStore(
    useShallow((s) => ({ items: s.items, tracks: s.tracks })),
  )
  const fps = useTimelineStore((s) => s.fps)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const pausePlayback = usePlaybackStore((s) => s.pause)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectItems = useSelectionStore((s) => s.selectItems)

  const isScrubbingRef = useRef(false)
  const scrubRectRef = useRef<DOMRect | null>(null)
  const scrubThrottleRef = useRef(createScrubThrottleState())
  const pendingClientXRef = useRef<number | null>(null)
  const scrubRafRef = useRef<number | null>(null)

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const trackRows = useMemo(
    () => tracks.filter(isStripTrack).sort((a, b) => a.order - b.order),
    [tracks],
  )
  const trackLaneIndexById = useMemo(
    () => new Map(trackRows.map((track, index) => [track.id, index])),
    [trackRows],
  )
  const clips = useMemo<StripClip[]>(
    () =>
      items
        .filter((item) => item.type !== 'subtitle')
        .map((item) => ({
          id: item.id,
          type: item.type,
          label: getStripLabel(item),
          trackId: item.trackId,
          from: item.from,
          durationInFrames: item.durationInFrames,
        }))
        .sort((a, b) => a.from - b.from),
    [items],
  )
  const timelineMaxFrame = useMemo(() => resolveMaxFrame(items), [items])

  const clientXToFrame = useCallback(
    (clientX: number): number | null => {
      const rect = scrubRectRef.current
      if (!rect || rect.width <= 0) return null
      const timelineWidth = Math.max(1, rect.width - LABEL_WIDTH)
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left - LABEL_WIDTH) / timelineWidth))
      return Math.round(ratio * timelineMaxFrame)
    },
    [timelineMaxFrame],
  )

  const cancelScrubRaf = useCallback(() => {
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current)
      scrubRafRef.current = null
    }
    pendingClientXRef.current = null
  }, [])

  useEffect(() => cancelScrubRaf, [cancelScrubRaf])

  const runScrubLoop = useCallback(() => {
    const clientX = pendingClientXRef.current
    const rect = scrubRectRef.current
    if (!isScrubbingRef.current || clientX === null || !rect) {
      scrubRafRef.current = null
      return
    }
    const frame = clientXToFrame(clientX)
    if (frame !== null) {
      const timelineWidth = Math.max(1, rect.width - LABEL_WIDTH)
      const pixelsPerSecond = (timelineWidth * (fps > 0 ? fps : 30)) / timelineMaxFrame
      if (
        shouldCommitScrubFrame({
          state: scrubThrottleRef.current,
          pointerX: clientX - rect.left - LABEL_WIDTH,
          targetFrame: frame,
          pixelsPerSecond,
          nowMs: performance.now(),
        })
      ) {
        setPreviewFrame(frame, null)
      }
    }
    scrubRafRef.current = requestAnimationFrame(runScrubLoop)
  }, [clientXToFrame, fps, setPreviewFrame, timelineMaxFrame])

  const handleScrubStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      isScrubbingRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrubRectRef.current = event.currentTarget.getBoundingClientRect()
      const frame = clientXToFrame(event.clientX)
      if (frame === null) return
      pausePlayback()
      pendingClientXRef.current = event.clientX
      scrubThrottleRef.current = createScrubThrottleState({
        pointerX: event.clientX - scrubRectRef.current.left - LABEL_WIDTH,
        frame,
        nowMs: performance.now(),
      })
      setPreviewFrame(frame, null)
      if (scrubRafRef.current === null) {
        scrubRafRef.current = requestAnimationFrame(runScrubLoop)
      }
    },
    [clientXToFrame, pausePlayback, runScrubLoop, setPreviewFrame],
  )

  const handleScrubMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return
    pendingClientXRef.current = event.clientX
  }, [])

  const finishScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      const frame = clientXToFrame(event.clientX)
      if (frame !== null) setCurrentFrame(frame)
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [cancelScrubRaf, clientXToFrame, setCurrentFrame, setPreviewFrame],
  )

  const cancelScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [cancelScrubRaf, setPreviewFrame],
  )

  const selectClip = useCallback(
    (clip: StripClip) => {
      pausePlayback()
      setPreviewFrame(null)
      setCurrentFrame(clip.from)
      selectItems([clip.id])
    },
    [pausePlayback, selectItems, setCurrentFrame, setPreviewFrame],
  )

  const rowCount = Math.max(1, trackRows.length)
  const rowHeight = TRACK_AREA_HEIGHT / rowCount

  return (
    <section
      className="panel-bg shrink-0 overflow-hidden border-b border-border bg-[#1d1e23]"
      aria-label={t('editor.animateTimeline.label')}
      data-testid="animate-timeline-strip"
      style={{ height: RULER_HEIGHT + TRACK_AREA_HEIGHT }}
    >
      {clips.length === 0 ? (
        <div className="flex h-full items-center px-3 text-[10px] font-medium text-zinc-500">
          {t('editor.animateTimeline.noClip')}
        </div>
      ) : (
        <div
          className="relative h-full cursor-ew-resize"
          data-testid="animate-timeline-scrub-surface"
          onPointerDown={handleScrubStart}
          onPointerMove={handleScrubMove}
          onPointerUp={finishScrub}
          onPointerCancel={cancelScrub}
        >
          {/* Ruler */}
          <div className="relative border-b border-black/40" style={{ height: RULER_HEIGHT }}>
            <div className="absolute inset-y-0 right-0" style={{ left: LABEL_WIDTH }}>
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <div
                  key={ratio}
                  className="absolute top-0 h-full border-l border-zinc-500/45 pl-1 pt-0.5 text-[10px] text-zinc-500"
                  style={{ left: `${ratio * 100}%` }}
                >
                  {formatStripTime(Math.round(ratio * timelineMaxFrame), fps)}
                </div>
              ))}
            </div>
          </div>

          {/* Track lanes + clips */}
          <div className="relative" style={{ height: TRACK_AREA_HEIGHT }}>
            <div
              className="absolute left-0 top-0 h-full border-r border-black/35 text-[9px] font-semibold text-zinc-400"
              style={{ width: LABEL_WIDTH }}
            >
              {trackRows.map((track, index) => (
                <span
                  key={track.id}
                  className="absolute left-0 flex w-full items-center justify-center overflow-hidden leading-none"
                  style={{ top: index * rowHeight, height: rowHeight }}
                >
                  {track.name || `T${index + 1}`}
                </span>
              ))}
            </div>
            <div className="absolute inset-y-0 right-0" style={{ left: LABEL_WIDTH }}>
              {trackRows.map((track, index) => (
                <div
                  key={track.id}
                  className="absolute left-0 right-0 border-t border-zinc-700/70"
                  style={{ top: index * rowHeight }}
                />
              ))}
              {clips.map((clip) => {
                const selected = selectedItemIdSet.has(clip.id)
                const laneIndex = trackLaneIndexById.get(clip.trackId) ?? 0
                const clipHeight = Math.max(8, Math.min(18, rowHeight - 4))
                const clipTop = laneIndex * rowHeight + Math.max(1, (rowHeight - clipHeight) / 2)
                return (
                  <button
                    key={clip.id}
                    type="button"
                    data-testid="animate-timeline-clip"
                    data-clip-id={clip.id}
                    className={`absolute overflow-hidden rounded-[2px] border text-left transition-colors ${
                      selected
                        ? 'border-orange-500 bg-orange-500/30 shadow-[0_0_0_1px_rgba(249,115,22,0.5)]'
                        : 'border-sky-500/70 bg-sky-500/40 hover:border-sky-300'
                    }`}
                    style={{
                      left: `${(clip.from / timelineMaxFrame) * 100}%`,
                      width: `${Math.max(0.6, (clip.durationInFrames / timelineMaxFrame) * 100)}%`,
                      minWidth: 14,
                      top: clipTop,
                      height: clipHeight,
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectClip(clip)
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    title={clip.label}
                    aria-label={clip.label}
                  />
                )
              })}
            </div>
          </div>

          <AnimateStripPlayhead timelineMaxFrame={timelineMaxFrame} />
        </div>
      )}
    </section>
  )
})
