import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
  importMediaLibraryService,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { useFilmstrip, type FilmstripFrame } from '@/features/editor/deps/timeline-hooks'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { GpuEffectInstance } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { renderGradedTileFrame } from '../utils/color-grade-tile-renderer'
import {
  createScrubThrottleState,
  shouldCommitScrubFrame,
} from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useGizmoStore } from '@/features/editor/deps/preview'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { ProjectMarker } from '@/types/timeline'
import {
  buildTimelineAnnotationModel,
  type TimelineAnnotationMarker,
  type TimelineAnnotationModel,
} from '@/shared/timeline/timeline-annotations'
import {
  resolveColorGradeThumbnailTreatment,
  type ColorGradeThumbnailTreatment,
} from '../utils/color-grade-thumbnail-treatment'

interface TimelineClip {
  id: string
  type: TimelineItem['type']
  label: string
  trackId: string
  trackName: string
  mediaId?: string
  from: number
  durationInFrames: number
  // Source-native frame fields (see CLAUDE.md: source* are in source FPS, not
  // project FPS). The film tile converts these to seconds with media metadata.
  sourceStartFrames: number
  sourceDurationFrames: number
  sourceFps: number
  trimStartFrames: number
  thumbnailUrl?: string
  // Resolved effects (live-preview overrides win) used to bake the real GPU
  // grade onto the tile frame; `gradeThumbnail` is the CSS-approximation
  // fallback + the grade indicator.
  effects: readonly ItemEffect[]
  gradeThumbnail: ColorGradeThumbnailTreatment
}

const FILM_TILE_SCROLLBAR_GUTTER = 16
const STRIP_HEIGHT = 164 + FILM_TILE_SCROLLBAR_GUTTER
const FILM_TILE_WIDTH = 118
const FILM_TILE_HEIGHT = 80
const FILM_TILE_STRIP_HEIGHT = 88 + FILM_TILE_SCROLLBAR_GUTTER
const MINI_TIMELINE_TRACK_AREA_HEIGHT = 52
const MINI_TIMELINE_LABEL_WIDTH = 32
const COLOR_IO_LANE_HEIGHT = 14
const COLOR_IO_HANDLE_WIDTH = 6
const COLOR_IO_HANDLE_COLOR = 'var(--color-timeline-io-handle)'
const MIN_TIMELINE_FRAMES = 300
const VIDEO_TRACK_NAME_REGEX = /^V\d+$/i

function isVisualNavigatorItem(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'subtitle'
}

function isNavigatorVideoTrack(track: TimelineTrack): boolean {
  if (track.isGroup) return false
  if (track.kind === 'audio') return false
  if (track.kind === 'video') return true
  return VIDEO_TRACK_NAME_REGEX.test(track.name)
}

function getNavigatorLabel(item: TimelineItem): string {
  const label = item.label.trim()
  if (label) return label
  return item.type === 'adjustment' ? 'Grade' : item.type
}

function getThumbnailUrl(item: TimelineItem): string | undefined {
  return 'thumbnailUrl' in item ? item.thumbnailUrl : undefined
}

function resolveTimelineMaxFrame(params: {
  items: readonly TimelineItem[]
  markers: readonly ProjectMarker[]
  inPoint: number | null
  outPoint: number | null
}): number {
  const { items, markers, inPoint, outPoint } = params
  const itemMax = items.reduce(
    (maxFrame, item) => Math.max(maxFrame, item.from + item.durationInFrames),
    0,
  )
  const markerMax = markers.reduce((maxFrame, marker) => Math.max(maxFrame, marker.frame), 0)
  return Math.max(MIN_TIMELINE_FRAMES, itemMax, markerMax, inPoint ?? 0, outPoint ?? 0)
}

function formatNavigatorTime(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, Math.floor(frame / safeFps))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function formatNavigatorTimecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps > 0 ? fps : 30))
  const clampedFrame = Math.max(0, Math.round(frame))
  const totalSeconds = Math.floor(clampedFrame / safeFps)
  const frames = clampedFrame % safeFps
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds, frames]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

