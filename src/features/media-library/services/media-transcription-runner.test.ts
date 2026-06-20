import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'

const storeState = vi.hoisted(() => ({
  transcriptStatus: new Map<string, 'idle' | 'queued' | 'transcribing' | 'ready' | 'error'>(),
  transcriptProgress: new Map<string, { stage: string; progress: number }>(),
  setTranscriptStatus: vi.fn(),
  setTranscriptProgress: vi.fn(),
  clearTranscriptProgress: vi.fn(),
}))

const mediaTranscriptionServiceMocks = vi.hoisted(() => ({
  transcribeMedia: vi.fn(),
  cancelTranscription: vi.fn(),
}))

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => storeState,
  },
}))

vi.mock('./media-transcription-service', () => ({
  mediaTranscriptionService: mediaTranscriptionServiceMocks,
}))

const { cancelMediaTranscriptionJob, runMediaTranscriptionJob } = await import(
  './media-transcription-runner'
)

function makeTranscript(mediaId = 'media-1'): MediaTranscript {
  return {
    id: mediaId,
    mediaId,
    model: 'whisper-base',
    language: 'auto',
    quantization: 'hybrid',
    text: 'hello',
    segments: [{ text: 'hello', start: 0, end: 1 }],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('runMediaTranscriptionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.transcriptStatus = new Map()
    storeState.transcriptProgress = new Map()
    mediaTranscriptionServiceMocks.cancelTranscription.mockReturnValue(true)
  })

  it('owns the shared status and progress lifecycle', async () => {
    const transcript = makeTranscript()
    mediaTranscriptionServiceMocks.transcribeMedia.mockImplementation(async (_mediaId, options) => {
      options.onQueueStatusChange?.('running')
      options.onProgress?.({ stage: 'decoding', progress: 0.42 })
      return transcript
    })

    const result = await runMediaTranscriptionJob('media-1', {
      model: 'whisper-base',
      quantization: 'hybrid',
    })

    expect(result).toEqual({ status: 'completed', transcript })
    expect(storeState.setTranscriptStatus.mock.calls).toEqual([
      ['media-1', 'queued'],
      ['media-1', 'transcribing'],
      ['media-1', 'ready'],
    ])
    expect(storeState.setTranscriptProgress.mock.calls).toEqual([
      ['media-1', { stage: 'queued', progress: 0 }],
      ['media-1', { stage: 'loading', progress: 0 }],
      ['media-1', { stage: 'decoding', progress: 0.42 }],
    ])
    expect(storeState.clearTranscriptProgress).toHaveBeenCalledWith('media-1')
  })

  it('restores the previous status when cancelled', async () => {
    storeState.transcriptStatus = new Map([['media-1', 'ready']])
    mediaTranscriptionServiceMocks.transcribeMedia.mockRejectedValue(
      new Error('Transcription cancelled'),
    )

    const result = await runMediaTranscriptionJob('media-1')

    expect(result).toEqual({ status: 'cancelled' })
    expect(storeState.setTranscriptStatus).toHaveBeenLastCalledWith('media-1', 'ready')
    expect(storeState.clearTranscriptProgress).toHaveBeenCalledWith('media-1')
  })

  it('uses the shared cancel wrapper', () => {
    expect(cancelMediaTranscriptionJob('media-1')).toBe(true)
    expect(mediaTranscriptionServiceMocks.cancelTranscription).toHaveBeenCalledWith('media-1')
  })
})
