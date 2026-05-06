import type { TimelineItem } from '@/types/timeline'
import { getOrDecodeAudio } from '@/features/timeline/deps/composition-runtime'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTimelineItemOverlayStore } from '@/features/timeline/stores/timeline-item-overlay-store'
import { sourceSecondsToTimelineFrame } from '@/features/timeline/utils/media-item-frames'
import { createLogger } from '@/shared/logging/logger'
import {
  detectSilentRanges,
  type AudioSilenceDetectionOptions,
  type AudioSilenceRange,
} from '@/shared/utils/audio-silence'

const logger = createLogger('SilenceRemovalPreview')

export const SILENCE_REMOVAL_PREVIEW_OVERLAY_ID = 'silence-removal-preview'

export interface SilenceRemovalSettings {
  thresholdDb: number
  minSilenceMs: number
  paddingMs: number
  windowMs: number
}

export const DEFAULT_SILENCE_REMOVAL_SETTINGS: SilenceRemovalSettings = {
  thresholdDb: -45,
  minSilenceMs: 500,
  paddingMs: 100,
  windowMs: 20,
}

export type SilenceRangesByMediaId = Record<string, AudioSilenceRange[]>

export interface SilencePreviewSummary {
  rangeCount: number
  totalSeconds: number
}

function isAudioVideoItem(item: TimelineItem | undefined): item is TimelineItem & {
  type: 'video' | 'audio'
  mediaId: string
} {
  return (
    item !== undefined &&
    (item.type === 'video' || item.type === 'audio') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function getItemPreviewRanges(
  item: TimelineItem,
  ranges: readonly AudioSilenceRange[],
  timelineFps: number,
): Array<{ startRatio: number; endRatio: number; seconds: number }> {
  return ranges.flatMap((range) => {
    const startFrame = sourceSecondsToTimelineFrame(item, range.start, timelineFps)
    const endFrame = sourceSecondsToTimelineFrame(item, range.end, timelineFps)
    const startRatio = Math.max(0, Math.min(1, (startFrame - item.from) / item.durationInFrames))
    const endRatio = Math.max(0, Math.min(1, (endFrame - item.from) / item.durationInFrames))
    if (endRatio <= startRatio) return []
    return [
      {
        startRatio,
        endRatio,
        seconds: ((endRatio - startRatio) * item.durationInFrames) / timelineFps,
      },
    ]
  })
}

export async function analyzeSilenceForItems(
  itemIds: readonly string[],
  settings: SilenceRemovalSettings,
): Promise<SilenceRangesByMediaId> {
  const itemsById = useItemsStore.getState().itemById
  const mediaIds = Array.from(
    new Set(
      itemIds
        .map((id) => itemsById[id])
        .filter(isAudioVideoItem)
        .map((item) => item.mediaId),
    ),
  )
  const silenceRangesByMediaId: SilenceRangesByMediaId = {}

  const results = await Promise.allSettled(
    mediaIds.map(async (mediaId) => {
      const url = await resolveMediaUrl(mediaId)
      if (!url) {
        throw new Error('Could not load media for silence detection')
      }

      const audioBuffer = await getOrDecodeAudio(mediaId, url)
      const ranges = detectSilentRanges(
        audioBuffer,
        settings satisfies AudioSilenceDetectionOptions,
      )
      return { mediaId, ranges }
    }),
  )

  let succeeded = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      succeeded += 1
      if (result.value.ranges.length > 0) {
        silenceRangesByMediaId[result.value.mediaId] = result.value.ranges
      }
    } else {
      logger.warn('Silence detection failed for media', { reason: result.reason })
    }
  }

  if (succeeded === 0 && mediaIds.length > 0) {
    throw new Error('Could not load media for silence detection')
  }

  return silenceRangesByMediaId
}

export function clearSilencePreviewOverlays(itemIds: readonly string[]): void {
  const overlayStore = useTimelineItemOverlayStore.getState()
  for (const itemId of itemIds) {
    overlayStore.removeOverlay(itemId, SILENCE_REMOVAL_PREVIEW_OVERLAY_ID)
  }
}

export function applySilencePreviewOverlays(
  itemIds: readonly string[],
  rangesByMediaId: SilenceRangesByMediaId,
): SilencePreviewSummary {
  const timelineFps = useTimelineSettingsStore.getState().fps
  const itemsById = useItemsStore.getState().itemById
  const overlayStore = useTimelineItemOverlayStore.getState()
  let rangeCount = 0
  let totalSeconds = 0

  for (const itemId of itemIds) {
    const item = itemsById[itemId]
    if (!isAudioVideoItem(item)) {
      overlayStore.removeOverlay(itemId, SILENCE_REMOVAL_PREVIEW_OVERLAY_ID)
      continue
    }

    const ranges = rangesByMediaId[item.mediaId] ?? []
    const previewRanges = getItemPreviewRanges(item, ranges, timelineFps)
    if (previewRanges.length === 0) {
      overlayStore.removeOverlay(itemId, SILENCE_REMOVAL_PREVIEW_OVERLAY_ID)
      continue
    }

    rangeCount += previewRanges.length
    totalSeconds += previewRanges.reduce((sum, range) => sum + range.seconds, 0)
    overlayStore.upsertOverlay(itemId, {
      id: SILENCE_REMOVAL_PREVIEW_OVERLAY_ID,
      label: `${previewRanges.length} silent range${previewRanges.length === 1 ? '' : 's'}`,
      tone: 'error',
      ranges: previewRanges.map((range) => ({
        startRatio: range.startRatio,
        endRatio: range.endRatio,
      })),
    })
  }

  return { rangeCount, totalSeconds }
}
