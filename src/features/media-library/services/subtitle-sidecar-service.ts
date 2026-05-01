import { useProjectStore } from '@/features/media-library/deps/projects'
import { useTimelineStore } from '@/features/media-library/deps/timeline-stores'
import { useSelectionStore } from '@/shared/state/selection'
import {
  inferSubtitleFormat,
  parseSubtitleFile,
  serializeSubtitleFile,
  type SubtitleCue,
  type SubtitleFormat,
} from '@/shared/utils/subtitles'
import {
  extractMatroskaTextSubtitleTracksFromBlob,
  type EmbeddedSubtitleTrack,
} from '@/shared/utils/matroska-subtitles'
import { getEmbeddedSubtitleSidecar, saveEmbeddedSubtitleSidecar } from '@/infrastructure/storage'
import type { MediaMetadata } from '@/types/storage'
import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  buildCaptionTrack,
  buildSubtitleSegmentForClip,
  consolidateCaptionTextItemsToSegments,
  findCaptionTargetClipsForMedia,
  findCompatibleCaptionTrackForRanges,
} from '../utils/caption-items'
import { mediaLibraryService } from './media-library-service'

export interface ImportSubtitleResult {
  insertedItemCount: number
  warningCount: number
  warnings: string[]
}

export interface ExportSubtitleOptions {
  format: SubtitleFormat
  selectedOnly?: boolean
}

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
  async importSubtitleFile(file: File): Promise<ImportSubtitleResult> {
    const format = inferSubtitleFormat(file.name)
    if (!format) {
      throw new Error('Choose an SRT or WebVTT subtitle file.')
    }

    const text = await file.text()
    const result = parseSubtitleFile(text, format)
    if (result.cues.length === 0) {
      throw new Error(
        result.warnings[0] ?? 'No valid subtitle cues were found in the selected file.',
      )
    }

    const insertedItemCount = this.insertImportedCuesAsSegment(result.cues, file.name, format)

    return {
      insertedItemCount,
      warningCount: result.warnings.length,
      warnings: result.warnings,
    }
  }

  private insertImportedCuesAsSegment(
    cues: readonly SubtitleCue[],
    fileName: string,
    format: SubtitleFormat,
  ): number {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080
    const startFrame = timeline.inPoint ?? 0

    // Drop any prior SRT/VTT-imported subtitle segments so a re-import
    // replaces rather than stacks. Embedded-subtitle segments are left
    // alone — they belong to a clip and aren't conceptually the same
    // as a free-standing imported subtitle file.
    const obsoleteIds = timeline.items
      .filter((item) => item.type === 'subtitle' && item.source.type === 'subtitle-import')
      .map((item) => item.id)
    if (obsoleteIds.length > 0) timeline.removeItems(obsoleteIds)

    // Imported subtitles have no clip to anchor to — synthesize a segment
    // anchored to the playhead/in-point covering the full cue range.
    const minStart = Math.min(...cues.map((c) => c.startSeconds), 0)
    const lastEnd = Math.max(...cues.map((c) => c.endSeconds), 1)
    const durationInFrames = Math.max(1, Math.ceil((lastEnd - minStart) * timeline.fps))

    const segmentRelativeCues = cues.map((cue) => ({
      id: cue.id,
      startSeconds: cue.startSeconds - minStart,
      endSeconds: cue.endSeconds - minStart,
      text: cue.text,
    }))

    const segmentItem: import('@/types/timeline').SubtitleSegmentItem = {
      id: crypto.randomUUID(),
      type: 'subtitle',
      trackId: '', // filled in below
      from: startFrame + Math.floor(minStart * timeline.fps),
      durationInFrames,
      label: fileName,
      source: { type: 'subtitle-import', fileName, format, importedAt: Date.now() },
      cues: segmentRelativeCues,
      // Defaults mirror the per-cue path so the strip looks consistent.
      fontSize: Math.max(36, Math.round(canvasHeight * 0.045)),
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textShadow: { offsetX: 0, offsetY: 3, blur: 10, color: 'rgba(0, 0, 0, 0.75)' },
      transform: {
        x: 0,
        y: Math.round(canvasHeight * 0.32),
        width: canvasWidth * 0.82,
        height: canvasHeight * 0.16,
        rotation: 0,
        opacity: 1,
      },
    }

    // Read the post-removal timeline state so target-track selection sees
    // freed-up rows that the now-deleted import segment was occupying.
    const refreshed = useTimelineStore.getState()
    const ranges = [{ startFrame: segmentItem.from, endFrame: segmentItem.from + durationInFrames }]
    let nextTracks: TimelineTrack[] = [...refreshed.tracks]
    let target = findCompatibleCaptionTrackForRanges(nextTracks, refreshed.items, ranges)
    if (!target) {
      target = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, target].sort((a, b) => a.order - b.order)
      refreshed.setTracks(nextTracks)
    }
    segmentItem.trackId = target.id

    refreshed.addItems([segmentItem])
    useSelectionStore.getState().selectItems([segmentItem.id])
    return 1
  }

  async extractEmbeddedSubtitlesAsCaptions(
    media: MediaMetadata,
  ): Promise<ExtractEmbeddedSubtitlesResult> {
    const file = await mediaLibraryService.getMediaFile(media.id)
    if (!file) {
      throw new Error(`Media file "${media.fileName}" is unavailable.`)
    }

    return this.extractEmbeddedSubtitlesFromBlobAsCaptions(media, file)
  }

  async extractEmbeddedSubtitlesFromBlobAsCaptions(
    media: MediaMetadata,
    file: Blob,
  ): Promise<ExtractEmbeddedSubtitlesResult> {
    const { tracks } = await this.scanEmbeddedSubtitleTracks(media, file)
    const selectedTrack = chooseEmbeddedSubtitleTrack(tracks)
    if (!selectedTrack) {
      throw new Error(NO_EMBEDDED_SUBTITLES_MESSAGE)
    }
    return this.insertEmbeddedSubtitleTrack(media, selectedTrack)
  }

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

  exportSubtitleText(options: ExportSubtitleOptions): { text: string; cueCount: number } {
    const timeline = useTimelineStore.getState()
    const cues = this.getExportableCues(timeline.items, timeline.fps, options.selectedOnly)
    if (cues.length === 0) {
      throw new Error(
        options.selectedOnly
          ? 'Select one or more caption text items before exporting selected subtitles.'
          : 'No caption text items found on the timeline.',
      )
    }

    return {
      text: serializeSubtitleFile(cues, options.format),
      cueCount: cues.length,
    }
  }

  private getExportableCues(
    items: readonly TimelineItem[],
    fps: number,
    selectedOnly = false,
  ): SubtitleCue[] {
    const selectedIds = new Set(useSelectionStore.getState().selectedItemIds)
    return items
      .filter((item): item is TextItem => {
        if (item.type !== 'text') return false
        if (selectedOnly && !selectedIds.has(item.id)) return false
        return item.textRole === 'caption' || item.captionSource !== undefined
      })
      .map((item) => ({
        id: item.id,
        startSeconds: item.from / fps,
        endSeconds: (item.from + item.durationInFrames) / fps,
        text: item.text,
      }))
      .filter((cue) => cue.text.trim().length > 0 && cue.endSeconds > cue.startSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds)
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

export const NO_EMBEDDED_SUBTITLES_MESSAGE =
  'No supported embedded text subtitles found. FreeCut currently supports MKV/WebM text subtitle tracks: S_TEXT/UTF8, S_TEXT/WEBVTT, S_TEXT/ASS, and S_TEXT/SSA.'

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