function getDisplayFrame() {
  const playbackState = usePlaybackStore.getState()
  return playbackState.previewFrame ?? playbackState.currentFrame
}

const ColorTimelinePlayhead = memo(function ColorTimelinePlayhead({
  timelineInsetPx,
  timelineMaxFrame,
}: {
  timelineInsetPx: number
  timelineMaxFrame: number
}) {
  const playheadRef = useRef<HTMLDivElement>(null)
  const maxFrameRef = useRef(timelineMaxFrame)
  maxFrameRef.current = timelineMaxFrame
  // Container width is cached so per-frame position updates stay layout-free
  // (getBoundingClientRect forces layout on every playback store change).
  const containerWidthRef = useRef(0)

  const updatePosition = useCallback((frame: number) => {
    const playhead = playheadRef.current
    if (!playhead) return

    if (containerWidthRef.current <= 0) {
      containerWidthRef.current = playhead.parentElement?.getBoundingClientRect().width ?? 0
    }
    const contentWidth = Math.max(0, containerWidthRef.current - timelineInsetPx)
    const maxFrame = Math.max(MIN_TIMELINE_FRAMES, maxFrameRef.current, frame + 1)
    const ratio = maxFrame > 0 ? Math.max(0, Math.min(1, frame / maxFrame)) : 0
    playhead.style.transform = `translate3d(${Math.round(timelineInsetPx + contentWidth * ratio)}px, 0, 0)`
  }, [timelineInsetPx])

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

  useLayoutEffect(() => {
    updatePosition(getDisplayFrame())
  }, [timelineInsetPx, timelineMaxFrame, updatePosition])

  return (
    <div
      ref={playheadRef}
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-0"
      data-testid="color-timeline-playhead"
      aria-hidden="true"
    >
      <span className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.65)]" />
      <span className="absolute left-0 top-0 h-3.5 w-2.5 -translate-x-1/2 rounded-b-[2px] border border-red-300/60 bg-red-500 shadow-[0_0_7px_rgba(239,68,68,0.55)]" />
      <span className="absolute left-0 top-3 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-red-500" />
    </div>
  )
})

