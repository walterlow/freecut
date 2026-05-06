import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { AbsoluteFill } from '@/features/preview/deps/player-core'
import {
  useClock,
  useClockIsPlaying,
  useClockPlaybackRate,
  useVideoConfig,
} from '@/features/preview/deps/player-context'
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool'
import { SharedVideoExtractorPool, type VideoFrameSource } from '@/features/preview/deps/export'
import { resolveProxyUrl } from '../utils/media-resolver'
import {
  backgroundBatchPreseek,
  getCachedPredecodedBitmap,
  waitForInflightPredecodedBitmap,
} from '../utils/decoder-prewarm'
import { getDirectionalPrewarmOffsets } from '../utils/fast-scrub-prewarm'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useMediaLibraryStore } from '@/features/preview/deps/media-library'
import { FileAudio } from 'lucide-react'

interface SourceCompositionProps {
  mediaId?: string
  src: string
  mediaType: 'video' | 'audio' | 'image'
  fileName: string
  pausedFrameSource?: 'clock' | 'source-player'
  forceFastScrub?: boolean
}

let sourceMonitorVideoInstanceCounter = 0
let sourceMonitorStrictDecodeInstanceCounter = 0
let globalSourceMonitorDecoderPool: SharedVideoExtractorPool | null = null

const SOURCE_MONITOR_STRICT_DECODE_FALLBACK_FAILURES = 2
const SOURCE_MONITOR_FRAME_CACHE_MAX = 90
const SOURCE_MONITOR_CACHE_TIME_QUANTUM = 1 / 60
const SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES = 6
const SOURCE_MONITOR_PREWARM_MAX_TIMESTAMPS = 6
const SOURCE_MONITOR_PREWARM_FORWARD_STEPS = 4
const SOURCE_MONITOR_PREWARM_BACKWARD_STEPS = 6
const SOURCE_MONITOR_PREWARM_OPPOSITE_STEPS = 2
const SOURCE_MONITOR_PREWARM_NEUTRAL_RADIUS = 2
const SOURCE_MONITOR_SHARED_CACHE_WAIT_MS = 4

function getSourceMonitorDecoderPool(): SharedVideoExtractorPool {
  if (!globalSourceMonitorDecoderPool) {
    globalSourceMonitorDecoderPool = new SharedVideoExtractorPool()
  }
  return globalSourceMonitorDecoderPool
}

function quantizeSourceMonitorTime(time: number): number {
  return Math.round(time / SOURCE_MONITOR_CACHE_TIME_QUANTUM) * SOURCE_MONITOR_CACHE_TIME_QUANTUM
}

function shouldResyncPlayingMedia(currentTime: number, targetTime: number, fps: number): boolean {
  return Math.abs(currentTime - targetTime) * fps >= SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES
}

function useSourceMonitorVideoSrc(mediaId: string | undefined, src: string): string {
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const proxyStatus = useMediaLibraryStore((s) =>
    mediaId ? (s.proxyStatus.get(mediaId) ?? null) : null,
  )

  return useMemo(() => {
    void proxyStatus
    if (!src) return ''
    if (useProxy && mediaId) {
      return resolveProxyUrl(mediaId) || src
    }
    return src
  }, [mediaId, proxyStatus, src, useProxy])
}

export function SourceComposition({
  mediaId,
  src,
  mediaType,
  fileName,
  pausedFrameSource = 'source-player',
  forceFastScrub = false,
}: SourceCompositionProps) {
  if (mediaType === 'video') {
    return (
      <VideoSource
        mediaId={mediaId}
        src={src}
        pausedFrameSource={pausedFrameSource}
        forceFastScrub={forceFastScrub}
      />
    )
  }
  if (mediaType === 'image') {
    return <ImageSource src={src} />
  }
  return <AudioSource src={src} fileName={fileName} />
}

