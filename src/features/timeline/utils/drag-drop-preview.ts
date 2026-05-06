import { extractValidMediaFileEntriesFromDataTransfer } from '@/features/timeline/deps/media-library-resolver'
import type { DroppableMediaType } from './dropped-media'

export type TimelineGhostPreviewType =
  | 'video'
  | 'audio'
  | 'text'
  | 'shape'
  | 'adjustment'
  | 'image'
  | 'composition'
  | 'external-file'

export interface TimelineGhostPreviewLike {
  type: TimelineGhostPreviewType
}

export interface DragMediaItem {
  mediaId: string
  mediaType: DroppableMediaType
  fileName: string
  duration: number
}

export interface ExternalDragPreviewEntry {
  label: string
  mediaType: DroppableMediaType
  duration?: number
  hasLinkedAudio?: boolean
}

export function getGhostHighlightClasses(ghostPreviews: TimelineGhostPreviewLike[]): string {
  if (ghostPreviews.some((ghost) => ghost.type === 'audio')) {
    return 'border-timeline-audio/60 bg-timeline-audio/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'video')) {
    return 'border-timeline-video/60 bg-timeline-video/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'text')) {
    return 'border-timeline-text/60 bg-timeline-text/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'shape')) {
    return 'border-timeline-shape/60 bg-timeline-shape/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'adjustment')) {
    return 'border-slate-400/60 bg-slate-400/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'image')) {
    return 'border-timeline-image/60 bg-timeline-image/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'composition')) {
    return 'border-violet-400/60 bg-violet-600/10'
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'external-file')) {
    return 'border-orange-500/60 bg-orange-500/10'
  }
  return 'border-primary/50 bg-primary/10'
}

export function getGhostPreviewItemClasses(type: TimelineGhostPreviewType): string {
  if (type === 'composition') {
    return 'border-violet-400 bg-violet-600/20'
  }
  if (type === 'external-file') {
    return 'border-orange-500 bg-orange-500/15'
  }
  if (type === 'video') {
    return 'border-timeline-video bg-timeline-video/20'
  }
  if (type === 'audio') {
    return 'border-timeline-audio bg-timeline-audio/20'
  }
  if (type === 'text') {
    return 'border-timeline-text bg-timeline-text/20'
  }
  if (type === 'shape') {
    return 'border-timeline-shape bg-timeline-shape/20'
  }
  if (type === 'adjustment') {
    return 'border-slate-400 bg-slate-400/15'
  }
  return 'border-timeline-image bg-timeline-image/20'
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isDroppableMediaType(value: unknown): value is DroppableMediaType {
  return value === 'video' || value === 'audio' || value === 'image'
}

export function isValidDragMediaItem(value: unknown): value is DragMediaItem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DragMediaItem>
  return (
    isNonEmptyString(candidate.mediaId) &&
    isDroppableMediaType(candidate.mediaType) &&
    isNonEmptyString(candidate.fileName) &&
    typeof candidate.duration === 'number' &&
    Number.isFinite(candidate.duration)
  )
}

export function buildExternalPreviewSignature(dataTransfer: Pick<DataTransfer, 'items'>): string {
  return `${dataTransfer.items.length}:${Array.from(dataTransfer.items)
    .map((item) => `${item.kind}:${item.type || 'unknown'}`)
    .join('|')}`
}

export async function resolveExternalDragPreviewEntries(
  dataTransfer: DataTransfer,
): Promise<ExternalDragPreviewEntry[] | null> {
  const { supported, entries } = await extractValidMediaFileEntriesFromDataTransfer(dataTransfer)
  if (!supported) {
    return null
  }

  return entries.flatMap((entry) =>
    entry.mediaType === 'video' || entry.mediaType === 'audio' || entry.mediaType === 'image'
      ? [
          {
            label: entry.file.name,
            mediaType: entry.mediaType,
          },
        ]
      : [],
  )
}
