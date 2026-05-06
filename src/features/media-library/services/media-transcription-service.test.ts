import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { waitFor } from '@testing-library/react'
import type { MediaTranscript } from '@/types/storage'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'

const saveTranscriptMock = vi.fn()
const getTranscriptMock = vi.fn()
const useTimelineStoreGetStateMock = vi.fn()
const useProjectStoreGetStateMock = vi.fn()
const useSelectionStoreGetStateMock = vi.fn()
const usePlaybackStoreGetStateMock = vi.fn()
const transcribeCollectMock = vi.fn()
const transcribeMock = vi.fn()
const getMediaMock = vi.fn()
const getMediaFileMock = vi.fn()
const startPreviewAudioConformMock = vi.fn()
const resolvePreviewAudioConformUrlMock = vi.fn()

vi.mock('@/infrastructure/storage', () => ({
  deleteTranscript: vi.fn(),
  getTranscript: getTranscriptMock,
  getTranscriptMediaIds: vi.fn(),
  saveTranscript: saveTranscriptMock,
}))

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: {
    getState: useSelectionStoreGetStateMock,
  },
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: usePlaybackStoreGetStateMock,
  },
}))

vi.mock('@/features/media-library/deps/projects', () => ({
  useProjectStore: {
    getState: useProjectStoreGetStateMock,
  },
}))

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  useTimelineStore: {
    getState: useTimelineStoreGetStateMock,
  },
}))

vi.mock('@/features/media-library/deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({
      defaultWhisperModel: 'tiny',
      defaultWhisperQuantization: 'q8',
      defaultWhisperLanguage: 'auto',
    }),
  },
}))

vi.mock('../transcription/registry', () => ({
  getDefaultMediaTranscriptionAdapter: () => ({
    createTranscriber: () => ({
      transcribe: transcribeMock,
    }),
  }),
  getMediaTranscriptionModelLabel: () => 'Tiny',
}))

vi.mock('./media-library-service', () => ({
  mediaLibraryService: {
    getMedia: getMediaMock,
    getMediaFile: getMediaFileMock,
  },
}))

vi.mock('@/features/media-library/deps/composition-runtime-contract', () => ({
  needsCustomAudioDecoder: vi.fn((codec?: string) => codec === 'pcm-s16be'),
  startPreviewAudioConform: startPreviewAudioConformMock,
  resolvePreviewAudioConformUrl: resolvePreviewAudioConformUrlMock,
}))

const { mediaTranscriptionService } = await import('./media-transcription-service')

