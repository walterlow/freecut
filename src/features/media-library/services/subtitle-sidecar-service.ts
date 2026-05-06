import { useProjectStore } from '@/features/media-library/deps/projects'
import { useTimelineStore } from '@/features/media-library/deps/timeline-stores'
import { useSelectionStore } from '@/shared/state/selection'
import {
  extractMatroskaTextSubtitleTracksFromBlob,
  type EmbeddedSubtitleTrack,
} from '@/shared/utils/matroska-subtitles'
import { getEmbeddedSubtitleSidecar, saveEmbeddedSubtitleSidecar } from '@/infrastructure/storage'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  buildCaptionTrack,
  buildSubtitleSegmentForClip,
  consolidateCaptionTextItemsToSegments,
  findCaptionTargetClipsForMedia,
  findCompatibleCaptionTrackForRanges,
} from '../utils/caption-items'

export interface ExtractEmbeddedSubtitlesResult {
  insertedItemCount: number
  cueCount: number
  trackLabel: string
}

export interface EmbeddedSubtitleScanResult {
  tracks: readonly EmbeddedSubtitleTrack[]
  scannedAt: number
  fromCache: boolean
}

export interface SubtitleScanProgressInfo {
  bytesRead: number
  totalBytes: number
  clusters: number
}

export interface SubtitleScanOptions {
  onProgress?: (info: SubtitleScanProgressInfo) => void
  signal?: AbortSignal
}

class SubtitleSidecarService {
  /**
   * Walk the source bytes for `media` and return its embedded text-subtitle
   * tracks. Cached in workspace-fs after the first scan so re-opening the
   * picker is instant. Cache is invalidated when the source's `fileSize`
   * (or `lastModified`, when available) changes.
   *
   * `onProgress` fires periodically during the parse with read/total bytes;
   * `signal` aborts mid-scan.
   */
  async scanEmbeddedSubtitleTracks(
    media: MediaMetadata,
    file: Blob,
    options: SubtitleScanOptions = {},
  ): Promise<EmbeddedSubtitleScanResult> {
    const fingerprint = {
      fileSize: file.size,
      fileLastModified: file instanceof File ? file.lastModified : undefined,
    }
    const cached = await getEmbeddedSubtitleSidecar(media.id, fingerprint)
    if (cached) {
      // Surface a single 100% tick so callers showing a progress bar can
      // settle their UI even when we short-circuit the parse.
      options.onProgress?.({ bytesRead: file.size, totalBytes: file.size, clusters: 0 })
      return { tracks: cached.tracks, scannedAt: cached.scannedAt, fromCache: true }
    }

    const tracks = await extractMatroskaTextSubtitleTracksFromBlob(file, {
      onProgress: options.onProgress,
      signal: options.signal,
    })
    let scannedAt = Date.now()
    if (tracks.length > 0) {
      const saved = await saveEmbeddedSubtitleSidecar(media.id, fingerprint, tracks).catch(
        () => null,
      )
      if (saved) scannedAt = saved.scannedAt
    }
    return { tracks, scannedAt, fromCache: false }
  }

  /**
   * Insert a specific embedded subtitle track's cues on the timeline as one
   * {@link SubtitleSegmentItem} per clip. Any existing subtitle segment
   * already attached to a target clip (via `captionSource.clipId`) is
   * removed first so the user gets a single, current segment per clip
   * instead of stacking duplicates each time they re-extract.
   */
  insertEmbeddedSubtitleTrack(
    media: MediaMetadata,
    track: EmbeddedSubtitleTrack,
  ): ExtractEmbeddedSubtitlesResult {
    const trackLabel = formatEmbeddedSubtitleTrackLabel(track)
    const inserted = this.insertSubtitleCuesAsSegmentForMedia(media, track, trackLabel)
    return {
      insertedItemCount: inserted,
      cueCount: track.cues.length,
      trackLabel,
    }
  }

