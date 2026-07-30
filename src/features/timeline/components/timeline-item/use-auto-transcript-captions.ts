import { useEffect, useRef } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { mediaTranscriptionService } from '../../deps/media-transcription-service'
import type { CaptionDialogState } from './use-caption-dialog-state'

interface UseAutoTranscriptCaptionsParams {
  item: TimelineItemType
  caption: CaptionDialogState
  hasGeneratedCaptions: boolean
  isBroken: boolean
}

function shouldSkipCaptionRefresh({
  canManageCaptions,
  mediaHasTranscript,
  hasGeneratedCaptions,
  isBroken,
  transcriptCaptionsEnabled,
  itemType,
}: {
  canManageCaptions: boolean
  mediaHasTranscript: boolean
  hasGeneratedCaptions: boolean
  isBroken: boolean
  transcriptCaptionsEnabled: boolean | undefined
  itemType: TimelineItemType['type']
}): boolean {
  return (
    !canManageCaptions ||
    !mediaHasTranscript ||
    hasGeneratedCaptions ||
    transcriptCaptionsEnabled !== true ||
    isBroken ||
    (itemType !== 'video' && itemType !== 'audio')
  )
}

/**
 * Refreshes transcript-backed captions only when they are already enabled on the
 * clip. Fresh transcripts no longer auto-enable captions; users opt in via the
 * explicit captions action.
 */
export function useAutoTranscriptCaptions({
  item,
  caption,
  hasGeneratedCaptions,
  isBroken,
}: UseAutoTranscriptCaptionsParams): void {
  const attemptRef = useRef<string | null>(null)

  useEffect(() => {
    const mediaId = item.mediaId
    if (
      !mediaId ||
      shouldSkipCaptionRefresh({
        canManageCaptions: caption.canManageCaptions,
        mediaHasTranscript: caption.mediaHasTranscript,
        hasGeneratedCaptions,
        isBroken,
        transcriptCaptionsEnabled: item.transcriptCaptions?.enabled,
        itemType: item.type,
      })
    ) {
      return
    }

    const attemptKey = `${item.id}:${mediaId}`
    if (attemptRef.current === attemptKey) {
      return
    }
    attemptRef.current = attemptKey

    void mediaTranscriptionService
      .enableTranscriptCaptions(mediaId, {
        clipIds: [item.id],
        replaceExisting: false,
        selectUpdatedClips: false,
      })
      .catch(() => {
        // Keep this silent: the explicit Generate Captions action remains the user-facing fallback.
      })
  }, [
    caption.canManageCaptions,
    caption.mediaHasTranscript,
    hasGeneratedCaptions,
    isBroken,
    item.id,
    item.mediaId,
    item.transcriptCaptions?.enabled,
    item.type,
  ])
}
