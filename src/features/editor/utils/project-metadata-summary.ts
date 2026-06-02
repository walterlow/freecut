import type { TimelineItem } from '@/types/timeline'

export interface ProjectMetadataSummaryInput {
  fps: number
  items: TimelineItem[]
  brokenMediaIds: string[]
}

export interface ProjectMetadataSummary {
  durationSeconds: number
  clipCount: number
  mediaCount: number
  brokenMediaCount: number
}

export function collectProjectMediaReferenceIds(items: TimelineItem[]): string[] {
  const mediaIds = new Set<string>()
  for (const item of items) {
    if ('mediaId' in item && item.mediaId) {
      mediaIds.add(item.mediaId)
    }
  }
  return [...mediaIds]
}

export function buildProjectMetadataSummary({
  fps,
  items,
  brokenMediaIds,
}: ProjectMetadataSummaryInput): ProjectMetadataSummary {
  const durationFrames = items.reduce(
    (maxFrame, item) => Math.max(maxFrame, item.from + item.durationInFrames),
    0,
  )
  const mediaIds = collectProjectMediaReferenceIds(items)
  const mediaIdSet = new Set(mediaIds)

  return {
    durationSeconds: fps > 0 ? durationFrames / fps : 0,
    clipCount: items.length,
    mediaCount: mediaIds.length,
    brokenMediaCount: brokenMediaIds.filter((mediaId) => mediaIdSet.has(mediaId)).length,
  }
}
