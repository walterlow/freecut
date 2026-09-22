/**
 * Subtitle export decisions: which subtitle modes a container can carry, and
 * whether the timeline holds transcript captions worth offering them for.
 */

import type { SubtitleExportMode } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'
import type { ClientVideoContainer } from '../deps/renderer'

/**
 * Soft (toggleable) subtitle tracks only work for Matroska (WebM/MKV). MP4/MOV
 * can't — mediabunny's WebVTT-in-ISOBMFF muxing is broken and players barely
 * support it anyway — so the "Embedded track" option is hidden there.
 */
export function getSubtitleModeOptions(container: ClientVideoContainer): SubtitleExportMode[] {
  return container === 'webm' || container === 'mkv'
    ? ['off', 'burn', 'embedded', 'sidecar']
    : ['off', 'burn', 'sidecar']
}

/** Captions baked into a clip's own audio/video stream (never a reversed clip's). */
function hasTranscriptCaptionTrack(item: TimelineItem): boolean {
  if (item.type !== 'video' && item.type !== 'audio') return false
  if (item.isReversed === true) return false

  const captions = item.transcriptCaptions
  return captions?.enabled === true && captions.type === 'transcript'
}

/**
 * Subtitle items generated from a transcript are only exportable while the clip
 * they were transcribed from is still on the timeline unreversed.
 */
function isTranscriptFromLiveClip(item: TimelineItem, reversedClipIds: Set<string>): boolean {
  if (item.type !== 'subtitle') return false
  if (item.source.type !== 'transcript') return false

  return !reversedClipIds.has(item.source.clipId)
}

/** Whether the timeline carries transcript captions any subtitle mode can act on. */
export function detectTranscriptSubtitles(items: TimelineItem[]): boolean {
  const reversedClipIds = new Set(
    items
      .filter(
        (item) => (item.type === 'video' || item.type === 'audio') && item.isReversed === true,
      )
      .map((item) => item.id),
  )

  return items.some((item) =>
    item.type === 'subtitle'
      ? isTranscriptFromLiveClip(item, reversedClipIds)
      : hasTranscriptCaptionTrack(item),
  )
}
