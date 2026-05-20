/**
 * Video item rendering: mediabunny extractor, DOM video fallback, and
 * worker-predecoded bitmap fast path.
 */

import type { VideoItem } from '@/types/timeline'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  type RenderTimelineSpan,
} from '../render-span'
import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
} from '../frame-source-policy'
import type { CanvasPool } from '../canvas-pool'
import type { CanvasSettings, ItemRenderContext, ItemTransform } from './types'
import {
  isFrameInsideItemTimelineSpan,
  log,
  TIER2_VIDEO_FRAME_TOLERANCE_FACTOR,
  WORKER_PRESEEK_WAIT_MS,
} from './shared'
import {
  applyCropFeatherMask,
  calculateContainedMediaDrawLayout,
  clipToViewport,
  drawContainedMediaSource,
  hasCropFeather,
} from './media-draw'

export function getTier2VideoFrameToleranceSeconds(sourceFps: number): number {
  const normalizedSourceFps = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  return (1 / normalizedSourceFps) * TIER2_VIDEO_FRAME_TOLERANCE_FACTOR
}

export function clampVideoSourceTime(
  sourceTime: number,
  sourceFps: number,
  sourceDurationFrames: number | undefined,
): number {
  const clampedToStart = Math.max(0, sourceTime)
  if (
    sourceDurationFrames === undefined ||
    !Number.isFinite(sourceDurationFrames) ||
    sourceDurationFrames <= 0
  ) {
    return clampedToStart
  }

  const lastFrame = Math.max(0, sourceDurationFrames - 1)
  const maxTime = (lastFrame + 1e-4) / sourceFps
  return Math.min(clampedToStart, maxTime)
}

export function drawTier2VideoFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ImageBitmap | VideoFrame,
  sourceWidth: number,
  sourceHeight: number,
  transform: ItemTransform,
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
  canvasPool?: CanvasPool,
): boolean {
  try {
    const maybeVideoFrame = frame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number }
    }
    const visibleRect = maybeVideoFrame.visibleRect
    return drawContainedMediaSource(
      ctx,
      frame,
      sourceWidth,
      sourceHeight,
      transform,
      canvas,
      crop,
      visibleRect,
      canvasPool,
    )
  } catch {
    return false
  }
}

