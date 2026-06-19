import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { getDefaultActiveTrackId } from '@/features/editor/deps/timeline-utils'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import {
  buildTimelineAnnotationModel,
  type TimelineAnnotationMarker,
} from '@/shared/timeline/timeline-annotations'
import type { TimelineItem } from '@/types/timeline'
import {
  formatMiniTimelineTimecode,
  MiniFilmTile,
  MiniTimelineAnnotations,
  MiniTimelineIoLane,
  MiniTimelinePlayhead,
  MiniTimelineRuler,
  MiniTimelineTrackLanes,
  resolveMiniTimelineMaxFrame,
  useClipStartFrameUrl,
  useMediaPosterUrls,
  useMiniTimelineScrub,
  MINI_FILM_TILE_SCROLLBAR_GUTTER,
  MINI_FILM_TILE_STRIP_HEIGHT,
  MINI_TIMELINE_IO_LANE_HEIGHT,
  MINI_TIMELINE_LABEL_WIDTH,
  MINI_TIMELINE_RULER_HEIGHT,
  type MiniFilmTileClip,
  type MiniTimelineClip,
} from '@/features/editor/components/mini-timeline'

const TEST_ID_PREFIX = 'animate-timeline'
const STRIP_HEIGHT = 212
const TRACK_AREA_HEIGHT =
  STRIP_HEIGHT -
  MINI_FILM_TILE_STRIP_HEIGHT -
  MINI_TIMELINE_IO_LANE_HEIGHT -
  MINI_TIMELINE_RULER_HEIGHT

/** Film-tile clip carrying its track id so the same list feeds the mini lanes. */
interface AnimateClip extends MiniFilmTileClip {
  trackId: string
}

function getStripLabel(item: TimelineItem): string {
  const label = item.label.trim()
  return label || item.type
}

function getThumbnailUrl(item: TimelineItem): string | undefined {
  return 'thumbnailUrl' in item ? item.thumbnailUrl : undefined
}

interface AnimateFilmTileProps {
  clip: AnimateClip
  index: number
  selected: boolean
  fps: number
  posterUrl?: string
  onSelect: (clip: AnimateClip) => void
}

/** Plain film tile (no grade baking) over the shared {@link MiniFilmTile}. */
const AnimateFilmTile = memo(function AnimateFilmTile({
  clip,
  index,
  selected,
  fps,
  posterUrl,
  onSelect,
}: AnimateFilmTileProps) {
  const startFrameUrl = useClipStartFrameUrl(clip, fps)
  const thumbnailUrl = startFrameUrl ?? clip.thumbnailUrl ?? posterUrl
  return (
    <MiniFilmTile
      index={index}
      label={clip.label}
      trackName={clip.trackName}
      timecodeText={formatMiniTimelineTimecode(clip.from, fps)}
      thumbnailUrl={thumbnailUrl}
      selected={selected}
      onSelect={() => onSelect(clip)}
      testId={`${TEST_ID_PREFIX}-film-tile`}
      dataClipId={clip.id}
    />
  )
})

/**
 * Animate workspace timeline: the same composable mini timeline the Color
 * workspace uses (film-tile row + IO bar + annotations + ruler + track lanes +
 * self-tracking playhead). Picking a tile or mini-clip selects the animation
 * target and seeks to its start; scrubbing the surface skims the shared
 * playhead so the preview and keyframe editors stay in sync.
 */
