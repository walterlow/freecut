import { memo } from 'react'
import {
  cancelMediaTranscriptionJob,
  mediaTranscriptionService,
} from '@/features/timeline/deps/media-transcription-service'
import {
  TranscribeDialog,
  type TranscribeDialogValues,
} from '@/features/timeline/deps/transcribe-dialog'
import {
  getTranscriptionProgressDetail,
  getTranscriptionProgressLabel,
  isIndeterminateTranscriptionProgress,
} from '@/shared/utils/transcription-progress'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import type { CaptionDialogState } from './use-caption-dialog-state'

interface TranscribeDialogControllerProps {
  itemMediaId: string | undefined
  hasGeneratedCaptions: boolean
  caption: CaptionDialogState
  onGenerate: (
    values: TranscribeDialogValues,
    hasExistingCaptions: boolean,
    onError?: (error: unknown) => void,
  ) => void
}

export const TranscribeDialogController = memo(function TranscribeDialogController({
  itemMediaId,
  hasGeneratedCaptions,
  caption,
  onGenerate,
}: TranscribeDialogControllerProps) {
  if (!caption.canManageCaptions || !itemMediaId) {
    return null
  }

  const {
    dialogOpen,
    setDialogOpen,
    mediaFileName,
    mediaHasTranscript,
    transcriptStatus,
    transcriptProgress,
    dialogError,
    setDialogError,
    markCaptionStarted,
    markCaptionEnded,
    markCaptionStopRequested,
  } = caption

  return (
    <TranscribeDialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) setDialogError(null)
        setDialogOpen(next)
      }}
      fileName={mediaFileName}
      hasTranscript={mediaHasTranscript}
      isRunning={transcriptStatus === 'queued' || transcriptStatus === 'transcribing'}
      // The bar tracks the *current stage*, not the whole job. Overall percent (which the
      // collapsed media-library bar still uses, having room for only one number) would crawl
      // across the first tenth of the track for a multi-minute download and read as a hang.
      progressPercent={transcriptProgress ? Math.round(transcriptProgress.progress * 100) : null}
      progressIndeterminate={
        transcriptProgress ? isIndeterminateTranscriptionProgress(transcriptProgress) : false
      }
      progressLabel={
        transcriptProgress ? getTranscriptionProgressLabel(transcriptProgress) : 'Transcribing...'
      }
      progressDetail={
        transcriptProgress ? getTranscriptionProgressDetail(transcriptProgress) : null
      }
      errorMessage={dialogError}
      onStart={(values: TranscribeDialogValues) => {
        markCaptionStarted()
        setDialogError(null)
        const handleError = (error: unknown) => {
          markCaptionEnded()
          const baseMessage = error instanceof Error ? error.message : 'Failed to generate captions'
          setDialogError(
            isTranscriptionOutOfMemoryError(error) ? TRANSCRIPTION_OOM_HINT : baseMessage,
          )
        }
        try {
          onGenerate(values, hasGeneratedCaptions, handleError)
          setDialogOpen(false)
        } catch (error) {
          handleError(error)
        }
      }}
      onCancel={() => {
        markCaptionStopRequested()
        cancelMediaTranscriptionJob(itemMediaId)
      }}
      onDelete={async () => {
        if (!itemMediaId) return
        try {
          await mediaTranscriptionService.deleteTranscript(itemMediaId)
        } catch {
          // ignore
        }
      }}
    />
  )
})
