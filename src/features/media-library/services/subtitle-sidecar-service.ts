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
import type { MediaMetadata } from '@/types/storage'
import type {
  GeneratedCaptionSource,
  TextItem,
  TimelineItem,
  TimelineTrack,
} from '@/types/timeline'
import {
  buildCaptionTrack,
  buildSubtitleTextItems,
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

interface InsertSubtitleCuesOptions {
  cues: readonly SubtitleCue[]
  fileName: string
  format: SubtitleFormat
  sourceType: Extract<GeneratedCaptionSource['type'], 'subtitle-import' | 'embedded-subtitles'>
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

    const items = this.insertSubtitleCuesAsCaptions({
      cues: result.cues,
      fileName: file.name,
      format,
      sourceType: 'subtitle-import',
    })

    return {
      insertedItemCount: items.length,
      warningCount: result.warnings.length,
      warnings: result.warnings,
    }
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
    const tracks = await extractMatroskaTextSubtitleTracksFromBlob(file)
    const selectedTrack = chooseEmbeddedSubtitleTrack(tracks)
    if (!selectedTrack) {
      throw new Error(
        'No supported embedded text subtitles found. FreeCut currently supports MKV/WebM text subtitle tracks: S_TEXT/UTF8, S_TEXT/WEBVTT, S_TEXT/ASS, and S_TEXT/SSA.',
      )
    }

    const format = selectedTrack.codecId === 'S_TEXT/WEBVTT' ? 'vtt' : 'srt'
    const trackLabel = formatEmbeddedSubtitleTrackLabel(selectedTrack)
    const items = this.insertSubtitleCuesAsCaptions({
      cues: selectedTrack.cues,
      fileName: `${media.fileName} - ${trackLabel}`,
      format,
      sourceType: 'embedded-subtitles',
    })

    return {
      insertedItemCount: items.length,
      cueCount: selectedTrack.cues.length,
      trackLabel,
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

  private insertSubtitleCuesAsCaptions(options: InsertSubtitleCuesOptions): TextItem[] {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080
    const startFrame = timeline.inPoint ?? 0
    const ranges = options.cues.map((cue) => ({
      startFrame: startFrame + Math.round(cue.startSeconds * timeline.fps),
      endFrame: startFrame + Math.max(1, Math.round(cue.endSeconds * timeline.fps)),
    }))

    let nextTracks: TimelineTrack[] = [...timeline.tracks]
    let targetTrack = findCompatibleCaptionTrackForRanges(nextTracks, timeline.items, ranges)
    if (!targetTrack) {
      targetTrack = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, targetTrack].sort((a, b) => a.order - b.order)
      timeline.setTracks(nextTracks)
    }

    const items = buildSubtitleTextItems({
      trackId: targetTrack.id,
      cues: options.cues,
      timelineFps: timeline.fps,
      canvasWidth,
      canvasHeight,
      fileName: options.fileName,
      format: options.format,
      startFrame,
      sourceType: options.sourceType,
    })

    timeline.addItems(items)
    useSelectionStore.getState().selectItems(items.map((item) => item.id))

    return items
  }
}

export const subtitleSidecarService = new SubtitleSidecarService()

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
