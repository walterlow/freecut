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
    if (
      !caption.canManageCaptions ||
      !caption.mediaHasTranscript ||
      hasGeneratedCaptions ||
      item.transcriptCaptions?.enabled !== true ||
      isBroken ||
      (item.type !== 'video' && item.type !== 'audio') ||
      !item.mediaId
    ) {
      return
    }

    const attemptKey = `${item.id}:${item.mediaId}`
    if (attemptRef.current === attemptKey) {
      return
    }
    attemptRef.current = attemptKey

    void mediaTranscriptionService
      .enableTranscriptCaptions(item.mediaId, {
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
