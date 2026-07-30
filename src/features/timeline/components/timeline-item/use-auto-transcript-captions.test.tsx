import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { CaptionDialogState } from './use-caption-dialog-state'

vi.mock('../../deps/media-transcription-service', () => ({
  mediaTranscriptionService: {
    enableTranscriptCaptions: vi.fn(),
  },
}))

const { mediaTranscriptionService } = await import('../../deps/media-transcription-service')
const { useAutoTranscriptCaptions } = await import('./use-auto-transcript-captions')
const enableTranscriptCaptionsMock = vi.mocked(mediaTranscriptionService.enableTranscriptCaptions)

function makeItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Clip',
    mediaId: 'media-1',
    src: 'blob:test',
    ...overrides,
  }
}

function makeCaptionState(overrides: Partial<CaptionDialogState> = {}): CaptionDialogState {
  return {
    canManageCaptions: true,
    canExtractEmbeddedSubtitles: false,
    hasConsolidatablePerCueCaptions: false,
    mediaHasTranscript: true,
    transcriptStatus: 'ready',
    transcriptProgress: null,
    mediaFileName: 'clip.mp4',
    dialogOpen: false,
    openDialog: vi.fn(),
    setDialogOpen: vi.fn(),
    setDialogError: vi.fn(),
    dialogError: null,
    markCaptionStarted: vi.fn(),
    markCaptionEnded: vi.fn(),
    markCaptionStopRequested: vi.fn(),
    handleExtractEmbeddedSubtitles: undefined,
    handleConsolidateCaptionsToSegment: undefined,
    ...overrides,
  }
}

describe('useAutoTranscriptCaptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enableTranscriptCaptionsMock.mockResolvedValue({ updatedClipCount: 1, removedItemCount: 0 })
  })

  it('does not auto-enable captions when transcript captions are absent or disabled', async () => {
    renderHook(() =>
      useAutoTranscriptCaptions({
        item: makeItem({ transcriptCaptions: undefined }),
        caption: makeCaptionState(),
        hasGeneratedCaptions: false,
        isBroken: false,
      }),
    )

    await waitFor(() => {
      expect(enableTranscriptCaptionsMock).not.toHaveBeenCalled()
    })

    renderHook(() =>
      useAutoTranscriptCaptions({
        item: makeItem({
          transcriptCaptions: {
            type: 'transcript',
            mediaId: 'media-1',
            enabled: false,
            updatedAt: 1,
            cues: [],
          },
        }),
        caption: makeCaptionState(),
        hasGeneratedCaptions: false,
        isBroken: false,
      }),
    )

    await waitFor(() => {
      expect(enableTranscriptCaptionsMock).not.toHaveBeenCalled()
    })
  })

  it('refreshes captions when transcript captions are already enabled', async () => {
    renderHook(() =>
      useAutoTranscriptCaptions({
        item: makeItem({
          transcriptCaptions: {
            type: 'transcript',
            mediaId: 'media-1',
            enabled: true,
            updatedAt: 1,
            cues: [],
          },
        }),
        caption: makeCaptionState(),
        hasGeneratedCaptions: false,
        isBroken: false,
      }),
    )

    await waitFor(() => {
      expect(enableTranscriptCaptionsMock).toHaveBeenCalledWith('media-1', {
        clipIds: ['clip-1'],
        replaceExisting: false,
        selectUpdatedClips: false,
      })
    })
  })
})
