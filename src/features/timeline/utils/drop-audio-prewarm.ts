import type { TimelineItem } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'
import {
  getOrDecodeAudioSliceForPlayback,
  needsCustomAudioDecoder,
  prewarmPreviewAudioElement,
  startPreviewAudioConform,
} from '@/features/timeline/deps/composition-runtime'
import type { DroppedMediaEntry } from './drop-execution'
import { registerPreviewAudioStartupHold } from '../hooks/preview-work-budget'

const log = createLogger('DropAudioPrewarm')

const PARTIAL_AUDIO_READY_SECONDS = 1
const PARTIAL_AUDIO_WAIT_TIMEOUT_MS = 6000
const AUDIO_STARTUP_PREVIEW_MIN_HOLD_MS = 1200

function getPlaybackSource(item: TimelineItem): string {
  if (item.type === 'video') {
    return item.audioSrc ?? item.src
  }
  if (item.type === 'audio') {
    return item.src
  }
  return ''
}

export function prewarmDroppedTimelineAudio(
  entries: DroppedMediaEntry[],
  items: TimelineItem[],
): void {
  if (entries.length === 0 || items.length === 0) {
    return
  }

  const entryByMediaId = new Map(entries.map((entry) => [entry.mediaId, entry]))
  const warmedKeys = new Set<string>()
  const customWarmups: Promise<unknown>[] = []
  let releasePreviewHold: (() => void) | null = null

  for (const item of items) {
    if (item.type !== 'video' && item.type !== 'audio') {
      continue
    }
    if (!item.mediaId) {
      continue
    }

    const mediaId = item.mediaId
    const entry = entryByMediaId.get(mediaId)
    if (!entry) {
      continue
    }

    const hasAudio = entry.mediaType === 'audio' || !!entry.media.audioCodec
    if (!hasAudio) {
      continue
    }

    const src = getPlaybackSource(item)
    if (!src) {
      continue
    }

    const sourceFps = Math.max(1, item.sourceFps ?? entry.media.fps ?? 30)
    const trimBeforeFrames =
      item.sourceStart ?? item.trimStart ?? ('offset' in item ? (item.offset ?? 0) : 0)
    const targetTimeSeconds = Math.max(0, trimBeforeFrames / sourceFps)
    const warmKey = `${mediaId}:${src}:${targetTimeSeconds.toFixed(3)}`
    if (warmedKeys.has(warmKey)) {
      continue
    }
    warmedKeys.add(warmKey)
    if (!releasePreviewHold) {
      releasePreviewHold = registerPreviewAudioStartupHold({
        minDurationMs: AUDIO_STARTUP_PREVIEW_MIN_HOLD_MS,
        maxDurationMs: PARTIAL_AUDIO_WAIT_TIMEOUT_MS,
      })
    }

    const codec = entry.media.audioCodec ?? entry.media.codec
    if (needsCustomAudioDecoder(codec)) {
      const warmup = getOrDecodeAudioSliceForPlayback(mediaId, src, {
        minReadySeconds: PARTIAL_AUDIO_READY_SECONDS,
        waitTimeoutMs: PARTIAL_AUDIO_WAIT_TIMEOUT_MS,
        targetTimeSeconds,
      }).catch((error) => {
        log.warn('Failed to prewarm custom-decoded drop audio', {
          mediaId,
          error,
        })
      })
      customWarmups.push(warmup)
      void warmup.finally(() => {
        void startPreviewAudioConform(mediaId, src).catch((error) => {
          log.warn('Failed to start background conform for dropped custom audio', {
            mediaId,
            error,
          })
        })
      })
      continue
    }

    prewarmPreviewAudioElement(src, targetTimeSeconds)
  }

  const releaseHold = releasePreviewHold
  if (!releaseHold) {
    return
  }

  if (customWarmups.length === 0) {
    releaseHold()
    return
  }

  void Promise.allSettled(customWarmups).finally(() => {
    releaseHold()
  })
}
