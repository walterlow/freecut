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
import type { TimelineTrack } from '@/types/timeline'
import { resolveReverseConformedVideoItem } from '@/shared/utils/reverse-conform-item'

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
