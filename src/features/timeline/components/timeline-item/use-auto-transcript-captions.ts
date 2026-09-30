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
 * Auto-enables transcript-backed captions for a video/audio clip the first time
 * its media has a transcript and no captions yet. Runs once per item+media pair
 * (tracked by a ref) and stays silent on failure — the explicit "Generate
 * Captions" action remains the user-facing fallback.
 */
export function useAutoTranscriptCaptions({
  item,
  caption,
  hasGeneratedCaptions,
  isBroken,
}: UseAutoTranscriptCaptionsParams): void {
  const attemptRef = useRef<string | null>(null)

  useEffect(() => {
    if (!caption.mediaHasTranscript) {
      attemptRef.current = null
      return
    }

    if (
      !caption.canManageCaptions ||
      hasGeneratedCaptions ||
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
    item.type,
  ])
}
