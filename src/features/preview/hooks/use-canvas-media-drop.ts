import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '@/features/preview/deps/timeline-store'
import {
  buildDroppedMediaTimelineItem,
  findBestCanvasDropPlacement,
  getDroppedMediaDurationInFrames,
  type DroppableMediaType,
} from '@/features/preview/deps/timeline-utils'
import {
  extractValidMediaFileEntriesFromDataTransfer,
  clearMediaDragData,
  getMediaDragData,
  getMediaType,
  getMimeType,
  mediaLibraryService,
  mediaProcessorService,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/preview/deps/media-library'
import { screenToCanvas } from '../utils/coordinate-transform'
import type { CoordinateParams } from '../types/gizmo'
import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  useProjectMediaMatchDialogStore,
  type ProjectMediaMatchChoice,
} from '@/shared/state/project-media-match-dialog'

type DropSource = 'library' | 'external-file'

interface CanvasDropState {
  allowed: boolean
  source: DropSource
  title: string
  description: string
}

interface UseCanvasMediaDropParams {
  coordParams: CoordinateParams | null
  projectSize: { width: number; height: number }
}

interface PlaceMediaOnCanvasParams {
  media: MediaMetadata
  mediaType: DroppableMediaType
  label: string
  clientX: number
  clientY: number
  placementProjectSize?: { width: number; height: number }
  preserveInitialPlacement?: boolean
}

function isVisualMediaType(
  value: unknown,
): value is Extract<DroppableMediaType, 'video' | 'image'> {
  return value === 'video' || value === 'image'
}

function normalizeMatchedProjectDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

function getMatchedProjectSize(media: Pick<MediaMetadata, 'width' | 'height'>) {
  const width = normalizeMatchedProjectDimension(media.width)
  const height = normalizeMatchedProjectDimension(media.height)

  if (width === 0 || height === 0) {
    return null
  }

  return { width, height }
}

function shouldPreserveInitialPlacement(choice: ProjectMediaMatchChoice): boolean {
  return choice === 'match-both' || choice === 'size-only'
}

function clampDropPosition(
  item: TimelineItem,
  canvasPoint: { x: number; y: number },
  projectSize: { width: number; height: number },
): TimelineItem {
  if (!item.transform) {
    return item
  }

  const width = item.transform.width ?? projectSize.width
  const height = item.transform.height ?? projectSize.height
  const halfWidth = width / 2
  const halfHeight = height / 2
  const minX = halfWidth
  const maxX = Math.max(halfWidth, projectSize.width - halfWidth)
  const minY = halfHeight
  const maxY = Math.max(halfHeight, projectSize.height - halfHeight)

  const centerX =
    minX > maxX ? projectSize.width / 2 : Math.min(maxX, Math.max(minX, canvasPoint.x))
  const centerY =
    minY > maxY ? projectSize.height / 2 : Math.min(maxY, Math.max(minY, canvasPoint.y))

  return {
    ...item,
    transform: {
      ...item.transform,
      x: centerX - projectSize.width / 2,
      y: centerY - projectSize.height / 2,
    },
  }
}

function evaluateCanvasDrop(dataTransfer: DataTransfer): CanvasDropState | null {
  const t = i18n.t.bind(i18n)
  const dragData = getMediaDragData()
  if (dragData) {
    if (dragData.type === 'composition') {
      return {
        allowed: false,
        source: 'library',
        title: t('preview.canvasDrop.dropOnTimeline'),
        description: t('preview.canvasDrop.compoundClipsTimeline'),
      }
    }

    if (dragData.type === 'timeline-template') {
      return {
        allowed: false,
        source: 'library',
        title: t('preview.canvasDrop.dropOnTimeline'),
        description: t('preview.canvasDrop.presetsTimeline'),
      }
    }

    if (dragData.type === 'media-items') {
      const itemCount = Array.isArray(dragData.items) ? dragData.items.length : 0
      if (itemCount !== 1) {
        return {
          allowed: false,
          source: 'library',
          title: t('preview.canvasDrop.dropOneItem'),
          description: t('preview.canvasDrop.oneMediaAtATime'),
        }
      }

      const mediaType = dragData.items?.[0]?.mediaType
      if (!isVisualMediaType(mediaType)) {
        return {
          allowed: false,
          source: 'library',
          title: t('preview.canvasDrop.audioGoesOnTimeline'),
          description: t('preview.canvasDrop.visualLayersOnly'),
        }
      }
    }

    if (dragData.type === 'media-item' && !isVisualMediaType(dragData.mediaType)) {
      return {
        allowed: false,
        source: 'library',
        title: t('preview.canvasDrop.audioGoesOnTimeline'),
        description: t('preview.canvasDrop.visualLayersOnly'),
      }
    }

    return {
      allowed: true,
      source: 'library',
      title: t('preview.canvasDrop.dropToPlace'),
      description: t('preview.canvasDrop.addAtPlayhead'),
    }
  }

  if (!dataTransfer.types.includes('Files')) {
    return null
  }

  const itemCount = dataTransfer.items.length
  if (itemCount !== 1) {
    return {
      allowed: false,
      source: 'external-file',
      title: t('preview.canvasDrop.dropOneFile'),
      description: t('preview.canvasDrop.oneVisualFileAtATime'),
    }
  }

  return {
    allowed: true,
    source: 'external-file',
    title: t('preview.canvasDrop.importAndPlace'),
    description: t('preview.canvasDrop.importAndPlaceDescription'),
  }
}