function makeTrack(id: string, order: number): TimelineTrack {
  return {
    id,
    name: id,
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

function makeTextItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number,
): TimelineItem {
  return {
    id,
    type: 'text',
    trackId,
    from,
    durationInFrames,
    label: id,
    text: id,
    color: '#fff',
  }
}

describe('mediaTranscriptionService.insertTranscriptAsCaptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSelectionStoreGetStateMock.mockReturnValue({
      selectedItemIds: [],
      selectItems: vi.fn(),
    })
    usePlaybackStoreGetStateMock.mockReturnValue({ currentFrame: 0 })
    useProjectStoreGetStateMock.mockReturnValue({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    })
    transcribeMock.mockReturnValue({
      collect: transcribeCollectMock,
    })
    transcribeCollectMock.mockResolvedValue([])
    getMediaMock.mockResolvedValue(null)
    getMediaFileMock.mockResolvedValue(null)
    startPreviewAudioConformMock.mockResolvedValue(undefined)
    resolvePreviewAudioConformUrlMock.mockResolvedValue(null)
  })

  it('creates a new captions track above the clip track when no compatible track exists', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
      speed: 1,
    }
    const initialTracks = [
      makeTrack('track-top', 0),
      makeTrack('track-video', 1),
      makeTrack('track-bottom', 2),
    ]
    const setTracks = vi.fn()
    const removeItems = vi.fn()
    const addItems = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: initialTracks,
      items: [
        clip,
        makeTextItem('top-blocker', 'track-top', 0, 90),
        makeTextItem('bottom-blocker', 'track-bottom', 0, 90),
      ],
      setTracks,
      removeItems,
      addItems,
    })

    const transcript: MediaTranscript = {
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: 'Hello there',
      segments: [{ text: 'Hello there', start: 0, end: 2 }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    getTranscriptMock.mockResolvedValue(transcript)

    const result = await mediaTranscriptionService.insertTranscriptAsCaptions('media-1', {
      clipIds: ['clip-1'],
    })

    expect(result).toEqual({
      insertedItemCount: 1,
      removedItemCount: 0,
    })
    expect(setTracks).toHaveBeenCalledTimes(1)

    const updatedTracks = setTracks.mock.calls[0]![0] as TimelineTrack[]
    const captionTrack = updatedTracks.find(
      (track) => !initialTracks.some((existing) => existing.id === track.id),
    )
    expect(captionTrack).toBeDefined()
    expect(captionTrack?.order).toBe(0.5)

    expect(addItems).toHaveBeenCalledTimes(1)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems).toHaveLength(1)
    expect(insertedItems[0]?.trackId).toBe(captionTrack?.id)
    expect(insertedItems[0]).toMatchObject({
      type: 'subtitle',
      label: 'Transcript',
      source: {
        type: 'transcript',
        mediaId: 'media-1',
        clipId: 'clip-1',
      },
      cues: [{ text: 'Hello there', startSeconds: 0, endSeconds: 2 }],
    })
    expect(removeItems).not.toHaveBeenCalled()
  })

  it('does not reuse an audio track when regenerating transcript captions', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
      speed: 1,
    }
    const initialTracks = [
      { ...makeTrack('track-audio', 0), name: 'A1', kind: 'audio' as const },
      { ...makeTrack('track-video', 1), name: 'V1', kind: 'video' as const },
    ]
    const legacyCaptionOnAudioTrack: TimelineItem = {
      id: 'caption-old',
      type: 'text',
      trackId: 'track-audio',
      from: 0,
      durationInFrames: 30,
      label: 'caption-old',
      text: 'caption-old',
      mediaId: 'media-1',
      color: '#fff',
      captionSource: {
        type: 'transcript',
        clipId: 'clip-1',
        mediaId: 'media-1',
      },
    }
    const setTracks = vi.fn()
    const removeItems = vi.fn()
    const addItems = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: initialTracks,
      items: [clip, legacyCaptionOnAudioTrack],
      setTracks,
      removeItems,
      addItems,
    })

    const transcript: MediaTranscript = {
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: 'Hello there',
      segments: [{ text: 'Hello there', start: 0, end: 2 }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    getTranscriptMock.mockResolvedValue(transcript)

    const result = await mediaTranscriptionService.insertTranscriptAsCaptions('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: true,
    })

    expect(result).toEqual({
      insertedItemCount: 1,
      removedItemCount: 1,
    })
    expect(setTracks).toHaveBeenCalledTimes(1)

    const updatedTracks = setTracks.mock.calls[0]![0] as TimelineTrack[]
    const captionTrack = updatedTracks.find(
      (track) => !initialTracks.some((existing) => existing.id === track.id),
    )
    expect(captionTrack).toBeDefined()
    expect(captionTrack?.kind).toBe('video')

    expect(addItems).toHaveBeenCalledTimes(1)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems[0]?.trackId).toBe(captionTrack?.id)
    expect(insertedItems[0]?.trackId).not.toBe('track-audio')
    expect(insertedItems[0]?.type).toBe('subtitle')
    expect(removeItems).toHaveBeenCalledWith(['caption-old'])
  })

  it('replaces an existing transcript subtitle segment with a single refreshed segment', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 150,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 150,
      sourceDuration: 150,
      sourceFps: 30,
      speed: 1,
    }
    const captionTrack = { ...makeTrack('track-captions', 0), kind: 'video' as const }
    const videoTrack = { ...makeTrack('track-video', 1), kind: 'video' as const }
    const existingTranscript: TimelineItem = {
      id: 'transcript-old',
      type: 'subtitle',
      trackId: 'track-captions',
      from: 0,
      durationInFrames: 60,
      label: 'Transcript',
      mediaId: 'media-1',
      source: {
        type: 'transcript',
        mediaId: 'media-1',
        clipId: 'clip-1',
      },
      cues: [{ id: 'old-cue', startSeconds: 0, endSeconds: 2, text: 'Old text' }],
      color: '#fff',
    }
    const setTracks = vi.fn()
    const removeItems = vi.fn()
    const addItems = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [captionTrack, videoTrack],
      items: [clip, existingTranscript],
      setTracks,
      removeItems,
      addItems,
    })

    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: 'Fresh one Fresh two',
      segments: [
        { text: 'Fresh one', start: 0, end: 1 },
        { text: 'Fresh two', start: 1, end: 3 },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsCaptions('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: true,
    })

    expect(result).toEqual({
      insertedItemCount: 1,
      removedItemCount: 1,
    })
    expect(setTracks).not.toHaveBeenCalled()
    expect(removeItems).toHaveBeenCalledWith(['transcript-old'])
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems).toHaveLength(1)
    expect(insertedItems[0]).toMatchObject({
      type: 'subtitle',
      trackId: 'track-captions',
      source: {
        type: 'transcript',
        mediaId: 'media-1',
        clipId: 'clip-1',
      },
    })
    if (insertedItems[0]?.type === 'subtitle') {
      expect(insertedItems[0].cues.map((cue) => cue.text)).toEqual(['Fresh one', 'Fresh two'])
    }
  })
})