function VideoSource({
  mediaId,
  src,
  pausedFrameSource,
  forceFastScrub,
}: {
  mediaId?: string
  src: string
  pausedFrameSource: 'clock' | 'source-player'
  forceFastScrub: boolean
}) {
  const activeSrc = useSourceMonitorVideoSrc(mediaId, src)
  const clock = useClock()
  const playing = useClockIsPlaying()
  const playbackRate = useClockPlaybackRate()
  const followSourcePlayerFrames = pausedFrameSource === 'source-player'
  const sourcePlayerPreviewScrubbing = useSourcePlayerStore(
    (s) => followSourcePlayerFrames && s.previewSourceFrame !== null,
  )
  const isPreviewScrubbing = forceFastScrub || sourcePlayerPreviewScrubbing
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const poolRef = useRef(getGlobalVideoSourcePool())
  const poolClipIdRef = useRef<string>(`source-monitor-${++sourceMonitorVideoInstanceCounter}`)
  const decoderPoolRef = useRef(getSourceMonitorDecoderPool())
  const decodeLaneRef = useRef<string>(
    `source-monitor-strict-${++sourceMonitorStrictDecodeInstanceCounter}`,
  )
  const extractorRef = useRef<VideoFrameSource | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const mountedRef = useRef(true)
  const decoderReadyRef = useRef(false)
  const renderInFlightRef = useRef(false)
  const pendingTimeRef = useRef<number | null>(null)
  const latestTargetTimeRef = useRef(0)
  const consecutiveDecodeFailuresRef = useRef(0)
  const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map())
  const frameCacheOrderRef = useRef<number[]>([])
  const prewarmInFlightRef = useRef(false)
  const queuedPrewarmTimesRef = useRef<number[]>([])
  const prewarmAnchorFrameRef = useRef<number | null>(null)
  const { fps } = useVideoConfig()
  const lastFrameRef = useRef(clock.currentFrame)
  const playingRef = useRef(playing)
  const currentSourceFrameRef = useRef<number>(useSourcePlayerStore.getState().currentSourceFrame)
  const previewSourceFrameRef = useRef<number | null>(
    useSourcePlayerStore.getState().previewSourceFrame,
  )
  const pausedRenderTargetKeyRef = useRef<number | null>(null)
  const decoderItemId = `${mediaId ?? 'source-monitor'}:${decodeLaneRef.current}`
  const [useLegacyPausedSeek, setUseLegacyPausedSeek] = useState(false)
  const [strictDecodeReady, setStrictDecodeReady] = useState(false)
  const [hasDecodedFrame, setHasDecodedFrame] = useState(false)
  const [decodedFrameKey, setDecodedFrameKey] = useState<number | null>(null)
  const [pausedRenderTargetKey, setPausedRenderTargetKey] = useState<number | null>(null)

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    if (!followSourcePlayerFrames) {
      currentSourceFrameRef.current = clock.currentFrame
      previewSourceFrameRef.current = null
      return
    }

    return useSourcePlayerStore.subscribe((state) => {
      currentSourceFrameRef.current = state.currentSourceFrame
      previewSourceFrameRef.current = state.previewSourceFrame
    })
  }, [clock.currentFrame, followSourcePlayerFrames])

  const getResolvedPausedSourceFrame = useCallback(() => {
    if (!followSourcePlayerFrames) {
      return clock.currentFrame
    }

    const previewFrame = previewSourceFrameRef.current
    if (previewFrame !== null) {
      return previewFrame
    }

    return currentSourceFrameRef.current
  }, [clock.currentFrame, followSourcePlayerFrames])

  useEffect(() => {
    const frameCache = frameCacheRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const bitmap of frameCache.values()) {
        bitmap.close()
      }
      frameCache.clear()
      frameCacheOrderRef.current = []
      prewarmInFlightRef.current = false
      queuedPrewarmTimesRef.current = []
      prewarmAnchorFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    setUseLegacyPausedSeek(false)
    setHasDecodedFrame(false)
    setDecodedFrameKey(null)
    setPausedRenderTargetKey(null)
    pausedRenderTargetKeyRef.current = null
    prewarmInFlightRef.current = false
    queuedPrewarmTimesRef.current = []
    prewarmAnchorFrameRef.current = null
  }, [activeSrc, mediaId])

  const pumpDirectionalPrewarm = useCallback(() => {
    if (
      prewarmInFlightRef.current ||
      !decoderReadyRef.current ||
      !mountedRef.current ||
      playingRef.current ||
      pendingTimeRef.current !== null
    ) {
      return
    }

    if (!activeSrc) {
      queuedPrewarmTimesRef.current = []
      return
    }

    const timestamps = queuedPrewarmTimesRef.current
    if (timestamps.length === 0) {
      return
    }

    prewarmInFlightRef.current = true
    queuedPrewarmTimesRef.current = []

    const run = async () => {
      try {
        await backgroundBatchPreseek(activeSrc, timestamps)
      } finally {
        prewarmInFlightRef.current = false
        if (
          mountedRef.current &&
          !playingRef.current &&
          pendingTimeRef.current === null &&
          queuedPrewarmTimesRef.current.length > 0
        ) {
          queueMicrotask(() => {
            if (!mountedRef.current) return
            pumpDirectionalPrewarm()
          })
        }
      }
    }

    void run()
  }, [activeSrc])

  const queueDirectionalPrewarm = useCallback(
    (targetTime: number) => {
      const extractor = extractorRef.current
      if (
        !extractor ||
        !decoderReadyRef.current ||
        playingRef.current ||
        pendingTimeRef.current !== null
      ) {
        return
      }

      const duration = extractor.getDuration()
      if (!Number.isFinite(duration) || duration <= 0) {
        return
      }

      const targetFrame = Math.max(0, Math.round(targetTime * fps))
      const previousAnchorFrame = prewarmAnchorFrameRef.current
      const direction: -1 | 0 | 1 =
        previousAnchorFrame === null || previousAnchorFrame === targetFrame
          ? 0
          : targetFrame > previousAnchorFrame
            ? 1
            : -1
      prewarmAnchorFrameRef.current = targetFrame

      const offsets = getDirectionalPrewarmOffsets(direction, {
        forwardSteps: SOURCE_MONITOR_PREWARM_FORWARD_STEPS,
        backwardSteps: SOURCE_MONITOR_PREWARM_BACKWARD_STEPS,
        oppositeSteps: SOURCE_MONITOR_PREWARM_OPPOSITE_STEPS,
        neutralRadius: SOURCE_MONITOR_PREWARM_NEUTRAL_RADIUS,
      })

      const maxFrame = Math.max(0, Math.floor(duration * fps) - 1)
      const cache = frameCacheRef.current
      const nextPrewarmTimes: number[] = []
      const seen = new Set<number>()

      for (const offset of offsets) {
        const prewarmFrame = targetFrame + offset
        if (prewarmFrame < 0 || prewarmFrame > maxFrame) continue
        const prewarmTime = quantizeSourceMonitorTime(prewarmFrame / fps)
        if (prewarmTime === quantizeSourceMonitorTime(targetTime)) continue
        if (cache.has(prewarmTime) || seen.has(prewarmTime)) continue
        seen.add(prewarmTime)
        nextPrewarmTimes.push(prewarmTime)
        if (nextPrewarmTimes.length >= SOURCE_MONITOR_PREWARM_MAX_TIMESTAMPS) {
          break
        }
      }

      queuedPrewarmTimesRef.current = nextPrewarmTimes
      pumpDirectionalPrewarm()
    },
    [fps, pumpDirectionalPrewarm],
  )

  const drawDecodedFrame = useCallback(
    async (targetTime: number) => {
      const extractor = extractorRef.current
      const canvas = canvasRef.current
      if (!extractor || !canvas) return false

      let ctx = contextRef.current
      if (!ctx) {
        ctx = canvas.getContext('2d')
        if (!ctx) return false
        contextRef.current = ctx
      }

      const { width: decodedWidth, height: decodedHeight } = extractor.getDimensions()
      const targetWidth = Math.max(1, Math.round(decodedWidth || 640))
      const targetHeight = Math.max(1, Math.round(decodedHeight || 360))

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }

      const cacheKey = quantizeSourceMonitorTime(targetTime)
      const markDecodedFrame = () => {
        setHasDecodedFrame(true)
        setDecodedFrameKey((prev) => (prev === cacheKey ? prev : cacheKey))
      }
      const cache = frameCacheRef.current
      const cacheOrder = frameCacheOrderRef.current
      const cached = cache.get(cacheKey)
      if (cached) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(cached, 0, 0, canvas.width, canvas.height)
        const cacheIndex = cacheOrder.indexOf(cacheKey)
        if (cacheIndex !== -1) {
          cacheOrder.splice(cacheIndex, 1)
          cacheOrder.push(cacheKey)
        }
        markDecodedFrame()
        return true
      }

      const drawSharedBitmap = (bitmap: ImageBitmap): boolean => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        return true
      }

      if (activeSrc) {
        const sharedBitmap = getCachedPredecodedBitmap(
          activeSrc,
          Math.max(0, targetTime),
          SOURCE_MONITOR_CACHE_TIME_QUANTUM,
        )
        if (sharedBitmap && drawSharedBitmap(sharedBitmap)) {
          markDecodedFrame()
          return true
        }

        const inflightBitmap = await waitForInflightPredecodedBitmap(
          activeSrc,
          Math.max(0, targetTime),
          SOURCE_MONITOR_CACHE_TIME_QUANTUM,
          SOURCE_MONITOR_SHARED_CACHE_WAIT_MS,
        ).catch(() => null)
        if (inflightBitmap && drawSharedBitmap(inflightBitmap)) {
          markDecodedFrame()
          return true
        }
      }

      const didDraw = await extractor.drawFrame(
        ctx,
        Math.max(0, targetTime),
        0,
        0,
        canvas.width,
        canvas.height,
      )
      if (!didDraw) return false

      try {
        const bitmap = await createImageBitmap(canvas)
        cache.set(cacheKey, bitmap)
        cacheOrder.push(cacheKey)
        while (cacheOrder.length > SOURCE_MONITOR_FRAME_CACHE_MAX) {
          const evictKey = cacheOrder.shift()
          if (evictKey === undefined) break
          const evicted = cache.get(evictKey)
          if (!evicted) continue
          evicted.close()
          cache.delete(evictKey)
        }
      } catch {
        // Cache population is best-effort only.
      }

      markDecodedFrame()
      return true
    },
    [activeSrc],
  )

  const pumpLatestDecodedFrame = useCallback(() => {
    if (renderInFlightRef.current) return
    renderInFlightRef.current = true

    const run = async () => {
      try {
        while (
          decoderReadyRef.current &&
          pendingTimeRef.current !== null &&
          mountedRef.current &&
          !playingRef.current
        ) {
          const targetTime = pendingTimeRef.current
          pendingTimeRef.current = null

          const didDraw = await drawDecodedFrame(targetTime).catch(() => false)
          if (didDraw) {
            consecutiveDecodeFailuresRef.current = 0
            queueDirectionalPrewarm(targetTime)
            continue
          }

          const failureKind = extractorRef.current?.getLastFailureKind() ?? 'decode-error'
          if (failureKind === 'decode-error') {
            consecutiveDecodeFailuresRef.current += 1
            if (
              consecutiveDecodeFailuresRef.current >= SOURCE_MONITOR_STRICT_DECODE_FALLBACK_FAILURES
            ) {
              decoderReadyRef.current = false
              setStrictDecodeReady(false)
              setUseLegacyPausedSeek((prev) => (prev ? prev : true))
              return
            }
          }
        }
      } finally {
        renderInFlightRef.current = false
        if (
          decoderReadyRef.current &&
          pendingTimeRef.current !== null &&
          mountedRef.current &&
          !playingRef.current
        ) {
          queueMicrotask(() => {
            if (!mountedRef.current) return
            pumpLatestDecodedFrame()
          })
        }
      }
    }

    void run()
  }, [drawDecodedFrame, queueDirectionalPrewarm])

  // Acquire/release pooled element when source changes.
  useEffect(() => {
    if (!activeSrc) return

    const pool = poolRef.current
    const clipId = poolClipIdRef.current

    pool.preloadSource(activeSrc).catch(() => {})
    const video = pool.acquireForClip(clipId, activeSrc)
    if (!video) return

    video.muted = true
    video.volume = 0
    video.playsInline = true
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'contain'
    video.style.display = 'block'
    video.style.position = 'absolute'
    video.style.top = '0'
    video.style.left = '0'

    const container = videoContainerRef.current
    if (container && video.parentElement !== container) {
      container.appendChild(video)
    }

    videoRef.current = video

    return () => {
      video.pause()
      if (video.parentElement) {
        video.parentElement.removeChild(video)
      }
      pool.releaseClip(clipId)
      videoRef.current = null
    }
  }, [activeSrc])

  useEffect(() => {
    decoderReadyRef.current = false
    setStrictDecodeReady(false)
    setHasDecodedFrame(false)
    extractorRef.current = null
    pendingTimeRef.current = null
    consecutiveDecodeFailuresRef.current = 0
    contextRef.current = null
    prewarmInFlightRef.current = false
    queuedPrewarmTimesRef.current = []
    prewarmAnchorFrameRef.current = null

    for (const bitmap of frameCacheRef.current.values()) {
      bitmap.close()
    }
    frameCacheRef.current.clear()
    frameCacheOrderRef.current = []

    if (!activeSrc) return

    const pool = decoderPoolRef.current
    const extractor = pool.getOrCreateItemExtractor(decoderItemId, activeSrc)
    extractorRef.current = extractor

    let cancelled = false
    void extractor
      .init()
      .then((ready) => {
        if (cancelled || !mountedRef.current) return
        if (!ready) {
          setUseLegacyPausedSeek((prev) => (prev ? prev : true))
          return
        }
        decoderReadyRef.current = true
        setStrictDecodeReady(true)
        pendingTimeRef.current = latestTargetTimeRef.current
        if (!playingRef.current) {
          pumpLatestDecodedFrame()
        }
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return
        setUseLegacyPausedSeek((prev) => (prev ? prev : true))
      })

    return () => {
      cancelled = true
      decoderReadyRef.current = false
      setStrictDecodeReady(false)
      extractorRef.current = null
      pendingTimeRef.current = null
      pool.releaseItem(decoderItemId)
    }
  }, [activeSrc, decoderItemId, pumpLatestDecodedFrame])

  const syncSourceFrame = useCallback(
    (frame: number) => {
      const video = videoRef.current
      const audio = audioRef.current
      const targetTime = frame / fps
      const targetCacheKey = quantizeSourceMonitorTime(targetTime)
      latestTargetTimeRef.current = targetTime

      lastFrameRef.current = frame

      if (!playingRef.current && !useLegacyPausedSeek && !isPreviewScrubbing) {
        if (pausedRenderTargetKeyRef.current !== targetCacheKey) {
          pausedRenderTargetKeyRef.current = targetCacheKey
          setPausedRenderTargetKey(targetCacheKey)
        }
        pendingTimeRef.current = targetTime
        if (decoderReadyRef.current) {
          pumpLatestDecodedFrame()
        }
      } else if (isPreviewScrubbing) {
        pendingTimeRef.current = null
      }

      const syncAudioTime = () => {
        if (!audio || !src || audio.readyState < 1) {
          return
        }

        if (playingRef.current) {
          if (!shouldResyncPlayingMedia(audio.currentTime, targetTime, fps)) {
            return
          }
        }

        try {
          audio.currentTime = targetTime
        } catch {
          // Ignore seek errors while media is loading
        }
      }

      if (!video || !activeSrc) {
        syncAudioTime()
        return
      }

      const canSeek = video.readyState >= 1
      if (!canSeek) return

      if (
        !playingRef.current &&
        strictDecodeReady &&
        hasDecodedFrame &&
        !useLegacyPausedSeek &&
        !isPreviewScrubbing
      ) {
        syncAudioTime()
        return
      }

      if (playingRef.current) {
        if (!shouldResyncPlayingMedia(video.currentTime, targetTime, fps)) {
          syncAudioTime()
          return
        }
        try {
          video.currentTime = targetTime
        } catch {
          // Ignore seek errors while media is loading
        }
        syncAudioTime()
        return
      }

      if (isPreviewScrubbing) {
        if (Math.abs(video.currentTime - targetTime) >= 0.016) {
          try {
            video.currentTime = targetTime
          } catch {
            // Ignore seek errors while media is loading
          }
        }
      } else {
        try {
          poolRef.current.seekClip(poolClipIdRef.current, frame / fps, { fast: true })
        } catch {
          // Ignore seek errors while media is loading
        }
      }

      syncAudioTime()
    },
    [
      activeSrc,
      fps,
      hasDecodedFrame,
      isPreviewScrubbing,
      pumpLatestDecodedFrame,
      src,
      strictDecodeReady,
      useLegacyPausedSeek,
    ],
  )

  useEffect(() => {
    syncSourceFrame(playing ? clock.currentFrame : getResolvedPausedSourceFrame())
    return clock.onFrameChange((frame) => {
      if (!playingRef.current) {
        return
      }
      syncSourceFrame(frame)
    })
  }, [clock, getResolvedPausedSourceFrame, playing, syncSourceFrame])

  useEffect(() => {
    syncSourceFrame(playing ? clock.currentFrame : getResolvedPausedSourceFrame())
  }, [clock, getResolvedPausedSourceFrame, playing, syncSourceFrame])

  useEffect(() => {
    if (!followSourcePlayerFrames) {
      return
    }

    return useSourcePlayerStore.subscribe((state, prevState) => {
      if (
        playingRef.current ||
        (state.previewSourceFrame === prevState.previewSourceFrame &&
          state.currentSourceFrame === prevState.currentSourceFrame)
      ) {
        return
      }

      syncSourceFrame(state.previewSourceFrame ?? state.currentSourceFrame)
    })
  }, [followSourcePlayerFrames, syncSourceFrame])

  // Handle play/pause sync
  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeSrc) return

    if (playing) {
      video.playbackRate = playbackRate
      if (video.readyState >= 1) {
        try {
          video.currentTime = latestTargetTimeRef.current
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [activeSrc, playbackRate, playing])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src) return

    if (playing) {
      audio.playbackRate = playbackRate
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = latestTargetTimeRef.current
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playbackRate, playing, src])

  const showDecodedCanvas =
    !playing &&
    !isPreviewScrubbing &&
    strictDecodeReady &&
    hasDecodedFrame &&
    !useLegacyPausedSeek &&
    decodedFrameKey !== null &&
    decodedFrameKey === pausedRenderTargetKey

  return (
    <AbsoluteFill>
      <div
        ref={videoContainerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: showDecodedCanvas ? 'none' : 'block',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: showDecodedCanvas ? 'block' : 'none',
        }}
      />
      <audio ref={audioRef} src={src} preload="auto" style={{ display: 'none' }} />
    </AbsoluteFill>
  )
}