export async function tryDrawWorkerPredecodedBitmap(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  canvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
  sourceTime: number,
  toleranceSeconds: number,
): Promise<boolean> {
  if (rctx.renderMode !== 'preview' || !item.src) {
    return false
  }

  const drawBitmap = (bitmap: ImageBitmap): boolean => {
    return drawContainedMediaSource(
      ctx,
      bitmap,
      bitmap.width,
      bitmap.height,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
  }

  const cachedBitmap = rctx.getCachedPredecodedBitmap?.(item.src, sourceTime, toleranceSeconds)
  if (cachedBitmap && drawBitmap(cachedBitmap)) {
    return true
  }

  if (!rctx.waitForInflightPredecodedBitmap) {
    return false
  }

  const inflightBitmap = await rctx.waitForInflightPredecodedBitmap(
    item.src,
    sourceTime,
    toleranceSeconds,
    WORKER_PRESEEK_WAIT_MS,
  )
  if (inflightBitmap && drawBitmap(inflightBitmap)) {
    return true
  }

  return false
}

/**
 * Render video item using mediabunny (fast) or HTML5 video element (fallback).
 */
export async function renderVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const {
    fps,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    canvasSettings,
    scrubbingCache,
  } = rctx
  const isPreviewMode = rctx.renderMode === 'preview'
  const allowVideoElementFallback = !isPreviewMode
  const hasFallbackVideoElement = videoElements.has(item.id)
  const extractor = videoExtractors.get(item.id)
  let mediabunnyFailedThisFrame = false
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)

  // Calculate source time
  const localFrame = frame - effectiveRenderSpan.from
  const localTime = localFrame / fps
  const sourceStart = getRenderTimelineSourceStart(item, effectiveRenderSpan)
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1

  // Normal: play from sourceStart forwards
  // sourceStart is in source-native FPS frames, so divide by sourceFps (not project fps)
  // Snap to nearest source frame boundary to avoid floating-point drift
  // that can cause Math.floor(sourceTime * sourceFps) to land on the wrong frame.
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / fps
  const reverseSourceEnd = (item.sourceEnd ?? sourceStart + sourceFramesNeeded) - sourceFrameOffset
  const adjustedSourceStart = sourceStart + sourceFrameOffset
  const unclampedSourceTime = item.isReversed
    ? (reverseSourceEnd - localFrame * speed * (sourceFps / fps) - 1) / sourceFps
    : adjustedSourceStart / sourceFps + localTime * speed
  const rawSourceTime = clampVideoSourceTime(unclampedSourceTime, sourceFps, item.sourceDuration)
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  const sourceTime =
    Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
      ? (snappedSourceFrame + 1e-4) / sourceFps
      : rawSourceTime
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps)
  const domVideoElementProvider = rctx.domVideoElementProvider
  const canUseDomVideoElement =
    isPreviewMode &&
    domVideoElementProvider &&
    sourceFrameOffset === 0 &&
    !rctx.isRenderingTransition &&
    isFrameInsideItemTimelineSpan(item, frame)
  const domVideo = canUseDomVideoElement ? domVideoElementProvider(item.id) : null
  const domVideoDecision = resolvePreviewDomVideoDrawDecision({
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition: !!rctx.isRenderingTransition,
  })
  const hasDomVideo = domVideoDecision.hasReadyDomVideo

  // === TRY DOM VIDEO ELEMENT (zero-copy playback path) ===
  // During playback, the Player's <video> elements are already playing
  // at the correct frame. Drawing from them avoids mediabunny decode entirely.
  //
  // For variable-speed clips (speed != 1), mediabunny provides frame-accurate
  // decode. Skip DOM video when mediabunny is warmed. When mediabunny ISN'T
  // warmed, use DOM video as a one-shot fallback to avoid a 300-500ms keyframe
  // seek stall — mediabunny init runs async in the background so subsequent
  // frames switch to frame-accurate decode.
  // Always try DOM video for variable-speed clips during playback. Mediabunny's
  // keyframe seek (400ms+) is worse than DOM video's timing drift. Only skip DOM
  // video for 1x speed clips when mediabunny is available (frame-accurate, fast).
  if (domVideo && domVideoDecision.shouldDraw) {
    // Variable-speed clips naturally drift from their DOM video element
    // because the browser plays at 1x while sourceTime advances at speed.
    // Use a wider threshold proportional to speed to avoid falling back
    // to mediabunny decode (which causes 50-500ms freezes on first decode).
    // For variable-speed clips, use a very wide threshold to avoid EVER
    // falling through to mediabunny (400ms+ keyframe seek). DOM video drift
    // is visually acceptable; mediabunny stalls are not.
    //
    // During transitions (entry ramp-up and exit handoff), the DOM video
    // element may be settling — play() was just called, Chrome's decoder
    // is ramping up.  Accept very high drift (1s) to prefer a stale
    // zero-copy frame (~1ms) over a mediabunny decode (~170ms stall).
    // A 1-2 frame-old frame is invisible; a 170ms freeze is not.
    drawContainedMediaSource(
      ctx,
      domVideo,
      domVideo.videoWidth,
      domVideo.videoHeight,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
    // For variable-speed clips using DOM fallback during playback,
    // DON'T kick off mediabunny init — keep using DOM video for the
    // entire playback session. Mediabunny init + keyframe seek takes
    // 400-500ms on the main thread, causing visible frame drops.
    // DOM video has slight timing drift at speed != 1, but no freezes.
    return
  }

  const mediabunnyInitAction = resolvePreviewMediabunnyInitAction({
    renderMode: rctx.renderMode,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    hasEnsureVideoItemReady: !!rctx.ensureVideoItemReady,
    speed,
  })
  if (mediabunnyInitAction !== 'none' && rctx.ensureVideoItemReady) {
    // For variable-speed clips during playback, don't block on mediabunny init.
    // The init triggers a keyframe seek that blocks the main thread for 400ms+.
    // Instead, skip this frame (DOM video already drew it or it's invisible).
    if (mediabunnyInitAction === 'warm-background-and-skip') {
      void rctx.ensureVideoItemReady(item.id)
      return
    }
    if (mediabunnyInitAction === 'await-ready') {
      try {
        await rctx.ensureVideoItemReady(item.id)
      } catch {
        // Best effort in preview path; fallback behavior handled below.
      }
    }
  }

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  if (
    shouldUsePreviewStrictWaitingFallback({
      renderMode: rctx.renderMode,
      hasMediabunny: useMediabunny.has(item.id),
      hasFallbackVideoElement,
    })
  ) {
    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions()
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }

    if (
      shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })
    ) {
      const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
        ctx,
        item,
        transform,
        canvasSettings,
        rctx,
        sourceTime,
        tier2ToleranceSeconds,
      )
      if (drewWorkerBitmap) {
        if (rctx.ensureVideoItemReady) {
          void rctx.ensureVideoItemReady(item.id)
        }
        return
      }
    }

    return
  }

  // === TRY PRE-DECODED BITMAP (from background Web Worker) ===
  // Prefer a worker-decoded exact frame before a cold main-thread extractor draw.
  // This keeps large-jump and transition-entry stalls off the main thread while
  // preserving the same exact-frame preview path once the extractor is warm.
  if (
    shouldTryPreviewWorkerBitmap({ renderMode: rctx.renderMode, hasReadyDomVideo: hasDomVideo })
  ) {
    const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      sourceTime,
      tier2ToleranceSeconds,
    )
    if (drewWorkerBitmap) {
      if (!useMediabunny.has(item.id) && rctx.ensureVideoItemReady) {
        void rctx.ensureVideoItemReady(item.id)
      }
      return
    }
  }

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  if (useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id) && extractor) {
    const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01))
    const dims = extractor.getDimensions()
    const drawLayout = calculateContainedMediaDrawLayout(
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
    )

    if (isPreviewMode && scrubbingCache) {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(
        item.id,
        clampedTime,
        tier2ToleranceSeconds,
      )
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }

    if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
      log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`)
    }

    if (
      rctx.renderMode === 'export' &&
      item.isReversed &&
      sourceFrameOffset === 0 &&
      rctx.reverseVideoFrameCache
    ) {
      const cachedReverseFrame = await rctx.reverseVideoFrameCache.getFrame({
        item,
        extractor,
        frame,
        renderSpan: effectiveRenderSpan,
        fps,
        sourceFps,
        speed,
      })
      if (
        cachedReverseFrame &&
        drawTier2VideoFrame(
          ctx,
          cachedReverseFrame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        mediabunnyFailureCountByItem.set(item.id, 0)
        return
      }
    }

    let success = false
    let capturedFrame: ImageBitmap | VideoFrame | null = null
    let capturedSourceTime: number | null = null
    const drawExtractorFrame = async (
      targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    ) =>
      isPreviewMode && scrubbingCache
        ? await extractor.drawFrameWithCapture(
            targetCtx,
            clampedTime,
            drawLayout.mediaRect.x,
            drawLayout.mediaRect.y,
            drawLayout.mediaRect.width,
            drawLayout.mediaRect.height,
          )
        : {
            success: await extractor.drawFrame(
              targetCtx,
              clampedTime,
              drawLayout.mediaRect.x,
              drawLayout.mediaRect.y,
              drawLayout.mediaRect.width,
              drawLayout.mediaRect.height,
            ),
            capturedFrame: null,
            capturedSourceTime: null,
          }

    if (hasCropFeather(drawLayout.featherPixels)) {
      const { canvas: scratchCanvas, ctx: scratchCtx } = rctx.canvasPool.acquire()
      try {
        scratchCtx.save()
        clipToViewport(scratchCtx, drawLayout.viewportRect)
        try {
          const result = await drawExtractorFrame(scratchCtx)
          success = result.success
          capturedFrame = result.capturedFrame
          capturedSourceTime = result.capturedSourceTime
        } finally {
          scratchCtx.restore()
        }

        if (success) {
          applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels)
          ctx.drawImage(scratchCanvas, 0, 0)
        }
      } finally {
        rctx.canvasPool.release(scratchCanvas)
      }
    } else {
      ctx.save()
      clipToViewport(ctx, drawLayout.viewportRect)
      try {
        const result = await drawExtractorFrame(ctx)
        success = result.success
        capturedFrame = result.capturedFrame
        capturedSourceTime = result.capturedSourceTime
      } finally {
        ctx.restore()
      }
    }

    if (success) {
      mediabunnyFailureCountByItem.set(item.id, 0)
      if (scrubbingCache && capturedFrame) {
        scrubbingCache.putVideoFrame(item.id, capturedFrame, capturedSourceTime ?? clampedTime)
      }
      return
    }
    mediabunnyFailedThisFrame = true

    // Distinguish transient misses from decode failures.
    const failureKind = extractor.getLastFailureKind()
    if (isPreviewMode && scrubbingCache && failureKind === 'no-sample') {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return
      }
    }
    if (failureKind === 'no-sample') {
      log.debug('Mediabunny had no sample for timestamp, using per-frame fallback', {
        itemId: item.id,
        frame,
        sourceTime: clampedTime,
      })
    } else {
      const failureCount = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1
      mediabunnyFailureCountByItem.set(item.id, failureCount)

      if (failureCount >= 3) {
        mediabunnyDisabledItems.add(item.id)
        log.warn(
          'Disabling mediabunny for item after repeated failures; using fallback for remainder of export',
          {
            itemId: item.id,
            frame,
            sourceTime: clampedTime,
            failureCount,
          },
        )
      } else {
        log.warn('Mediabunny frame draw failed, using fallback', {
          itemId: item.id,
          frame,
          sourceTime: clampedTime,
          failureCount,
        })
      }
    }
  }

  // === FALLBACK TO HTML5 VIDEO ELEMENT (slower, seeks required) ===
  const allowPreviewFallback = shouldAllowPreviewVideoElementFallback({
    renderMode: rctx.renderMode,
    hasFallbackVideoElement,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    mediabunnyFailedThisFrame,
  })
  if (!allowVideoElementFallback && !allowPreviewFallback) {
    return
  }

  const video = videoElements.get(item.id)
  if (!video) {
    log.warn('Video element not found', { itemId: item.id, frame })
    return
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01))

  const SEEK_TOLERANCE = isPreviewMode ? 0.05 : 0.034
  const SEEK_TIMEOUT = isPreviewMode ? 24 : 150
  const READY_TIMEOUT = isPreviewMode ? 40 : 300

  const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE
  if (needsSeek) {
    video.currentTime = clampedTime

    if (!isPreviewMode) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }, SEEK_TIMEOUT)
      })
    }
  }

  // Wait for video to have enough data to draw
  if (video.readyState < 2) {
    if (isPreviewMode) return

    await new Promise<void>((resolve) => {
      const checkReady = () => {
        if (video.readyState >= 2) {
          video.removeEventListener('canplay', checkReady)
          video.removeEventListener('loadeddata', checkReady)
          resolve()
        }
      }
      video.addEventListener('canplay', checkReady)
      video.addEventListener('loadeddata', checkReady)
      checkReady()
      setTimeout(() => {
        video.removeEventListener('canplay', checkReady)
        video.removeEventListener('loadeddata', checkReady)
        resolve()
      }, READY_TIMEOUT)
    })
  }

  if (video.readyState < 2) {
    if (import.meta.env.DEV && frame < 5)
      log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`)
    return
  }

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(
      `VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`,
    )
  }

  drawContainedMediaSource(
    ctx,
    video,
    video.videoWidth,
    video.videoHeight,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
}

export function resolveVideoParticipantSourceTime(
  item: VideoItem,
  renderSpan: RenderTimelineSpan,
  frame: number,
  rctx: ItemRenderContext,
): number {
  const localFrame = frame - renderSpan.from
  const localTime = localFrame / rctx.fps
  const sourceStart = getRenderTimelineSourceStart(item, renderSpan)
  const sourceFps = item.sourceFps ?? rctx.fps
  const speed = item.speed ?? 1
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / rctx.fps
  const reverseSourceEnd = item.sourceEnd ?? sourceStart + sourceFramesNeeded
  const unclampedSourceTime = item.isReversed
    ? (reverseSourceEnd - localFrame * speed * (sourceFps / rctx.fps) - 1) / sourceFps
    : sourceStart / sourceFps + localTime * speed
  const rawSourceTime = clampVideoSourceTime(unclampedSourceTime, sourceFps, item.sourceDuration)
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  return Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
    ? (snappedSourceFrame + 1e-4) / sourceFps
    : rawSourceTime
}
