import { useCallback, useEffect, useRef } from 'react'
import { audioScrubPreview } from '@/features/timeline/deps/media-library-audio-preview'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import {
  clearAudioSkimMeterLevel,
  publishAudioSkimMeterLevel,
} from '@/shared/state/audio-skim-meter'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  getOrDecodeAudioSliceForPlayback,
  resolvePreviewAudioConformUrl,
} from '../deps/composition-runtime-contract'
import { useCompositionsStore } from '../stores/compositions-store'
import { useItemsStore } from '../stores/items-store'
import { useTimelineStore } from '../stores/timeline-store'
import {
  createLatestOnlyAsyncFrameRunner,
  getTimelineAudioBufferPeak,
  selectTimelineSkimSourceAtFrame,
  timelineAudioBufferSkimPreview,
  timelineMediaElementAudioSkimPreview,
} from '../utils/timeline-audio-skim'

export function useTimelineAudioSkimPreview(): void {
  const audioSkimmingEnabled = useTimelineStore((s) => s.audioSkimmingEnabled)
  const requestIdRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const pendingFrameRef = useRef<number | null>(null)
  const skimPreviewFrameRef = useRef<(frame: number) => Promise<void>>(async () => {})
  const latestAudioSkimRunnerRef = useRef<ReturnType<
    typeof createLatestOnlyAsyncFrameRunner
  > | null>(null)
  if (latestAudioSkimRunnerRef.current === null) {
    latestAudioSkimRunnerRef.current = createLatestOnlyAsyncFrameRunner((frame) =>
      skimPreviewFrameRef.current(frame),
    )
  }
  const sourceByMediaIdRef = useRef<
    Map<string, { mediaUrl: string; mediaKind: 'audio' | 'video' }>
  >(new Map())

  const stopAudioSkim = useCallback(() => {
    requestIdRef.current += 1
    pendingFrameRef.current = null
    latestAudioSkimRunnerRef.current?.cancelPending()
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    audioScrubPreview.stop()
    timelineAudioBufferSkimPreview.stop()
    timelineMediaElementAudioSkimPreview.stop()
    clearAudioSkimMeterLevel()
  }, [])

  const resolveSkimUrl = useCallback(
    async (mediaId: string, item: { type: 'audio' | 'video'; src?: string; audioSrc?: string }) => {
      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (media?.previewAudioConformedAt || media?.previewAudioOpfsPath) {
        const conformUrl = await resolvePreviewAudioConformUrl(mediaId)
        if (conformUrl) {
          const resolved = { mediaUrl: conformUrl, mediaKind: 'audio' as const }
          sourceByMediaIdRef.current.set(mediaId, resolved)
          return resolved
        }
      }

      const cached = sourceByMediaIdRef.current.get(mediaId)
      if (cached) {
        return cached
      }

      const conformUrl = await resolvePreviewAudioConformUrl(mediaId)
      if (conformUrl) {
        const resolved = { mediaUrl: conformUrl, mediaKind: 'audio' as const }
        sourceByMediaIdRef.current.set(mediaId, resolved)
        return resolved
      }

      let mediaUrl =
        item.type === 'audio' ? item.src : item.type === 'video' ? item.audioSrc : undefined
      if (!mediaUrl) {
        const { mediaLibraryService } = await importMediaLibraryService()
        mediaUrl = (await mediaLibraryService.getMediaBlobUrl(mediaId)) ?? undefined
      }
      if (!mediaUrl && item.type === 'video') {
        mediaUrl = item.src
      }
      const mediaKind =
        item.type === 'video' && (!item.audioSrc || mediaUrl === item.src)
          ? ('video' as const)
          : ('audio' as const)
      if (!mediaUrl) return null

      const resolved = { mediaUrl, mediaKind }
      sourceByMediaIdRef.current.set(mediaId, resolved)
      return resolved
    },
    [],
  )

  const skimPreviewFrame = useCallback(
    async (frame: number) => {
      if (!useTimelineStore.getState().audioSkimmingEnabled) {
        stopAudioSkim()
        return
      }

      const playback = usePlaybackStore.getState()
      if (playback.previewFrame === null || playback.isPlaying || playback.muted) {
        stopAudioSkim()
        return
      }

      const timelineFps = useTimelineStore.getState().fps
      const { items, tracks } = useItemsStore.getState()
      const source = selectTimelineSkimSourceAtFrame(
        frame,
        items,
        tracks,
        timelineFps,
        (item, activeTimelineFps) => {
          const media = item.mediaId
            ? useMediaLibraryStore.getState().mediaById[item.mediaId]
            : undefined
          if (media?.duration) return media.duration
          return item.sourceDuration !== undefined
            ? item.sourceDuration / (item.sourceFps ?? activeTimelineFps)
            : item.durationInFrames / activeTimelineFps
        },
        (compositionId) => {
          const composition = useCompositionsStore.getState().compositionById[compositionId]
          return composition
            ? { items: composition.items, tracks: composition.tracks, fps: composition.fps }
            : undefined
        },
      )
      if (!source) {
        stopAudioSkim()
        return
      }

      const { item, timeSeconds } = source
      const mediaId = item.mediaId
      if (!mediaId) {
        stopAudioSkim()
        return
      }
      const masterGain = Math.pow(10, (playback.masterBusDb ?? 0) / 20)
      const outputGain = source.gain * masterGain * playback.volume
      if (outputGain <= 0.0001) {
        stopAudioSkim()
        return
      }

      const requestId = ++requestIdRef.current
      try {
        const resolved = await resolveSkimUrl(mediaId, item)
        if (!resolved || requestId !== requestIdRef.current) return

        await timelineMediaElementAudioSkimPreview.scrub({
          mediaKind: resolved.mediaKind,
          mediaUrl: resolved.mediaUrl,
          timeSeconds,
          gain: outputGain,
        })
        publishAudioSkimMeterLevel({
          left: 0.28 * outputGain,
          right: 0.28 * outputGain,
          trackId: item.trackId,
        })
        timelineAudioBufferSkimPreview.stop()
        audioScrubPreview.stop()
      } catch {
        try {
          const resolved = await resolveSkimUrl(mediaId, item)
          if (!resolved || requestId !== requestIdRef.current) return
          const slice = await getOrDecodeAudioSliceForPlayback(mediaId, resolved.mediaUrl, {
            targetTimeSeconds: timeSeconds,
            minReadySeconds: 1,
            waitTimeoutMs: 0,
            preRollSeconds: 0.15,
          })
          if (requestId !== requestIdRef.current) return
          timelineMediaElementAudioSkimPreview.stop()
          audioScrubPreview.stop()
          await timelineAudioBufferSkimPreview.scrub({
            buffer: slice.buffer,
            sliceStartTimeSeconds: slice.startTime,
            timeSeconds,
            gain: outputGain,
          })
          const peak = getTimelineAudioBufferPeak({
            buffer: slice.buffer,
            sliceStartTimeSeconds: slice.startTime,
            timeSeconds,
          })
          publishAudioSkimMeterLevel({
            left: peak.left * outputGain,
            right: peak.right * outputGain,
            trackId: item.trackId,
          })
        } catch {
          try {
            const resolved = await resolveSkimUrl(mediaId, item)
            if (!resolved || requestId !== requestIdRef.current) return
            timelineMediaElementAudioSkimPreview.stop()
            timelineAudioBufferSkimPreview.stop()
            await audioScrubPreview.scrub({
              mediaId,
              mediaUrl: resolved.mediaUrl,
              timeSeconds,
              gain: outputGain,
            })
            publishAudioSkimMeterLevel({
              left: 0.28 * outputGain,
              right: 0.28 * outputGain,
              trackId: item.trackId,
            })
          } catch {
            // Preview audio skim is best-effort; timeline hover/editing should continue normally.
          }
        }
      }
    },
    [resolveSkimUrl, stopAudioSkim],
  )
  skimPreviewFrameRef.current = skimPreviewFrame

  const scheduleAudioSkim = useCallback((frame: number) => {
    pendingFrameRef.current = frame
    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const nextFrame = pendingFrameRef.current
      pendingFrameRef.current = null
      if (nextFrame === null) return
      latestAudioSkimRunnerRef.current?.schedule(nextFrame)
    })
  }, [])

  useEffect(() => {
    if (audioSkimmingEnabled) return
    stopAudioSkim()
  }, [audioSkimmingEnabled, stopAudioSkim])

  useEffect(() => {
    return usePlaybackStore.subscribe((state, prev) => {
      if (state.isPlaying) {
        if (!prev.isPlaying || prev.previewFrame !== null) stopAudioSkim()
        return
      }
      if (state.previewFrame === null) {
        if (prev.previewFrame !== null) stopAudioSkim()
        return
      }
      if (state.previewFrameEpoch === prev.previewFrameEpoch) return
      scheduleAudioSkim(state.previewFrame)
    })
  }, [scheduleAudioSkim, stopAudioSkim])

  useEffect(() => stopAudioSkim, [stopAudioSkim])
}