export function useCanvasMediaDrop({ coordParams, projectSize }: UseCanvasMediaDropParams) {
  const dragDepthRef = useRef(0)
  const [dropState, setDropState] = useState<CanvasDropState | null>(null)

  const clearDropState = useCallback(() => {
    dragDepthRef.current = 0
    setDropState(null)
  }, [])

  const placeMediaOnCanvas = useCallback(
    async ({
      media,
      mediaType,
      label,
      clientX,
      clientY,
      placementProjectSize,
      preserveInitialPlacement = false,
    }: PlaceMediaOnCanvasParams) => {
      if (!coordParams || !isVisualMediaType(mediaType)) {
        return
      }

      const effectiveProjectSize = placementProjectSize ?? projectSize
      const timelineState = useTimelineStore.getState()
      const playbackState = usePlaybackStore.getState()
      const selectionState = useSelectionStore.getState()
      const durationInFrames = getDroppedMediaDurationInFrames(media, mediaType, timelineState.fps)
      const placement = findBestCanvasDropPlacement({
        tracks: timelineState.tracks,
        items: timelineState.items,
        activeTrackId: selectionState.activeTrackId,
        proposedFrame: playbackState.currentFrame,
        durationInFrames,
        itemType: mediaType === 'image' ? 'image' : 'video',
      })

      if (!placement) {
        toast.warning(i18n.t('preview.canvasDrop.noCompatibleTrack'))
        return
      }

      const blobUrl = await resolveMediaUrl(media.id)
      if (!blobUrl) {
        toast.error(i18n.t('preview.canvasDrop.unableToLoadMedia'))
        return
      }

      const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(media.id)
      const baseItem = buildDroppedMediaTimelineItem({
        media,
        mediaId: media.id,
        mediaType,
        label,
        timelineFps: timelineState.fps,
        blobUrl,
        thumbnailUrl,
        canvasWidth: effectiveProjectSize.width,
        canvasHeight: effectiveProjectSize.height,
        placement: {
          trackId: placement.trackId,
          from: placement.from,
          durationInFrames,
        },
      })

      const placedItem = preserveInitialPlacement
        ? baseItem
        : clampDropPosition(
            baseItem,
            screenToCanvas(clientX, clientY, coordParams),
            effectiveProjectSize,
          )

      timelineState.addItem(placedItem)
      selectionState.setActiveTrack(placement.trackId)
      selectionState.selectItems([placedItem.id])
    },
    [coordParams, projectSize],
  )

  const handleLibraryDrop = useCallback(
    async (event: React.DragEvent, currentDropState: CanvasDropState) => {
      if (!currentDropState.allowed) {
        toast.warning(currentDropState.description)
        return
      }

      const dragData = getMediaDragData()
      if (!dragData) {
        return
      }

      let mediaId: string | undefined
      let mediaType: DroppableMediaType | undefined
      let label: string | undefined

      if (
        dragData.type === 'media-item' &&
        dragData.mediaId &&
        dragData.mediaType &&
        dragData.fileName
      ) {
        if (!isVisualMediaType(dragData.mediaType)) {
          toast.warning(i18n.t('preview.canvasDrop.visualLayersOnly'))
          return
        }
        mediaId = dragData.mediaId
        mediaType = dragData.mediaType
        label = dragData.fileName
      } else if (dragData.type === 'media-items' && dragData.items?.length === 1) {
        const item = dragData.items[0]
        if (!item || !isVisualMediaType(item.mediaType)) {
          toast.warning(i18n.t('preview.canvasDrop.visualLayersOnly'))
          return
        }
        mediaId = item.mediaId
        mediaType = item.mediaType
        label = item.fileName
      }

      if (!mediaId || !mediaType || !label) {
        return
      }

      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (!media) {
        toast.error(i18n.t('preview.canvasDrop.mediaNoLongerAvailable'))
        return
      }

      await placeMediaOnCanvas({
        media,
        mediaType,
        label,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    [placeMediaOnCanvas],
  )

  const handleExternalFileDrop = useCallback(
    async (event: React.DragEvent, currentDropState: CanvasDropState) => {
      if (!currentDropState.allowed) {
        toast.warning(currentDropState.description)
        return
      }

      const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(
        event.dataTransfer,
      )
      if (!supported) {
        toast.warning(i18n.t('preview.canvasDrop.dragDropUnsupported'))
        return
      }

      if (errors.length > 0) {
        toast.error(i18n.t('preview.canvasDrop.filesRejected', { errors: errors.join(', ') }))
      }

      const entry = entries[0]
      if (!entry) {
        return
      }

      if (!isVisualMediaType(entry.mediaType)) {
        toast.warning(i18n.t('preview.canvasDrop.dropAudioOnTimeline'))
        return
      }

      const mediaState = useMediaLibraryStore.getState()
      const currentProjectId = mediaState.currentProjectId
      const hasExistingProjectVideo = mediaState.mediaItems.some((item) =>
        item.mimeType.startsWith('video/'),
      )

      let preInspectedMetadata: {
        type: string
        width: number
        height: number
        fps: number
      } | null = null

      if (entry.mediaType === 'video' && currentProjectId && !hasExistingProjectVideo) {
        try {
          const mimeType = getMimeType(entry.file)
          const { metadata } = await mediaProcessorService.processMedia(entry.file, mimeType, {
            generateThumbnail: false,
          })

          if (metadata.type !== 'video') {
            toast.error(i18n.t('preview.canvasDrop.unableToInspectVideo'))
            return
          }

          preInspectedMetadata = metadata
        } catch (error) {
          toast.error(i18n.t('preview.canvasDrop.unableToInspectFile'), {
            description: error instanceof Error ? error.message : i18n.t('projects.tryAgain'),
          })
          return
        }
      }

      const importedMedia = await useMediaLibraryStore
        .getState()
        .importHandlesForPlacement([entry.handle])
      const imported = importedMedia[0]
      if (!imported) {
        toast.error(i18n.t('preview.canvasDrop.unableToImportFile'))
        return
      }

      const importedType = getMediaType(imported.mimeType)
      if (!isVisualMediaType(importedType)) {
        toast.warning(i18n.t('preview.canvasDrop.dropAudioOnTimeline'))
        return
      }

      let placementProjectSize: { width: number; height: number } | undefined
      let preserveInitialPlacement = false

      if (preInspectedMetadata && currentProjectId) {
        const matchChoice = await useProjectMediaMatchDialogStore
          .getState()
          .requestProjectMediaMatch(currentProjectId, {
            fileName: entry.file.name,
            width: preInspectedMetadata.width,
            height: preInspectedMetadata.height,
            fps: preInspectedMetadata.fps,
          })

        preserveInitialPlacement = shouldPreserveInitialPlacement(matchChoice)
        if (preserveInitialPlacement) {
          placementProjectSize = getMatchedProjectSize(preInspectedMetadata) ?? undefined
        }
      }

      await placeMediaOnCanvas({
        media: imported,
        mediaType: importedType,
        label: imported.fileName,
        clientX: event.clientX,
        clientY: event.clientY,
        placementProjectSize,
        preserveInitialPlacement,
      })
    },
    [placeMediaOnCanvas],
  )

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    const nextDropState = evaluateCanvasDrop(event.dataTransfer)
    if (!nextDropState) {
      return
    }

    event.preventDefault()
    dragDepthRef.current += 1
    setDropState(nextDropState)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    const nextDropState = evaluateCanvasDrop(event.dataTransfer)
    if (!nextDropState) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = nextDropState.allowed ? 'copy' : 'none'
    setDropState((prev) => {
      if (
        prev?.allowed === nextDropState.allowed &&
        prev?.source === nextDropState.source &&
        prev?.title === nextDropState.title &&
        prev?.description === nextDropState.description
      ) {
        return prev
      }
      return nextDropState
    })
  }, [])

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!dropState) {
        return
      }

      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setDropState(null)
      }
    },
    [dropState],
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      const currentDropState = evaluateCanvasDrop(event.dataTransfer)
      clearDropState()

      if (!currentDropState) {
        return
      }

      event.preventDefault()
      if (!coordParams) {
        return
      }

      try {
        if (currentDropState.source === 'library') {
          await handleLibraryDrop(event, currentDropState)
          return
        }

        await handleExternalFileDrop(event, currentDropState)
      } finally {
        if (currentDropState.source === 'library') {
          clearMediaDragData()
        }
      }
    },
    [clearDropState, coordParams, handleExternalFileDrop, handleLibraryDrop],
  )

  return {
    dropState,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  }
}
