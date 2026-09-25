/**
 * Client Render Engine
 *
 * Contains the `createCompositionRenderer` factory that builds the per-frame
 * renderer with full support for effects, masks, transitions, and keyframe
 * animations.
 *
 * The top-level render orchestration functions (`renderComposition`,
 * `renderAudioOnly`, `renderSingleFrame`) live in
 * `canvas-render-orchestrator.ts`.
 *
 * Per-item rendering helpers (video, image, text, shape, transitions) live
 * in `canvas-item-renderer.ts`.
 */

import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem, VideoItem, ImageItem, LottieItem, ShapeItem, TimelineTrack } from '@/types/timeline'
import { LottieExportProvider, isRenderableLottieSrc } from '@/infrastructure/lottie/lottie-frame-provider'
import { resolveLottieRenderSpec } from '@/infrastructure/lottie/lottie-text'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import { createLogger } from '@/shared/logging/logger'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { resolveMediaUrl, resolveProxyUrl } from '@/runtime/renderer/deps/media-library-contract'
import { VideoSourcePool } from '@/runtime/player/video/VideoSourcePool'

// Import subsystems
import { buildKeyframesMap } from './canvas-keyframes'
import { getLogicalCanvasSize } from './canvas-render-scale'
import { type AdjustmentLayerWithTrackOrder } from './canvas-effects'
import { GpuPipelineManager } from './gpu-pipeline-manager'
import type { RenderedTaskResult } from './frame-mask-helpers'
import { FrameRenderPass, type FrameRenderDeps } from './frame-render-pass'
import { buildMaskFrameIndex, getActiveMasksForFrame, type MaskCanvasSettings } from './canvas-masks'
import { type CachedGifFrames, gifFrameCache } from '@/runtime/renderer/deps/timeline-gif-cache-contract'
import { CanvasPool, TextMeasurementCache } from './canvas-pool'
import { acquireSharedPreviewVideoExtractorPool, SharedVideoExtractorPool, type VideoFrameSource } from './shared-video-extractor'
import { useCompositionsStore, type SubComposition } from '@/runtime/renderer/deps/timeline-compositions-contract'
import type { FrameInvalidationRequest } from '@/shared/utils/frame-invalidation'
import { collectReachableCompositionIdsFromTracks } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { appendVirtualTranscriptCaptionTrack } from '@/runtime/renderer/deps/caption-items-contract'

// Item renderer
import { createFrameCompositionSceneCache, type PreviewPathVerticesOverride, resolveCompositionRenderPlan, resolveLiveTransitionRenderPlan, collectFrameVideoCandidates, getVideoTargetTimeSeconds, resolveTrackRenderState } from '@/runtime/renderer/deps/composition-runtime-contract'
import { renderItem, type CanvasSettings, type WorkerLoadedImage, type ItemRenderContext, type SubCompRenderData } from './canvas-item-renderer'
import { ScrubbingCache } from '@/runtime/renderer/deps/preview-contract'
import { shouldUseScrubbingFrameCache } from './render-path-optimizer'
import { resolveReverseConformedVideoItem } from '@/shared/utils/reverse-conform-item'
import { resolveCompositionSourceFrame } from './render-span'
import { itemHasEnabledGpuEffect, isAnimatedImage, isGifFormat, subCompositionRenderDataHasGpuEffects } from './render-engine-predicates'
import { buildTransitionTrackOrderById, collectTopLevelMediaItems, collectTopLevelVideoItems, resolveCompositionRenderTracks } from './composition-render-inputs'
import { CANVAS_POOL_OBSERVER_BY_RENDER_MODE, createRendererCrossFrameCaches } from './render-mode-resources'

function getLog() {
  return createLogger('ClientRenderEngine')
}

export function buildSubCompositionRenderTracks(
  subComp: Pick<SubComposition, 'items' | 'tracks' | 'fps' | 'width' | 'height'>,
): SubCompRenderData['sortedTracks'] {
  const tracksWithItems = subComp.tracks.map((track) => ({
    ...track,
    items: subComp.items.filter((item) => item.trackId === track.id),
  }))

  const renderTracks = appendVirtualTranscriptCaptionTrack(
    tracksWithItems,
    subComp.fps,
    subComp.width,
    subComp.height,
  )
  const { visibleTrackIds } = resolveTrackRenderState(renderTracks)

  return renderTracks
    .sort((left, right) => (right.order ?? 0) - (left.order ?? 0))
    .map((track) => ({
      order: track.order ?? 0,
      visible: visibleTrackIds.has(track.id),
      items: (track.items ?? []).filter(
        (item) => item.type !== 'audio' && item.type !== 'adjustment',
      ),
    }))
}

function getPrewarmVideoSourceTimeSeconds(item: VideoItem, frame: number, fps: number): number {
  const localFrame = frame - item.from
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / fps
  const reverseSourceEnd = item.sourceEnd ?? sourceStart + sourceFramesNeeded
  return getVideoTargetTimeSeconds(
    sourceStart,
    sourceFps,
    localFrame,
    speed,
    fps,
    0,
    item.isReversed === true,
    reverseSourceEnd,
  )
}

export function selectPreviewVideoSource(options: {
  candidates: Array<string | null | undefined>
  sourceTime?: number
  toleranceSeconds?: number
  getCachedPredecodedBitmap?: ItemRenderContext['getCachedPredecodedBitmap']
  getCachedActivePreviewFallbackBitmap?: ItemRenderContext['getCachedActivePreviewFallbackBitmap']
  isActivePreviewSourceTarget?: ItemRenderContext['isActivePreviewSourceTarget']
}): string | null {
  const candidates = [...new Set(options.candidates.filter((src): src is string => !!src))]
  if (options.sourceTime !== undefined) {
    for (const src of candidates) {
      if (
        options.getCachedPredecodedBitmap?.(src, options.sourceTime, options.toleranceSeconds) ||
        options.getCachedActivePreviewFallbackBitmap?.(
          src,
          options.sourceTime,
          options.toleranceSeconds,
        )
      ) {
        return src
      }
    }
  }
  if (options.sourceTime !== undefined) {
    const activeTarget = candidates.find((src) =>
      options.isActivePreviewSourceTarget?.(src, options.sourceTime!, options.toleranceSeconds),
    )
    if (activeTarget) return activeTarget
  }
  return candidates[0] ?? null
}

export function getPreviewVideoSourceCandidates({
  itemSource,
  proxySource,
  registeredSource,
  cachedSource,
  useProxyMedia,
}: {
  itemSource?: string | null
  proxySource?: string | null
  registeredSource?: string | null
  cachedSource?: string | null
  useProxyMedia: boolean
}): Array<string | null | undefined> {
  if (useProxyMedia) {
    return [proxySource, itemSource, registeredSource, cachedSource]
  }

  // blobUrlManager owns the current original-media URL and is also what the
  // active preseek scheduler uses with proxy playback disabled. Timeline item
  // src values can lag a proxy-mode toggle, so never let an explicit proxy URL
  // outrank or masquerade as the original source here.
  return [cachedSource, registeredSource, itemSource].map((candidate) =>
    candidate === proxySource ? null : candidate,
  )
}

// Predicate helpers (GPU-effect / animated-image classifiers) live in
// `render-engine-predicates.ts`. `subCompositionRenderDataHasGpuEffects` is
// re-exported so existing import sites (and its test) keep working.
export { subCompositionRenderDataHasGpuEffects }

export type RenderedFrameCacheMode = 'full' | 'gpu-only' | 'skip'

const ISOLATED_SEEK_WORKER_WAIT_MS = 900

export interface VideoPreloadPlan {
  priorityItemIds: string[]
  eagerItemIds: string[]
  deferredItemIds: string[]
}

export type CompositionRendererMode = 'export' | 'preview' | 'comparison'

export interface CompositionRendererExecutionPolicy {
  itemRenderMode: 'export' | 'preview'
  usesSharedPreviewPool: boolean
  usesStrictPreviewDecode: boolean
  allowsPredecodedVideoFrames: boolean
}

export function resolveCompositionRendererExecutionPolicy(
  mode: CompositionRendererMode,
): CompositionRendererExecutionPolicy {
  const isPreview = mode === 'preview'
  return {
    itemRenderMode: isPreview ? 'preview' : 'export',
    usesSharedPreviewPool: isPreview,
    usesStrictPreviewDecode: isPreview,
    allowsPredecodedVideoFrames: mode === 'comparison',
  }
}

export function resolveWorkerPredecodeWaitMs(
  rendererMode: CompositionRendererMode,
  renderedFrameCacheMode: RenderedFrameCacheMode,
): number | undefined {
  // Comparison frames share a serialized render session. A long worker wait
  // here would let a superseded guide frame block the current drag target.
  if (rendererMode === 'comparison') return undefined
  return renderedFrameCacheMode === 'skip' ? ISOLATED_SEEK_WORKER_WAIT_MS : undefined
}

export interface PriorityMediaItemIds {
  video: string[]
  image: string[]
  lottie: string[]
}

export function selectRendererPreloadItems<T>(
  mode: CompositionRendererMode,
  items: readonly T[],
  priorityItemIds: ReadonlySet<string>,
  getItemId: (item: T) => string,
): T[] {
  if (mode !== 'comparison') return [...items]
  return items.filter((item) => priorityItemIds.has(getItemId(item)))
}

export function selectNestedMediaSource({
  useProxyMedia,
  proxyUrl,
  sourceUrl,
}: {
  useProxyMedia: boolean
  proxyUrl: string | null
  sourceUrl: string | null
}): string | null {
  return (useProxyMedia ? proxyUrl : null) ?? sourceUrl
}

function selectFirstMediaSource(candidates: Array<string | null | undefined>): string | null {
  return candidates.find((candidate): candidate is string => !!candidate) ?? null
}

function selectComparisonVideoSource(
  item: VideoItem,
  registeredSource: string | undefined,
  useProxyMedia: boolean,
): string | null {
  return selectFirstMediaSource([
    registeredSource,
    useProxyMedia && item.mediaId ? resolveProxyUrl(item.mediaId) : null,
    item.src,
    item.mediaId ? blobUrlManager.get(item.mediaId) : null,
  ])
}

function selectExportVideoSource(
  item: VideoItem,
  registeredSource: string | undefined,
): string | null {
  return selectFirstMediaSource([
    item.mediaId ? blobUrlManager.get(item.mediaId) : null,
    registeredSource,
    item.src,
  ])
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('Renderer preload aborted', 'AbortError')
}

function waitForFallbackVideoReady(options: {
  video: HTMLVideoElement
  itemId: string
  signal?: AbortSignal
  context: 'root' | 'nested'
}): Promise<void> {
  const { video, itemId, signal, context } = options
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onLoaded = () => finish()
    const onError = () => {
      getLog().warn('Fallback video preload failed (non-fatal)', {
        context,
        itemId,
        mediaErrorCode: video.error?.code,
        mediaErrorMessage: video.error?.message,
      })
      finish()
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      try {
        video.pause()
      } catch {
        // The renderer is already being disposed; abort must still reject promptly.
      }
      reject(signal?.reason ?? new DOMException('Video preload aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      getLog().warn('Fallback video load timeout', { context, itemId })
      finish()
    }, 10000)

    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (video.readyState >= 2) finish()
    else video.load()
  })
}

async function resolveRendererMediaSource(
  item: VideoItem | ImageItem | LottieItem,
  useProxyMedia: boolean,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal)
  if (useProxyMedia && item.type === 'video' && item.mediaId) {
    const proxyUrl = resolveProxyUrl(item.mediaId)
    if (proxyUrl) return proxyUrl
  }
  if (item.src) return item.src
  if (!item.mediaId) return null
  const cachedUrl = blobUrlManager.get(item.mediaId)
  if (cachedUrl) return cachedUrl
  const resolvedUrl = await resolveMediaUrl(item.mediaId)
  throwIfAborted(signal)
  return resolvedUrl || null
}

