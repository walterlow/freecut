/**
 * Static render inputs derived from a composition.
 *
 * `createCompositionRenderer` receives the raw `CompositionInputProps` and has
 * to normalize it before it builds any renderer state: text filtering
 * (`renderText: false`), reverse-conform resolution for the active mode, and the
 * per-transition track order the transition pass reads. Those derivations are
 * pure — composition in, data out — so they live here beside the factory and the
 * factory only wires them.
 */

import type { CompositionInputProps } from '@/types/export'
import type {
  ImageItem,
  LottieItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import { resolveReverseConformedVideoItem } from '@/shared/utils/reverse-conform-item'
import { isAnimatedImage, isGifFormat } from './render-engine-predicates'

type ItemRenderMode = 'export' | 'preview'

export interface ResolveCompositionRenderTracksOptions {
  tracks: CompositionInputProps['tracks']
  fps: number
  /** `false` drops top-level text items before anything else sees them. */
  renderText?: boolean
  /**
   * Comparison frames render on their own canvas but conform like preview, so
   * the conform pass needs both flags instead of the derived render mode.
   */
  isComparisonMode: boolean
  renderMode: ItemRenderMode
  /** Raw option: only an explicit `true` enables proxy conforms. */
  useProxy?: boolean
}

/**
 * The render-ready track list: text items removed when the caller asked for
 * text-free rendering, then reversed clips resolved to their conform source for
 * the mode this renderer runs in. Untouched items and tracks keep their identity.
 */
export function resolveCompositionRenderTracks({
  tracks,
  fps,
  renderText,
  isComparisonMode,
  renderMode,
  useProxy,
}: ResolveCompositionRenderTracksOptions): TimelineTrack[] {
  const compositionTracks =
    renderText === false
      ? tracks?.map((track) => ({
          ...track,
          items: (track.items ?? []).filter((item) => item.type !== 'text'),
        }))
      : tracks
  const conformMode = isComparisonMode ? 'preview' : renderMode

  return (
    compositionTracks?.map((track) => ({
      ...track,
      items: (track.items ?? []).map((item) =>
        item.type === 'video'
          ? resolveReverseConformedVideoItem(item, fps, { mode: conformMode, useProxy })
          : item,
      ),
    })) ?? []
  )
}

/** Video items on the top-level tracks, in track order. */
export function collectTopLevelVideoItems(tracks: readonly TimelineTrack[]): VideoItem[] {
  const videoItems: VideoItem[] = []
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'video') videoItems.push(item as VideoItem)
    }
  }
  return videoItems
}

export interface TopLevelMediaItems {
  lottieItems: LottieItem[]
  imageItems: ImageItem[]
  gifItems: ImageItem[]
  webpItems: ImageItem[]
}

/** Renderable image and Lottie items on the top-level tracks, classified. */
export function collectTopLevelMediaItems(tracks: readonly TimelineTrack[]): TopLevelMediaItems {
  const mediaItems: TopLevelMediaItems = {
    lottieItems: [],
    imageItems: [],
    gifItems: [],
    webpItems: [],
  }
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      collectTopLevelMediaItem(item, mediaItems)
    }
  }
  return mediaItems
}

/**
 * Classifies one track item. An item is at most one of these kinds, so the
 * branches are exclusive; animated images split into the GIF and WebP frame
 * caches their renderers read.
 */
function collectTopLevelMediaItem(item: TimelineItem, mediaItems: TopLevelMediaItems): void {
  if (item.type === 'lottie') {
    if (item.src || item.mediaId) mediaItems.lottieItems.push(item as LottieItem)
    return
  }
  if (item.type !== 'image') return
  if (!item.src && !item.mediaId) return
  const imageItem = item as ImageItem
  mediaItems.imageItems.push(imageItem)
  if (!isAnimatedImage(imageItem)) return
  if (isGifFormat(imageItem)) mediaItems.gifItems.push(imageItem)
  else mediaItems.webpItems.push(imageItem)
}

interface TransitionWindowLike {
  transition: { id: string; trackId?: string | null }
}

/**
 * Track order per transition clip, read once per renderer instead of per frame.
 * A transition whose track carries no order (or no track at all) is treated as
 * order 0, matching how the render plan sorts un-ordered tracks.
 */
export function buildTransitionTrackOrderById(
  transitionWindows: ReadonlyArray<TransitionWindowLike>,
  trackOrderMap: ReadonlyMap<string, number>,
): Map<string, number> {
  const transitionTrackOrderById = new Map<string, number>()
  for (const window of transitionWindows) {
    const transitionTrackId = window.transition.trackId
    const trackOrder = transitionTrackId ? (trackOrderMap.get(transitionTrackId) ?? 0) : 0
    transitionTrackOrderById.set(window.transition.id, trackOrder)
  }
  return transitionTrackOrderById
}
