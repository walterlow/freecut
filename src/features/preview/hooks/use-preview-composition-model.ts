import { useCallback, useMemo, useRef } from 'react'
import type { CompositionInputProps } from '@/types/export'
import type { AudioEqSettings } from '@/types/audio'
import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { isColorGradeEffectType } from '@/infrastructure/gpu-effects'
import { usePlaybackStore } from '@/shared/state/playback'
import { resolveEffectiveTrackStates } from '@/features/preview/deps/timeline-utils'
import { useCompositionsStore, useItemsStore } from '@/features/preview/deps/timeline-store'
import { appendVirtualTranscriptCaptionTrack } from '@/features/preview/deps/caption-items'
import { useCornerPinStore } from '../stores/corner-pin-store'
import { useGizmoStore, type ItemPreview } from '../stores/gizmo-store'
import { useMaskEditorStore } from '../stores/mask-editor-store'
import { resolveGizmoWorldPreviewAsLocal } from '../utils/gizmo-world-preview'
import { resolveProxyUrl } from '../utils/media-resolver'
import { getRealtimePreviewRenderSize } from '../utils/preview-render-size'
import {
  getMediaResolveCost,
  toTrackTopologyFingerprint,
  type FastScrubBoundarySource,
  type VideoSourceSpan,
} from '../utils/preview-constants'

/** Return the effects list with enabled color-category effects switched off. */
function withColorGradeBypassed(effects: ItemEffect[] | undefined): ItemEffect[] | undefined {
  if (!effects || effects.length === 0) return effects
  let changed = false
  const next = effects.map((entry) => {
    if (
      entry.enabled &&
      entry.effect.type === 'gpu-effect' &&
      isColorGradeEffectType(entry.effect.gpuEffectType)
    ) {
      changed = true
      return { ...entry, enabled: false }
    }
    return entry
  })
  return changed ? next : effects
}

/** Resolve an item's current effects, including items inside sub-compositions. */
function findCurrentItemEffects(itemId: string): ItemEffect[] | undefined {
  const item = useItemsStore.getState().itemById[itemId]
  if (item) return item.effects
  for (const composition of useCompositionsStore.getState().compositions) {
    const subItem = composition.items.find((candidate) => candidate.id === itemId)
    if (subItem) return subItem.effects
  }
  return undefined
}

interface PreviewProject {
  width: number
  height: number
  backgroundColor?: string
}

interface PreviewPlayerSize {
  width: number
  height: number
}

interface BuildPreviewCompositionDataParams {
  combinedTracks: TimelineTrack[]
  fps: number
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
  transitions: CompositionInputProps['transitions']
  busAudioEq?: AudioEqSettings
  resolvedUrls: ReadonlyMap<string, string>
  useProxy: boolean
  blobUrlVersion: number
  project: PreviewProject
  previewRenderSize?: PreviewPlayerSize
  resolveProxyUrlFn?: (mediaId: string) => string | null
  getBlobUrlFn?: (mediaId: string) => string | null
}

interface UsePreviewCompositionModelParams {
  combinedTracks: TimelineTrack[]
  fps: number
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
  transitions: CompositionInputProps['transitions']
  busAudioEq?: AudioEqSettings
  resolvedUrls: ReadonlyMap<string, string>
  useProxy: boolean
  proxyReadyCount: number
  blobUrlVersion: number
  project: PreviewProject
  playerSize: PreviewPlayerSize
}

interface UsePreviewCompositionBaseModelParams {
  tracks: TimelineTrack[]
  itemsByTrackId: Record<string, TimelineItem[]>
  mediaById: Record<string, Parameters<typeof getMediaResolveCost>[0]>
}

/**
 * Apply transient panel edits to the item snapshot consumed by the canvas
 * renderer. The DOM player subscribes to the same preview store directly, but
 * the paused fast-scrub canvas needs the values merged into its live snapshot.
 */
export function mergeLiveItemPreview(
  item: TimelineItem,
  preview: ItemPreview | undefined,
): TimelineItem {
  let liveItem = preview?.properties ? ({ ...item, ...preview.properties } as TimelineItem) : item

  if (liveItem.type === 'lottie' && preview?.lottie) {
    liveItem = { ...liveItem, ...preview.lottie }
  }

  return liveItem
}

/**
 * Keep item-local presentation fields current while the composition-wide item
 * snapshot is deferred. Timeline placement/topology still comes from the
 * stable snapshot, but a just-committed text resize must not briefly combine
 * its new transform with stale typography after the gizmo preview clears.
 */
