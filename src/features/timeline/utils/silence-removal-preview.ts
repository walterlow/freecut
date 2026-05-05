import { getOrDecodeAudio } from '@/features/timeline/deps/composition-runtime'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { createLogger } from '@/shared/logging/logger'
import {
  applyRemovalPreviewOverlays,
  clearRemovalPreviewOverlays,
  isAudioVideoItem,
} from '@/features/timeline/utils/removal-preview-overlays'
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
  clearRemovalPreviewOverlays(itemIds, SILENCE_REMOVAL_PREVIEW_OVERLAY_ID)
}

export function applySilencePreviewOverlays(
  itemIds: readonly string[],
  rangesByMediaId: SilenceRangesByMediaId,
): SilencePreviewSummary {
  return applyRemovalPreviewOverlays({
    itemIds,
    rangesByMediaId,
    overlayId: SILENCE_REMOVAL_PREVIEW_OVERLAY_ID,
    labelNoun: 'silent',
    tone: 'error',
  })
}
