import { memo } from 'react'
import { cancelMediaTranscriptionJob } from '@/features/timeline/deps/media-transcription-service'
import {
  TranscribeDialog,
  type TranscribeDialogValues,
} from '@/features/timeline/deps/transcribe-dialog'
import {
  getTranscriptionOverallPercent,
  getTranscriptionStageLabel,
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
      progressPercent={
        transcriptProgress ? Math.round(getTranscriptionOverallPercent(transcriptProgress)) : null
      }
      progressLabel={
        transcriptProgress
          ? `${getTranscriptionStageLabel(transcriptProgress.stage)} (${Math.round(
              getTranscriptionOverallPercent(transcriptProgress),
            )}%)`
          : 'Transcribing...'
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
    />
  )
})