export function mergeLiveItemPresentation(
  item: TimelineItem,
  liveItem: TimelineItem | undefined,
): TimelineItem {
  if (!liveItem || liveItem.id !== item.id || liveItem.type !== item.type) return item

  let itemWithLiveUpdates =
    'transform' in liveItem && 'transform' in item && liveItem.transform !== item.transform
      ? ({ ...item, transform: liveItem.transform } as TimelineItem)
      : item

  if (liveItem.projection360 !== item.projection360) {
    itemWithLiveUpdates = { ...itemWithLiveUpdates, projection360: liveItem.projection360 } as TimelineItem
  }
  if (liveItem.effects !== item.effects) {
    itemWithLiveUpdates = { ...itemWithLiveUpdates, effects: liveItem.effects } as TimelineItem
  }

  if (item.type !== 'text' || liveItem.type !== 'text') return itemWithLiveUpdates

  return {
    ...itemWithLiveUpdates,
    text: liveItem.text,
    textSpans: liveItem.textSpans,
    spanLayout: liveItem.spanLayout,
    textStyleScale: liveItem.textStyleScale,
    textMotion: liveItem.textMotion,
    color: liveItem.color,
    fontSize: liveItem.fontSize,
    fontFamily: liveItem.fontFamily,
    fontWeight: liveItem.fontWeight,
    fontStyle: liveItem.fontStyle,
    underline: liveItem.underline,
    letterSpacing: liveItem.letterSpacing,
    backgroundColor: liveItem.backgroundColor,
    backgroundRadius: liveItem.backgroundRadius,
    textAlign: liveItem.textAlign,
    verticalAlign: liveItem.verticalAlign,
    lineHeight: liveItem.lineHeight,
    textPadding: liveItem.textPadding,
    textShadow: liveItem.textShadow,
    stroke: liveItem.stroke,
  } as TimelineItem
}

export function usePreviewCompositionBaseModel({
  tracks,
  itemsByTrackId,
  mediaById,
}: UsePreviewCompositionBaseModelParams) {
  // resolveEffectiveTrackStates applies parent layer-group state (mute/hide/lock/solo)
  // and filters out Layer Group containers (which hold no items)
  const combinedTracks = useMemo(() => {
    const effectiveTracks = resolveEffectiveTrackStates(tracks).toSorted(
      (a, b) => b.order - a.order,
    )
    return effectiveTracks.map((track) => ({
      ...track,
      items: itemsByTrackId[track.id] ?? [],
    }))
  }, [tracks, itemsByTrackId])

  const mediaResolveCostById = useMemo(() => {
    const costs = new Map<string, number>()
    for (const [mediaId, media] of Object.entries(mediaById)) {
      costs.set(mediaId, getMediaResolveCost(media))
    }
    return costs
  }, [mediaById])

  return {
    combinedTracks,
    mediaResolveCostById,
  }
}

