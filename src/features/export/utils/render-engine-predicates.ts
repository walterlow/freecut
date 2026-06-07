/**
 * Pure predicate helpers for the client render engine.
 *
 * These are stateless classifiers used by `createCompositionRenderer` to decide
 * which render path an item takes (GPU-effect vs plain, animated-image vs
 * static). Extracted from `client-render-engine.ts` so the factory body stays
 * focused on orchestration and these remain independently testable.
 */

import type { TimelineItem, ImageItem } from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils'
import { type SubCompRenderData } from './canvas-item-renderer'

export function hasEnabledGpuEffect(effects: TimelineItem['effects']): boolean {
  return effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect') ?? false
}

export function itemHasEnabledGpuEffect(
  item: TimelineItem,
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined,
): boolean {
  const previewEffects = getPreviewEffectsOverride?.(item.id)
  return hasEnabledGpuEffect(previewEffects ?? item.effects)
}

export function subCompositionRenderDataHasGpuEffects(
  compositionId: string,
  subCompRenderData: ReadonlyMap<string, SubCompRenderData>,
  options: {
    getCurrentItem?: <TItem extends TimelineItem>(item: TItem) => TItem
    getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
    visited?: Set<string>
  } = {},
): boolean {
  const { getPreviewEffectsOverride } = options
  const getCurrentItem =
    options.getCurrentItem ?? (<TItem extends TimelineItem>(item: TItem) => item)
  const visited = options.visited ?? new Set<string>()
  if (visited.has(compositionId)) return false
  visited.add(compositionId)

  const subData = subCompRenderData.get(compositionId)
  if (!subData) return false

  for (const entry of subData.adjustmentLayers ?? []) {
    if (itemHasEnabledGpuEffect(getCurrentItem(entry.layer), getPreviewEffectsOverride)) {
      return true
    }
  }

  for (const track of subData.sortedTracks) {
    if (!track.visible) continue
    for (const subItem of track.items) {
      const currentSubItem = getCurrentItem(subItem)
      if (itemHasEnabledGpuEffect(currentSubItem, getPreviewEffectsOverride)) return true
      if (
        currentSubItem.type === 'composition' &&
        subCompositionRenderDataHasGpuEffects(currentSubItem.compositionId, subCompRenderData, {
          getCurrentItem,
          getPreviewEffectsOverride,
          visited,
        })
      ) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if an image item is a potentially animated image (GIF or WebP).
 * Static WebP files will be detected during frame extraction and fall back
 * to regular image rendering.
 */
export function isAnimatedImage(item: ImageItem): boolean {
  const label = item.label?.toLowerCase() ?? ''
  return (
    isGifUrl(item.src) || label.endsWith('.gif') || isWebpUrl(item.src) || label.endsWith('.webp')
  )
}

/**
 * Check if an image item is specifically a GIF (for gifuct-js extraction).
 */
export function isGifFormat(item: ImageItem): boolean {
  return isGifUrl(item.src) || (item.label?.toLowerCase() ?? '').endsWith('.gif')
}
