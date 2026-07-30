import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { waitFor } from '@testing-library/react'
import type { MediaTranscript } from '@/types/storage'
import type { AudioItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'

const saveTranscriptMock = vi.fn()
const getTranscriptMock = vi.fn()
const useTimelineStoreGetStateMock = vi.fn()
const useCompositionsStoreGetStateMock = vi.fn()
const useCompositionNavigationStoreGetStateMock = vi.fn()
const useCompositionNavigationStoreSetStateMock = vi.fn()
const useProjectStoreGetStateMock = vi.fn()
const useSelectionStoreGetStateMock = vi.fn()
const usePlaybackStoreGetStateMock = vi.fn()
const removeTimelineItemsExactMock = vi.fn()
const selectItemsMock = vi.fn()
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
  removeTimelineItemsExact: removeTimelineItemsExactMock,
  useTimelineStore: {
    getState: useTimelineStoreGetStateMock,
  },
  useCompositionsStore: {
    getState: useCompositionsStoreGetStateMock,
  },
  useCompositionNavigationStore: {
    getState: useCompositionNavigationStoreGetStateMock,
    setState: useCompositionNavigationStoreSetStateMock,
  },
}))

vi.mock('@/features/media-library/deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({
      defaultWhisperModel: 'tiny',
      defaultWhisperQuantization: 'q8',
      defaultWhisperLanguage: 'auto',
      defaultCaptionStylePresetId: 'netflix',
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

beforeEach(() => {
  useCompositionsStoreGetStateMock.mockReturnValue({
    compositions: [],
    updateComposition: vi.fn(),
  })
  useCompositionNavigationStoreGetStateMock.mockReturnValue({
    stashStack: [],
    mainHolder: null,
  })
})

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

function mockQueuedTranscriptionSources() {
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
}

describe('mediaTranscriptionService.insertTranscriptAsCaptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSelectionStoreGetStateMock.mockReturnValue({
      selectedItemIds: [],
      selectItems: selectItemsMock,
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
      cues: [{ text: 'Hello there' }],
    })
    const insertedCue = insertedItems[0]?.type === 'subtitle' ? insertedItems[0].cues[0] : undefined
    expect(insertedCue?.startSeconds).toBeCloseTo(0)
    expect(insertedCue?.endSeconds).toBeCloseTo(2)
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
    expect(removeTimelineItemsExactMock).toHaveBeenCalledWith(['caption-old'])
    expect(removeItems).not.toHaveBeenCalled()
  })

  it('replaces an existing transcript subtitle segment without removing linked media', async () => {
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
      linkedGroupId: 'linked-av-1',
    }
    const linkedAudio: TimelineItem = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-audio',
      from: 0,
      durationInFrames: 150,
      label: 'Audio',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 150,
      sourceDuration: 150,
      sourceFps: 30,
      linkedGroupId: 'linked-av-1',
    }
    const captionTrack = { ...makeTrack('track-captions', 0), kind: 'video' as const }
    const videoTrack = { ...makeTrack('track-video', 1), kind: 'video' as const }
    const audioTrack = { ...makeTrack('track-audio', 2), kind: 'audio' as const }
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
      linkedGroupId: 'linked-av-1',
    }
    const setTracks = vi.fn()
    const removeItems = vi.fn()
    const addItems = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [captionTrack, videoTrack, audioTrack],
      items: [clip, linkedAudio, existingTranscript],
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
    expect(removeTimelineItemsExactMock).toHaveBeenCalledWith(['transcript-old'])
    expect(removeItems).not.toHaveBeenCalled()
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems).toHaveLength(1)
    expect(insertedItems[0]).toMatchObject({
      type: 'subtitle',
      trackId: 'track-captions',
      linkedGroupId: 'linked-av-1',
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

describe('mediaTranscriptionService.insertTranscriptAsTextLayers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlaybackStoreGetStateMock.mockReturnValue({ currentFrame: 0 })
    useProjectStoreGetStateMock.mockReturnValue({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    })
    useSelectionStoreGetStateMock.mockReturnValue({
      selectedItemIds: [],
      selectItems: selectItemsMock,
    })
  })

  it('creates transcript text layers on a dedicated track with Circe styling', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1)],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = [
      'This',
      'is',
      'proper',
      'subtitle',
      'line',
      'for',
      'today',
      'another',
      'strong',
      'sentence',
    ]
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.3,
            end: (index + 1) * 0.3,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    expect(setTracks).toHaveBeenCalledTimes(1)
    const createdTracks = (setTracks.mock.calls[0]![0] as TimelineTrack[]).filter(
      (track) => track.name === 'Text Layers',
    )
    expect(createdTracks.length).toBe(1)

    expect(addItems).toHaveBeenCalledTimes(1)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems.length).toBe(result.insertedItemCount)
    const uniqueTrackIds = new Set(insertedItems.map((item) => item.trackId))
    expect(uniqueTrackIds.size).toBe(1)
    for (const item of insertedItems) {
      if (item.type !== 'text') {
        throw new Error('Expected text item')
      }
      expect(item.text.length).toBeLessThanOrEqual(25)
      expect(item.fontFamily).toBe('Circe Bold')
      expect(item.fontSize).toBe(70)
      expect(item.fontStyle).toBe('normal')
      expect(item.textStylePresetId).toBe('circe-bold')
      expect(item.transform?.y).toBe(420)
      expect(item.text).not.toMatch(/(?:^|\s)[\p{L}\p{N}]{1,2}[.!?,;:'"”’)]?$/u)
    }
  })

  it('rebalances phrase boundaries so layers do not end with short words', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [
        makeTrack('track-video', 1),
        { ...makeTrack('track-text-layers', 2), name: 'Text Layers' },
      ],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'to', 'market', 'quickly', 'again', 'today']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    expect(setTracks).toHaveBeenCalledTimes(1)
    const createdTracks = (setTracks.mock.calls[0]![0] as TimelineTrack[]).filter(
      (track) => track.name === 'Text Layers',
    )
    expect(createdTracks.length).toBe(2)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    const uniqueTrackIds = new Set(insertedItems.map((item) => item.trackId))
    expect(uniqueTrackIds.size).toBe(1)
    for (const item of insertedItems) {
      if (item.type !== 'text') {
        throw new Error('Expected text item')
      }
      expect(item.text.length).toBeLessThanOrEqual(25)
      expect(item.text).not.toMatch(/(?:^|\s)[\p{L}\p{N}]{1,2}[.!?,;:'"”’)]?$/u)
    }
  })

  it('keeps the 25-char cap when moving a short trailing word to the next layer', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1)],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'to', 'extraordinary']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    for (const item of insertedItems) {
      if (item.type !== 'text') {
        throw new Error('Expected text item')
      }
      expect(item.text.length).toBeLessThanOrEqual(25)
    }
    expect(insertedItems.some((item) => item.type === 'text' && item.text === 'to')).toBe(false)
  })

  it('dedupes a linked video/audio pair so layers are created only from the audio clip', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
      linkedGroupId: 'av-1',
    }
    const linkedAudio: AudioItem = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-audio',
      from: 0,
      durationInFrames: 300,
      label: 'Audio',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      linkedGroupId: 'av-1',
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1), makeTrack('track-audio', 2)],
      items: [clip, linkedAudio],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 2.4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1', 'audio-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    const signatures = insertedItems.map(
      (item) => `${item.from}:${item.durationInFrames}:${item.type === 'text' ? item.text : ''}`,
    )
    expect(new Set(signatures).size).toBe(signatures.length)
    for (const item of insertedItems) {
      if (item.type !== 'text') {
        throw new Error('Expected text item')
      }
      expect(item.captionSource?.clipId).toBe('audio-1')
    }
  })

  it('still processes distinct timeline placements of the same media', async () => {
    const firstClip: AudioItem = {
      id: 'audio-a',
      type: 'audio',
      trackId: 'track-audio',
      from: 0,
      durationInFrames: 300,
      label: 'Audio A',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
    }
    const secondClip: AudioItem = {
      ...firstClip,
      id: 'audio-b',
      from: 500,
      label: 'Audio B',
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-audio', 1)],
      items: [firstClip, secondClip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 2.4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['audio-a', 'audio-b'],
    })

    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    const sourceClipIds = new Set(
      insertedItems.map((item) => (item.type === 'text' ? item.captionSource?.clipId : undefined)),
    )
    expect(sourceClipIds).toEqual(new Set(['audio-a', 'audio-b']))
    expect(result.insertedItemCount).toBe(insertedItems.length)
  })

  it('reuses an existing Text Layers track sitting on top instead of creating a new one', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }
    const textLayersTrack = { ...makeTrack('track-text-layers', 0), name: 'Text Layers' }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1), textLayersTrack],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 2.4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    expect(setTracks).not.toHaveBeenCalled()
    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    expect(insertedItems.length).toBeGreaterThan(0)
    for (const item of insertedItems) {
      expect(item.trackId).toBe('track-text-layers')
    }
  })

  it('creates the Text Layers track on top of all tracks when none exists', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1), makeTrack('track-audio', 2)],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 2.4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    expect(setTracks).toHaveBeenCalledTimes(1)
    const nextTracks = setTracks.mock.calls[0]![0] as TimelineTrack[]
    const createdTrack = nextTracks.find((track) => track.name === 'Text Layers')
    expect(createdTrack).toBeDefined()
    expect(createdTrack!.order).toBe(Math.min(...nextTracks.map((track) => track.order)))

    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    for (const item of insertedItems) {
      expect(item.trackId).toBe(createdTrack!.id)
    }
  })

  it('creates a fresh top track when a Text Layers track exists but sits lower in the stack', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 30,
      speed: 1,
    }
    const buriedTextLayersTrack = {
      ...makeTrack('track-text-layers-buried', 2),
      name: 'Text Layers',
    }

    const setTracks = vi.fn()
    const addItems = vi.fn()
    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 1), buriedTextLayersTrack],
      items: [clip],
      setTracks,
      addItems,
    })

    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: words.join(' '),
      segments: [
        {
          text: words.join(' '),
          start: 0,
          end: 2.4,
          words: words.map((text, index) => ({
            text,
            start: index * 0.4,
            end: (index + 1) * 0.4,
          })),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    const result = await mediaTranscriptionService.insertTranscriptAsTextLayers({
      clipIds: ['clip-1'],
    })

    expect(result.insertedItemCount).toBeGreaterThan(0)
    expect(setTracks).toHaveBeenCalledTimes(1)
    const nextTracks = setTracks.mock.calls[0]![0] as TimelineTrack[]
    const topTrack = nextTracks.find(
      (track) => track.order === Math.min(...nextTracks.map((entry) => entry.order)),
    )
    expect(topTrack?.name).toBe('Text Layers')
    expect(topTrack?.id).not.toBe('track-text-layers-buried')

    const insertedItems = addItems.mock.calls[0]![0] as TimelineItem[]
    for (const item of insertedItems) {
      expect(item.trackId).toBe(topTrack!.id)
    }
  })
})

