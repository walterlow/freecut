import type { MediaTranscript, MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'
import { isTranscriptionCancellationError } from '@/shared/utils/transcription-cancellation'
import type { TranscribeOptions } from '../transcription/types'
import type { MediaTranscriptStatus } from '../types'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { mediaTranscriptionService } from './media-transcription-service'

type QueueState = 'queued' | 'running'

export interface RunMediaTranscriptionJobOptions {
  model?: MediaTranscriptModel
  quantization?: MediaTranscriptQuantization
  language?: string
  /**
   * Defaults to true. Keep this centralized so all UI launch paths either get
   * the same throttled background progress or intentionally opt out.
   */
  updateProgress?: boolean
  onProgress?: TranscribeOptions['onProgress']
  onQueueStatusChange?: (state: QueueState) => void
}

export type MediaTranscriptionJobResult =
  | { status: 'completed'; transcript: MediaTranscript }
  | { status: 'cancelled' }

function setInitialTranscriptionState(mediaId: string): void {
  const store = useMediaLibraryStore.getState()
  store.setTranscriptStatus(mediaId, 'queued')
  store.setTranscriptProgress(mediaId, { stage: 'queued', progress: 0 })
}

function createProgressHandler(
  mediaId: string,
  updateProgress: boolean,
  onProgress: TranscribeOptions['onProgress'] | undefined,
): TranscribeOptions['onProgress'] {
  let lastStage: string | null = null
  let lastPercent = -1

  return (progress) => {
    onProgress?.(progress)
    if (!updateProgress) return

    const percent = Math.floor(progress.progress * 100)
    if (progress.stage === lastStage && percent <= lastPercent) {
      return
    }

    lastStage = progress.stage
    lastPercent = percent
    useMediaLibraryStore.getState().setTranscriptProgress(mediaId, progress)
  }
}

function createQueueStatusHandler(
  mediaId: string,
  onQueueStatusChange: ((state: QueueState) => void) | undefined,
): (state: QueueState) => void {
  return (state) => {
    onQueueStatusChange?.(state)
    const store = useMediaLibraryStore.getState()

    if (state === 'queued') {
      store.setTranscriptStatus(mediaId, 'queued')
      store.setTranscriptProgress(mediaId, { stage: 'queued', progress: 0 })
      return
    }

    store.setTranscriptStatus(mediaId, 'transcribing')
    const currentProgress = store.transcriptProgress.get(mediaId)
    if (!currentProgress || currentProgress.stage === 'queued') {
      store.setTranscriptProgress(mediaId, { stage: 'loading', progress: 0 })
    }
  }
}

export async function runMediaTranscriptionJob(
  mediaId: string,
  options: RunMediaTranscriptionJobOptions = {},
): Promise<MediaTranscriptionJobResult> {
  const store = useMediaLibraryStore.getState()
  const previousStatus: MediaTranscriptStatus = store.transcriptStatus.get(mediaId) ?? 'idle'
  const updateProgress = options.updateProgress ?? true

  setInitialTranscriptionState(mediaId)

  try {
    const transcript = await mediaTranscriptionService.transcribeMedia(mediaId, {
      model: options.model,
      quantization: options.quantization,
      language: options.language || undefined,
      onQueueStatusChange: createQueueStatusHandler(mediaId, options.onQueueStatusChange),
      onProgress: createProgressHandler(mediaId, updateProgress, options.onProgress),
    })

    useMediaLibraryStore.getState().setTranscriptStatus(mediaId, 'ready')
    useMediaLibraryStore.getState().clearTranscriptProgress(mediaId)
    return { status: 'completed', transcript }
  } catch (error) {
    const latestStore = useMediaLibraryStore.getState()
    if (isTranscriptionCancellationError(error)) {
      latestStore.setTranscriptStatus(mediaId, previousStatus)
      latestStore.clearTranscriptProgress(mediaId)
      return { status: 'cancelled' }
    }

    latestStore.setTranscriptStatus(mediaId, previousStatus === 'ready' ? 'ready' : 'error')
    latestStore.clearTranscriptProgress(mediaId)
    throw error
  }
}

export function cancelMediaTranscriptionJob(mediaId: string): boolean {
  return mediaTranscriptionService.cancelTranscription(mediaId)
}