  private insertSubtitleCuesAsSegmentForMedia(
    media: MediaMetadata,
    track: EmbeddedSubtitleTrack,
    trackLabel: string,
  ): number {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080
    const clips = findCaptionTargetClipsForMedia(timeline.items, media.id)
    if (clips.length === 0) return 0

    // Drop any subtitle segments already attached to one of the target
    // clips so the user ends up with one segment per clip instead of
    // stacking a new layer on top with each re-extract. We also clean up
    // legacy per-cue caption text items linked to those same clipIds —
    // they'd otherwise sit underneath the new segment with stale text.
    const clipIdSet = new Set(clips.map((c) => c.id))
    const obsoleteIds = timeline.items
      .filter((item) => isSubtitleForClip(item, clipIdSet))
      .map((item) => item.id)

    const segments: import('@/types/timeline').SubtitleSegmentItem[] = []
    for (const clip of clips) {
      const segment = buildSubtitleSegmentForClip({
        trackId: clip.trackId,
        cues: track.cues,
        clip,
        timelineFps: timeline.fps,
        canvasWidth,
        canvasHeight,
        label: `${media.fileName} — ${trackLabel}`,
        source: {
          type: 'embedded-subtitles',
          mediaId: media.id,
          clipId: clip.id,
          trackNumber: track.trackNumber,
          language: track.language,
          trackName: track.name,
          codecId: track.codecId,
          importedAt: Date.now(),
        },
      })
      if (segment) segments.push(segment)
    }
    if (segments.length === 0) {
      // Nothing new to insert; still remove the obsolete entries so a
      // re-extract that produced no usable cues at least clears the stale
      // segment instead of leaving the user looking at outdated text.
      if (obsoleteIds.length > 0) timeline.removeItems(obsoleteIds)
      return 0
    }

    if (obsoleteIds.length > 0) timeline.removeItems(obsoleteIds)

    // Pick a single track that can host every segment's range so captions
    // stay on one row rather than scattering across several.
    const ranges = segments.map((s) => ({
      startFrame: s.from,
      endFrame: s.from + s.durationInFrames,
    }))
    let nextTracks: TimelineTrack[] = [...timeline.tracks]
    // After removing the obsolete items, look up the timeline state again so
    // findCompatibleCaptionTrackForRanges sees the post-removal items.
    const refreshed = useTimelineStore.getState()
    let target = findCompatibleCaptionTrackForRanges(nextTracks, refreshed.items, ranges)
    if (!target) {
      target = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, target].sort((a, b) => a.order - b.order)
      refreshed.setTracks(nextTracks)
    }
    const placedSegments = segments.map((segment) => ({ ...segment, trackId: target.id }))

    refreshed.addItems(placedSegments)
    useSelectionStore.getState().selectItems(placedSegments.map((s) => s.id))
    return placedSegments.length
  }

  /**
   * One-shot migration: collapse all per-cue caption text items for the
   * given clip (or every clip, if no clipId is provided) into a single
   * {@link SubtitleSegmentItem} per clip group.
   *
   * Returns the number of segments created and the total cue count packed
   * into them. Caller-side undo/redo is handled by the timeline command
   * boundary that wraps the addItems/removeItems pair.
   */
  consolidatePerCueCaptionsToSegments(options: { clipId?: string } = {}): {
    segmentsCreated: number
    cuesConsolidated: number
  } {
    const timeline = useTimelineStore.getState()
    const { segments, consumedItemIds } = consolidateCaptionTextItemsToSegments(
      timeline.items,
      timeline.fps,
      { onlyClipId: options.clipId },
    )
    if (segments.length === 0) return { segmentsCreated: 0, cuesConsolidated: 0 }

    timeline.removeItems(consumedItemIds)
    timeline.addItems(segments)
    useSelectionStore.getState().selectItems(segments.map((s) => s.id))
    return {
      segmentsCreated: segments.length,
      cuesConsolidated: segments.reduce((sum, s) => sum + s.cues.length, 0),
    }
  }
}

/**
 * Treat a timeline item as "the existing subtitle for one of `clipIds`"
 * if it's either:
 *  - a {@link SubtitleSegmentItem} whose source.clipId matches, or
 *  - a legacy per-cue caption text item linked to that clipId via
 *    `captionSource.clipId`.
 *
 * Both shapes get cleared on re-extract so the user always sees a single,
 * fresh subtitle entity per clip.
 */
function isSubtitleForClip(item: TimelineItem, clipIds: ReadonlySet<string>): boolean {
  if (item.type === 'subtitle') {
    return item.source.type === 'embedded-subtitles' && clipIds.has(item.source.clipId)
  }
  if (item.type !== 'text') return false
  const source = item.captionSource
  return (
    source !== undefined &&
    (source.type === 'embedded-subtitles' || source.type === 'subtitle-import') &&
    clipIds.has(source.clipId)
  )
}

export const subtitleSidecarService = new SubtitleSidecarService()

export function chooseEmbeddedSubtitleTrackForMedia(
  tracks: readonly EmbeddedSubtitleTrack[],
): EmbeddedSubtitleTrack | null {
  return chooseEmbeddedSubtitleTrack(tracks)
}

export function getEmbeddedSubtitleTrackLabel(track: EmbeddedSubtitleTrack): string {
  return formatEmbeddedSubtitleTrackLabel(track)
}

function chooseEmbeddedSubtitleTrack(
  tracks: readonly EmbeddedSubtitleTrack[],
): EmbeddedSubtitleTrack | null {
  return (
    tracks.find((track) => track.forced) ??
    tracks.find((track) => track.default) ??
    tracks.find((track) => /^en(?:g|[-_]|$)/i.test(track.language)) ??
    tracks[0] ??
    null
  )
}

function formatEmbeddedSubtitleTrackLabel(track: EmbeddedSubtitleTrack): string {
  const parts = [track.name, track.language !== 'und' ? track.language : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : `Track ${track.trackNumber}`
}