export function usePreviewCompositionModel({
  combinedTracks,
  fps,
  items,
  keyframes,
  transitions,
  busAudioEq,
  resolvedUrls,
  useProxy,
  proxyReadyCount,
  blobUrlVersion,
  project,
  playerSize,
}: UsePreviewCompositionModelParams) {
  const projectWidth = project.width
  const projectHeight = project.height
  const playerWidth = playerSize.width
  const playerHeight = playerSize.height
  const calculatedPreviewRenderSize = getRealtimePreviewRenderSize(
    { width: projectWidth, height: projectHeight },
    { width: playerWidth, height: playerHeight },
  )
  const previewRenderWidth = calculatedPreviewRenderSize.width
  const previewRenderHeight = calculatedPreviewRenderSize.height
  // Keep renderer identity stable while the layout changes inside the same
  // physical-size bucket (especially <=1080p projects, which stay full-size).
  const previewRenderSize = useMemo(
    () => ({ width: previewRenderWidth, height: previewRenderHeight }),
    [previewRenderHeight, previewRenderWidth],
  )
  const {
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    fastScrubTracksTopologyFingerprint,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
  } = useMemo(() => {
    void proxyReadyCount
    return buildPreviewCompositionData({
      combinedTracks,
      fps,
      items,
      keyframes,
      transitions,
      busAudioEq,
      resolvedUrls,
      useProxy,
      blobUrlVersion,
      project,
      previewRenderSize,
    })
  }, [
    blobUrlVersion,
    busAudioEq,
    combinedTracks,
    fps,
    items,
    keyframes,
    project,
    previewRenderSize,
    proxyReadyCount,
    resolvedUrls,
    transitions,
    useProxy,
  ])

  const getPreviewEffectsOverride = useCallback((itemId: string): ItemEffect[] | undefined => {
    const gizmoState = useGizmoStore.getState()
    const playbackState = usePlaybackStore.getState()
    const overriddenEffects = gizmoState.preview?.[itemId]?.effects
    const shouldShowAfterDuringSplitPlayback =
      playbackState.isPlaying && gizmoState.colorGradeComparisonMode === 'split'
    const shouldBypassGrade =
      !shouldShowAfterDuringSplitPlayback &&
      (gizmoState.colorGradeBypassed || gizmoState.colorGradeComparisonMode !== 'off')
    if (!shouldBypassGrade) {
      return overriddenEffects
    }
    // Grade bypass: disable color-category effects in the preview only.
    // Export never receives this override, so renders are unaffected.
    return withColorGradeBypassed(overriddenEffects ?? findCurrentItemEffects(itemId))
  }, [])

  const getPreviewCornerPinOverride = useCallback((itemId: string) => {
    const cornerPinState = useCornerPinStore.getState()
    if (cornerPinState.editingItemId === itemId && cornerPinState.previewCornerPin) {
      return cornerPinState.previewCornerPin
    }
    return undefined
  }, [])

  const getPreviewPathVerticesOverride = useCallback((itemId: string) => {
    const maskState = useMaskEditorStore.getState()
    if (maskState.editingItemId === itemId && maskState.previewVertices) {
      return maskState.previewVertices
    }
    return undefined
  }, [])

  const fastScrubLiveItemsById = useMemo(() => {
    const map = new Map<string, TimelineItem>()
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        map.set(item.id, item)
      }
    }
    return map
  }, [fastScrubScaledTracks])
  const fastScrubLiveItemsByIdRef = useRef<Map<string, TimelineItem>>(fastScrubLiveItemsById)
  fastScrubLiveItemsByIdRef.current = fastScrubLiveItemsById

  const fastScrubKeyframesByItemId = useMemo(
    () => new Map(keyframes.map((entry) => [entry.itemId, entry])),
    [keyframes],
  )
  const fastScrubKeyframesByItemIdRef = useRef<Map<string, ItemKeyframes>>(
    fastScrubKeyframesByItemId,
  )
  fastScrubKeyframesByItemIdRef.current = fastScrubKeyframesByItemId

  const getPreviewTransformOverride = useCallback(
    (itemId: string): Partial<ResolvedTransform> | undefined => {
      const gizmoState = useGizmoStore.getState()
      const unifiedPreviewTransform = gizmoState.preview?.[itemId]?.transform
      if (unifiedPreviewTransform) return unifiedPreviewTransform
      if (gizmoState.activeGizmo?.itemId !== itemId || !gizmoState.previewTransform) {
        return undefined
      }

      const playbackState = usePlaybackStore.getState()
      return resolveGizmoWorldPreviewAsLocal({
        itemId,
        worldPreviewTransform: gizmoState.previewTransform,
        canvas: { width: project.width, height: project.height, fps },
        frame: playbackState.previewFrame ?? playbackState.currentFrame,
        getItem: (candidateId) => fastScrubLiveItemsByIdRef.current.get(candidateId),
        getKeyframes: (candidateId) => fastScrubKeyframesByItemIdRef.current.get(candidateId),
        getLocalPreviewTransform: (candidateId) =>
          useGizmoStore.getState().preview?.[candidateId]?.transform,
      })
    },
    [fps, project.height, project.width],
  )

  const getLiveItemSnapshot = useCallback((itemId: string) => {
    const item = fastScrubLiveItemsByIdRef.current.get(itemId)
    if (!item) return undefined
    const liveItem = useItemsStore.getState().itemById[itemId]
    return mergeLiveItemPreview(
      mergeLiveItemPresentation(item, liveItem),
      useGizmoStore.getState().preview?.[itemId],
    )
  }, [])

  const getLiveKeyframes = useCallback((itemId: string) => {
    return fastScrubKeyframesByItemIdRef.current.get(itemId)
  }, [])

  return {
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
    fastScrubTracksTopologyFingerprint,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
  }
}