const ColorTimelineAnnotations = memo(function ColorTimelineAnnotations({
  model,
  selectedMarkerId,
  onMarkerPress,
}: {
  model: TimelineAnnotationModel
  selectedMarkerId: string | null
  onMarkerPress: (marker: TimelineAnnotationMarker) => void
}) {
  const ioRangeStyle = model.ioRange
    ? {
        left: `${model.ioRange.startRatio * 100}%`,
        width: `${Math.max(0.25, (model.ioRange.endRatio - model.ioRange.startRatio) * 100)}%`,
      }
    : null

  const renderIoPost = (point: TimelineAnnotationModel['inPoint'], side: 'in' | 'out') => {
    if (!point) return null
    return (
      <span
        key={side}
        className="pointer-events-none absolute bottom-0 top-0 z-[22] w-0"
        data-testid={`color-timeline-${side}-point`}
        style={{ left: `${point.positionRatio * 100}%` }}
        title={side === 'in' ? 'In point' : 'Out point'}
      >
        <span
          className="absolute bottom-0 top-0 w-px bg-cyan-200/55"
          style={{ transform: 'translateX(-0.5px)' }}
          aria-hidden="true"
        />
        <span
          className="absolute pointer-events-none"
          data-testid={`color-timeline-${side}-handle`}
          style={{
            top: 0,
            left: side === 'in' ? 0 : -COLOR_IO_HANDLE_WIDTH,
            width: COLOR_IO_HANDLE_WIDTH,
            height: COLOR_IO_LANE_HEIGHT,
            borderRadius: '2px',
            background: `linear-gradient(to bottom, ${COLOR_IO_HANDLE_COLOR}, color-mix(in oklch, ${COLOR_IO_HANDLE_COLOR} 75%, black))`,
            boxShadow: `0 0 6px color-mix(in oklch, ${COLOR_IO_HANDLE_COLOR} 55%, transparent)`,
          }}
          aria-hidden="true"
        />
      </span>
    )
  }

  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 top-0"
      data-testid="color-timeline-annotations"
      style={{ left: MINI_TIMELINE_LABEL_WIDTH }}
    >
      {ioRangeStyle ? (
        <>
          <span
            className="absolute bottom-0 top-0 z-[9]"
            data-testid="color-timeline-io-range"
            style={{
              ...ioRangeStyle,
              backgroundColor: 'oklch(0.50 0.10 220 / 0.16)',
              borderLeft:
                '1px solid color-mix(in oklch, var(--color-timeline-io-range-border) 45%, transparent)',
              borderRight:
                '1px solid color-mix(in oklch, var(--color-timeline-io-range-border) 45%, transparent)',
            }}
          />
          <span
            className="absolute z-[11] rounded-[2px]"
            data-testid="color-timeline-io-strip"
            style={{
              ...ioRangeStyle,
              top: 0,
              height: COLOR_IO_LANE_HEIGHT,
              background:
                'linear-gradient(to bottom, var(--color-timeline-io-range-fill), color-mix(in oklch, var(--color-timeline-io-range-fill) 82%, black))',
              border: '1px solid var(--color-timeline-io-range-border)',
              boxShadow:
                'inset 0 1px 0 color-mix(in oklch, white 22%, transparent), 0 0 8px var(--color-timeline-io-range-glow)',
            }}
          />
        </>
      ) : null}

      {renderIoPost(model.inPoint, 'in')}
      {renderIoPost(model.outPoint, 'out')}

      {model.markers.map((marker) => {
        const selected = selectedMarkerId === marker.id
        return (
          <button
            key={marker.id}
            type="button"
            className="pointer-events-auto absolute bottom-0 top-0 z-[14] w-5 -translate-x-1/2 cursor-pointer"
            data-testid="color-timeline-marker"
            data-marker-id={marker.id}
            style={{ left: `${marker.positionRatio * 100}%` }}
            title={marker.label || `Marker at frame ${marker.frame}`}
            aria-label={marker.label || `Marker at frame ${marker.frame}`}
            onPointerDown={(event) => {
              event.stopPropagation()
              if (event.button !== 0) return
              onMarkerPress(marker)
            }}
            onClick={(event) => {
              event.stopPropagation()
              onMarkerPress(marker)
            }}
          >
            <span
              className={`absolute bottom-0 top-4 left-1/2 w-px -translate-x-1/2 ${
                selected ? 'bg-white' : 'bg-white/45'
              }`}
              aria-hidden="true"
            />
            <span
              className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent drop-shadow"
              style={{ borderTopColor: selected ? '#ffffff' : marker.color }}
              aria-hidden="true"
            />
            {selected ? (
              <span
                className="absolute left-1/2 top-[2px] h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent"
                style={{ borderTopColor: marker.color }}
                aria-hidden="true"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
})

/**
 * Resolve poster thumbnails (the per-media frame captured at import) for clips
 * that carry no inline `thumbnailUrl`. This gives the Color page film tiles a
 * real frame snapshot instead of a flat black/colored placeholder. The media
 * library service caches and owns these blob URLs (revoking on media delete),
 * so we only read them here — never revoke.
 */
function useMediaPosterUrls(mediaIds: readonly string[]): Map<string, string> {
  const [posterUrls, setPosterUrls] = useState<Map<string, string>>(() => new Map())

  // Reactive snapshot of which media have a poster available, so a clip painted
  // before its thumbnail finishes generating re-resolves once it lands.
  const thumbnailIds = useMediaLibraryStore(
    useShallow((s) => {
      const out: Record<string, string | undefined> = {}
      for (const id of mediaIds) {
        out[id] = s.mediaById[id]?.thumbnailId
      }
      return out
    }),
  )

  useEffect(() => {
    const missing = Object.entries(thumbnailIds)
      .filter(([id, thumbnailId]) => thumbnailId && !posterUrls.has(id))
      .map(([id]) => id)
    if (missing.length === 0) return

    let cancelled = false
    void importMediaLibraryService().then(async ({ mediaLibraryService }) => {
      if (cancelled) return
      const entries = await Promise.all(
        missing.map(async (id) => [id, await mediaLibraryService.getThumbnailBlobUrl(id)] as const),
      )
      if (cancelled) return
      setPosterUrls((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [id, url] of entries) {
          if (url && !next.has(id)) {
            next.set(id, url)
            changed = true
          }
        }
        return changed ? next : prev
      })
    })

    return () => {
      cancelled = true
    }
  }, [thumbnailIds, posterUrls])

  return posterUrls
}

/**
 * Extract the frame at a video clip's actual start (DaVinci-style), reusing the
 * shared filmstrip cache (1fps, worker-pooled, deduped per media, disk-cached).
 * Returns null for non-video clips or until the frame lands — callers fall back
 * to the import poster so a tile never flashes black.
 */
function useClipStartFrameUrl(clip: TimelineClip, projectFps: number): string | null {
  const isVideo = clip.type === 'video' && Boolean(clip.mediaId)
  const mediaId = clip.mediaId ?? ''

  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => s.mediaById[mediaId]?.duration ?? 0, [mediaId]),
  )
  const mediaFps = useMediaLibraryStore(
    useCallback((s) => s.mediaById[mediaId]?.fps ?? 0, [mediaId]),
  )

  // Tie the resolved URL to the media it belongs to so a tile reused for a new
  // mediaId (same clip.id, relinked/replaced source) doesn't keep feeding the
  // old blob URL into useFilmstrip — `blobUrl` falls back to null until the new
  // media resolves.
  const [resolved, setResolved] = useState<{ mediaId: string; url: string } | null>(null)
  const blobUrl = resolved?.mediaId === mediaId ? resolved.url : null

  useEffect(() => {
    if (!isVideo || !mediaId || blobUrl) return
    let cancelled = false
    void resolveMediaUrl(mediaId)
      .then((url) => {
        if (!cancelled && url) setResolved({ mediaId, url })
      })
      .catch(() => {
        /* extraction simply stays unavailable; poster fallback remains */
      })
    return () => {
      cancelled = true
    }
  }, [isVideo, mediaId, blobUrl])

  // Source-frame -> seconds, mirroring clip-content's conversion. Prefer the
  // media's real duration (duration-ratio) over source-fps division when known.
  const sourceFps = clip.sourceFps > 0 ? clip.sourceFps : mediaFps > 0 ? mediaFps : 30
  const sourceDurationSeconds =
    mediaDuration > 0 ? mediaDuration : clip.sourceDurationFrames / sourceFps
  const sourceStartSeconds =
    mediaDuration > 0
      ? (clip.sourceStartFrames / clip.sourceDurationFrames) * mediaDuration
      : clip.sourceStartFrames / sourceFps
  const startSeconds = Math.max(
    0,
    sourceStartSeconds + clip.trimStartFrames / Math.max(1, projectFps),
  )
  const startIndex = Math.floor(startSeconds)

  const targetFrameIndices = useMemo(() => [startIndex], [startIndex])
  const priorityWindow = useMemo(
    () => ({ startTime: startSeconds, endTime: startSeconds + 1 }),
    [startSeconds],
  )

  const { frames } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDurationSeconds,
    isVisible: isVideo,
    enabled: isVideo,
    priorityWindow,
    targetFrameIndices,
  })

  return useMemo(() => {
    if (!frames || frames.length === 0) return null
    let best: FilmstripFrame | null = null
    for (const frame of frames) {
      if (!best || Math.abs(frame.index - startIndex) < Math.abs(best.index - startIndex)) {
        best = frame
      }
    }
    return best?.url ?? null
  }, [frames, startIndex])
}

// Largest source dimension to grade at — keeps the GPU pass + readback cheap
// while leaving enough detail for the tile's object-cover crop.
const GRADE_TILE_MAX_DIMENSION = 256
// Coalesce live color-wheel drags into ~10fps GPU renders so a drag doesn't
// queue a readback per pointer frame.
const GRADE_RENDER_DEBOUNCE_MS = 100

function toGpuEffectInstances(effects: readonly ItemEffect[]): GpuEffectInstance[] {
  return effects
    .filter((entry) => entry.enabled && entry.effect.type === 'gpu-effect')
    .map((entry) => {
      const gpu = entry.effect as GpuEffect
      return {
        id: entry.id,
        type: gpu.gpuEffectType,
        name: gpu.gpuEffectType,
        enabled: true,
        params: { ...gpu.params },
      }
    })
}

/**
 * Bake the clip's real GPU grade onto `baseUrl`, returning a graded object URL
 * (or undefined while rendering / when there is nothing to grade / no GPU).
 * Re-renders are debounced so live color-wheel drags don't thrash the readback.
 */
function useGradedTileThumbnail(
  baseUrl: string | undefined,
  instances: GpuEffectInstance[],
): string | undefined {
  const signature = useMemo(() => JSON.stringify(instances), [instances])
  const [gradedUrl, setGradedUrl] = useState<string | undefined>(undefined)

  // Read the latest instances inside the effect without making its array
  // identity a dependency — `signature` is the reactive digest that gates reruns.
  const instancesRef = useRef(instances)
  instancesRef.current = instances

  useEffect(() => {
    const current = instancesRef.current
    if (!baseUrl || current.length === 0) {
      setGradedUrl(undefined)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void renderGradedTileFrame(baseUrl, current, GRADE_TILE_MAX_DIMENSION).then((blob) => {
        if (cancelled || !blob) return
        setGradedUrl(URL.createObjectURL(blob))
      })
    }, GRADE_RENDER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [baseUrl, signature])

  // Revoke the previous URL whenever it is replaced or on unmount.
  useEffect(() => {
    return () => {
      if (gradedUrl) URL.revokeObjectURL(gradedUrl)
    }
  }, [gradedUrl])

  return instances.length > 0 ? gradedUrl : undefined
}

interface ColorFilmTileProps {
  clip: TimelineClip
  index: number
  selected: boolean
  fps: number
  posterUrl?: string
  onSelect: (clip: TimelineClip) => void
}

const ColorFilmTile = memo(function ColorFilmTile({
  clip,
  index,
  selected,
  fps,
  posterUrl,
  onSelect,
}: ColorFilmTileProps) {
  const startFrameUrl = useClipStartFrameUrl(clip, fps)
  const clipNumber = String(index + 1).padStart(2, '0')
  // Prefer the clip's actual start frame; fall back to the import poster (or any
  // stored thumbnail) so the tile shows real content immediately while the
  // start frame extracts.
  const baseUrl = startFrameUrl ?? clip.thumbnailUrl ?? posterUrl

  const gradeInstances = useMemo(() => toGpuEffectInstances(clip.effects), [clip.effects])
  const gradedUrl = useGradedTileThumbnail(baseUrl, gradeInstances)

  // Real GPU grade baked into the frame wins. Until it lands (or when WebGPU is
  // unavailable) show the base frame with the CSS-approximation grade so the
  // tile is never blatantly ungraded.
  const thumbnailUrl = gradedUrl ?? baseUrl
  const showCssGradeFallback = !gradedUrl && clip.gradeThumbnail.hasGrade
  const imageGradeStyle = showCssGradeFallback ? clip.gradeThumbnail.imageStyle : undefined

  return (
    <button
      type="button"
      data-testid="color-timeline-film-tile"
      data-clip-id={clip.id}
      className={`group grid shrink-0 grid-rows-[20px_1fr_16px] overflow-hidden rounded-[3px] border bg-[#17181d] text-left shadow-sm transition-colors ${
        selected
          ? 'border-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.65)]'
          : 'border-zinc-700 hover:border-zinc-500'
      }`}
      style={{ width: FILM_TILE_WIDTH, height: FILM_TILE_HEIGHT }}
      onClick={() => {
        onSelect(clip)
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        onSelect(clip)
      }}
      title={clip.label}
    >
      <span className="flex min-w-0 items-center gap-1 border-b border-black/40 bg-[#24252b] px-1.5 text-[10px] font-semibold text-zinc-200">
        <span
          className={`rounded-[2px] border px-1 leading-3 ${
            selected
              ? 'border-lime-300/80 bg-indigo-700 text-lime-200'
              : 'border-indigo-400/70 bg-zinc-800 text-zinc-200'
          }`}
        >
          {clipNumber}
        </span>
        <span className="font-mono">{formatNavigatorTimecode(clip.from, fps)}</span>
        <span className="ml-auto text-[9px] text-zinc-400">{clip.trackName}</span>
      </span>

      <span className="relative block min-h-0 overflow-hidden bg-black">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            style={imageGradeStyle}
            data-graded-thumbnail={clip.gradeThumbnail.hasGrade ? 'true' : undefined}
            data-grade-source={gradedUrl ? 'gpu' : clip.gradeThumbnail.hasGrade ? 'css' : undefined}
          />
        ) : (
          <span className="block h-full w-full bg-black" style={imageGradeStyle} />
        )}
        {showCssGradeFallback && clip.gradeThumbnail.overlayStyle ? (
          <span
            className="pointer-events-none absolute inset-0"
            data-testid="color-timeline-grade-overlay"
            style={clip.gradeThumbnail.overlayStyle}
          />
        ) : null}
        {clip.gradeThumbnail.hasGrade ? (
          <span
            className="pointer-events-none absolute right-1 top-1 flex h-1.5 w-6 overflow-hidden rounded-full border border-black/45 shadow-sm"
            aria-hidden="true"
          >
            <span className="h-full flex-1 bg-red-500" />
            <span className="h-full flex-1 bg-lime-400" />
            <span className="h-full flex-1 bg-sky-500" />
          </span>
        ) : null}
      </span>

      <span className="truncate border-t border-black/40 bg-[#202127] px-1.5 text-[10px] font-medium text-zinc-300">
        {clip.label}
      </span>
    </button>
  )
})

