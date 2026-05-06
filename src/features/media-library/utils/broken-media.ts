import type { MediaMetadata } from '@/types/storage'
import type { BrokenMediaInfo } from '../types'

function projectHasMedia(mediaById: Record<string, MediaMetadata>, mediaId: string): boolean {
  return Object.prototype.hasOwnProperty.call(mediaById, mediaId)
}

export function getProjectBrokenMediaIds(
  brokenMediaIds: string[],
  mediaById: Record<string, MediaMetadata>,
): string[] {
  return brokenMediaIds.filter((mediaId) => projectHasMedia(mediaById, mediaId))
}

export function getProjectBrokenMediaInfo(
  brokenMediaInfo: Map<string, BrokenMediaInfo>,
  mediaById: Record<string, MediaMetadata>,
): BrokenMediaInfo[] {
  return Array.from(brokenMediaInfo.values()).filter((item) =>
    projectHasMedia(mediaById, item.mediaId),
  )
}
