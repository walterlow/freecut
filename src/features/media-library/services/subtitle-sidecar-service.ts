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
import type {
  GeneratedCaptionSource,
  TextItem,
  TimelineItem,
  TimelineTrack,
} from '@/types/timeline'
import {
  buildCaptionTrack,
  buildSubtitleSegmentForClip,
  buildSubtitleTextItems,
  buildSubtitleTextItemsForClip,
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

interface InsertSubtitleCuesOptions {
  cues: readonly SubtitleCue[]
  fileName: string
  format: SubtitleFormat
  sourceType: Extract<GeneratedCaptionSource['type'], 'subtitle-import' | 'embedded-subtitles'>
  /**
   * When provided, cues are anchored to the clips of this media on the
   * timeline (each clip's `from` + `sourceStart` window, honoring `speed`).
   * If the media has no clips on the timeline, falls back to inPoint-anchored
   * insertion so subtitle-import for unimported sources still works.
   */
  mediaId?: string
}

class SubtitleSidecarService {
  async importSubtitleFile(
    file: File,
    options: { mode?: 'segment' | 'per-cue' } = {},
  ): Promise<ImportSubtitleResult> {
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

    const mode = options.mode ?? 'segment'
    const insertedItemCount =
      mode === 'segment'
        ? this.insertImportedCuesAsSegment(result.cues, file.name, format)
        : this.insertSubtitleCuesAsCaptions({
            cues: result.cues,
            fileName: file.name,
            format,
            sourceType: 'subtitle-import',
          }).length

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

    const ranges = [{ startFrame: segmentItem.from, endFrame: segmentItem.from + durationInFrames }]
    let nextTracks: TimelineTrack[] = [...timeline.tracks]
    let target = findCompatibleCaptionTrackForRanges(nextTracks, timeline.items, ranges)
    if (!target) {
      target = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, target].sort((a, b) => a.order - b.order)
      timeline.setTracks(nextTracks)
    }
    segmentItem.trackId = target.id

    timeline.addItems([segmentItem])
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
   */
  async scanEmbeddedSubtitleTracks(
    media: MediaMetadata,
    file: Blob,
  ): Promise<EmbeddedSubtitleScanResult> {
    const fingerprint = {
      fileSize: file.size,
      fileLastModified: file instanceof File ? file.lastModified : undefined,
    }
    const cached = await getEmbeddedSubtitleSidecar(media.id, fingerprint)
    if (cached) {
      return { tracks: cached.tracks, scannedAt: cached.scannedAt, fromCache: true }
    }

    const tracks = await extractMatroskaTextSubtitleTracksFromBlob(file)
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
   * Insert a specific embedded subtitle track's cues as captions on the
   * timeline, anchored to `media`'s clips.
   *
   * `mode` controls the timeline shape:
   *  - `'segment'` (default): one {@link SubtitleSegmentItem} per clip
   *    that owns the entire cue list — drag/trim/style as one unit.
   *  - `'per-cue'`: legacy fallback that stamps out one TextItem per cue.
   */
  insertEmbeddedSubtitleTrack(
    media: MediaMetadata,
    track: EmbeddedSubtitleTrack,
    options: { mode?: 'segment' | 'per-cue' } = {},
  ): ExtractEmbeddedSubtitlesResult {
    const trackLabel = formatEmbeddedSubtitleTrackLabel(track)
    const mode = options.mode ?? 'segment'

    if (mode === 'segment') {
      const inserted = this.insertSubtitleCuesAsSegmentForMedia(media, track, trackLabel)
      return {
        insertedItemCount: inserted,
        cueCount: track.cues.length,
        trackLabel,
      }
    }

    const format: SubtitleFormat = track.codecId === 'S_TEXT/WEBVTT' ? 'vtt' : 'srt'
    const items = this.insertSubtitleCuesAsCaptions({
      cues: track.cues,
      fileName: `${media.fileName} - ${trackLabel}`,
      format,
      sourceType: 'embedded-subtitles',
      mediaId: media.id,
    })
    return {
      insertedItemCount: items.length,
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
    if (segments.length === 0) return 0

    // Pick a single track that can host every segment's range, mirroring the
    // per-cue path — keeps captions on one row rather than scattering them.
    const ranges = segments.map((s) => ({
      startFrame: s.from,
      endFrame: s.from + s.durationInFrames,
    }))
    let nextTracks: TimelineTrack[] = [...timeline.tracks]
    let target = findCompatibleCaptionTrackForRanges(nextTracks, timeline.items, ranges)
    if (!target) {
      target = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, target].sort((a, b) => a.order - b.order)
      timeline.setTracks(nextTracks)
    }
    const placedSegments = segments.map((segment) => ({ ...segment, trackId: target.id }))

    timeline.addItems(placedSegments)
    useSelectionStore.getState().selectItems(placedSegments.map((s) => s.id))
    return placedSegments.length
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

  private insertSubtitleCuesAsCaptions(options: InsertSubtitleCuesOptions): TextItem[] {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080

    const targetClips = options.mediaId
      ? findCaptionTargetClipsForMedia(timeline.items, options.mediaId)
      : []

    if (targetClips.length === 0) {
      return this.insertCuesAtInPoint({
        ...options,
        timeline,
        canvasWidth,
        canvasHeight,
      })
    }

    return this.insertCuesAnchoredToClips({
      ...options,
      timeline,
      clips: targetClips,
      canvasWidth,
      canvasHeight,
    })
  }

  private insertCuesAtInPoint({
    cues,
    fileName,
    format,
    sourceType,
    timeline,
    canvasWidth,
    canvasHeight,
  }: InsertSubtitleCuesOptions & {
    timeline: ReturnType<typeof useTimelineStore.getState>
    canvasWidth: number
    canvasHeight: number
  }): TextItem[] {
    const startFrame = timeline.inPoint ?? 0
    const ranges = cues.map((cue) => ({
      startFrame: startFrame + Math.round(cue.startSeconds * timeline.fps),
      endFrame: startFrame + Math.max(1, Math.round(cue.endSeconds * timeline.fps)),
    }))

    const targetTrack = ensureCaptionTrack(timeline, ranges)
    const items = buildSubtitleTextItems({
      trackId: targetTrack.id,
      cues,
      timelineFps: timeline.fps,
      canvasWidth,
      canvasHeight,
      fileName,
      format,
      startFrame,
      sourceType,
    })

    timeline.addItems(items)
    useSelectionStore.getState().selectItems(items.map((item) => item.id))
    return items
  }

  private insertCuesAnchoredToClips({
    cues,
    fileName,
    format,
    sourceType,
    timeline,
    clips,
    canvasWidth,
    canvasHeight,
  }: InsertSubtitleCuesOptions & {
    timeline: ReturnType<typeof useTimelineStore.getState>
    clips: ReadonlyArray<
      import('@/types/timeline').AudioItem | import('@/types/timeline').VideoItem
    >
    canvasWidth: number
    canvasHeight: number
  }): TextItem[] {
    // Pick a single track that can host every clip's caption range, so the
    // user sees one row of captions even if the media has multiple cuts.
    const allRanges: Array<{ startFrame: number; endFrame: number }> = []
    for (const clip of clips) {
      const sourceFps = clip.sourceFps ?? timeline.fps
      const speed = clip.speed ?? 1
      const sourceStartSec = (clip.sourceStart ?? 0) / sourceFps
      const sourceEndSec = clip.sourceEnd
        ? clip.sourceEnd / sourceFps
        : sourceStartSec + (clip.durationInFrames * speed) / timeline.fps
      for (const cue of cues) {
        const overlapStartSec = Math.max(cue.startSeconds, sourceStartSec)
        const overlapEndSec = Math.min(cue.endSeconds, sourceEndSec)
        if (overlapEndSec <= overlapStartSec) continue
        const fromOffset = Math.floor(((overlapStartSec - sourceStartSec) * timeline.fps) / speed)
        const endOffset = Math.ceil(((overlapEndSec - sourceStartSec) * timeline.fps) / speed)
        allRanges.push({
          startFrame: clip.from + Math.max(0, fromOffset),
          endFrame: clip.from + Math.max(fromOffset + 1, endOffset),
        })
      }
    }

    if (allRanges.length === 0) {
      // Cues exist but none overlap any clip's source window — fall back to
      // playhead-anchored so the user still sees something rather than a
      // silent no-op.
      return this.insertCuesAtInPoint({
        cues,
        fileName,
        format,
        sourceType,
        mediaId: undefined,
        timeline,
        canvasWidth,
        canvasHeight,
      })
    }

    const targetTrack = ensureCaptionTrack(timeline, allRanges)
    const items: TextItem[] = []
    for (const clip of clips) {
      const clipItems = buildSubtitleTextItemsForClip({
        trackId: targetTrack.id,
        cues,
        clip,
        timelineFps: timeline.fps,
        canvasWidth,
        canvasHeight,
        fileName,
        format,
        sourceType,
      })
      items.push(...clipItems)
    }

    if (items.length === 0) return []
    timeline.addItems(items)
    useSelectionStore.getState().selectItems(items.map((item) => item.id))
    return items
  }
}

function ensureCaptionTrack(
  timeline: ReturnType<typeof useTimelineStore.getState>,
  ranges: ReadonlyArray<{ startFrame: number; endFrame: number }>,
): TimelineTrack {
  let nextTracks: TimelineTrack[] = [...timeline.tracks]
  let targetTrack = findCompatibleCaptionTrackForRanges(nextTracks, timeline.items, ranges)
  if (!targetTrack) {
    targetTrack = buildCaptionTrack(nextTracks)
    nextTracks = [...nextTracks, targetTrack].sort((a, b) => a.order - b.order)
    timeline.setTracks(nextTracks)
  }
  return targetTrack
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
