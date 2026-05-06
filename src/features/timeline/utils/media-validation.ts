import type { TimelineItem } from '@/types/timeline'
import type { OrphanedClipInfo } from '@/features/timeline/deps/media-library-resolver'
import type { MediaMetadata } from '@/types/storage'
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { getSynchronizedLinkedItems } from './linked-items'

function isOrphanableMediaItem(item: TimelineItem): item is TimelineItem & { mediaId: string } {
  return !!item.mediaId && (item.type === 'video' || item.type === 'audio' || item.type === 'image')
}

function getOrphanGroupRepresentative(
  items: Array<TimelineItem & { mediaId: string }>,
): TimelineItem & { mediaId: string } {
  return (
    items.find((item) => item.type === 'video') ??
    items.find((item) => item.type === 'image') ??
    items[0]!
  )
}

/**
 * Validates that all timeline items have valid media references.
 * Returns list of orphaned clips (items with missing media metadata).
 *
 * This detects clips that reference mediaIds which no longer exist in IndexedDB,
 * typically from loading old project snapshots saved before media was deleted.
 */
export async function validateMediaReferences(
  items: TimelineItem[],
  projectId: string,
): Promise<OrphanedClipInfo[]> {
  const orphans: OrphanedClipInfo[] = []

  // Get all unique mediaIds from timeline items that have media references
  const mediaItems = items.filter(isOrphanableMediaItem)

  if (mediaItems.length === 0) {
    return orphans
  }

  // Get all media for this project
  const mediaLibrary = await mediaLibraryService.getMediaForProject(projectId)
  const validMediaIds = new Set(mediaLibrary.map((m) => m.id))

  const visitedItemIds = new Set<string>()

  // Find items with missing media, collapsing synchronized linked A/V pairs
  for (const item of mediaItems) {
    if (visitedItemIds.has(item.id) || validMediaIds.has(item.mediaId)) {
      continue
    }

    const groupedItems = getSynchronizedLinkedItems(mediaItems, item.id).filter(
      (candidate): candidate is TimelineItem & { mediaId: string } =>
        isOrphanableMediaItem(candidate) && candidate.mediaId === item.mediaId,
    )
    const orphanGroup = groupedItems.length > 0 ? groupedItems : [item]
    orphanGroup.forEach((groupedItem) => visitedItemIds.add(groupedItem.id))

    const representative = getOrphanGroupRepresentative(orphanGroup)
    if (!validMediaIds.has(item.mediaId)) {
      orphans.push({
        itemId: representative.id,
        mediaId: representative.mediaId,
        itemType: representative.type as 'video' | 'audio' | 'image',
        fileName: representative.label || 'Unknown',
        trackId: representative.trackId,
      })
    }
  }

  return orphans
}

export async function validateProjectMediaReferences(params: {
  rootItems: TimelineItem[]
  compositions: Array<{ items: TimelineItem[] }>
  projectId: string
}): Promise<OrphanedClipInfo[]> {
  const allItems = [
    ...params.rootItems,
    ...params.compositions.flatMap((composition) => composition.items),
  ]

  if (allItems.length === 0) {
    return []
  }

  const dedupedItems = Array.from(new Map(allItems.map((item) => [item.id, item])).values())

  return validateMediaReferences(dedupedItems, params.projectId)
}

/**
 * Find matching media item by filename (case-insensitive).
 * Used for auto-relinking orphaned clips to existing media in the library.
 */
function findMatchingMediaByFilename(
  orphan: OrphanedClipInfo,
  mediaItems: MediaMetadata[],
): MediaMetadata | null {
  const orphanFileName = orphan.fileName.toLowerCase()

  // Try exact filename match first
  const exactMatch = mediaItems.find((m) => m.fileName.toLowerCase() === orphanFileName)
  if (exactMatch) {
    return exactMatch
  }

  // Try matching without extension
  const orphanBaseName = orphanFileName.replace(/\.[^.]+$/, '')
  const baseNameMatch = mediaItems.find((m) => {
    const mediaBaseName = m.fileName.toLowerCase().replace(/\.[^.]+$/, '')
    return mediaBaseName === orphanBaseName
  })

  return baseNameMatch || null
}

/**
 * Filter media items by type for the media picker.
 * Maps timeline item type to media MIME type prefix.
 */
function filterMediaByType(
  mediaItems: MediaMetadata[],
  itemType: 'video' | 'audio' | 'image',
): MediaMetadata[] {
  const mimePrefix = `${itemType}/`
  return mediaItems.filter((m) => m.mimeType.startsWith(mimePrefix))
}

/**
 * Auto-match orphaned clips to media in the library by filename.
 * Returns a map of itemId -> matching mediaId for all successful matches.
 */
export function autoMatchOrphanedClips(
  orphans: OrphanedClipInfo[],
  mediaItems: MediaMetadata[],
): Map<string, string> {
  const matches = new Map<string, string>()

  for (const orphan of orphans) {
    // Filter to same type first
    const compatibleMedia = filterMediaByType(mediaItems, orphan.itemType)
    const match = findMatchingMediaByFilename(orphan, compatibleMedia)

    if (match) {
      matches.set(orphan.itemId, match.id)
    }
  }

  return matches
}
