import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  extractValidMediaFileEntriesFromDataTransfer,
  getMediaType,
} from '@/features/timeline/deps/media-library-resolver'
import type { DroppableMediaType } from './dropped-media'
import { isDroppableMediaType, isValidDragMediaItem, type DragMediaItem } from './drag-drop-preview'
import { preflightFirstTimelineVideoProjectMatch } from './external-file-project-match'

export interface DroppedMediaEntry {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
}

interface DropLogger {
  error: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

interface DropNotifications {
  error: (message: string, options?: { description?: string }) => void
  warning: (message: string) => void
}

interface ResolveDroppedMediaEntriesFromExternalFilesOptions {
  dataTransfer: DataTransfer
  importHandlesForPlacement: (handles: FileSystemFileHandle[]) => Promise<MediaMetadata[]>
  notify: DropNotifications
}

interface ApplyResolvedTimelineDropOptions<TTracks> {
  addItem: (item: TimelineItem) => void
  addItems: (items: TimelineItem[]) => void
  currentTracks: TTracks
  dropResult: {
    items: TimelineItem[]
    tracks: TTracks
  }
  emptyMessage: string
  notify: DropNotifications
  partialFailureLabel: string
  requestedCount: number
  setTracks: (tracks: TTracks) => void
}

function isParsedMediaItemPayload(payload: unknown): payload is {
  type: 'media-item'
  mediaId: string
  mediaType: unknown
  fileName: string
} {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  return (
    candidate.type === 'media-item' &&
    typeof candidate.mediaId === 'string' &&
    typeof candidate.fileName === 'string'
  )
}

export function resolveDroppedMediaEntriesFromPayload(
  payload: unknown,
  mediaItems: MediaMetadata[],
  logger: DropLogger,
): DroppedMediaEntry[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const mediaById = new Map(mediaItems.map((media) => [media.id, media]))
  const candidate = payload as Record<string, unknown>

  if (candidate.type === 'media-items') {
    const rawItems = Array.isArray(candidate.items) ? candidate.items : []
    const validItems = rawItems.filter(isValidDragMediaItem)
    if (validItems.length !== rawItems.length) {
      logger.warn('Skipping invalid media-items payload entries', {
        invalidCount: rawItems.length - validItems.length,
      })
    }

    return validItems.flatMap((dragItem: DragMediaItem) => {
      const media = mediaById.get(dragItem.mediaId)
      if (!media) {
        logger.error('Media not found:', dragItem.mediaId)
        return []
      }

      return [
        {
          media,
          mediaId: dragItem.mediaId,
          mediaType: dragItem.mediaType,
          label: dragItem.fileName,
        },
      ]
    })
  }

  if (isParsedMediaItemPayload(candidate) && isDroppableMediaType(candidate.mediaType)) {
    const media = mediaById.get(candidate.mediaId)
    if (!media) {
      logger.error('Media not found:', candidate.mediaId)
      return []
    }

    return [
      {
        media,
        mediaId: candidate.mediaId,
        mediaType: candidate.mediaType,
        label: candidate.fileName,
      },
    ]
  }

  return []
}

export function buildDroppedMediaEntriesFromImportedMedia(
  importedMedia: MediaMetadata[],
): DroppedMediaEntry[] {
  return importedMedia.flatMap((media) => {
    const mediaType = getMediaType(media.mimeType)
    if (!isDroppableMediaType(mediaType)) {
      return []
    }

    return [
      {
        media,
        mediaId: media.id,
        mediaType,
        label: media.fileName,
      },
    ]
  })
}

export async function resolveDroppedMediaEntriesFromExternalFiles({
  dataTransfer,
  importHandlesForPlacement,
  notify,
}: ResolveDroppedMediaEntriesFromExternalFilesOptions): Promise<DroppedMediaEntry[] | null> {
  const { supported, entries, errors } =
    await extractValidMediaFileEntriesFromDataTransfer(dataTransfer)
  if (!supported) {
    notify.warning('Drag-drop not supported in this browser. Use Chrome or Edge.')
    return null
  }

  if (errors.length > 0) {
    notify.error(`Some files were rejected: ${errors.join(', ')}`)
  }

  if (entries.length === 0) {
    return null
  }

  try {
    await preflightFirstTimelineVideoProjectMatch(entries)
  } catch (error) {
    notify.error('Unable to inspect dropped file.', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
    return null
  }

  let importedMedia: Awaited<ReturnType<typeof importHandlesForPlacement>>
  try {
    importedMedia = await importHandlesForPlacement(entries.map((entry) => entry.handle))
  } catch (error) {
    notify.error('Unable to import dropped files.', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
    return null
  }
  if (importedMedia.length === 0) {
    notify.error('Unable to import dropped files')
    return null
  }

  const droppedEntries = buildDroppedMediaEntriesFromImportedMedia(importedMedia)
  if (droppedEntries.length === 0) {
    notify.warning('Dropped files were imported, but none could be placed on the timeline.')
    return null
  }

  return droppedEntries
}

export function applyResolvedTimelineDrop<TTracks>({
  addItem,
  addItems,
  currentTracks,
  dropResult,
  emptyMessage,
  notify,
  partialFailureLabel,
  requestedCount,
  setTracks,
}: ApplyResolvedTimelineDropOptions<TTracks>): boolean {
  if (dropResult.items.length === 0) {
    notify.error(emptyMessage)
    return false
  }

  if (dropResult.tracks !== currentTracks) {
    setTracks(dropResult.tracks)
  }

  if (dropResult.items.length < requestedCount) {
    notify.warning(
      `Some ${partialFailureLabel} could not be added: ${requestedCount - dropResult.items.length} failed`,
    )
  }

  if (dropResult.items.length === 1) {
    addItem(dropResult.items[0]!)
  } else {
    addItems(dropResult.items)
  }

  return true
}
