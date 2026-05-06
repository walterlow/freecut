import type { ScrubbingCache, VideoFrameEntry } from './scrubbing-cache'

let activePreviewScrubbingCache: ScrubbingCache | null = null

export function setActivePreviewScrubbingCache(cache: ScrubbingCache | null): void {
  activePreviewScrubbingCache = cache
}

export function getActivePreviewScrubbingCache(): ScrubbingCache | null {
  return activePreviewScrubbingCache
}

export function getActivePreviewVideoFrameEntry(
  itemId: string,
  sourceTime?: number,
  maxSourceTimeDelta = Number.POSITIVE_INFINITY,
): VideoFrameEntry | undefined {
  return activePreviewScrubbingCache?.getVideoFrameEntry(itemId, sourceTime, maxSourceTimeDelta)
}