export const ColorTimelineNavigator = memo(function ColorTimelineNavigator() {
  const { t } = useTranslation()
  const { items, tracks } = useItemsStore(
    useShallow((s) => ({
      items: s.items,
      tracks: s.tracks,
    })),
  )
  const { markers, inPoint, outPoint } = useTimelineStore(
    useShallow((s) => ({
      markers: s.markers,
      inPoint: s.inPoint,
      outPoint: s.outPoint,
    })),
  )
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const pausePlayback = usePlaybackStore((s) => s.pause)
  const fps = useTimelineStore((s) => s.fps)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const selectMarker = useSelectionStore((s) => s.selectMarker)
  const livePreviewEdits = useGizmoStore((s) => s.preview)
  const isScrubbingRef = useRef(false)
  // Scrub gesture state: rect is captured once on pointer down (no layout reads
  // per move), commits are rAF-batched and gated by the same adaptive throttle
  // the Edit-workspace playhead uses.
  const scrubRectRef = useRef<DOMRect | null>(null)
  const scrubThrottleRef = useRef(createScrubThrottleState())
  const pendingClientXRef = useRef<number | null>(null)
  const scrubRafRef = useRef<number | null>(null)

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const videoTrackRows = useMemo(
    () => tracks.filter(isNavigatorVideoTrack).sort((a, b) => a.order - b.order),
    [tracks],
  )
  const trackLaneIndexById = useMemo(
    () => new Map(videoTrackRows.map((track, index) => [track.id, index])),
    [videoTrackRows],
  )
  const trackNameById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track.name || track.id])),
    [tracks],
  )
  const visualClips = useMemo<TimelineClip[]>(
    () =>
      items
        .filter(isVisualNavigatorItem)
        .map((item) => ({
          id: item.id,
          type: item.type,
          label: getNavigatorLabel(item),
          trackId: item.trackId,
          trackName: trackNameById.get(item.trackId) ?? 'V1',
          mediaId: item.mediaId,
          from: item.from,
          durationInFrames: item.durationInFrames,
          sourceStartFrames: Math.max(0, item.sourceStart ?? 0),
          sourceDurationFrames: Math.max(1, item.sourceDuration ?? item.durationInFrames),
          sourceFps: item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps,
          trimStartFrames: item.trimStart ?? 0,
          thumbnailUrl: getThumbnailUrl(item),
          effects: livePreviewEdits?.[item.id]?.effects ?? item.effects ?? [],
          gradeThumbnail: resolveColorGradeThumbnailTreatment(
            livePreviewEdits?.[item.id]?.effects ?? item.effects,
          ),
        }))
        .sort((a, b) => a.from - b.from || a.trackId.localeCompare(b.trackId)),
    [items, livePreviewEdits, trackNameById, fps],
  )
  const posterMediaIds = useMemo(
    () =>
      Array.from(
        new Set(visualClips.map((clip) => clip.mediaId).filter((id): id is string => Boolean(id))),
      ),
    [visualClips],
  )
  const posterUrls = useMediaPosterUrls(posterMediaIds)
  const timelineMaxFrame = resolveTimelineMaxFrame({ items, markers, inPoint, outPoint })
  const annotationModel = useMemo(
    () => buildTimelineAnnotationModel({ markers, inPoint, outPoint, maxFrame: timelineMaxFrame }),
    [inPoint, markers, outPoint, timelineMaxFrame],
  )

  const clientXToFrame = useCallback(
    (clientX: number): number | null => {
      const rect = scrubRectRef.current
      if (!rect || rect.width <= 0) return null
      const timelineWidth = Math.max(1, rect.width - MINI_TIMELINE_LABEL_WIDTH)
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left - MINI_TIMELINE_LABEL_WIDTH) / timelineWidth),
      )
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
      const timelineWidth = Math.max(1, rect.width - MINI_TIMELINE_LABEL_WIDTH)
      const navigatorPixelsPerSecond = (timelineWidth * (fps > 0 ? fps : 30)) / timelineMaxFrame
      if (
        shouldCommitScrubFrame({
          state: scrubThrottleRef.current,
          pointerX: clientX - rect.left - MINI_TIMELINE_LABEL_WIDTH,
          targetFrame: frame,
          pixelsPerSecond: navigatorPixelsPerSecond,
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
        pointerX: event.clientX - scrubRectRef.current.left - MINI_TIMELINE_LABEL_WIDTH,
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

  const handleScrubMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      pendingClientXRef.current = event.clientX
    },
    [],
  )

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

  const seekToClip = useCallback(
    (clip: TimelineClip) => {
      pausePlayback()
      setPreviewFrame(null)
      setCurrentFrame(clip.from)
      selectItems([clip.id])
    },
    [pausePlayback, selectItems, setCurrentFrame, setPreviewFrame],
  )

  const seekToMarker = useCallback(
    (marker: TimelineAnnotationMarker) => {
      pausePlayback()
      setPreviewFrame(null)
      setCurrentFrame(marker.frame)
      selectMarker(marker.id)
    },
    [pausePlayback, selectMarker, setCurrentFrame, setPreviewFrame],
  )

  const renderTimelineClip = (clip: TimelineClip) => {
    const selected = selectedItemIdSet.has(clip.id)
    const rowCount = Math.max(1, videoTrackRows.length)
    const rowHeight = MINI_TIMELINE_TRACK_AREA_HEIGHT / rowCount
    const laneIndex = trackLaneIndexById.get(clip.trackId) ?? 0
    const clipHeight =
      rowHeight >= 10 ? Math.max(8, Math.min(16, rowHeight - 4)) : Math.max(4, rowHeight - 2)
    const clipTop = laneIndex * rowHeight + Math.max(1, (rowHeight - clipHeight) / 2)
    return (
      <button
        key={`${clip.id}-timeline`}
        type="button"
        data-testid="color-timeline-mini-clip"
        data-track-id={clip.trackId}
        className={`absolute overflow-hidden rounded-[2px] border text-left transition-colors ${
          selected
            ? 'border-orange-500 bg-orange-500/20 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
            : 'border-sky-500/70 bg-sky-500/45 hover:border-sky-300'
        }`}
        style={{
          left: `${(clip.from / timelineMaxFrame) * 100}%`,
          width: `${Math.max(0.6, (clip.durationInFrames / timelineMaxFrame) * 100)}%`,
          minWidth: 16,
          top: clipTop,
          height: clipHeight,
        }}
        onClick={(event) => {
          event.stopPropagation()
          seekToClip(clip)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title={clip.label}
        aria-label={clip.label}
      />
    )
  }

  return (
    <section
      className="panel-bg shrink-0 overflow-hidden border-y border-border bg-[#24252b]"
      aria-label={t('editor.colorTimeline.label')}
      data-testid="color-timeline-navigator"
      style={{ height: STRIP_HEIGHT }}
    >
      <div className="flex h-full flex-col">
        <div
          className="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-black/40 px-1 pt-1"
          data-testid="color-timeline-filmstrip-scroll"
          style={{ height: FILM_TILE_STRIP_HEIGHT, paddingBottom: FILM_TILE_SCROLLBAR_GUTTER }}
        >
          {visualClips.length > 0 ? (
            visualClips.map((clip, index) => (
              <ColorFilmTile
                key={`${clip.id}-film-tile`}
                clip={clip}
                index={index}
                selected={selectedItemIdSet.has(clip.id)}
                fps={fps}
                posterUrl={clip.mediaId ? posterUrls.get(clip.mediaId) : undefined}
                onSelect={seekToClip}
              />
            ))
          ) : (
            <div className="flex h-full items-center px-2 text-[10px] font-medium text-zinc-500">
              {t('editor.colorTimeline.noClip')}
            </div>
          )}
        </div>

        <div
          className="relative min-h-0 flex-1 cursor-ew-resize bg-[#1d1e23]"
          data-testid="color-timeline-scrub-surface"
          onPointerDown={handleScrubStart}
          onPointerMove={handleScrubMove}
          onPointerUp={finishScrub}
          onPointerCancel={cancelScrub}
        >
          <ColorTimelineAnnotations
            model={annotationModel}
            selectedMarkerId={selectedMarkerId}
            onMarkerPress={seekToMarker}
          />
          <div className="relative h-5 border-b border-black/40">
            <div
              className="absolute inset-y-0 right-0"
              style={{ left: MINI_TIMELINE_LABEL_WIDTH }}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <div
                  key={ratio}
                  className="absolute top-0 h-full border-l border-zinc-500/45 pl-1 pt-0.5 text-[10px] text-zinc-500"
                  style={{ left: `${ratio * 100}%` }}
                >
                  {formatNavigatorTime(Math.round(ratio * timelineMaxFrame), fps)}
                </div>
              ))}
            </div>
          </div>
          <div className="relative" style={{ height: MINI_TIMELINE_TRACK_AREA_HEIGHT }}>
            <div
              className="absolute left-0 top-0 h-full border-r border-black/35 text-[9px] font-semibold text-zinc-400"
              style={{ width: MINI_TIMELINE_LABEL_WIDTH }}
            >
              {videoTrackRows.length > 0 ? (
                videoTrackRows.map((track, index) => {
                  const rowCount = Math.max(1, videoTrackRows.length)
                  const rowHeight = MINI_TIMELINE_TRACK_AREA_HEIGHT / rowCount
                  return (
                    <span
                      key={track.id}
                      className="absolute left-0 flex w-full items-center justify-center overflow-hidden leading-none"
                      style={{ top: index * rowHeight, height: rowHeight }}
                    >
                      {track.name || `V${index + 1}`}
                    </span>
                  )
                })
              ) : (
                <span className="flex h-full items-center justify-center">V1</span>
              )}
            </div>
            <div
              className="absolute inset-y-0 right-0"
              style={{ left: MINI_TIMELINE_LABEL_WIDTH }}
            >
              {videoTrackRows.map((track, index) => {
                const rowCount = Math.max(1, videoTrackRows.length)
                const rowHeight = MINI_TIMELINE_TRACK_AREA_HEIGHT / rowCount
                return (
                  <div
                    key={track.id}
                    className="absolute left-0 right-0 border-t border-zinc-700/70"
                    style={{ top: index * rowHeight }}
                  />
                )
              })}
              {visualClips.map(renderTimelineClip)}
            </div>
          </div>
          <ColorTimelinePlayhead
            timelineInsetPx={MINI_TIMELINE_LABEL_WIDTH}
            timelineMaxFrame={timelineMaxFrame}
          />
        </div>
      </div>
    </section>
  )
})