export const AnimateTimelineStrip = memo(function AnimateTimelineStrip() {
  const { t } = useTranslation()
  const { items, tracks } = useItemsStore(useShallow((s) => ({ items: s.items, tracks: s.tracks })))
  const { fps, markers, inPoint, outPoint } = useTimelineStore(
    useShallow((s) => ({
      fps: s.fps,
      markers: s.markers,
      inPoint: s.inPoint,
      outPoint: s.outPoint,
    })),
  )
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const pausePlayback = usePlaybackStore((s) => s.pause)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const selectMarker = useSelectionStore((s) => s.selectMarker)
  // Set while an IO drag is active so the playhead stops chasing the preview.
  const suppressPlayheadPreviewRef = useRef(false)

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const trackRows = useMemo(
    () => tracks.filter((track) => !track.isGroup).sort((a, b) => a.order - b.order),
    [tracks],
  )
  const trackNameById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track.name || track.id])),
    [tracks],
  )
  const filmClips = useMemo<AnimateClip[]>(
    () =>
      items
        .filter((item) => item.type !== 'subtitle')
        .map((item) => ({
          id: item.id,
          type: item.type,
          label: getStripLabel(item),
          trackName: trackNameById.get(item.trackId) ?? 'T1',
          mediaId: item.mediaId,
          from: item.from,
          durationInFrames: item.durationInFrames,
          sourceStartFrames: Math.max(0, item.sourceStart ?? 0),
          sourceDurationFrames: Math.max(1, item.sourceDuration ?? item.durationInFrames),
          sourceFps: item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps,
          trimStartFrames: item.trimStart ?? 0,
          thumbnailUrl: getThumbnailUrl(item),
          trackId: item.trackId,
        }))
        .sort((a, b) => a.from - b.from || a.trackId.localeCompare(b.trackId)),
    [items, trackNameById, fps],
  )
  const miniClips = useMemo<MiniTimelineClip[]>(
    () =>
      filmClips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        from: clip.from,
        durationInFrames: clip.durationInFrames,
        label: clip.label,
      })),
    [filmClips],
  )
  // Linked-audio companions (the A1 half of a V1 clip) have no visual frame to
  // animate. Map each companion to its visual partner so the audio lane stays
  // visible for context but stops acting as a standalone animation target.
  const { companionIds, companionToVisualId } = useMemo(() => {
    const ids = new Set<string>()
    const toVisual = new Map<string, string>()
    for (const item of items) {
      if (item.type !== 'video' && item.type !== 'composition') continue
      const audio = getLinkedAudioCompanion(items, item)
      if (!audio) continue
      ids.add(audio.id)
      toVisual.set(audio.id, item.id)
    }
    return { companionIds: ids, companionToVisualId: toVisual }
  }, [items])
  // The film-tile row only carries primary (animatable) clips — the audio
  // companion would just render a labelled black box.
  const tileClips = useMemo(
    () => filmClips.filter((clip) => !companionIds.has(clip.id)),
    [filmClips, companionIds],
  )
  const frameById = useMemo(() => new Map(items.map((item) => [item.id, item.from])), [items])
  const posterMediaIds = useMemo(
    () =>
      Array.from(
        new Set(tileClips.map((clip) => clip.mediaId).filter((id): id is string => Boolean(id))),
      ),
    [tileClips],
  )
  const posterUrls = useMediaPosterUrls(posterMediaIds)
  const timelineMaxFrame = resolveMiniTimelineMaxFrame({ items, markers, inPoint, outPoint })
  const annotationModel = useMemo(
    () => buildTimelineAnnotationModel({ markers, inPoint, outPoint, maxFrame: timelineMaxFrame }),
    [inPoint, markers, outPoint, timelineMaxFrame],
  )

  const scrubHandlers = useMiniTimelineScrub({
    maxFrame: timelineMaxFrame,
    fps,
    labelWidth: MINI_TIMELINE_LABEL_WIDTH,
  })

  const selectClip = useCallback(
    (clip: { id: string; from: number }) => {
      // A muted audio-companion bar forwards to its visual partner so the
      // keyframe editor always opens on an animatable clip.
      const targetId = companionToVisualId.get(clip.id) ?? clip.id
      const targetFrom = frameById.get(targetId) ?? clip.from
      pausePlayback()
      setPreviewFrame(null)
      setCurrentFrame(targetFrom)
      selectItems([targetId])
    },
    [companionToVisualId, frameById, pausePlayback, selectItems, setCurrentFrame, setPreviewFrame],
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

  // Auto-select a default clip on first mount with nothing selected so the
  // keyframe editor doesn't open on its empty state. Targets V1 (the default
  // active track) and its earliest clip, falling back to the earliest clip
  // anywhere. Runs once: a later deliberate deselect is left alone.
  const hasAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (hasAutoSelectedRef.current) return
    if (selectedItemIds.length > 0) {
      hasAutoSelectedRef.current = true
      return
    }
    if (tileClips.length === 0) return // items not loaded yet — retry when they arrive
    const v1TrackId = getDefaultActiveTrackId(tracks)
    const target = tileClips.find((clip) => clip.trackId === v1TrackId) ?? tileClips[0]
    if (!target) return
    hasAutoSelectedRef.current = true
    selectItems([target.id])
  }, [tileClips, selectedItemIds, selectItems, tracks])

  return (
    <section
      className="panel-bg shrink-0 overflow-hidden border-b border-border bg-[#24252b]"
      aria-label={t('editor.animateTimeline.label')}
      data-testid="animate-timeline-strip"
      style={{ height: STRIP_HEIGHT }}
    >
      <div className="flex h-full flex-col">
        <div
          className="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-black/40 px-1 pt-1"
          data-testid="animate-timeline-filmstrip-scroll"
          style={{
            height: MINI_FILM_TILE_STRIP_HEIGHT,
            paddingBottom: MINI_FILM_TILE_SCROLLBAR_GUTTER,
          }}
        >
          {tileClips.length > 0 ? (
            tileClips.map((clip, index) => (
              <AnimateFilmTile
                key={`${clip.id}-film-tile`}
                clip={clip}
                index={index}
                selected={selectedItemIdSet.has(clip.id)}
                fps={fps}
                posterUrl={clip.mediaId ? posterUrls.get(clip.mediaId) : undefined}
                onSelect={selectClip}
              />
            ))
          ) : (
            <div className="flex h-full items-center px-2 text-[10px] font-medium text-zinc-500">
              {t('editor.animateTimeline.noClip')}
            </div>
          )}
        </div>

        <div
          className="relative flex min-h-0 flex-1 cursor-ew-resize flex-col bg-[#1d1e23]"
          data-testid="animate-timeline-scrub-surface"
          {...scrubHandlers}
        >
          <div
            className="relative shrink-0 border-b border-black/40 bg-[#202127]"
            style={{ height: MINI_TIMELINE_IO_LANE_HEIGHT }}
          >
            <MiniTimelineIoLane
              model={annotationModel}
              timelineMaxFrame={timelineMaxFrame}
              labelWidth={MINI_TIMELINE_LABEL_WIDTH}
              suppressPlayheadPreviewRef={suppressPlayheadPreviewRef}
              testIdPrefix={TEST_ID_PREFIX}
            />
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MiniTimelineAnnotations
              model={annotationModel}
              selectedMarkerId={selectedMarkerId}
              onMarkerPress={seekToMarker}
              labelWidth={MINI_TIMELINE_LABEL_WIDTH}
              testIdPrefix={TEST_ID_PREFIX}
            />
            <MiniTimelineRuler
              labelWidth={MINI_TIMELINE_LABEL_WIDTH}
              maxFrame={timelineMaxFrame}
              fps={fps}
            />
            <MiniTimelineTrackLanes
              tracks={trackRows}
              clips={miniClips}
              selectedIds={selectedItemIdSet}
              maxFrame={timelineMaxFrame}
              trackAreaHeight={TRACK_AREA_HEIGHT}
              labelWidth={MINI_TIMELINE_LABEL_WIDTH}
              onSelectClip={selectClip}
              fallbackLabelPrefix="T"
              clipTestId="animate-timeline-clip"
              mutedClipIds={companionIds}
            />
            <MiniTimelinePlayhead
              labelWidth={MINI_TIMELINE_LABEL_WIDTH}
              maxFrame={timelineMaxFrame}
              handle="flag"
              suppressPreviewRef={suppressPlayheadPreviewRef}
              testId="animate-timeline-playhead"
            />
          </div>
        </div>
      </div>
    </section>
  )
})