describe('mediaTranscriptionService.transcribeMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transcribeMock.mockReturnValue({
      collect: transcribeCollectMock,
    })
    transcribeCollectMock.mockResolvedValue([{ text: ' hello ', start: 0, end: 1.2 }])
    startPreviewAudioConformMock.mockResolvedValue(undefined)
    resolvePreviewAudioConformUrlMock.mockResolvedValue(null)
  })

  it('transcribes the original file for browser-decodable codecs', async () => {
    const sourceFile = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })
    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.mp3',
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)

    await mediaTranscriptionService.transcribeMedia('media-1')

    expect(startPreviewAudioConformMock).not.toHaveBeenCalled()
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(transcribeMock.mock.calls[0]?.[0]).toBe(sourceFile)
    expect(saveTranscriptMock).toHaveBeenCalledTimes(1)
  })

  it('splits word-timestamped Whisper chunks into readable caption segments', async () => {
    const sourceFile = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })
    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.mp3',
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)
    transcribeCollectMock.mockResolvedValue([
      {
        text: " my sentences. So once again, I'm going to talk about the Netherlands in this video.",
        start: 0,
        end: 5,
        words: [
          { text: 'my', start: 0, end: 0.2 },
          { text: 'sentences.', start: 0.22, end: 0.7 },
          { text: 'So', start: 1.4, end: 1.6 },
          { text: 'once', start: 1.62, end: 1.9 },
          { text: 'again,', start: 1.92, end: 2.2 },
          { text: "I'm", start: 2.22, end: 2.4 },
          { text: 'going', start: 2.42, end: 2.7 },
          { text: 'to', start: 2.72, end: 2.84 },
          { text: 'talk', start: 2.86, end: 3.1 },
          { text: 'about', start: 3.12, end: 3.38 },
          { text: 'the', start: 3.4, end: 3.52 },
          { text: 'Netherlands', start: 3.54, end: 4.1 },
          { text: 'in', start: 4.12, end: 4.25 },
          { text: 'this', start: 4.27, end: 4.42 },
          { text: 'video.', start: 4.44, end: 4.8 },
        ],
      },
    ])

    await mediaTranscriptionService.transcribeMedia('media-1')

    const saved = saveTranscriptMock.mock.calls[0]?.[0] as MediaTranscript
    expect(saved.segments.length).toBeGreaterThan(1)
    expect(saved.segments.every((segment) => segment.text.length <= 72)).toBe(true)
    expect(saved.segments.every((segment) => (segment.words?.length ?? 0) > 0)).toBe(true)
    expect(saved.segments.map((segment) => segment.text)).toEqual([
      'my sentences.',
      "So once again, I'm going to talk about the Netherlands in this",
      'video.',
    ])
  })

  it('transcribes a conformed wav for custom-decoded codecs like pcm-s16be', async () => {
    const sourceFile = new File(['pcm'], 'clip.aif', { type: 'audio/aiff' })
    const conformedBlob = new Blob(['wav'], { type: 'audio/wav' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => conformedBlob,
    } as Response)

    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.aif',
      mimeType: 'audio/aiff',
      codec: 'pcm-s16be',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)
    resolvePreviewAudioConformUrlMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('blob:conformed-audio')

    await mediaTranscriptionService.transcribeMedia('media-1')

    expect(startPreviewAudioConformMock).toHaveBeenCalledWith('media-1', sourceFile)
    expect(resolvePreviewAudioConformUrlMock).toHaveBeenCalledWith('media-1')
    expect(transcribeMock).toHaveBeenCalledTimes(1)

    const transcribeFile = transcribeMock.mock.calls[0]?.[0] as File
    expect(transcribeFile).toBeInstanceOf(File)
    expect(transcribeFile.type).toBe('audio/wav')

    fetchMock.mockRestore()
  })

  it('reuses a cached conformed wav without starting a new conform job', async () => {
    const sourceFile = new File(['pcm'], 'clip.aif', { type: 'audio/aiff' })
    const conformedBlob = new Blob(['wav'], { type: 'audio/wav' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => conformedBlob,
    } as Response)

    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.aif',
      mimeType: 'audio/aiff',
      codec: 'pcm-s16be',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)
    resolvePreviewAudioConformUrlMock.mockResolvedValue('blob:cached-conformed-audio')

    await mediaTranscriptionService.transcribeMedia('media-1')

    expect(startPreviewAudioConformMock).not.toHaveBeenCalled()
    expect(resolvePreviewAudioConformUrlMock).toHaveBeenCalledWith('media-1')
    expect(transcribeMock).toHaveBeenCalledTimes(1)

    const transcribeFile = transcribeMock.mock.calls[0]?.[0] as File
    expect(transcribeFile).toBeInstanceOf(File)
    expect(transcribeFile.type).toBe('audio/wav')

    fetchMock.mockRestore()
  })

  it('runs only one transcription job at a time and queues later requests', async () => {
    const sourceById = {
      'media-1': new File(['one'], 'one.mp3', { type: 'audio/mpeg' }),
      'media-2': new File(['two'], 'two.mp3', { type: 'audio/mpeg' }),
    } as const
    getMediaMock.mockImplementation(async (mediaId: string) => ({
      id: mediaId,
      fileName: `${mediaId}.mp3`,
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    }))
    getMediaFileMock.mockImplementation(
      async (mediaId: string) => sourceById[mediaId as keyof typeof sourceById],
    )

    let resolveFirstCollect!: (
      segments: Array<{ text: string; start: number; end: number }>,
    ) => void
    const firstCollect = vi.fn(
      () =>
        new Promise<Array<{ text: string; start: number; end: number }>>((resolve) => {
          resolveFirstCollect = resolve
        }),
    )
    const secondCollect = vi.fn().mockResolvedValue([{ text: ' second ', start: 0, end: 1 }])

    transcribeMock
      .mockReturnValueOnce({ collect: firstCollect, cancel: vi.fn() })
      .mockReturnValueOnce({ collect: secondCollect, cancel: vi.fn() })

    const firstQueueState = vi.fn()
    const secondQueueState = vi.fn()

    const firstPromise = mediaTranscriptionService.transcribeMedia('media-1', {
      onQueueStatusChange: firstQueueState,
    })
    const secondPromise = mediaTranscriptionService.transcribeMedia('media-2', {
      onQueueStatusChange: secondQueueState,
    })

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledTimes(1)
    })
    expect(firstQueueState).toHaveBeenCalledWith('running')
    expect(secondQueueState).toHaveBeenCalledWith('queued')

    resolveFirstCollect([{ text: ' first ', start: 0, end: 1 }])

    await firstPromise
    await secondPromise

    expect(transcribeMock).toHaveBeenCalledTimes(2)
    expect(secondQueueState).toHaveBeenCalledWith('running')
  })

  it('cancels queued transcription jobs before they start', async () => {
    const sourceById = {
      'media-1': new File(['one'], 'one.mp3', { type: 'audio/mpeg' }),
      'media-2': new File(['two'], 'two.mp3', { type: 'audio/mpeg' }),
    } as const
    getMediaMock.mockImplementation(async (mediaId: string) => ({
      id: mediaId,
      fileName: `${mediaId}.mp3`,
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    }))
    getMediaFileMock.mockImplementation(
      async (mediaId: string) => sourceById[mediaId as keyof typeof sourceById],
    )

    let resolveFirstCollect!: (
      segments: Array<{ text: string; start: number; end: number }>,
    ) => void
    const firstCollect = vi.fn(
      () =>
        new Promise<Array<{ text: string; start: number; end: number }>>((resolve) => {
          resolveFirstCollect = resolve
        }),
    )

    transcribeMock.mockReturnValueOnce({ collect: firstCollect, cancel: vi.fn() })

    const firstPromise = mediaTranscriptionService.transcribeMedia('media-1')
    const secondPromise = mediaTranscriptionService.transcribeMedia('media-2')

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledTimes(1)
    })

    const secondRejection = expect(secondPromise).rejects.toThrow('Transcription cancelled')
    expect(mediaTranscriptionService.cancelTranscription('media-2')).toBe(true)
    await secondRejection
    expect(transcribeMock).toHaveBeenCalledTimes(1)

    resolveFirstCollect([{ text: ' first ', start: 0, end: 1 }])
    await firstPromise
  })

  it('cancels the active transcription job and advances the queue', async () => {
    const sourceById = {
      'media-1': new File(['one'], 'one.mp3', { type: 'audio/mpeg' }),
      'media-2': new File(['two'], 'two.mp3', { type: 'audio/mpeg' }),
    } as const
    getMediaMock.mockImplementation(async (mediaId: string) => ({
      id: mediaId,
      fileName: `${mediaId}.mp3`,
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    }))
    getMediaFileMock.mockImplementation(
      async (mediaId: string) => sourceById[mediaId as keyof typeof sourceById],
    )

    let rejectFirstCollect!: (error: Error) => void
    const firstCollect = vi.fn(
      () =>
        new Promise<Array<{ text: string; start: number; end: number }>>((_, reject) => {
          rejectFirstCollect = reject
        }),
    )
    const firstCancel = vi.fn((message?: string) => {
      rejectFirstCollect(new Error(message ?? 'Transcription cancelled'))
    })
    const secondCollect = vi.fn().mockResolvedValue([{ text: ' second ', start: 0, end: 1 }])

    transcribeMock
      .mockReturnValueOnce({ collect: firstCollect, cancel: firstCancel })
      .mockReturnValueOnce({ collect: secondCollect, cancel: vi.fn() })

    const firstPromise = mediaTranscriptionService.transcribeMedia('media-1')
    const secondPromise = mediaTranscriptionService.transcribeMedia('media-2')

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledTimes(1)
    })

    expect(mediaTranscriptionService.cancelTranscription('media-1')).toBe(true)
    await expect(firstPromise).rejects.toThrow('Transcription cancelled')

    const secondTranscript = await secondPromise
    expect(firstCancel).toHaveBeenCalledWith('Transcription cancelled')
    expect(secondTranscript.mediaId).toBe('media-2')
    expect(transcribeMock).toHaveBeenCalledTimes(2)
  })
})