describe('mediaTranscriptionService.enableTranscriptCaptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlaybackStoreGetStateMock.mockReturnValue({ currentFrame: 0 })
    useProjectStoreGetStateMock.mockReturnValue({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    })
    useSelectionStoreGetStateMock.mockReturnValue({
      selectedItemIds: [],
      selectItems: vi.fn(),
    })
  })

  it('stores transcript captions on the source clip and removes stale generated subtitle items exactly', async () => {
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
      linkedGroupId: 'linked-av-1',
    }
    const linkedAudio: TimelineItem = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-audio',
      from: 0,
      durationInFrames: 150,
      label: 'Audio',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 150,
      sourceDuration: 150,
      sourceFps: 30,
      linkedGroupId: 'linked-av-1',
    }
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
      linkedGroupId: 'linked-av-1',
    }
    const setTracks = vi.fn()
    const removeItems = vi.fn()
    const addItems = vi.fn()
    const updateItem = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [
        makeTrack('track-captions', 0),
        makeTrack('track-video', 1),
        makeTrack('track-audio', 2),
      ],
      items: [clip, linkedAudio, existingTranscript],
      setTracks,
      removeItems,
      addItems,
      updateItem,
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

    const result = await mediaTranscriptionService.enableTranscriptCaptions('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: true,
    })

    expect(result).toEqual({
      updatedClipCount: 1,
      removedItemCount: 1,
    })
    expect(setTracks).not.toHaveBeenCalled()
    expect(addItems).not.toHaveBeenCalled()
    expect(removeItems).not.toHaveBeenCalled()
    expect(removeTimelineItemsExactMock).toHaveBeenCalledWith(['transcript-old'])
    expect(updateItem).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({
        transcriptCaptions: expect.objectContaining({
          type: 'transcript',
          mediaId: 'media-1',
          enabled: true,
          style: expect.objectContaining({
            fontFamily: expect.any(String),
            transform: expect.objectContaining({
              width: expect.any(Number),
              height: expect.any(Number),
            }),
          }),
          cues: [
            {
              id: 'transcript-media-1-0',
              startSeconds: 0,
              endSeconds: 1,
              text: 'Fresh one',
            },
            {
              id: 'transcript-media-1-1',
              startSeconds: 1,
              endSeconds: 3,
              text: 'Fresh two',
            },
          ],
        }),
      }),
    )
  })

  it('can enable transcript captions without changing selection', async () => {
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
    const updateItem = vi.fn()

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: [makeTrack('track-video', 0)],
      items: [clip],
      setTracks: vi.fn(),
      removeItems: vi.fn(),
      addItems: vi.fn(),
      updateItem,
    })

    getTranscriptMock.mockResolvedValue({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      language: 'auto',
      quantization: 'q8',
      text: 'Fresh one',
      segments: [{ text: 'Fresh one', start: 0, end: 1 }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies MediaTranscript)

    await mediaTranscriptionService.enableTranscriptCaptions('media-1', {
      clipIds: ['clip-1'],
      selectUpdatedClips: false,
    })

    expect(updateItem).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({
        transcriptCaptions: expect.objectContaining({
          enabled: true,
        }),
      }),
    )
    expect(selectItemsMock).not.toHaveBeenCalled()
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
    useTimelineStoreGetStateMock.mockReturnValue({ items: [], updateItem: vi.fn() })
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

  it('refreshes existing canvas captions while preserving clip-owned presentation', async () => {
    const sourceFile = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })
    const updateItem = vi.fn()
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'media-1',
        enabled: false,
        updatedAt: 10,
        cues: [{ id: 'old-cue', startSeconds: 0, endSeconds: 1, text: 'Old text' }],
        style: { color: '#ffcc00', fontSize: 48 },
      },
    }
    useTimelineStoreGetStateMock.mockReturnValue({ items: [clip], updateItem })
    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.mp3',
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)
    transcribeCollectMock.mockResolvedValue([{ text: 'Fresh text', start: 0.2, end: 1.4 }])

    const transcript = await mediaTranscriptionService.transcribeMedia('media-1')

    expect(updateItem).toHaveBeenCalledWith('clip-1', {
      transcriptCaptions: expect.objectContaining({
        enabled: false,
        sourceTranscriptUpdatedAt: transcript.updatedAt,
        style: { color: '#ffcc00', fontSize: 48 },
        cues: [
          {
            id: 'transcript-media-1-0',
            startSeconds: 0.2,
            endSeconds: 1.4,
            text: 'Fresh text',
          },
        ],
      }),
    })
  })

  it('refreshes transcript captions inside nested compositions and navigation stashes', async () => {
    const sourceFile = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })
    const makeCaptionedClip = (id: string): VideoItem => ({
      id,
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 90,
      label: id,
      mediaId: 'media-1',
      src: 'blob:test',
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'media-1',
        enabled: true,
        updatedAt: 10,
        timingVersion: 3,
        cues: [{ id: 'old-cue', startSeconds: 0, endSeconds: 1, text: 'Old text' }],
      },
    })
    const nestedClip = makeCaptionedClip('nested-clip')
    const stashedClip = makeCaptionedClip('stashed-clip')
    const updateComposition = vi.fn()
    useCompositionsStoreGetStateMock.mockReturnValue({
      compositions: [
        {
          id: 'outer-comp',
          items: [
            {
              id: 'inner-wrapper',
              type: 'composition',
              trackId: 'track-video',
              from: 0,
              durationInFrames: 90,
              label: 'Inner',
              compositionId: 'inner-comp',
            },
          ],
        },
        { id: 'inner-comp', items: [nestedClip] },
      ],
      updateComposition,
    })
    useCompositionNavigationStoreGetStateMock.mockReturnValue({
      stashStack: [{ compositionId: 'inner-comp', items: [stashedClip] }],
      mainHolder: null,
    })
    useTimelineStoreGetStateMock.mockReturnValue({ items: [], updateItem: vi.fn() })
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
        text: 'Fresh nested phrase',
        start: 0.2,
        end: 1.4,
        words: [
          { text: 'Fresh', start: 0.2, end: 0.5 },
          { text: 'nested', start: 0.53, end: 0.9 },
          { text: 'phrase', start: 0.93, end: 1.4 },
        ],
      },
    ])

    const transcript = await mediaTranscriptionService.transcribeMedia('media-1')

    expect(updateComposition).toHaveBeenCalledTimes(1)
    expect(updateComposition).toHaveBeenCalledWith('inner-comp', {
      items: [
        expect.objectContaining({
          id: 'nested-clip',
          transcriptCaptions: expect.objectContaining({
            sourceTranscriptUpdatedAt: transcript.updatedAt,
            timingVersion: 4,
            cues: [
              {
                id: 'transcript-media-1-0',
                startSeconds: 0.2,
                endSeconds: 1.4,
                text: 'Fresh nested phrase',
              },
            ],
          }),
        }),
      ],
    })
    expect(useCompositionNavigationStoreSetStateMock).toHaveBeenCalledWith({
      stashStack: [
        expect.objectContaining({
          items: [
            expect.objectContaining({
              id: 'stashed-clip',
              transcriptCaptions: expect.objectContaining({ timingVersion: 4 }),
            }),
          ],
        }),
      ],
      mainHolder: null,
    })
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
    expect(saved.segments.every((segment) => segment.text.length <= 42)).toBe(true)
    expect(saved.segments.every((segment) => segment.end - segment.start <= 2.2)).toBe(true)
    expect(saved.segments.every((segment) => (segment.words?.length ?? 0) > 0)).toBe(true)
    expect(saved.segments.map((segment) => segment.text)).toEqual([
      'my sentences.',
      "So once again, I'm going to talk about",
      'the Netherlands in this video.',
    ])
  })

  it('groups nearby words into phrases and breaks at an audible pause', async () => {
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
        text: 'take a look over there',
        start: 4,
        end: 5.4,
        words: [
          { text: 'take', start: 4, end: 4.24 },
          { text: 'a', start: 4.27, end: 4.36 },
          { text: 'look', start: 4.39, end: 4.66 },
          { text: 'over', start: 4.9, end: 5.12 },
          { text: 'there', start: 5.15, end: 5.4 },
        ],
      },
    ])

    await mediaTranscriptionService.transcribeMedia('media-1')

    const saved = saveTranscriptMock.mock.calls[0]?.[0] as MediaTranscript
    expect(saved.segments.map((segment) => segment.text)).toEqual(['take a look', 'over there'])
    expect(saved.segments.map((segment) => segment.start)).toEqual([4, 4.9])
    expect(saved.segments.every((segment) => segment.words!.length >= 2)).toBe(true)
  })

  it('does not merge a trailing one-word caption across a long pause', async () => {
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
        text: 'short phrase isolated',
        start: 0,
        end: 10.3,
        words: [
          { text: 'short', start: 0, end: 0.2 },
          { text: 'phrase', start: 0.22, end: 0.5 },
          { text: 'isolated', start: 10, end: 10.3 },
        ],
      },
    ])

    await mediaTranscriptionService.transcribeMedia('media-1')

    const saved = saveTranscriptMock.mock.calls[0]?.[0] as MediaTranscript
    expect(saved.segments.map((segment) => segment.text)).toEqual(['short phrase', 'isolated'])
    expect(saved.segments.every((segment) => segment.end - segment.start <= 2.2)).toBe(true)
  })

  it('keeps timestamped CJK captions as short phrases rather than individual words', async () => {
    const sourceFile = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })
    getMediaMock.mockResolvedValue({
      id: 'media-1',
      fileName: 'clip.mp3',
      mimeType: 'audio/mpeg',
      codec: 'mp3',
      fileLastModified: 123,
    })
    getMediaFileMock.mockResolvedValue(sourceFile)
    const characters = ['難', '知', '足', '看', '似', '個', '燕', '陽', '蝴', '蝶']
    transcribeCollectMock.mockResolvedValue([
      {
        text: characters.join(''),
        start: 10,
        end: 13.95,
        words: characters.map((text, index) => ({
          text,
          start: 10 + index * 0.4,
          end: 10.35 + index * 0.4,
        })),
      },
    ])

    await mediaTranscriptionService.transcribeMedia('media-1')

    const saved = saveTranscriptMock.mock.calls[0]?.[0] as MediaTranscript
    expect(saved.segments.map((segment) => segment.text)).toEqual(['難知足看似', '個燕陽蝴蝶'])
    expect(saved.segments.map((segment) => segment.start)).toEqual([10, 12])
    expect(saved.segments.every((segment) => segment.words!.length > 1)).toBe(true)
    expect(saved.segments.every((segment) => segment.end - segment.start <= 2.2)).toBe(true)
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
    mockQueuedTranscriptionSources()

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
    mockQueuedTranscriptionSources()

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
    mockQueuedTranscriptionSources()

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