function ImageSource({ src }: { src: string }) {
  return (
    <AbsoluteFill>
      <img
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        alt="源预览"
      />
    </AbsoluteFill>
  )
}

function AudioSource({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const clock = useClock()
  const playing = useClockIsPlaying()
  const playbackRate = useClockPlaybackRate()
  const { fps } = useVideoConfig()
  const lastFrameRef = useRef(clock.currentFrame)

  const syncAudioFrame = useCallback(
    (frame: number) => {
      const audio = audioRef.current
      if (!audio || !src) return

      const targetTime = frame / fps
      lastFrameRef.current = frame

      const canSeek = audio.readyState >= 1
      if (!canSeek) {
        return
      }

      if (playing && !shouldResyncPlayingMedia(audio.currentTime, targetTime, fps)) {
        return
      }

      try {
        audio.currentTime = targetTime
      } catch {
        // Ignore seek errors while media is loading
      }
    },
    [fps, playing, src],
  )

  useEffect(() => {
    syncAudioFrame(clock.currentFrame)
    return clock.onFrameChange((frame) => {
      syncAudioFrame(frame)
    })
  }, [clock, syncAudioFrame])

  useEffect(() => {
    syncAudioFrame(clock.currentFrame)
  }, [clock, playing, syncAudioFrame])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src) return

    if (playing) {
      audio.playbackRate = playbackRate
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = lastFrameRef.current / fps
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playing, playbackRate, src, fps])

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a2e',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <FileAudio style={{ width: 48, height: 48, color: '#22c55e' }} />
        <span
          style={{
            color: '#a1a1aa',
            fontSize: 14,
            maxWidth: 200,
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fileName}
        </span>
      </div>
      <audio ref={audioRef} src={src} preload="auto" />
    </AbsoluteFill>
  )
}