/** Export opens every source up front; interactive renderers initialize misses on demand. */
export function resolveVideoPreloadPlan(
  renderMode: CompositionRendererMode,
  allItemIds: Iterable<string>,
  priorityItemIds: Iterable<string>,
): VideoPreloadPlan {
  const all = [...new Set(allItemIds)]
  const available = new Set(all)
  const priority = [...new Set(priorityItemIds)].filter((itemId) => available.has(itemId))
  const prioritySet = new Set(priority)
  const remaining = all.filter((itemId) => !prioritySet.has(itemId))
  return {
    priorityItemIds: priority,
    eagerItemIds: renderMode === 'export' ? remaining : [],
    deferredItemIds: renderMode === 'export' ? [] : remaining,
  }
}

function isVisibleAtFrame(
  item: TimelineItem,
  frame: number,
  visibleTrackIds: ReadonlySet<string> | null,
): boolean {
  if (visibleTrackIds && !visibleTrackIds.has(item.trackId)) return false
  return frame >= item.from && frame < item.from + item.durationInFrames
}

function getPriorityMediaType(item: TimelineItem): keyof PriorityMediaItemIds | null {
  switch (item.type) {
    case 'video':
    case 'image':
    case 'lottie':
      return item.type
    default:
      return null
  }
}

function getVisibleSubCompositionTrackIds(composition: SubComposition): ReadonlySet<string> | null {
  if (composition.tracks.length === 0) return null
  return new Set(composition.tracks.filter((track) => track.visible).map((track) => track.id))
}

export function collectPriorityMediaItemIds({
  tracks,
  frame,
  fps,
  compositionById,
}: {
  tracks: TimelineTrack[]
  frame: number
  fps: number
  compositionById: Record<string, SubComposition | undefined>
}): PriorityMediaItemIds {
  const itemIds = {
    video: new Set<string>(),
    image: new Set<string>(),
    lottie: new Set<string>(),
  }

  const visitItems = (
    items: TimelineItem[],
    currentFrame: number,
    currentFps: number,
    visibleTrackIds: ReadonlySet<string> | null,
    path: ReadonlySet<string>,
  ) => {
    for (const item of items) {
      if (!isVisibleAtFrame(item, currentFrame, visibleTrackIds)) continue

      const mediaType = getPriorityMediaType(item)
      if (mediaType) {
        itemIds[mediaType].add(item.id)
        continue
      }
      if (item.type !== 'composition' || path.has(item.compositionId)) continue

      const subComposition = compositionById[item.compositionId]
      if (!subComposition) continue
      const subFrame = resolveCompositionSourceFrame(
        item,
        currentFrame,
        currentFps,
        subComposition.fps,
      )
      if (subFrame < 0 || subFrame >= subComposition.durationInFrames) continue

      const nextPath = new Set(path)
      nextPath.add(item.compositionId)
      const subVisibleTrackIds = getVisibleSubCompositionTrackIds(subComposition)
      visitItems(subComposition.items, subFrame, subComposition.fps, subVisibleTrackIds, nextPath)
    }
  }

  for (const track of tracks) {
    if (!track.visible) continue
    visitItems(track.items ?? [], frame, fps, null, new Set())
  }

  return {
    video: [...itemIds.video],
    image: [...itemIds.image],
    lottie: [...itemIds.lottie],
  }
}

export function collectPriorityMediaItemIdsForFrames({
  tracks,
  frames,
  fps,
  compositionById,
}: {
  tracks: TimelineTrack[]
  frames: readonly number[]
  fps: number
  compositionById: Record<string, SubComposition | undefined>
}): PriorityMediaItemIds {
  const merged = {
    video: new Set<string>(),
    image: new Set<string>(),
    lottie: new Set<string>(),
  }
  for (const frame of frames) {
    const frameItems = collectPriorityMediaItemIds({ tracks, frame, fps, compositionById })
    for (const itemId of frameItems.video) merged.video.add(itemId)
    for (const itemId of frameItems.image) merged.image.add(itemId)
    for (const itemId of frameItems.lottie) merged.lottie.add(itemId)
  }
  return {
    video: [...merged.video],
    image: [...merged.image],
    lottie: [...merged.lottie],
  }
}

export function collectPriorityNestedVideoItemIds(
  options: Parameters<typeof collectPriorityMediaItemIds>[0],
): string[] {
  return collectPriorityMediaItemIds(options).video
}

/**
 * Avoid retaining isolated frames from large random seeks. They have almost no
 * reuse value (especially on an overview timeline), while each full-resolution
 * cache entry creates both a GPU texture and a deep ImageBitmap copy.
 */
export function resolveRenderedFrameCacheMode({
  previousFrame,
  frame,
  fps,
}: {
  previousFrame: number | null
  frame: number
  fps: number
}): RenderedFrameCacheMode {
  if (previousFrame === null) return 'full'
  const delta = frame - previousFrame
  if (delta > 0 && delta <= 3) return 'gpu-only'
  const wideSeekThreshold = Math.max(12, Math.round(Math.max(1, fps)))
  if (Math.abs(delta) > wideSeekThreshold) return 'skip'
  return 'full'
}

// WebP frame extraction is handled by gifFrameCache.getWebpFrames() —
// the cache service uses the ImageDecoder API and provides the same
// CachedGifFrames structure used for GIF.

// ---------------------------------------------------------------------------
// Scrub perf instrumentation (DEV diagnostics, opt-in)
// ---------------------------------------------------------------------------
//
// Gated on `window.__SCRUB_PERF__ = true` (off by default → zero overhead).
// When on, every `renderFrame` call records its wall-time + which path it took
// (cache-hit / direct / full) into `window.__scrubPerf` and emits a
// `scrub.renderFrame.<path>` User Timing measure so it shows up on the
// Performance panel's Timings track. Read with:
//   window.__scrubPerf            // raw ring buffer
//   — or record a Performance profile and look for `scrub.renderFrame.*`.
/**
 * Identity of a Lottie item's animation/theme selection + text/color overrides.
 * When this changes the preloaded dotlottie renderer must be rebuilt with a
 * fresh render spec (see the preview freshness sync in `renderFrame`).
 */
function lottieOverrideSignature(item: {
  animationId?: string
  themeId?: string
  textOverrides?: Record<string, string>
  colorOverrides?: Record<string, string>
  slotOverrides?: Record<string, number | [number, number]>
}): string {
  return JSON.stringify({
    a: item.animationId ?? null,
    m: item.themeId ?? null,
    t: item.textOverrides ?? null,
    c: item.colorOverrides ?? null,
    s: item.slotOverrides ?? null,
  })
}

// ---------------------------------------------------------------------------
// createCompositionRenderer
// ---------------------------------------------------------------------------

/**
 * Creates a composition renderer that can render frames to a canvas
 * with full support for effects, masks, transitions, and keyframe animations.
 */
