import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useTimelineStore } from '../../stores/timeline-store'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import {
  mediaLibraryService as mediaLibraryServiceForSubtitles,
  useEmbeddedSubtitlePickerStore,
} from '@/features/timeline/deps/media-library-service'

function isEmbeddedSubtitleContainer(fileName: string, mimeType: string): boolean {
  const name = fileName.toLowerCase()
  return (
    mimeType === 'video/x-matroska' ||
    mimeType === 'video/matroska' ||
    mimeType === 'video/webm' ||
    name.endsWith('.mkv') ||
    name.endsWith('.webm')
  )
}

interface UseCaptionDialogStateParams {
  item: TimelineItemType
  isBroken: boolean
  linkedItemsForCaptionOwnership: TimelineItemType[]
}

type TranscriptProgress = NonNullable<
  ReturnType<typeof useMediaLibraryStore.getState>['transcriptProgress'] extends Map<
    string,
    infer V
  >
    ? V
    : never
>

export interface CaptionDialogState {
  canManageCaptions: boolean
  canExtractEmbeddedSubtitles: boolean
  hasConsolidatablePerCueCaptions: boolean
  mediaHasTranscript: boolean
  transcriptStatus: string
  transcriptProgress: TranscriptProgress | null
  mediaFileName: string
  dialogOpen: boolean
  openDialog: () => void
  setDialogOpen: (next: boolean) => void
  setDialogError: (message: string | null) => void
  dialogError: string | null
  markCaptionStarted: () => void
  markCaptionEnded: () => void
  markCaptionStopRequested: () => void
  handleExtractEmbeddedSubtitles: (() => Promise<void>) | undefined
  handleConsolidateCaptionsToSegment: (() => Promise<void>) | undefined
}

export function useCaptionDialogState({
  item,
  isBroken,
  linkedItemsForCaptionOwnership,
}: UseCaptionDialogStateParams): CaptionDialogState {
  const transcriptStatus = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? (s.transcriptStatus.get(item.mediaId) ?? 'idle') : 'idle'),
      [item.mediaId],
    ),
  )
  const transcriptProgress = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? (s.transcriptProgress.get(item.mediaId) ?? null) : null),
      [item.mediaId],
    ),
  )
  const mediaForItem = useMediaLibraryStore(
    useCallback((s) => (item.mediaId ? (s.mediaById[item.mediaId] ?? null) : null), [item.mediaId]),
  )
  const mediaFileName = mediaForItem?.fileName ?? ''
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const mediaHasTranscript = transcriptStatus === 'ready'
  const captionStartedRef = useRef(false)
  const captionStopRequestedRef = useRef(false)

  const captionIsActive = transcriptStatus === 'queued' || transcriptStatus === 'transcribing'
  useEffect(() => {
    if (captionStartedRef.current && !captionIsActive) {
      captionStartedRef.current = false
      const keepOpen = captionStopRequestedRef.current || dialogError !== null
      captionStopRequestedRef.current = false
      setDialogOpen((wasOpen) => wasOpen && keepOpen)
    }
  }, [captionIsActive, dialogError])

  const linkedVideoCaptionOwner = useMemo(() => {
    if (item.type !== 'audio' || !item.mediaId) {
      return null
    }
    return (
      linkedItemsForCaptionOwnership.find(
        (linkedItem) =>
          linkedItem.id !== item.id &&
          linkedItem.type === 'video' &&
          linkedItem.mediaId === item.mediaId,
      ) ?? null
    )
  }, [item.id, item.mediaId, item.type, linkedItemsForCaptionOwnership])

  const canManageCaptions =
    !!item.mediaId &&
    !isBroken &&
    (item.type === 'video' || (item.type === 'audio' && linkedVideoCaptionOwner === null))

  const canExtractEmbeddedSubtitles = !!(
    mediaForItem &&
    !isBroken &&
    isEmbeddedSubtitleContainer(mediaForItem.fileName, mediaForItem.mimeType)
  )

  const handleExtractEmbeddedSubtitles = useCallback(async () => {
    if (!mediaForItem) return
    const mediaStore = useMediaLibraryStore.getState()
    try {
      const handle = mediaForItem.fileHandle
      if (mediaForItem.storageType === 'handle' && handle) {
        const granted =
          (await handle.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)) ===
          'granted'
        if (!granted) {
          mediaStore.showNotification?.({
            type: 'error',
            message: `FreeCut needs permission to read "${mediaForItem.fileName}" before extracting subtitles.`,
          })
          return
        }
        const blob = await handle.getFile()
        useEmbeddedSubtitlePickerStore.getState().open(mediaForItem, blob)
        return
      }
      const blob = await mediaLibraryServiceForSubtitles.getMediaFile(mediaForItem.id)
      if (!blob) {
        mediaStore.showNotification?.({
          type: 'error',
          message: `FreeCut could not load "${mediaForItem.fileName}".`,
        })
        return
      }
      useEmbeddedSubtitlePickerStore.getState().open(mediaForItem, blob)
    } catch (error) {
      mediaStore.showNotification?.({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Failed to open "${mediaForItem.fileName}" for subtitle extraction.`,
      })
    }
  }, [mediaForItem])

  const hasConsolidatablePerCueCaptions = useTimelineStore(
    useCallback(
      (s) =>
        s.items.some(
          (other) =>
            other.type === 'text' &&
            (other.captionSource?.type === 'embedded-subtitles' ||
              other.captionSource?.type === 'subtitle-import') &&
            other.captionSource.clipId === item.id,
        ),
      [item.id],
    ),
  )

  const handleConsolidateCaptionsToSegment = useCallback(async () => {
    const mediaStore = useMediaLibraryStore.getState()
    try {
      const { subtitleSidecarService } =
        await import('@/features/timeline/deps/subtitle-sidecar-service')
      const result = subtitleSidecarService.consolidatePerCueCaptionsToSegments({
        clipId: item.id,
      })
      mediaStore.showNotification?.({
        type: 'success',
        message:
          result.segmentsCreated > 0
            ? `Consolidated ${result.cuesConsolidated} caption${result.cuesConsolidated === 1 ? '' : 's'} into ${result.segmentsCreated} segment${result.segmentsCreated === 1 ? '' : 's'}.`
            : 'No per-cue captions found for this clip.',
      })
    } catch (error) {
      mediaStore.showNotification?.({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to consolidate captions to segment.',
      })
    }
  }, [item.id])

  const openDialog = useCallback(() => {
    captionStopRequestedRef.current = false
    setDialogError(null)
    setDialogOpen(true)
  }, [])

  const markCaptionStarted = useCallback(() => {
    captionStartedRef.current = true
    captionStopRequestedRef.current = false
  }, [])

  const markCaptionEnded = useCallback(() => {
    captionStartedRef.current = false
  }, [])

  const markCaptionStopRequested = useCallback(() => {
    captionStopRequestedRef.current = true
  }, [])

  return {
    canManageCaptions,
    canExtractEmbeddedSubtitles,
    hasConsolidatablePerCueCaptions,
    mediaHasTranscript,
    transcriptStatus,
    transcriptProgress,
    mediaFileName,
    dialogOpen,
    openDialog,
    setDialogOpen,
    setDialogError,
    dialogError,
    markCaptionStarted,
    markCaptionEnded,
    markCaptionStopRequested,
    handleExtractEmbeddedSubtitles: canExtractEmbeddedSubtitles
      ? handleExtractEmbeddedSubtitles
      : undefined,
    handleConsolidateCaptionsToSegment: hasConsolidatablePerCueCaptions
      ? handleConsolidateCaptionsToSegment
      : undefined,
  }
}
