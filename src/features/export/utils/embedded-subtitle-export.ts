import type { CompositionInputProps } from '@/types/export'
import type { SubtitleSegmentItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { serializeVtt, type SubtitleCue } from '@/shared/utils/subtitles'

function isTranscriptSubtitleItem(item: TimelineItem): item is SubtitleSegmentItem {
  return item.type === 'subtitle' && item.source.type === 'transcript'
}

/**
 * Collect transcript subtitle cues from the (export-trimmed) composition,
 * offset to the export timeline and clamped to its duration. Returns [] when
 * there are none. Shared by the soft-embed (VTT) and sidecar (SRT) paths.
 */
export function buildTranscriptSubtitleCues(composition: CompositionInputProps): SubtitleCue[] {
  const fps = composition.fps
  const durationSeconds =
    composition.durationInFrames !== undefined ? composition.durationInFrames / fps : Infinity

  const cues: SubtitleCue[] = []

  for (const track of composition.tracks) {
    if (track.visible === false) continue

    for (const item of track.items ?? []) {
      if (!isTranscriptSubtitleItem(item)) continue

      const itemStartSeconds = item.from / fps
      const itemEndSeconds = (item.from + item.durationInFrames) / fps

      for (const cue of item.cues) {
        const startSeconds = Math.max(0, itemStartSeconds + cue.startSeconds)
        const endSeconds = Math.min(
          durationSeconds,
          itemEndSeconds,
          itemStartSeconds + cue.endSeconds,
        )

        if (endSeconds <= startSeconds || cue.text.trim().length === 0) continue

        cues.push({
          id: cue.id,
          startSeconds,
          endSeconds,
          text: cue.text,
        })
      }
    }
  }

  // Items can be processed track-by-track in any order, but subtitle consumers
  // expect cues sorted chronologically. Sort by start time, breaking ties by
  // end time so deterministically-overlapping cues don't reorder.
  cues.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
  return cues
}

export function buildTranscriptSubtitleWebVtt(composition: CompositionInputProps): string | null {
  const cues = buildTranscriptSubtitleCues(composition)
  if (cues.length === 0) return null
  return serializeVtt(cues)
}

export function omitTranscriptSubtitleItemsForSoftSubtitleExport(
  composition: CompositionInputProps,
): CompositionInputProps {
  return {
    ...composition,
    tracks: composition.tracks.map(
      (track): TimelineTrack => ({
        ...track,
        items: (track.items ?? []).filter((item) => !isTranscriptSubtitleItem(item)),
      }),
    ),
  }
}