export async function createCompositionRenderer(
  composition: CompositionInputProps,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  options: {
    mode?: CompositionRendererMode
    getPreviewTransformOverride?: (itemId: string) => Partial<ResolvedTransform> | undefined
    getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
    getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined
    getPreviewPathVerticesOverride?: PreviewPathVerticesOverride
    getLiveItemSnapshot?: (itemId: string) => TimelineItem | undefined
    getLiveKeyframes?: (itemId: string) => ItemKeyframes | undefined
    domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null
    useProxyMedia?: boolean
    renderText?: boolean
  } = {},
) {
  const { fps, transitions = [], backgroundColor = '#000000', keyframes = [] } = composition
  const rendererMode = options.mode ?? 'export'
  const executionPolicy = resolveCompositionRendererExecutionPolicy(rendererMode)
  const renderMode = executionPolicy.itemRenderMode
  const isComparisonMode = rendererMode === 'comparison'
  const useProxyMedia = options.useProxyMedia === true
  const tracks = resolveCompositionRenderTracks({
    tracks: composition.tracks,
    fps,
    renderText: options.renderText,
    isComparisonMode,
    renderMode,
    useProxy: options.useProxyMedia,
  })
  const getPreviewTransformOverride = options.getPreviewTransformOverride
  const getPreviewEffectsOverride = options.getPreviewEffectsOverride
  const getPreviewCornerPinOverride = options.getPreviewCornerPinOverride
  const getPreviewPathVerticesOverride = options.getPreviewPathVerticesOverride
  const getLiveItemSnapshot = options.getLiveItemSnapshot
  const getLiveKeyframes = options.getLiveKeyframes
  const domVideoElementProvider = options.domVideoElementProvider
  const hasDom = typeof document !== 'undefined'
  const previewStrictDecode = executionPolicy.usesStrictPreviewDecode
  // Workers render through mediabunny only; the HTML5 fallback pool is main-thread.
  const canUseFallbackVideoElements = hasDom && !previewStrictDecode

  const canvasSettings: CanvasSettings = {
    width: canvas.width,
    height: canvas.height,
    logicalWidth: composition.width,
    logicalHeight: composition.height,
    fps,
    getPreviewTransform: renderMode === 'preview' ? getPreviewTransformOverride : undefined,
  }
  const frameSceneCache = createFrameCompositionSceneCache()
  let frameSceneRevision = 0

  const renderPlan = resolveCompositionRenderPlan({ tracks, transitions })
  const { trackRenderState } = renderPlan
  const {
    visibleTrackIds,
    visibleTracksByOrderDesc: sortedTracks,
    visibleTracksByOrderAsc: tracksTopToBottom,
    trackOrderMap,
  } = trackRenderState

  // === PERFORMANCE OPTIMIZATION: Canvas Pool ===
  // Pre-allocate reusable canvases instead of creating new ones per frame
  // Initial size: 10 (1 content + ~5 items + 2 effects + 2 transitions).
  // Complex stacked preview frames reached 22 concurrent surfaces in the real
  // project, so retain a small bounded headroom instead of reallocating two
  // throwaway full-resolution canvases on every such frame.
  const canvasPool = new CanvasPool(
    canvas.width,
    canvas.height,
    10,
    24,
    CANVAS_POOL_OBSERVER_BY_RENDER_MODE[renderMode],
  )

  // === PERFORMANCE OPTIMIZATION: Text Measurement Cache ===
  const textMeasureCache = new TextMeasurementCache()

  // === 3-TIER SCRUBBING CACHE (preview only) ===
  // Tier 1: GPU textures in VRAM for instant scrub (~0.1ms blit)
  // Tier 2: Per-video last-frame for instant clip boundary display
  // Tier 3: Deep RAM ImageBitmap buffer (~900 frames) with GPU promotion
  // When all tiers are warm, scrubbing doesn't decode at all.
  const scrubbingCache = renderMode === 'preview' ? new ScrubbingCache() : null
  let lastRenderedFrame: number | null = null
  let nonBlockingVideoFrameToleranceSeconds: number | undefined
  let liveDomVideoPlaybackActive = Boolean(domVideoElementProvider)
  const cacheRenderedFrame = (frame: number) => {
    // Sequential playback already has the decoder's live frame available and
    // should not copy every full-resolution output into the scrub cache. Those
    // GPU copies compete with the next frame's effects/composite work and retain
    // textures that playback is unlikely to revisit immediately. Paused seeks
    // still populate all cache tiers as before.
    if (
      !scrubbingCache ||
      !frameRenderDeps.scrubbingFrameCacheActive ||
      frameRenderDeps.activePreviewFallbackUsed
    ) {
      return
    }

    const cacheMode = resolveRenderedFrameCacheMode({
      previousFrame: lastRenderedFrame,
      frame,
      fps,
    })
    lastRenderedFrame = frame
    // Overview timelines can move tens of thousands of frames per pointer
    // pixel. Caching those isolated frames only creates GPU textures and deep
    // ImageBitmaps that are almost never revisited, adding allocation/GC churn
    // to the latency-sensitive render path.
    if (cacheMode === 'skip') return
    if (gpu.effects) {
      scrubbingCache.setGpuDevice(gpu.effects.getDevice(), canvas.width, canvas.height)
    }
    scrubbingCache.cacheFrame(frame, canvas, cacheMode === 'gpu-only')
  }

  // === GPU pipeline cluster ===
  // All WebGPU pipelines, the compositor/texture-pool/mask-manager, the
  // composite output target, and the glyph/bitmap-mask texture caches are
  // owned by the manager. Lazily initialized on first use; the effects
  // pipeline owns the device that every other pipeline derives from.
  const gpu = new GpuPipelineManager()

  // Build lookup maps
  const keyframesMap = buildKeyframesMap(keyframes)
  const getCurrentKeyframes = (itemId: string): ItemKeyframes | undefined =>
    getLiveKeyframes?.(itemId) ?? keyframesMap.get(itemId)
  const getCurrentItem = <TItem extends TimelineItem>(item: TItem): TItem => {
    const liveItem = getLiveItemSnapshot?.(item.id)
    const current = liveItem && liveItem.type === item.type ? (liveItem as TItem) : item
    if (current.type !== 'video') {
      return current
    }

    const resolvedVideoItem = resolveReverseConformedVideoItem(current, fps, {
      mode: renderMode,
      useProxy: options.useProxyMedia,
    })
    syncVideoItemRegistration(resolvedVideoItem)
    return resolvedVideoItem as TItem
  }
  const expressionItemsById = new Map(
    tracks.flatMap((track) => track.items.map((item) => [item.id, item] as const)),
  )
  canvasSettings.getExpressionItem = (itemId) =>
    getLiveItemSnapshot?.(itemId) ?? expressionItemsById.get(itemId)
  canvasSettings.getExpressionKeyframes = getCurrentKeyframes
  let liveTransitionRenderPlanRevision = -1
  let liveTransitionRenderPlan = renderPlan
  const getCurrentRenderPlan = () => {
    if (!getLiveItemSnapshot || liveTransitionRenderPlanRevision === frameSceneRevision) {
      return liveTransitionRenderPlan
    }

    liveTransitionRenderPlan = resolveLiveTransitionRenderPlan({
      renderPlan,
      transitions,
      getCurrentItem,
    })
    liveTransitionRenderPlanRevision = frameSceneRevision
    return liveTransitionRenderPlan
  }
  const getLiveMaskItem = getLiveItemSnapshot
    ? (itemId: string) => {
        const live = getLiveItemSnapshot(itemId)
        return live && live.type === 'shape' ? (live as ShapeItem) : undefined
      }
    : undefined

  // === PERFORMANCE OPTIMIZATION: Use mediabunny for video decoding ===
  // VideoFrameExtractor provides precise frame access without seek delays
  const sharedPreviewExtractorLease = executionPolicy.usesSharedPreviewPool
    ? acquireSharedPreviewVideoExtractorPool()
    : null
  const sharedVideoExtractors =
    sharedPreviewExtractorLease?.pool ??
    new SharedVideoExtractorPool({
      // Same-source transitions and overlaps can require multiple concurrent decode
      // timelines. Keep a small fixed lane cap to prevent per-clip duplication.
      maxLanesPerSource: 4,
      logFrameFailuresAsDebug: false,
    })
  const videoExtractors = new Map<string, VideoFrameSource>()
  const videoSourceByItemId = new Map<string, string>()
  const videoItemIdsBySource = new Map<string, Set<string>>()
  const videoItemsById = new Map<string, VideoItem>()
  // Keep video elements as fallback if mediabunny fails
  const videoElements = new Map<string, HTMLVideoElement>()
  const fallbackVideoPool = canUseFallbackVideoElements ? new VideoSourcePool() : null
  const fallbackVideoBySrc = new Set<string>()
  const fallbackVideoClipIdByItem = new Map<string, string>()
  let fallbackVideoClipCounter = 0
  const registerVideoItem = (itemId: string, src: string): void => {
    if (!src) return
    const prevSrc = videoSourceByItemId.get(itemId)
    if (prevSrc && prevSrc !== src) {
      const prevSet = videoItemIdsBySource.get(prevSrc)
      prevSet?.delete(itemId)
      if (prevSet && prevSet.size === 0) {
        videoItemIdsBySource.delete(prevSrc)
      }
      sharedVideoExtractors.releaseItem(itemId, prevSrc)
    }
    videoSourceByItemId.set(itemId, src)
    let ids = videoItemIdsBySource.get(src)
    if (!ids) {
      ids = new Set<string>()
      videoItemIdsBySource.set(src, ids)
    }
    ids.add(itemId)
    videoExtractors.set(itemId, sharedVideoExtractors.getOrCreateItemExtractor(itemId, src))
  }

  const bindFallbackVideoElement = (itemId: string, src: string): void => {
    if (!fallbackVideoPool) return

    let clipId = fallbackVideoClipIdByItem.get(itemId)
    if (!clipId) {
      clipId = `export-fallback-${++fallbackVideoClipCounter}-${itemId}`
      fallbackVideoClipIdByItem.set(itemId, clipId)
    }

    const element = fallbackVideoPool.acquireForClip(clipId, src)
    if (!element) return

    // Configure element immediately after acquire, then warm shared source preload.
    element.crossOrigin = 'anonymous'
    element.muted = true
    element.preload = 'auto'

    if (!fallbackVideoBySrc.has(src)) {
      fallbackVideoBySrc.add(src)
      fallbackVideoPool.preloadSource(src).catch(() => {})
    }

    videoElements.set(itemId, element)
  }

  /**
   * Registers one top-level video item: its extractor wrapper, and (main thread,
   * non-comparison) the HTML5 fallback element used when mediabunny fails.
   */
  const registerTopLevelVideoItem = (videoItem: VideoItem): void => {
    videoItemsById.set(videoItem.id, videoItem)
    if (!videoItem.src) return

    getLog().debug('Registering shared video extractor', {
      itemId: videoItem.id,
      src: videoItem.src.substring(0, 80),
    })

    // Create item-bound wrapper backed by a shared per-source extractor pool.
    registerVideoItem(videoItem.id, videoItem.src)

    // Also create fallback video element in case mediabunny fails (main thread only).
    if (canUseFallbackVideoElements && !isComparisonMode) {
      bindFallbackVideoElement(videoItem.id, videoItem.src)
    }
  }

  for (const videoItem of collectTopLevelVideoItems(tracks)) {
    registerTopLevelVideoItem(videoItem)
  }

  let isDisposed = false

  // Image elements and animated frames are loaded through per-item promises so
  // comparison panels can warm only the exact target dependencies.
  const imageElements = new Map<string, WorkerLoadedImage>()
  const imageLoadByKey = new Map<string, Promise<void>>()
  const animatedImageLoadByKey = new Map<string, Promise<void>>()
  const gifFramesMap = new Map<string, CachedGifFrames>()

  // Lottie animations: rendered on demand via dotlottie-web (no frame pre-extraction).
  const lottieProvider = new LottieExportProvider()

  // Preview only: a persistent renderer outlives edits, so when a top-level
  // Lottie's text/color overrides change we must rebuild its dotlottie renderer
  // with freshly patched data (the frame mapping already reads live timing).
  // Cheap when nothing changed (a signature compare); export never calls this
  // (it preloads final overrides once). Sub-comp Lotties are out of scope.
  const liveLottieItem = (baseItem: LottieItem): LottieItem => {
    const live = getLiveItemSnapshot?.(baseItem.id)
    return live && live.type === 'lottie' ? live : baseItem
  }
  const lottieLoadByKey = new Map<string, Promise<void>>()

  const ensureLottieItemReady = async (baseItem: LottieItem, signal?: AbortSignal) => {
    if (lottieProvider.get(baseItem.id)) return
    const item = liveLottieItem(baseItem)
    const src = await resolveRendererMediaSource(item, false, signal)
    if (!src || !isRenderableLottieSrc(src)) return
    const signature = lottieOverrideSignature(item)
    const key = `${item.id}\u0000${src}\u0000${signature}`
    const existing = lottieLoadByKey.get(key)
    if (existing) return existing

    const promise = (async () => {
      throwIfAborted(signal)
      const w = item.sourceWidth && item.sourceWidth > 0 ? item.sourceWidth : 512
      const h = item.sourceHeight && item.sourceHeight > 0 ? item.sourceHeight : 512
      const spec = await resolveLottieRenderSpec(src, item)
      throwIfAborted(signal)
      if (isDisposed) return
      await lottieProvider.preload(
        item.id,
        src,
        w,
        h,
        spec.data ?? undefined,
        signature,
        spec.themeData ?? undefined,
        spec.slots ?? undefined,
      )
      throwIfAborted(signal)
    })().finally(() => {
      lottieLoadByKey.delete(key)
    })
    lottieLoadByKey.set(key, promise)
    return promise
  }

  const ensureAnimatedImageReady = async (
    item: ImageItem,
    src: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!hasDom || !isAnimatedImage(item) || gifFramesMap.has(item.id)) return
    const key = `${item.id}\u0000${src}`
    const existing = animatedImageLoadByKey.get(key)
    if (existing) return existing
    const promise = (async () => {
      throwIfAborted(signal)
      const mediaId = item.mediaId ?? item.id
      const frames = isGifFormat(item)
        ? await gifFrameCache.getGifFrames(mediaId, src)
        : await gifFrameCache.getWebpFrames(mediaId, src)
      throwIfAborted(signal)
      if (!isDisposed) gifFramesMap.set(item.id, frames)
    })()
      .catch((error) => {
        if (!signal?.aborted) {
          getLog().error('Failed to load animated image frames', { itemId: item.id, error })
        }
      })
      .finally(() => {
        animatedImageLoadByKey.delete(key)
      })
    animatedImageLoadByKey.set(key, promise)
    return promise
  }

  const ensureImageItemReady = async (baseItem: ImageItem, signal?: AbortSignal) => {
    const src = await resolveRendererMediaSource(baseItem, false, signal)
    if (!src) return
    const item = baseItem.src === src ? baseItem : ({ ...baseItem, src } as ImageItem)
    const key = `${item.id}\u0000${src}`
    let loadPromise = imageLoadByKey.get(key)
    if (!imageElements.has(item.id) && !loadPromise) {
      loadPromise = (async () => {
        throwIfAborted(signal)
        if (hasDom && typeof Image !== 'undefined') {
          await new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            const cleanup = () => signal?.removeEventListener('abort', onAbort)
            const onAbort = () => {
              cleanup()
              img.src = ''
              reject(signal?.reason ?? new DOMException('Image load aborted', 'AbortError'))
            }
            img.onload = () => {
              cleanup()
              if (!isDisposed) {
                imageElements.set(item.id, {
                  source: img,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                })
              }
              resolve()
            }
            img.onerror = () => {
              cleanup()
              reject(new Error(`Failed to load image: ${src}`))
            }
            signal?.addEventListener('abort', onAbort, { once: true })
            img.src = src
          })
        } else {
          if (typeof createImageBitmap !== 'function') {
            throw new Error('WORKER_REQUIRES_MAIN_THREAD:imagebitmap')
          }
          const response = await fetch(src, { signal })
          if (!response.ok) throw new Error(`Failed to load image: ${src}`)
          const bitmap = await createImageBitmap(await response.blob())
          throwIfAborted(signal)
          if (!isDisposed) {
            imageElements.set(item.id, {
              source: bitmap,
              width: bitmap.width,
              height: bitmap.height,
            })
          } else {
            bitmap.close()
          }
        }
      })()
        .catch((error) => {
          if (!signal?.aborted) getLog().error('Failed to load image', { itemId: item.id, error })
          if (signal?.aborted) throw error
        })
        .finally(() => {
          imageLoadByKey.delete(key)
        })
      imageLoadByKey.set(key, loadPromise)
    }
    await Promise.all([loadPromise, ensureAnimatedImageReady(item, src, signal)])
  }

  const lottieOverridesAreStale = (): boolean =>
    lottieItems.some(
      (baseItem) =>
        lottieProvider.getSignature(baseItem.id) !==
        lottieOverrideSignature(liveLottieItem(baseItem)),
    )
  const ensureLottieOverridesFresh = async (): Promise<void> => {
    await Promise.all(
      lottieItems.map(async (baseItem) => {
        const item = liveLottieItem(baseItem)
        if (!isRenderableLottieSrc(item.src)) return
        const signature = lottieOverrideSignature(item)
        if (lottieProvider.getSignature(baseItem.id) === signature) return
        const w = item.sourceWidth && item.sourceWidth > 0 ? item.sourceWidth : 512
        const h = item.sourceHeight && item.sourceHeight > 0 ? item.sourceHeight : 512
        const spec = await resolveLottieRenderSpec(item.src, item)
        await lottieProvider.rebuild(
          baseItem.id,
          item.src,
          w,
          h,
          spec.data ?? undefined,
          signature,
          spec.themeData ?? undefined,
          spec.slots ?? undefined,
        )
      }),
    )
  }

  const { lottieItems, imageItems, gifItems, webpItems } = collectTopLevelMediaItems(tracks)
  // Comparison panels warm only the exact target dependencies, so they skip the
  // top-level image loads and pick their own in `preload`.
  const imageLoadPromises = isComparisonMode
    ? []
    : imageItems.map((imageItem) => ensureImageItemReady(imageItem))

  // Collect adjustment layers
  const adjustmentLayers = renderPlan.visibleAdjustmentLayers as AdjustmentLayerWithTrackOrder[]

  const transitionTrackOrderById = buildTransitionTrackOrderById(
    renderPlan.transitionWindows,
    trackOrderMap,
  )

  const maskSettings: MaskCanvasSettings = canvasSettings
  const maskFrameIndex = buildMaskFrameIndex(tracks, maskSettings)

  // Track which videos successfully use mediabunny (for render decisions)
  const useMediabunny = new Set<string>()
  // Track persistent mediabunny failures and disable extractor after repeated errors.
  const mediabunnyFailureCountByItem = new Map<string, number>()
  const mediabunnyInitFailureCountByItem = new Map<string, number>()
  const mediabunnyDisabledItems = new Set<string>()
  const MEDIABUNNY_DISABLE_THRESHOLD = 4
  const PREWARM_FAILURE_DISABLE_THRESHOLD = 3
  const inFlightInitByItem = new Map<string, Promise<boolean>>()

  function syncVideoItemRegistration(videoItem: VideoItem): void {
    if (!videoItem.src) return

    const prevSrc = videoSourceByItemId.get(videoItem.id)
    if (prevSrc !== videoItem.src) {
      useMediabunny.delete(videoItem.id)
      mediabunnyDisabledItems.delete(videoItem.id)
      mediabunnyFailureCountByItem.delete(videoItem.id)
      mediabunnyInitFailureCountByItem.delete(videoItem.id)
      inFlightInitByItem.delete(videoItem.id)
      registerVideoItem(videoItem.id, videoItem.src)
      if (hasDom && !previewStrictDecode) {
        bindFallbackVideoElement(videoItem.id, videoItem.src)
      }
    }

    videoItemsById.set(videoItem.id, videoItem)
  }

  // Pre-computed sub-composition render data. Populated synchronously at
  // renderer creation (so the first renderFrame sees compound-clip structure
  // even before preload finishes) and refreshed during preload.
  const subCompRenderData = new Map<string, SubCompRenderData>()

  const buildSubCompRenderDataEntry = (subComp: SubComposition): SubCompRenderData => {
    const sortedWithItems = buildSubCompositionRenderTracks(subComp)
    const subKfMap = new Map<string, ItemKeyframes>()
    for (const kf of subComp.keyframes ?? []) {
      subKfMap.set(kf.itemId, kf)
    }
    const subAdjustmentLayers: AdjustmentLayerWithTrackOrder[] = []
    for (const t of resolveTrackRenderState(subComp.tracks).visibleTracks) {
      const trackOrder = t.order ?? 0
      for (const i of subComp.items) {
        if (i.trackId === t.id && i.type === 'adjustment') {
          subAdjustmentLayers.push({ layer: i, trackOrder })
        }
      }
    }
    return {
      fps: subComp.fps,
      durationInFrames: subComp.durationInFrames,
      compositionControls: subComp.compositionControls,
      sortedTracks: sortedWithItems,
      keyframesMap: subKfMap,
      itemsById: new Map(subComp.items.map((item) => [item.id, item])),
      adjustmentLayers: subAdjustmentLayers,
    }
  }
  const PREWARM_DECODE_MAX_ITEMS = 6
  let prewarmCanvas: OffscreenCanvas | HTMLCanvasElement | null = null
  let prewarmCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
  let prewarmAttempted = false
  const { reverseVideoFrameCache, textRasterCache, cornerPinWarpCache } =
    createRendererCrossFrameCaches(renderMode)

  // Build the shared ItemRenderContext used by canvas-item-renderer functions
  const itemRenderContext: ItemRenderContext = {
    fps,
    canvasSettings,
    canvasPool,
    textMeasureCache,
    renderMode,
    renderItem,
    scrubbingCache,
    getCurrentItemSnapshot: getCurrentItem,
    getLiveItemSnapshotById: getLiveItemSnapshot,
    getCurrentKeyframes,
    getPreviewTransformOverride,
    getPreviewCornerPinOverride,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    allowPredecodedVideoFrames: executionPolicy.allowsPredecodedVideoFrames,
    workerPredecodeWaitMs: undefined,
    getResolvedVideoSource: (item, sourceTime, toleranceSeconds) => {
      const registeredSource = videoSourceByItemId.get(item.id)
      if (renderMode !== 'preview') {
        return isComparisonMode
          ? selectComparisonVideoSource(item, registeredSource, useProxyMedia)
          : selectExportVideoSource(item, registeredSource)
      }
      return selectPreviewVideoSource({
        candidates: getPreviewVideoSourceCandidates({
          itemSource: item.src,
          proxySource: item.mediaId ? resolveProxyUrl(item.mediaId) : null,
          registeredSource,
          cachedSource: item.mediaId ? blobUrlManager.get(item.mediaId) : null,
          useProxyMedia,
        }),
        sourceTime,
        toleranceSeconds,
        getCachedPredecodedBitmap: itemRenderContext.getCachedPredecodedBitmap,
        getCachedActivePreviewFallbackBitmap: useProxyMedia
          ? itemRenderContext.getCachedActivePreviewFallbackBitmap
          : undefined,
        isActivePreviewSourceTarget: itemRenderContext.isActivePreviewSourceTarget,
      })
    },
    reverseVideoFrameCache,
    imageElements,
    gifFramesMap,
    ensureImageItemReady: (item) => ensureImageItemReady(item),
    lottieProvider,
    ensureLottieItemReady: (item) => ensureLottieItemReady(item),
    keyframesMap,
    adjustmentLayers,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    subCompRenderData,
    instanceSubCompRenderDataCache: new Map(),
    gpuPipeline: null,
    gpuTransitionPipeline: null,
    gpuMediaPipeline: null,
    gpuMediaBlendPipeline: null,
    gpuShapePipeline: null,
    gpuTextPipeline: null,
    gpuMaskCombinePipeline: null,
    gpuTextTextureCache: gpu.textTextureCache,
    gpuBitmapMaskTextureCache: gpu.bitmapMaskTextureCache,
    // Cross-frame caches keyed on content, not frame: preview keeps them across
    // scrubs, export renders each frame once.
    textRasterCache,
    cornerPinWarpCache,
    gpuScratchTexturePool: {
      acquire: (width, height, format) =>
        gpu.texturePool?.acquire(width, height, format) ??
        gpu.ensureTexturePool().acquire(width, height, format),
      release: (texture) => {
        gpu.texturePool?.release(texture)
      },
    },
    domVideoElementProvider,
  }
  itemRenderContext.markActivePreviewFramePending = () => {
    frameRenderDeps.activePreviewFramePending = true
  }
  itemRenderContext.markActivePreviewFallbackUsed = () => {
    frameRenderDeps.activePreviewFallbackUsed = true
  }

  // Track the SubComposition identity we last built each entry from so we only
  // rebuild when the Zustand store produced a new reference (effects added,
  // items changed, etc.). Using reference equality keeps the per-frame cost
  // near-zero when nothing edited the sub-comp.
  const subCompRenderDataSource = new Map<string, SubComposition>()

  const refreshSubCompRenderData = (compositionById: Record<string, SubComposition>) => {
    const reachableIds = collectReachableCompositionIdsFromTracks(tracks, compositionById)
    for (const compositionId of reachableIds) {
      const subComp = compositionById[compositionId]
      if (!subComp) continue
      if (subCompRenderDataSource.get(compositionId) === subComp) continue
      subCompRenderData.set(compositionId, buildSubCompRenderDataEntry(subComp))
      subCompRenderDataSource.set(compositionId, subComp)
    }
  }

  // Synchronously populate sub-comp render data from the current compositions
  // store. Without this, the first renderFrame after creation would fall into
  // the `if (!subData) return;` path in renderCompositionItem and skip all
  // compound clips — producing a black frame until preload() finishes.
  refreshSubCompRenderData(useCompositionsStore.getState().compositionById)

  const getPrewarmContext = ():
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null => {
    if (prewarmAttempted) return prewarmCtx
    prewarmAttempted = true

    if (typeof OffscreenCanvas !== 'undefined') {
      prewarmCanvas = new OffscreenCanvas(1, 1)
      prewarmCtx = prewarmCanvas.getContext('2d')
      return prewarmCtx
    }

    if (typeof document !== 'undefined') {
      const canvasEl = document.createElement('canvas')
      canvasEl.width = 1
      canvasEl.height = 1
      prewarmCanvas = canvasEl
      prewarmCtx = canvasEl.getContext('2d')
      return prewarmCtx
    }

    return null
  }

  const collectPrewarmVideoCandidatesForFrame = (frame: number): VideoItem[] =>
    collectFrameVideoCandidates({
      tracksByOrderAsc: tracksTopToBottom,
      visibleTrackIds,
      minFrame: frame - 1,
      maxFrame: frame + 1,
      maxItems: PREWARM_DECODE_MAX_ITEMS,
    }).map((item) => getCurrentItem(item))

  const initializeMediabunnyForItems = async (
    itemIds: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, boolean>> => {
    const itemResult = new Map<string, boolean>()
    if (itemIds.length === 0) return itemResult
    throwIfAborted(signal)

    const bySource = new Map<string, string[]>()
    for (const itemId of itemIds) {
      const src = videoSourceByItemId.get(itemId)
      if (!src) {
        itemResult.set(itemId, false)
        continue
      }
      let ids = bySource.get(src)
      if (!ids) {
        ids = []
        bySource.set(src, ids)
      }
      ids.push(itemId)
    }

    await Promise.all(
      [...bySource.entries()].map(async ([src, ids]) => {
        throwIfAborted(signal)
        const success = await sharedVideoExtractors.initSource(src)
        throwIfAborted(signal)
        if (isDisposed) return
        // Intentional side effect: decode readiness is tracked per shared source,
        // while itemResult only reports back for the explicitly requested ids.
        const allItemsForSource = videoItemIdsBySource.get(src) ?? new Set(ids)
        for (const itemId of allItemsForSource) {
          if (success) {
            useMediabunny.add(itemId)
          } else {
            useMediabunny.delete(itemId)
          }
        }
        for (const itemId of ids) {
          itemResult.set(itemId, success)
        }
      }),
    )

    return itemResult
  }

  const collectPriorityVideoItemIds = (targetFrame: number, windowFrames: number): string[] => {
    const minFrame = targetFrame - windowFrames
    const maxFrame = targetFrame + windowFrames
    const ids: string[] = []

    for (const track of tracks) {
      if (!visibleTrackIds.has(track.id)) continue
      for (const item of track.items ?? []) {
        if (item.type !== 'video') continue
        const start = item.from
        const end = item.from + item.durationInFrames
        if (end < minFrame || start > maxFrame) continue
        const currentItem = getCurrentItem(item)
        if (videoExtractors.has(currentItem.id)) {
          ids.push(currentItem.id)
        }
      }
    }

    return ids
  }

  const registerVideoItemOnDemand = async (
    itemId: string,
    item: VideoItem | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (videoExtractors.has(itemId)) return true
    if (!item) return false
    const src = await resolveRendererMediaSource(item, useProxyMedia, signal)
    if (isDisposed || !src) return false
    registerVideoItem(itemId, src)
    videoItemsById.set(itemId, item)
    if (hasDom && !previewStrictDecode) bindFallbackVideoElement(itemId, src)
    return true
  }

  const ensureVideoItemReady = async (
    itemId: string,
    item?: VideoItem,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (useMediabunny.has(itemId)) return true
    if (mediabunnyDisabledItems.has(itemId)) return false
    if (!(await registerVideoItemOnDemand(itemId, item, signal))) return false

    const existing = inFlightInitByItem.get(itemId)
    if (existing) return existing

    const promise = initializeMediabunnyForItems([itemId], signal)
      .then((result) => {
        if (isDisposed) return false
        const ok = result.get(itemId) === true
        if (ok) {
          mediabunnyInitFailureCountByItem.delete(itemId)
          return true
        }

        const failures = (mediabunnyInitFailureCountByItem.get(itemId) ?? 0) + 1
        mediabunnyInitFailureCountByItem.set(itemId, failures)
        if (failures >= MEDIABUNNY_DISABLE_THRESHOLD) {
          mediabunnyDisabledItems.add(itemId)
        }
        return false
      })
      .finally(() => {
        inFlightInitByItem.delete(itemId)
      })

    inFlightInitByItem.set(itemId, promise)
    return promise
  }
  itemRenderContext.ensureVideoItemReady = ensureVideoItemReady

  /**
   * Wires the pre-decoded bitmap cache from the decoder prewarm worker. Resolves
   * the adapter before the factory returns: the first held scrub may call
   * renderFrame immediately, and only a resolved (already imported) adapter lets
   * that frame enter blocking MediaBunny with cancellation wired. Callers gate
   * this on preview/comparison; the inner preview gate keeps comparison frames on
   * the shared decode-session lookups only.
   */
  const wirePreviewDecodeAdapter = async (): Promise<void> => {
    try {
      const {
        getCachedPredecodedBitmap,
        getCachedActivePreviewFallbackBitmap,
        isActivePreviewFrameCurrent,
        isActivePreviewFrameDecodeReady,
        isActivePreviewSourceTarget,
        isActivePreviewFrameSuperseded,
        isActivePreviewTargetSuperseded,
        waitForInflightPredecodedBitmap,
      } = await import('@/runtime/renderer/deps/preview-contract')
      itemRenderContext.getCachedPredecodedBitmap = getCachedPredecodedBitmap
      itemRenderContext.waitForInflightPredecodedBitmap = waitForInflightPredecodedBitmap
      if (renderMode === 'preview') {
        itemRenderContext.getCachedActivePreviewFallbackBitmap =
          getCachedActivePreviewFallbackBitmap
        itemRenderContext.isActivePreviewFrameCurrent = isActivePreviewFrameCurrent
        itemRenderContext.isActivePreviewFrameDecodeReady = isActivePreviewFrameDecodeReady
        itemRenderContext.isActivePreviewSourceTarget = isActivePreviewSourceTarget
        itemRenderContext.isActivePreviewFrameSuperseded = isActivePreviewFrameSuperseded
        itemRenderContext.isActivePreviewTargetSuperseded = isActivePreviewTargetSuperseded
      }
    } catch {
      // Preview can still fall back to its ordinary media path if the optional
      // worker adapter is unavailable in a constrained runtime.
    }
  }

  if (renderMode === 'preview' || isComparisonMode) {
    await wirePreviewDecodeAdapter()
  }

  const reportPreviewDecodeCoverage = (expectedReadyItemIds: Iterable<string>) => {
    if (previewStrictDecode) {
      const failedItemIds = [...expectedReadyItemIds].filter((id) => !useMediabunny.has(id))
      if (failedItemIds.length === 0) return
      getLog().debug('Preview Mediabunny coverage incomplete; fallback paths remain available', {
        failedCount: failedItemIds.length,
        failedItemIds,
      })
    }
  }

  /**
   * Scans the visible tracks for any item needing the GPU path at `frame`
   * (enabled GPU effects on the item or inside compound sub-compositions).
   */
  const detectFrameGpuEffects = (frame: number): boolean => {
    for (const track of sortedTracks) {
      if (!visibleTrackIds.has(track.id)) continue
      for (const baseItem of track.items ?? []) {
        const item = getCurrentItem(baseItem)
        if (frame < item.from || frame >= item.from + item.durationInFrames) continue
        if (
          itemHasEnabledGpuEffect(
            item,
            renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
          )
        ) {
          return true
        }
        // Compound clips: also check GPU effects on sub-comp items and
        // adjustment layers so the pipeline is initialized before
        // renderCompositionItem needs it.
        if (item.type === 'composition') {
          if (
            subCompositionRenderDataHasGpuEffects(item.compositionId, subCompRenderData, {
              getCurrentItem,
              getPreviewEffectsOverride:
                renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
            })
          ) {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * Preloads every fallback video element (not just mediabunny misses) so the
   * HTML5 fallback is ready if mediabunny fails mid-export. Critical for
   * transitions where the outgoing clip's extractor may fail past the source
   * duration boundary.
   */
  const preloadFallbackVideoElements = async (
    fallbackVideoIds: string[],
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!hasDom && fallbackVideoIds.some((id) => !useMediabunny.has(id))) {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:video-fallback')
    }

    if (hasDom && !previewStrictDecode && fallbackVideoIds.length > 0) {
      const fallbackVideoIdSet = new Set(fallbackVideoIds)
      const uniqueVideoEntries = new Map<HTMLVideoElement, string>()
      for (const [itemId, video] of videoElements.entries()) {
        if (!fallbackVideoIdSet.has(itemId)) continue
        if (!uniqueVideoEntries.has(video)) {
          uniqueVideoEntries.set(video, itemId)
        }
      }

      const videoLoadPromises = Array.from(uniqueVideoEntries.entries()).map(([video, itemId]) =>
        waitForFallbackVideoReady({ video, itemId, signal, context: 'root' }),
      )

      await Promise.all(videoLoadPromises)
    }
  }

  /**
   * Preloads Lottie renderers (main thread only). Each renders into its own
   * OffscreenCanvas at native animation resolution; frames are drawn on demand.
   */
  const preloadLottieRenderers = async (): Promise<void> => {
    if (!isComparisonMode && hasDom && lottieItems.length > 0) {
      getLog().debug('Preloading Lottie animations', { lottieCount: lottieItems.length })
      await Promise.all(
        lottieItems.map(async (lottieItem) => {
          try {
            const w =
              lottieItem.sourceWidth && lottieItem.sourceWidth > 0 ? lottieItem.sourceWidth : 512
            const h =
              lottieItem.sourceHeight && lottieItem.sourceHeight > 0 ? lottieItem.sourceHeight : 512
            // Resolve animation/theme + text/color edits before warming so
            // exports reflect them.
            const spec = await resolveLottieRenderSpec(lottieItem.src, lottieItem)
            if (isDisposed) return
            await lottieProvider.preload(
              lottieItem.id,
              lottieItem.src,
              w,
              h,
              spec.data ?? undefined,
              lottieOverrideSignature(lottieItem),
              spec.themeData ?? undefined,
              spec.slots ?? undefined,
            )
            // Bail if the engine was disposed mid-load so we don't register a
            // renderer into a torn-down provider (dispose() → destroy()).
            if (isDisposed) return
          } catch (err) {
            getLog().error('Failed to preload Lottie', { itemId: lottieItem.id, error: err })
          }
        }),
      )
      getLog().debug('All Lottie animations loaded')
    }
  }

  /** Loads animated WebP frames via the cache service (main thread only). */
  const preloadAnimatedWebpFrames = async (): Promise<void> => {
    if (hasDom && webpItems.some((item) => !gifFramesMap.has(item.id))) {
      getLog().debug('Preloading animated WebP frames', { webpCount: webpItems.length })

      const webpLoadPromises = webpItems.map(async (webpItem) => {
        try {
          const mediaId = webpItem.mediaId ?? webpItem.id
          const cachedFrames = await gifFrameCache.getWebpFrames(mediaId, webpItem.src)
          gifFramesMap.set(webpItem.id, cachedFrames)
          getLog().debug('Animated WebP frames loaded', {
            itemId: webpItem.id.substring(0, 8),
            frameCount: cachedFrames.frames.length,
            totalDuration: cachedFrames.totalDuration,
          })
        } catch (err) {
          getLog().error('Failed to load WebP frames', { itemId: webpItem.id, error: err })
          // WebP will fallback to static image rendering
        }
      })

      await Promise.all(webpLoadPromises)
    }
  }

  /**
   * Classifies one sub-comp item: resolves its playable source (proxy/blob or
   * inline `src`) or defers it for async URL resolution.
   */
  const collectSubCompItemMedia = (
    subItem: TimelineItem,
    subCompMediaItems: Array<{ subItem: TimelineItem; src: string }>,
    pendingResolutions: Array<{ subItem: TimelineItem; mediaId: string }>,
  ): void => {
    if (subItem.type !== 'video' && subItem.type !== 'image' && subItem.type !== 'lottie') return
    if (subItem.mediaId) {
      const src = selectNestedMediaSource({
        useProxyMedia,
        proxyUrl: useProxyMedia ? resolveProxyUrl(subItem.mediaId) : null,
        sourceUrl: blobUrlManager.get(subItem.mediaId),
      })
      if (src) {
        subCompMediaItems.push({ subItem, src })
      } else {
        pendingResolutions.push({ subItem, mediaId: subItem.mediaId })
      }
    } else {
      const src = (subItem as VideoItem | ImageItem | LottieItem).src ?? ''
      if (src) subCompMediaItems.push({ subItem, src })
    }
  }

  /**
   * Walks every reachable sub-composition: syncs its pre-computed render data
   * and collects its media items (resolving proxy/blob sources), deferring
   * items whose media URL is not yet available. In comparison mode the
   * collection is narrowed to priority media in place.
   */
  const collectSubCompMedia = (
    compositionById: Record<string, SubComposition>,
    subCompMediaItems: Array<{ subItem: TimelineItem; src: string }>,
    pendingResolutions: Array<{ subItem: TimelineItem; mediaId: string }>,
    prioritySubCompMediaItemIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): void => {
    const reachableCompositionIds = collectReachableCompositionIdsFromTracks(
      tracks,
      compositionById,
    )
    for (const compositionId of reachableCompositionIds) {
      throwIfAborted(signal)
      const subComp = compositionById[compositionId]
      if (!subComp) {
        getLog().warn('Sub-composition not found in store!', {
          compositionId,
          storeCompositionCount: useCompositionsStore.getState().compositions.length,
          storeCompositionIds: useCompositionsStore
            .getState()
            .compositions.map((c) => c.id.substring(0, 8)),
        })
        continue
      }

      if (subCompRenderDataSource.get(compositionId) !== subComp) {
        subCompRenderData.set(compositionId, buildSubCompRenderDataEntry(subComp))
        subCompRenderDataSource.set(compositionId, subComp)
      }

      for (const subItem of subComp.items) {
        collectSubCompItemMedia(subItem, subCompMediaItems, pendingResolutions)
      }
    }

    if (isComparisonMode) {
      const priorityMedia = selectRendererPreloadItems(
        rendererMode,
        subCompMediaItems,
        prioritySubCompMediaItemIds,
        ({ subItem }) => subItem.id,
      )
      subCompMediaItems.splice(0, subCompMediaItems.length, ...priorityMedia)
    }
  }

  /**
   * Registers sub-comp video items with the extractor registry (binding DOM
   * fallback elements where available). Returns the registered item ids.
   */
  const registerSubCompVideos = (
    subCompMediaItems: ReadonlyArray<{ subItem: TimelineItem; src: string }>,
  ): string[] => {
    const subVideoItemIds: string[] = []
    for (const { subItem, src } of subCompMediaItems) {
      if (subItem.type === 'video' && !videoExtractors.has(subItem.id)) {
        registerVideoItem(subItem.id, src)
        subVideoItemIds.push(subItem.id)
        if (hasDom && !previewStrictDecode) {
          bindFallbackVideoElement(subItem.id, src)
        }
      }
    }
    return subVideoItemIds
  }

  /** Loads fallback video elements for sub-comp items that failed mediabunny init. */
  const preloadSubCompFallbackVideos = async (
    subCompMediaItems: ReadonlyArray<{ subItem: TimelineItem; src: string }>,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (hasDom && !previewStrictDecode) {
      const subFallbackVideoIds = subCompMediaItems
        .filter(({ subItem }) => subItem.type === 'video' && !useMediabunny.has(subItem.id))
        .map(({ subItem }) => subItem.id)

      if (subFallbackVideoIds.length > 0) {
        const uniqueSubVideos = new Map<HTMLVideoElement, string>()
        for (const itemId of subFallbackVideoIds) {
          const video = videoElements.get(itemId)
          if (video && !uniqueSubVideos.has(video)) {
            uniqueSubVideos.set(video, itemId)
          }
        }

        const subVideoLoadPromises = Array.from(uniqueSubVideos.entries()).map(([video, itemId]) =>
          waitForFallbackVideoReady({ video, itemId, signal, context: 'nested' }),
        )
        await Promise.all(subVideoLoadPromises)
      }
    }
  }

  /** Whether an item is currently eligible for mediabunny prewarm decode. */
  const isPrewarmDecodeEligible = (itemId: string): boolean =>
    useMediabunny.has(itemId) && !mediabunnyDisabledItems.has(itemId)

  /** Source timestamp for a prewarm draw, clamped into the extractor range. */
  const getPrewarmClampedTime = (
    item: VideoItem,
    frame: number,
    extractor: VideoFrameSource,
  ): number => {
    const sourceTime = getPrewarmVideoSourceTimeSeconds(item, frame, fps)
    return Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01))
  }

  /**
   * Records a prewarm decode failure, disabling mediabunny for the item after
   * repeated failures. Returns the updated failure count.
   */
  const recordPrewarmFailure = (itemId: string): number => {
    const failures = (mediabunnyFailureCountByItem.get(itemId) ?? 0) + 1
    mediabunnyFailureCountByItem.set(itemId, failures)
    if (failures >= PREWARM_FAILURE_DISABLE_THRESHOLD) {
      mediabunnyDisabledItems.add(itemId)
      useMediabunny.delete(itemId)
    }
    return failures
  }

  /** Notifies onPriorityMediaReady once; warns (never throws) on callback failure. */
  const createPriorityReadyNotifier = (onPriorityMediaReady?: () => void): (() => void) => {
    let notified = false
    return () => {
      if (notified) return
      notified = true
      try {
        onPriorityMediaReady?.()
      } catch (err) {
        getLog().warn('onPriorityMediaReady callback threw', { error: err })
      }
    }
  }

  /** Resolves deferred sub-comp media URLs, dropping entries that fail to resolve. */
  const resolvePendingSubCompMedia = async (
    entries: ReadonlyArray<{ subItem: TimelineItem; mediaId: string }>,
    signal?: AbortSignal,
  ): Promise<Array<{ subItem: TimelineItem; src: string }>> => {
    throwIfAborted(signal)
    const resolved = await Promise.all(
      entries.map(async ({ subItem, mediaId }) => ({
        subItem,
        src: await resolveMediaUrl(mediaId),
      })),
    )
    throwIfAborted(signal)
    return resolved.filter(({ src }) => !!src)
  }

  /**
   * Preloads sub-comp images and Lottie renderers (applying animation/theme +
   * text/color edits so compound-clip Lotties reflect them on export, parity
   * with preview). Returns the collected items for progress logging.
   */
  const preloadSubCompImagesAndLotties = async (
    subCompMediaItems: ReadonlyArray<{ subItem: TimelineItem; src: string }>,
    signal?: AbortSignal,
  ): Promise<{ subImageItems: ImageItem[]; subLottieItems: LottieItem[] }> => {
    const subImageItems = subCompMediaItems.flatMap(({ subItem, src }) =>
      subItem.type === 'image' ? [{ ...subItem, src } as ImageItem] : [],
    )
    const subLottieItems = subCompMediaItems.flatMap(({ subItem, src }) =>
      subItem.type === 'lottie' ? [{ ...subItem, src } as LottieItem] : [],
    )
    await Promise.all(subImageItems.map((item) => ensureImageItemReady(item, signal)))

    if (hasDom && subLottieItems.length > 0) {
      await Promise.all(subLottieItems.map((item) => ensureLottieItemReady(item, signal)))
    }
    return { subImageItems, subLottieItems }
  }

  /** Returns `performance.now()` when perf tracking is enabled, else -1. */
  const perfMarkIfEnabled = (enabledMs: number): number => (enabledMs >= 0 ? performance.now() : -1)

  /**
   * Refreshes per-frame render context: cache mode, decode capture flags, and
   * sub-comp render data (so edits inside compound clips show up during
   * playback; reference-equality keeps unchanged compositions at ~zero cost).
   */
  const refreshFrameRenderContext = (frame: number): void => {
    const renderedFrameCacheMode = resolveRenderedFrameCacheMode({
      previousFrame: lastRenderedFrame,
      frame,
      fps,
    })
    itemRenderContext.captureDecodedVideoFrames =
      Boolean(scrubbingCache && frameRenderDeps.scrubbingFrameCacheActive) && renderedFrameCacheMode !== 'skip'
    itemRenderContext.nonBlockingVideoFrameToleranceSeconds = nonBlockingVideoFrameToleranceSeconds
    itemRenderContext.workerPredecodeWaitMs =
      nonBlockingVideoFrameToleranceSeconds === undefined
        ? resolveWorkerPredecodeWaitMs(rendererMode, renderedFrameCacheMode)
        : 0

    // This matters for nested compounds where `renderCompositionItem` reads
    // sub-item effects directly from the cached snapshot — without this
    // refresh, effects added after renderer creation stay invisible.
    if (renderMode === 'preview') {
      refreshSubCompRenderData(useCompositionsStore.getState().compositionById)
    }
  }

  /**
   * Clears the canvas and resolves masks plus the frame scene for a frame
   * (including development transition/frame logging).
   */
  const resolveFrameSceneState = (
    frame: number,
  ): {
    activeMasks: ReturnType<typeof getActiveMasksForFrame>
    frameScene: ReturnType<typeof frameSceneCache.resolve>
  } => {
    // Clear canvas
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Prepare masks for this frame
    const activeMasks = getActiveMasksForFrame(
      maskFrameIndex,
      frame,
      maskSettings,
      getCurrentKeyframes,
      renderMode === 'preview' ? getPreviewTransformOverride : undefined,
      renderMode === 'preview' ? getPreviewPathVerticesOverride : undefined,
      renderMode === 'preview' ? getLiveMaskItem : undefined,
      canvasSettings.getExpressionItem,
    )

    const frameScene = frameSceneCache.resolve(
      {
        renderPlan: getCurrentRenderPlan(),
        frame,
        canvas: getLogicalCanvasSize(canvasSettings),
        getKeyframes: getCurrentKeyframes,
        getItem: canvasSettings.getExpressionItem,
        getPreviewTransform: renderMode === 'preview' ? getPreviewTransformOverride : undefined,
        getPreviewPathVertices:
          renderMode === 'preview' ? getPreviewPathVerticesOverride : undefined,
      },
      frameSceneRevision,
    )
    const { activeTransitions, transitionClipIds } = frameScene.transitionFrameState

    // Debug: Log transition state at key frames (only in development)
    if (
      import.meta.env.DEV &&
      activeTransitions.length > 0 &&
      (frame === activeTransitions[0]?.transitionStart || frame % 30 === 0)
    ) {
      getLog().info(
        `TRANSITION STATE: frame=${frame} activeTransitions=${activeTransitions.length} skippedClipIds=${Array.from(
          transitionClipIds,
        )
          .map((id) => id.substring(0, 8))
          .join(',')}`,
      )
    }

    // Log periodically (only in development)
    if (import.meta.env.DEV && frame % 30 === 0) {
      getLog().debug('Rendering frame', {
        frame,
        tracksCount: sortedTracks.length,
        activeMasks: activeMasks.length,
        activeTransitions: activeTransitions.length,
      })
    }
    return { activeMasks, frameScene }
  }

  /**
   * Sets up the GPU compositor when non-normal blend modes need it. Returns
   * whether compositing runs on GPU plus the composite output target (if any).
   */
  const setupGpuCompositor = async (
    hasNonNormalBlend: boolean,
  ): Promise<{
    useGpuCompositor: boolean
    gpuCompositeOutput: ReturnType<NonNullable<typeof gpu.ensureCompositeOutput>> | null
  }> => {
    if (hasNonNormalBlend && !itemRenderContext.gpuPipeline) {
      itemRenderContext.gpuPipeline = await gpu.ensureEffects()
      if (!itemRenderContext.gpuPipeline) {
        getLog().warn('GPU pipeline init failed - blend modes will use Canvas2D fallback')
      }
    }
    const useGpuCompositor = Boolean(
      hasNonNormalBlend && itemRenderContext.gpuPipeline && gpu.effects && gpu.ensureCompositor(),
    )
    return {
      useGpuCompositor,
      gpuCompositeOutput: useGpuCompositor
        ? gpu.ensureCompositeOutput(canvasSettings.width, canvasSettings.height)
        : null,
    }
  }

  /** Releases per-task outputs and pooled canvases after an aborted frame. */
  const discardFrameResults = (
    results: Array<RenderedTaskResult | null>,
    contentCanvas: OffscreenCanvas,
  ): void => {
    for (const result of results) {
      if (!result) continue
      for (const pooledCanvas of result.poolCanvases) {
        canvasPool.release(pooledCanvas)
      }
      if (result.gpuTexture) {
        gpu.texturePool?.release(result.gpuTexture)
      }
    }
    canvasPool.release(contentCanvas)
  }

  /**
   * Lazily initializes the GPU pipelines needed for a frame: effects (+ media)
   * when any item needs the GPU path, and the transition pipeline (+ its
   * companion media/shape/text/mask pipelines) when transitions are active.
   */
  const ensureFrameGpuPipelines = async (
    hasAnyGpuEffects: boolean,
    hasActiveTransitions: boolean,
  ): Promise<void> => {
    if (hasAnyGpuEffects || hasActiveTransitions) {
      if (!itemRenderContext.gpuPipeline) {
        itemRenderContext.gpuPipeline = await gpu.ensureEffects()
      }
      if (itemRenderContext.gpuPipeline) {
        // Initialize GPU transition pipeline (shares device with effects pipeline)
        if (hasAnyGpuEffects) {
          if (!itemRenderContext.gpuMediaPipeline) gpu.ensureMedia()
          itemRenderContext.gpuMediaPipeline = gpu.media
        }
        if (hasActiveTransitions) {
          if (!itemRenderContext.gpuTransitionPipeline) gpu.ensureTransition()
          if (!itemRenderContext.gpuMediaPipeline) gpu.ensureMedia()
          if (!itemRenderContext.gpuMediaBlendPipeline) gpu.ensureMediaBlend()
          if (!itemRenderContext.gpuShapePipeline) gpu.ensureShape()
          if (!itemRenderContext.gpuTextPipeline) gpu.ensureText()
          if (!itemRenderContext.gpuMaskCombinePipeline) gpu.ensureMaskCombine()
          itemRenderContext.gpuTransitionPipeline = gpu.transition
          itemRenderContext.gpuMediaPipeline = gpu.media
          itemRenderContext.gpuMediaBlendPipeline = gpu.mediaBlend
          itemRenderContext.gpuShapePipeline = gpu.shape
          itemRenderContext.gpuTextPipeline = gpu.text
          itemRenderContext.gpuMaskCombinePipeline = gpu.maskCombine
        }
      }
    }
  }

  // Renderer-lifetime dependencies for the per-frame pass, assembled once so the
  // pass reads them instead of re-closing over the factory scope on every frame.
  // The four mutable entries (abort/pending/fallback/cache-mode) live here so the
  // prewarm and cache paths share exactly one storage location with the pass.
  const frameRenderDeps: FrameRenderDeps = {
    gpu,
    canvasPool,
    canvasSettings,
    maskSettings,
    itemRenderContext,
    adjustmentLayers,
    lottieItems,
    transitionTrackOrderById,
    videoExtractors,
    sortedTracks,
    tracksTopToBottom,
    visibleTrackIds,
    setupGpuCompositor,
    scrubbingCache,
    ctx,
    canvas,
    renderMode,
    scrubbingFrameCacheActive: shouldUseScrubbingFrameCache(
      Boolean(scrubbingCache),
      liveDomVideoPlaybackActive,
    ),
    lastRenderAborted: false,
    activePreviewFramePending: false,
    activePreviewFallbackUsed: false,
    cacheRenderedFrame,
    detectFrameGpuEffects,
    discardFrameResults,
    ensureFrameGpuPipelines,
    ensureLottieOverridesFresh,
    lottieOverridesAreStale,
    refreshFrameRenderContext,
    resolveFrameSceneState,
    perfMarkIfEnabled,
    getCurrentKeyframes,
    getCurrentItem,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getLiveItemSnapshot,
  }
  const frameRenderPass = new FrameRenderPass(frameRenderDeps)

  return {
    async preload(
      options: {
        priorityFrame?: number
        priorityFrames?: readonly number[]
        priorityWindowFrames?: number
        onPriorityMediaReady?: () => void
        signal?: AbortSignal
      } = {},
    ) {
      const { signal } = options
      throwIfAborted(signal)
      // Composition items require the compositions store which only exists on main thread.
      // Workers get a fresh, empty Zustand store, so sub-comp data can never be resolved.
      // Bail early to trigger the main-thread fallback path. Use reachability rather than a
      // narrow `type === 'composition'` scan so sub-comps referenced only through a linked-audio
      // wrapper item are caught too — otherwise nested Lottie/GIF/WebP (invisible to the
      // top-level media lists) would slip past into the sub-comp preload and export blank.
      const hasCompositionItems =
        collectReachableCompositionIdsFromTracks(
          tracks,
          useCompositionsStore.getState().compositionById,
        ).length > 0
      if (!hasDom && hasCompositionItems) {
        throw new Error('WORKER_REQUIRES_MAIN_THREAD:composition')
      }

      const priorityFrames = [options.priorityFrame, ...(options.priorityFrames ?? [])]
        .filter((frame): frame is number => Number.isFinite(frame))
        .map((frame) => Math.round(frame))
        .filter((frame, index, frames) => frames.indexOf(frame) === index)
      const priorityFrame = priorityFrames[0] ?? null
      const priorityWindowFrames = Math.max(4, Math.round(options.priorityWindowFrames ?? fps * 4))
      const compositionById = useCompositionsStore.getState().compositionById
      const priorityMediaItemIds = collectPriorityMediaItemIdsForFrames({
        tracks,
        frames: priorityFrames,
        fps,
        compositionById,
      })
      const priorityImageItemIds = new Set(priorityMediaItemIds.image)
      const priorityLottieItemIds = new Set(priorityMediaItemIds.lottie)
      const prioritizedMainVideoIds =
        priorityFrame === null
          ? []
          : isComparisonMode
            ? priorityMediaItemIds.video.filter((itemId) => videoItemsById.has(itemId))
            : collectPriorityVideoItemIds(priorityFrame, priorityWindowFrames)

      getLog().debug('Preloading media', {
        videoCount: videoExtractors.size,
        videoSourceCount: new Set(videoSourceByItemId.values()).size,
        imageCount: imageElements.size,
      })

      // Preload runs as named stages in fixed order. Each stage keeps its own
      // abort checks and worker guards exactly where they were, so cancellation
      // and main-thread fallback timing are unchanged — the loop only sequences.
      const stages: Array<{ name: string; run: () => Promise<void> }> = [
        {
          name: 'top-level-images',
          run: async () => {
            const topLevelImageLoads = isComparisonMode
              ? selectRendererPreloadItems(
                  rendererMode,
                  imageItems,
                  priorityImageItemIds,
                  (item) => item.id,
                ).map((item) => ensureImageItemReady(item, signal))
              : imageLoadPromises
            await Promise.all(topLevelImageLoads)
            throwIfAborted(signal)
          },
        },
        {
          name: 'worker-guards',
          run: async () => {
            if (!hasDom && (gifItems.length > 0 || webpItems.length > 0)) {
              throw new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image')
            }

            if (!hasDom && lottieItems.length > 0) {
              throw new Error('WORKER_REQUIRES_MAIN_THREAD:lottie')
            }
          },
        },
        {
          name: 'top-level-lotties',
          run: async () => {
            const topLevelLottieItems = isComparisonMode
              ? selectRendererPreloadItems(
                  rendererMode,
                  lottieItems,
                  priorityLottieItemIds,
                  (item) => item.id,
                )
              : lottieItems
            if (isComparisonMode && hasDom && topLevelLottieItems.length > 0) {
              await Promise.all(
                topLevelLottieItems.map((item) =>
                  ensureLottieItemReady(item, signal).catch((error) => {
                    if (signal?.aborted) throw error
                    getLog().error('Failed to preload Lottie', { itemId: item.id, error })
                  }),
                ),
              )
            }
            throwIfAborted(signal)
          },
        },
        {
          name: 'comparison-main-videos',
          run: async () => {
            if (isComparisonMode) {
              await Promise.all(
                prioritizedMainVideoIds.map((itemId) =>
                  ensureVideoItemReady(itemId, videoItemsById.get(itemId), signal),
                ),
              )
            }
          },
        },
        {
          name: 'main-video-extractors',
          run: async () => {
            // === Initialize mediabunny video extractors (primary method) ===
            if (prioritizedMainVideoIds.length > 0) {
              await initializeMediabunnyForItems(prioritizedMainVideoIds, signal)
            }
            const mainVideoPreloadPlan = resolveVideoPreloadPlan(
              rendererMode,
              videoExtractors.keys(),
              prioritizedMainVideoIds,
            )
            // Export needs every source ready before frame 0. Preview renders initialize
            // a missed source on demand, so opening all remaining project media here only
            // creates decoder/GC churn for clips the user may never visit.
            if (mainVideoPreloadPlan.eagerItemIds.length > 0) {
              await initializeMediabunnyForItems(mainVideoPreloadPlan.eagerItemIds, signal)
            }
            throwIfAborted(signal)

            getLog().info('Video initialization complete', {
              mediabunny: useMediabunny.size,
              deferred: mainVideoPreloadPlan.deferredItemIds.length,
              fallback:
                renderMode === 'export' ? videoExtractors.size - useMediabunny.size : undefined,
              uniqueSources: new Set(videoSourceByItemId.values()).size,
            })

            reportPreviewDecodeCoverage(prioritizedMainVideoIds)
          },
        },
        {
          name: 'comparison-fallback-bind',
          run: async () => {
            if (isComparisonMode && hasDom) {
              for (const itemId of prioritizedMainVideoIds) {
                if (useMediabunny.has(itemId)) continue
                const src = videoSourceByItemId.get(itemId)
                if (src) bindFallbackVideoElement(itemId, src)
              }
            }
          },
        },

        {
          name: 'fallback-videos',
          run: async () => {
            // === Preload ALL fallback video elements ===
            // Load every video element (not just those that failed mediabunny init)
            // so the HTML5 fallback is ready if mediabunny fails mid-export.
            // This is critical for transitions where the outgoing clip's extractor
            // may fail past the source duration boundary.
            const allVideoIds = Array.from(videoElements.keys())
            const fallbackVideoIds = isComparisonMode ? prioritizedMainVideoIds : allVideoIds

            await preloadFallbackVideoElements(fallbackVideoIds, signal)
            throwIfAborted(signal)
          },
        },
        {
          name: 'lottie-renderers',
          run: async () => {
            await preloadLottieRenderers()
          },
        },
        {
          name: 'animated-webp-frames',
          run: async () => {
            await preloadAnimatedWebpFrames()
          },
        },
      ]
      for (const stage of stages) {
        await stage.run()
      }

      // === PRELOAD SUB-COMPOSITION MEDIA & BUILD RENDER DATA ===
      // CompositionItem references sub-compositions with their own media items.
      // We preload media AND build pre-computed render data to avoid per-frame
      // sorting, filtering, and linear searches in renderCompositionItem.
      // Shared across the sub-comp stages below; the fixed stage order keeps
      // the original sequencing (collect → resolve → register → load).
      const subCompState = {
        items: [] as Array<{ subItem: TimelineItem; src: string }>,
        pending: [] as Array<{ subItem: TimelineItem; mediaId: string }>,
        deferredPending: [] as Array<{ subItem: TimelineItem; mediaId: string }>,
        resolveDeferredBeforeRegistration: false,
      }
      const prioritySubCompVideoItemIds = new Set(priorityMediaItemIds.video)
      const prioritySubCompMediaItemIds = new Set([
        ...priorityMediaItemIds.video,
        ...priorityMediaItemIds.image,
        ...priorityMediaItemIds.lottie,
      ])
      const notifyPriorityMediaReady = createPriorityReadyNotifier(options.onPriorityMediaReady)

      const subCompStages: Array<{ name: string; run: () => Promise<void> }> = [
        {
          name: 'sub-comp-collect',
          run: async () => {
            collectSubCompMedia(
              compositionById,
              subCompState.items,
              subCompState.pending,
              prioritySubCompMediaItemIds,
              signal,
            )
            const priorityPendingResolutions = subCompState.pending.filter(({ subItem }) =>
              prioritySubCompMediaItemIds.has(subItem.id),
            )
            subCompState.deferredPending = subCompState.pending.filter(
              ({ subItem }) => !prioritySubCompMediaItemIds.has(subItem.id),
            )
            subCompState.items.push(
              ...(await resolvePendingSubCompMedia(priorityPendingResolutions, signal)),
            )

            subCompState.resolveDeferredBeforeRegistration =
              !isComparisonMode && subCompState.items.length === 0
            if (subCompState.resolveDeferredBeforeRegistration) {
              notifyPriorityMediaReady()
              subCompState.items.push(
                ...(await resolvePendingSubCompMedia(subCompState.deferredPending, signal)),
              )
            }
          },
        },
        {
          name: 'sub-comp-videos',
          run: async () => {
            if (subCompState.items.length === 0) return
            getLog().debug('Preloading sub-composition media', {
              count: subCompState.items.length,
            })

            // Preload sub-comp video extractors
            const subVideoItemIds = registerSubCompVideos(subCompState.items)
            const prioritizedSubVideoItemIds = subVideoItemIds.filter((itemId) =>
              prioritySubCompVideoItemIds.has(itemId),
            )
            if (prioritizedSubVideoItemIds.length > 0) {
              await initializeMediabunnyForItems(prioritizedSubVideoItemIds, signal)
            }

            // Signal that priority media for the current frame is ready. The
            // preview controller uses this to trigger a re-render before the
            // rest of preload (remaining videos, sub images, GIF/WebP frames)
            // finishes — so the user sees the correct frame faster after
            // exiting a sub-composition.
            if (!isComparisonMode) notifyPriorityMediaReady()

            const deferredResolvedMedia =
              isComparisonMode || subCompState.resolveDeferredBeforeRegistration
                ? []
                : await resolvePendingSubCompMedia(subCompState.deferredPending, signal)
            subCompState.items.push(...deferredResolvedMedia)
            for (const { subItem, src } of deferredResolvedMedia) {
              if (subItem.type === 'video' && !videoExtractors.has(subItem.id)) {
                registerVideoItem(subItem.id, src)
                subVideoItemIds.push(subItem.id)
                if (hasDom && !previewStrictDecode) {
                  bindFallbackVideoElement(subItem.id, src)
                }
              }
            }

            const subVideoPreloadPlan = resolveVideoPreloadPlan(
              rendererMode,
              subVideoItemIds,
              prioritizedSubVideoItemIds,
            )
            if (subVideoPreloadPlan.eagerItemIds.length > 0) {
              await initializeMediabunnyForItems(subVideoPreloadPlan.eagerItemIds, signal)
            }
            throwIfAborted(signal)

            reportPreviewDecodeCoverage(prioritizedSubVideoItemIds)
          },
        },
        {
          name: 'sub-comp-fallback-videos',
          run: async () => {
            if (subCompState.items.length === 0) return
            // Load fallback video elements for sub-comp items that failed mediabunny init
            await preloadSubCompFallbackVideos(subCompState.items, signal)
          },
        },
        {
          name: 'sub-comp-images',
          run: async () => {
            if (subCompState.items.length === 0) return
            // Preload sub-comp images, then Lottie renderers (applying
            // animation/theme + text/color edits so compound-clip Lotties reflect
            // them on export, parity with preview).
            const { subImageItems, subLottieItems } = await preloadSubCompImagesAndLotties(
              subCompState.items,
              signal,
            )
            throwIfAborted(signal)
            if (isComparisonMode) notifyPriorityMediaReady()

            getLog().debug('Sub-composition media loaded', {
              videos: subCompState.items.filter((s) => s.subItem.type === 'video').length,
              images: subCompState.items.filter((s) => s.subItem.type === 'image').length,
              animatedImages: subImageItems.filter(isAnimatedImage).length,
              lotties: subLottieItems.length,
            })
          },
        },
      ]
      for (const stage of subCompStages) {
        await stage.run()
      }

      if (isComparisonMode) notifyPriorityMediaReady()

      getLog().debug('All media loaded')
    },

    async renderFrame(frame: number) {
      await frameRenderPass.run(frame)
    },

    wasLastRenderAborted() {
      return frameRenderDeps.lastRenderAborted
    },

    wasLastRenderFallback() {
      return frameRenderDeps.activePreviewFallbackUsed
    },

    async prewarmFrame(frame: number) {
      // Lightweight decoder warm-up path for scrubbing:
      // decode only nearby video items into a 1x1 target without running full composition.
      const ctx2d = getPrewarmContext()
      if (!ctx2d) return

      const candidates = collectPrewarmVideoCandidatesForFrame(frame)

      const missingCandidateItemIds = candidates
        .map((item) => item.id)
        .filter((itemId) => !useMediabunny.has(itemId) && !mediabunnyDisabledItems.has(itemId))
      if (missingCandidateItemIds.length > 0) {
        await initializeMediabunnyForItems(missingCandidateItemIds)
      }

      for (const item of candidates) {
        if (!isPrewarmDecodeEligible(item.id)) continue
        const extractor = videoExtractors.get(item.id)
        if (!extractor) continue

        const clampedTime = getPrewarmClampedTime(item, frame, extractor)

        try {
          const success = await extractor.drawFrame(ctx2d, clampedTime, 0, 0, 1, 1)
          if (success) {
            mediabunnyFailureCountByItem.set(item.id, 0)
          } else {
            // Skip transient "no-sample" misses (same guard as renderVideoItem).
            const failureKind = extractor.getLastFailureKind()
            if (failureKind !== 'no-sample') {
              recordPrewarmFailure(item.id)
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') continue
          const failures = recordPrewarmFailure(item.id)
          getLog().warn('Prewarm decode failed', { itemId: item.id, frame, failures, error })
        }
      }
    },

    /**
     * Batch-prewarm multiple frames using mediabunny's samplesAtTimestamps()
     * pipeline. Groups source timestamps by extractor and decodes each packet
     * at most once across the batch.
     *
     * Falls back to sequential prewarmFrame() for extractors where batch mode
     * has been disabled (e.g. due to "key frame required after flush" errors).
     *
     * @returns Number of frames that used batch path (vs fallback).
     */
    async prewarmFrames(frames: number[]) {
      if (frames.length === 0) return
      const ctx2d = getPrewarmContext()
      if (!ctx2d) return

      // Expand frames → candidate items → source timestamps grouped by extractor
      const batchByExtractor = new Map<
        string,
        { extractor: ReturnType<typeof videoExtractors.get>; timestamps: number[] }
      >()
      const fallbackFrames: number[] = []

      for (const frame of frames) {
        const candidates = collectPrewarmVideoCandidatesForFrame(frame)

        for (const item of candidates) {
          if (!isPrewarmDecodeEligible(item.id)) continue
          const extractor = videoExtractors.get(item.id)
          if (!extractor) continue

          // Check if batch mode is available for this extractor
          if (!extractor.isBatchPrewarmAvailable()) {
            if (!fallbackFrames.includes(frame)) fallbackFrames.push(frame)
            continue
          }

          const clampedTime = getPrewarmClampedTime(item, frame, extractor)

          const existing = batchByExtractor.get(item.id)
          if (existing) {
            existing.timestamps.push(clampedTime)
          } else {
            batchByExtractor.set(item.id, { extractor, timestamps: [clampedTime] })
          }
        }
      }

      // Initialize any missing extractors
      const missingIds = [...batchByExtractor.keys()].filter(
        (id) => !useMediabunny.has(id) && !mediabunnyDisabledItems.has(id),
      )
      if (missingIds.length > 0) {
        await initializeMediabunnyForItems(missingIds)
      }

      // Batch decode per extractor — sorted timestamps for optimal pipeline
      await Promise.all(
        [...batchByExtractor.entries()].map(async ([itemId, { extractor, timestamps }]) => {
          if (isDisposed || !extractor) return
          timestamps.sort((a, b) => a - b)
          const result = await extractor.prewarmBatch(ctx2d, timestamps, 0, 0, 1, 1)
          if (result >= 0) {
            mediabunnyFailureCountByItem.set(itemId, 0)
          }
          // result === -1 means batch disabled or failed — fallback frames
          // are handled below
        }),
      )

      // Sequential fallback for extractors where batch is disabled
      for (const frame of fallbackFrames) {
        if (isDisposed) break
        const candidates = collectPrewarmVideoCandidatesForFrame(frame)
        for (const item of candidates) {
          if (!isPrewarmDecodeEligible(item.id)) continue
          const extractor = videoExtractors.get(item.id)
          if (!extractor) continue
          const clampedTime = getPrewarmClampedTime(item, frame, extractor)
          try {
            await extractor.drawFrame(ctx2d, clampedTime, 0, 0, 1, 1)
          } catch {
            /* best-effort fallback */
          }
        }
      }
    },

    setDomVideoElementProvider(
      provider: ((itemId: string) => HTMLVideoElement | null) | undefined,
    ) {
      itemRenderContext.domVideoElementProvider = provider
      liveDomVideoPlaybackActive = Boolean(provider)
      frameRenderDeps.scrubbingFrameCacheActive = shouldUseScrubbingFrameCache(
        Boolean(scrubbingCache),
        liveDomVideoPlaybackActive,
      )
    },

    setNonBlockingVideoFrameTolerance(toleranceSeconds: number | undefined) {
      nonBlockingVideoFrameToleranceSeconds =
        toleranceSeconds === undefined
          ? undefined
          : Math.max(1 / Math.max(1, fps), Math.min(0.5, toleranceSeconds))
    },

    /**
     * Pre-initialize mediabunny decoders for specific item IDs and optionally
     * seek them to a target frame. This warms up the WASM decoder and positions
     * the decode cursor so the first real render is fast (~1ms instead of 300-500ms).
     *
     * For variable-speed clips, also advances the decoder up to ~2.5s ahead of
     * the target frame in sequential 0.5s steps. This ensures the decoder cursor
     * is within the 3s forward-jump threshold of any frame that might be rendered
     * in the near future — preventing 400-500ms keyframe seeks when occluded clips
     * become visible mid-playback.
     */
    async prewarmItems(itemIds: string[], targetFrame?: number) {
      const unready = itemIds.filter(
        (id) =>
          videoExtractors.has(id) && !useMediabunny.has(id) && !mediabunnyDisabledItems.has(id),
      )
      if (unready.length > 0) {
        await initializeMediabunnyForItems(unready)
      }
      // Seek decoders to the target frame position using a 1x1 draw.
      // Run all clips in parallel — each has its own decoder lane.
      // NOTE: localFrame may be negative for incoming transition clips whose
      // timeline `from` is after targetFrame — the transition renderer will
      // still render them. We allow negative localFrame and clamp sourceTime
      // to zero so the decoder is positioned at the clip's start.
      if (targetFrame !== undefined) {
        const ctx2d = getPrewarmContext()
        if (!ctx2d) return
        await Promise.all(
          itemIds.map(async (itemId) => {
            if (isDisposed) return
            const extractor = videoExtractors.get(itemId)
            if (!extractor || !useMediabunny.has(itemId)) return
            const item = videoItemsById.get(itemId)
            if (!item || item.type !== 'video') return
            const localFrame = targetFrame - item.from
            if (localFrame >= item.durationInFrames) return
            const baseSourceTime = getPrewarmVideoSourceTimeSeconds(item, targetFrame, fps)
            try {
              await extractor.drawFrame(ctx2d, Math.max(0, baseSourceTime), 0, 0, 1, 1)
            } catch {
              // Best-effort prewarm — ignore failures.
            }
          }),
        )
      }
    },

    /** Evict cached render frames or cached frame ranges after visual edits. */
    invalidateFrameCache(request?: FrameInvalidationRequest) {
      frameSceneRevision += 1
      frameSceneCache.invalidate(request)
      scrubbingCache?.invalidate(request)
    },

    /** Get the scrubbing cache instance for stats/GPU wiring. */
    getScrubbingCache(): ScrubbingCache | null {
      return scrubbingCache
    },

    /** Get the offscreen canvas this renderer draws into. */
    getCanvas(): OffscreenCanvas {
      return canvas
    },

    /**
     * Eagerly initialize the GPU effects + transition pipelines so the first
     * transition frame doesn't pay the ~100-150ms WebGPU device + shader
     * compilation cost. Safe to call multiple times — no-ops if already warm.
     */
    async warmGpuPipeline(): Promise<void> {
      const pipeline = await gpu.ensureEffects()
      if (pipeline) {
        gpu.ensureTransition()
        gpu.ensureMedia()
        gpu.ensureMediaBlend()
        gpu.ensureShape()
        gpu.ensureText()
        gpu.ensureMaskCombine()
        itemRenderContext.gpuPipeline = pipeline
        itemRenderContext.gpuTransitionPipeline = gpu.transition
        itemRenderContext.gpuMediaPipeline = gpu.media
        itemRenderContext.gpuMediaBlendPipeline = gpu.mediaBlend
        itemRenderContext.gpuShapePipeline = gpu.shape
        itemRenderContext.gpuTextPipeline = gpu.text
        itemRenderContext.gpuMaskCombinePipeline = gpu.maskCombine
      }
    },

    dispose() {
      isDisposed = true
      inFlightInitByItem.clear()

      // Clean up mediabunny video extractors
      for (const [itemId, src] of videoSourceByItemId) {
        sharedVideoExtractors.releaseItem(itemId, src)
      }
      if (sharedPreviewExtractorLease) {
        sharedPreviewExtractorLease.release()
      } else {
        sharedVideoExtractors.dispose()
      }
      videoExtractors.clear()
      videoSourceByItemId.clear()
      videoItemIdsBySource.clear()
      videoItemsById.clear()
      useMediabunny.clear()
      mediabunnyFailureCountByItem.clear()
      mediabunnyInitFailureCountByItem.clear()
      mediabunnyDisabledItems.clear()

      // Clean up fallback video pool and references.
      // In this renderer, fallback video elements are only bound when a DOM is
      // available, which is also when fallbackVideoPool exists.
      if (fallbackVideoPool) {
        for (const clipId of fallbackVideoClipIdByItem.values()) {
          fallbackVideoPool.releaseClip(clipId)
        }
        fallbackVideoPool.dispose()
      }
      fallbackVideoBySrc.clear()
      fallbackVideoClipIdByItem.clear()
      videoElements.clear()
      for (const image of imageElements.values()) {
        if ('close' in image.source && typeof image.source.close === 'function') {
          image.source.close()
        }
      }
      imageElements.clear()
      gifFramesMap.clear() // Clear GIF frame references (actual frames are managed by gifFrameCache)
      lottieProvider.destroy() // Tear down dotlottie WASM instances
      subCompRenderData.clear() // Release sub-composition render data references
      itemRenderContext.instanceSubCompRenderDataCache?.clear()
      subCompRenderDataSource.clear()
      prewarmCtx = null
      prewarmCanvas = null
      prewarmAttempted = false

      // === PERFORMANCE: Clean up optimization resources ===
      scrubbingCache?.dispose()
      reverseVideoFrameCache?.dispose()
      // Preview-only cross-frame caches hold canvas backing stores (hundreds of
      // MB for text rasters / corner-pin warps); drop them now instead of at GC.
      itemRenderContext.textRasterCache?.clear()
      itemRenderContext.cornerPinWarpCache?.clear()

      gpu.dispose()
      frameSceneCache.invalidate()
      canvasPool.dispose()
      textMeasureCache.clear()

      // Log pool stats in development
      if (import.meta.env.DEV) {
        getLog().debug('Canvas pool disposed', canvasPool.getStats())
      }
    },
  }
}

/**
 * The renderer instance the preview and export pipelines drive frame-by-frame.
 *
 * Named here, next to the factory that produces it, so consumers import one
 * type instead of re-deriving it from the factory signature.
 */
export type CompositionRendererInstance = Awaited<ReturnType<typeof createCompositionRenderer>>