export function buildPreviewCompositionData({
  combinedTracks,
  fps,
  items,
  keyframes,
  transitions,
  busAudioEq,
  resolvedUrls,
  useProxy,
  blobUrlVersion,
  project,
  previewRenderSize,
  resolveProxyUrlFn = resolveProxyUrl,
  getBlobUrlFn = (mediaId: string) => blobUrlManager.get(mediaId),
}: BuildPreviewCompositionDataParams) {
  void blobUrlVersion
  const resolvedTrackList: CompositionInputProps['tracks'] = []
  const fastScrubTrackList: CompositionInputProps['tracks'] = []
  const playbackSpans: VideoSourceSpan[] = []
  const scrubSpans: VideoSourceSpan[] = []
  const boundaryFrames = new Set<number>()
  const boundarySources = new Map<number, Set<string>>()

  for (const track of combinedTracks) {
    const resolvedItems: typeof track.items = []
    const fastScrubItems: typeof track.items = []

    for (const item of track.items) {
      if (
        !item.mediaId ||
        (item.type !== 'video' &&
          item.type !== 'audio' &&
          item.type !== 'image' &&
          item.type !== 'lottie')
      ) {
        resolvedItems.push(item)
        fastScrubItems.push(item)
        continue
      }

      const sourceUrl = resolvedUrls.get(item.mediaId) ?? getBlobUrlFn(item.mediaId) ?? ''
      const proxyUrl =
        item.type === 'video' ? resolveProxyUrlFn(item.mediaId) || sourceUrl : sourceUrl
      const resolvedSrc = useProxy && item.type === 'video' ? proxyUrl : sourceUrl
      const fastScrubSrc = resolvedSrc
      const hasMatchingAudioSrc = item.type !== 'video' || item.audioSrc === sourceUrl

      const resolvedItem =
        'src' in item && item.src === resolvedSrc && hasMatchingAudioSrc
          ? item
          : { ...item, src: resolvedSrc, ...(item.type === 'video' ? { audioSrc: sourceUrl } : {}) }
      const fastScrubItem =
        'src' in item && item.src === fastScrubSrc && hasMatchingAudioSrc
          ? item
          : {
              ...item,
              src: fastScrubSrc,
              ...(item.type === 'video' ? { audioSrc: sourceUrl } : {}),
            }

      resolvedItems.push(resolvedItem)
      fastScrubItems.push(fastScrubItem)

      if (resolvedItem.type === 'video' && resolvedSrc) {
        playbackSpans.push({
          src: resolvedSrc,
          startFrame: resolvedItem.from,
          endFrame: resolvedItem.from + resolvedItem.durationInFrames,
        })
      }

      if (fastScrubItem.type === 'video' && fastScrubSrc) {
        scrubSpans.push({
          src: fastScrubSrc,
          startFrame: fastScrubItem.from,
          endFrame: fastScrubItem.from + fastScrubItem.durationInFrames,
        })
        if (fastScrubItem.durationInFrames > 0) {
          const startFrame = fastScrubItem.from
          const endFrame = fastScrubItem.from + fastScrubItem.durationInFrames
          boundaryFrames.add(startFrame)
          boundaryFrames.add(endFrame)

          let startSet = boundarySources.get(startFrame)
          if (!startSet) {
            startSet = new Set<string>()
            boundarySources.set(startFrame, startSet)
          }
          startSet.add(fastScrubSrc)

          let endSet = boundarySources.get(endFrame)
          if (!endSet) {
            endSet = new Set<string>()
            boundarySources.set(endFrame, endSet)
          }
          endSet.add(fastScrubSrc)
        }
      }
    }

    resolvedTrackList.push({ ...track, items: resolvedItems })
    fastScrubTrackList.push({ ...track, items: fastScrubItems })
  }

  const sortedBoundaryFrames = [...boundaryFrames].sort((a, b) => a - b)
  const sortedBoundarySources: FastScrubBoundarySource[] = [...boundarySources.entries()]
    .map(([frame, srcSet]) => ({ frame, srcs: [...srcSet] }))
    .sort((a, b) => a.frame - b.frame)

  const resolvedTracks = appendVirtualTranscriptCaptionTrack(
    resolvedTrackList,
    fps,
    project.width,
    project.height,
  )
  const fastScrubTracks = appendVirtualTranscriptCaptionTrack(
    fastScrubTrackList,
    fps,
    project.width,
    project.height,
  )
  const fastScrubTracksTopologyFingerprint = toTrackTopologyFingerprint(fastScrubTracks)
  const furthestItemEndFrame = items.reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0,
  )
  const totalFrames = furthestItemEndFrame === 0 ? 900 : furthestItemEndFrame + fps * 5
  const inputProps: CompositionInputProps = {
    fps,
    width: project.width,
    height: project.height,
    tracks: resolvedTracks as CompositionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes,
    busAudioEq,
  }
  const playerRenderSize = {
    width: Math.max(2, project.width),
    height: Math.max(2, project.height),
  }
  const renderSize = previewRenderSize ?? playerRenderSize
  const fastScrubScaledTracks = fastScrubTracks as CompositionInputProps['tracks']
  const fastScrubScaledKeyframes = keyframes
  const fastScrubInputProps: CompositionInputProps = {
    fps,
    width: project.width,
    height: project.height,
    tracks: fastScrubScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: fastScrubScaledKeyframes,
    busAudioEq,
  }
  const fastScrubPreviewItems = fastScrubScaledTracks.flatMap(
    (track) => track.items as TimelineItem[],
  )

  return {
    resolvedTracks,
    fastScrubTracks,
    playbackVideoSourceSpans: playbackSpans,
    scrubVideoSourceSpans: scrubSpans,
    fastScrubBoundaryFrames: sortedBoundaryFrames,
    fastScrubBoundarySources: sortedBoundarySources,
    fastScrubTracksTopologyFingerprint,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
  }
}
