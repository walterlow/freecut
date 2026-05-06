import { prewarmDroppedTimelineAudio } from './drop-audio-prewarm'

const compositionRuntimeMocks = vi.hoisted(() => ({
  getOrDecodeAudioSliceForPlayback: vi.fn(),
  needsCustomAudioDecoder: vi.fn(() => false),
  prewarmPreviewAudioElement: vi.fn(),
  startPreviewAudioConform: vi.fn(async () => undefined),
}))

const previewBudgetMocks = vi.hoisted(() => ({
  registerPreviewAudioStartupHold: vi.fn(() => vi.fn()),
}))

vi.mock('@/features/timeline/deps/composition-runtime', () => compositionRuntimeMocks)
vi.mock('../hooks/preview-work-budget', () => previewBudgetMocks)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('prewarmDroppedTimelineAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(false)
    compositionRuntimeMocks.startPreviewAudioConform.mockResolvedValue(undefined)
  })

  it('starts both startup slice warmup and background conform for custom-decoded drops', async () => {
    const deferred = createDeferred<{
      buffer: AudioBuffer
      startTime: number
      isComplete: boolean
    }>()
    const releaseHold = vi.fn()

    compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(true)
    compositionRuntimeMocks.getOrDecodeAudioSliceForPlayback.mockImplementation(
      () => deferred.promise,
    )
    previewBudgetMocks.registerPreviewAudioStartupHold.mockReturnValue(releaseHold)

    prewarmDroppedTimelineAudio(
      [
        {
          mediaId: 'media-1',
          mediaType: 'video',
          label: 'clip.webm',
          media: {
            id: 'media-1',
            mimeType: 'video/webm',
            codec: 'vp9',
            audioCodec: 'vorbis',
            fps: 30,
          },
        } as never,
      ],
      [
        {
          type: 'video',
          mediaId: 'media-1',
          src: 'blob:video',
          audioSrc: 'blob:audio',
          sourceFps: 30,
          sourceStart: 90,
        } as never,
      ],
    )

    expect(compositionRuntimeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
      'media-1',
      'blob:audio',
      expect.objectContaining({
        minReadySeconds: 1,
        waitTimeoutMs: 6000,
        targetTimeSeconds: 3,
      }),
    )
    expect(compositionRuntimeMocks.startPreviewAudioConform).not.toHaveBeenCalled()
    expect(previewBudgetMocks.registerPreviewAudioStartupHold).toHaveBeenCalledTimes(1)
    expect(releaseHold).not.toHaveBeenCalled()

    deferred.resolve({
      buffer: {} as AudioBuffer,
      startTime: 0,
      isComplete: false,
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(compositionRuntimeMocks.startPreviewAudioConform).toHaveBeenCalledWith(
      'media-1',
      'blob:audio',
    )
    expect(releaseHold).toHaveBeenCalledTimes(1)
  })
})
