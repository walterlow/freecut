import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { AudioItem, CompositionItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useCompositionsStore } from '@/features/export/deps/timeline'

vi.mock('mediabunny', () => {
  class UrlSource {
    constructor(public readonly url: string) {}
  }

  class Input {
    readonly source: UrlSource

    constructor(params: { source: UrlSource }) {
      this.source = params.source
    }

    async getPrimaryAudioTrack() {
      return { src: this.source.url }
    }

    async computeDuration() {
      return 10
    }

    dispose() {}
  }

  class AudioSampleSink {
    constructor(private readonly track: { src: string }) {}

    async *samples(startTime = 0, endTime = 0) {
      const sampleRate = 48000
      const frameCount = Math.max(1, Math.round((endTime - startTime) * sampleRate))
      const makePlane = () => new Float32Array(frameCount).fill(0.1)
      const planes = [makePlane(), makePlane()]

      yield {
        numberOfFrames: frameCount,
        numberOfChannels: 2,
        sampleRate,
        copyTo(destination: Float32Array, options: { planeIndex: number }) {
          destination.set(planes[options.planeIndex] ?? planes[0]!)
        },
        close() {},
        trackSrc: this.track.src,
      }
    }
  }

  return {
    ALL_FORMATS: [],
    Input,
    UrlSource,
    AudioSampleSink,
  }
})

import { downmixToOutputChannels, extractAudioSegments, processAudio } from './canvas-audio'

function makeTrack(params: {
  id: string
  order: number
  kind?: 'video' | 'audio'
  items?: TimelineTrack['items']
}): TimelineTrack {
  return {
    id: params.id,
    name: params.id,
    kind: params.kind,
    order: params.order,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: params.items ?? [],
  }
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 90,
    src: 'blob:video',
    mediaId: 'media-1',
    label: 'Video',
    ...overrides,
  } as VideoItem
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 90,
    src: 'blob:audio',
    mediaId: 'media-1',
    label: 'Audio',
    ...overrides,
  } as AudioItem
}

describe('extractAudioSegments', () => {
  beforeEach(() => {
    useCompositionsStore.setState({
      compositions: [],
      compositionById: {},
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })
  })

  it('skips root video audio when a linked audio companion exists', () => {
    const video = makeVideoItem({ linkedGroupId: 'group-1' })
    const audio = makeAudioItem({ linkedGroupId: 'group-1' })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [video] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [audio] }),
      ],
      transitions: [],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ itemId: 'audio-1', type: 'audio' })
  })

  it('skips precomp video audio when a linked audio companion exists inside the precomp', () => {
    const subVideo = makeVideoItem({ id: 'sub-video', linkedGroupId: 'group-1', trackId: 'sub-v1' })
    const subAudio = makeAudioItem({ id: 'sub-audio', linkedGroupId: 'group-1', trackId: 'sub-a1' })
    const subComp = {
      id: 'sub-comp-1',
      name: 'Compound Clip',
      items: [subVideo, subAudio],
      tracks: [
        makeTrack({ id: 'sub-v1', order: 0, kind: 'video' }),
        makeTrack({ id: 'sub-a1', order: 1, kind: 'audio' }),
      ],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 90,
    }
    useCompositionsStore.setState({
      compositions: [subComp],
      compositionById: { [subComp.id]: subComp },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })

    const compositionItem: CompositionItem = {
      id: 'comp-item-1',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'root-v1',
      from: 0,
      durationInFrames: 90,
      label: 'Compound Clip',
      compositionWidth: 1920,
      compositionHeight: 1080,
      transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    }

    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [makeTrack({ id: 'root-v1', order: 0, kind: 'video', items: [compositionItem] })],
      transitions: [],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ itemId: 'sub-audio', type: 'audio' })
  })

  it('expands linked audio companions around a cut-centered transition', () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      linkedGroupId: 'group-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      linkedGroupId: 'group-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      linkedGroupId: 'group-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      linkedGroupId: 'group-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'track-v1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      itemId: 'audio-1',
      type: 'audio',
      startFrame: 0,
      durationFrames: 35,
      fadeOutFrames: 0,
      crossfadeFadeOutFrames: 10,
    })
    expect(segments[1]).toMatchObject({
      itemId: 'audio-2',
      type: 'audio',
      startFrame: 25,
      durationFrames: 35,
      fadeInFrames: 0,
      crossfadeFadeInFrames: 10,
    })
  })

  it('expands standalone audio clips around an audio transition', () => {
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-a1', order: 0, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      itemId: 'audio-1',
      type: 'audio',
      startFrame: 0,
      durationFrames: 35,
      fadeOutFrames: 0,
      crossfadeFadeOutFrames: 10,
    })
    expect(segments[1]).toMatchObject({
      itemId: 'audio-2',
      type: 'audio',
      startFrame: 25,
      durationFrames: 35,
      fadeInFrames: 0,
      crossfadeFadeInFrames: 10,
    })
  })

  it('uses only linked audio companions for linked clips with an explicit audio transition', () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      linkedGroupId: 'group-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      linkedGroupId: 'group-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      linkedGroupId: 'group-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      linkedGroupId: 'group-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'audio-transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.type === 'audio')).toBe(true)
    expect(segments.map((segment) => segment.itemId)).toEqual(['audio-1', 'audio-2'])
  })

  it('does not duplicate linked audio when video and audio transitions coexist', () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      linkedGroupId: 'group-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      linkedGroupId: 'group-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      linkedGroupId: 'group-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      linkedGroupId: 'group-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'video-transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'track-v1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
        {
          id: 'audio-transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.type === 'audio')).toBe(true)
    expect(segments.map((segment) => segment.itemId)).toEqual(['audio-1', 'audio-2'])
  })

  it('crossfades linked audio companions during export without doubling them', async () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      linkedGroupId: 'group-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      linkedGroupId: 'group-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      linkedGroupId: 'group-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      linkedGroupId: 'group-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'audio-transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const audio = await processAudio(composition)

    expect(audio).not.toBeNull()

    const mixed = audio!.samples[0]!
    const sampleRate = audio!.sampleRate
    const startOnlyIndex = Math.floor((10 / composition.fps) * sampleRate)
    const overlapMidIndex = Math.floor((30 / composition.fps) * sampleRate)
    const endOnlyIndex = Math.floor((50 / composition.fps) * sampleRate)

    expect(mixed[startOnlyIndex]!).toBeCloseTo(0.1, 2)
    expect(mixed[endOnlyIndex]!).toBeCloseTo(0.1, 2)
    expect(mixed[overlapMidIndex]!).toBeLessThan(0.15)
  })

  it('does not double linked audio export when video and audio transitions coexist', async () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      linkedGroupId: 'group-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      linkedGroupId: 'group-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      linkedGroupId: 'group-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      linkedGroupId: 'group-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'video-transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'track-v1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
        {
          id: 'audio-transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const audio = await processAudio(composition)

    expect(audio).not.toBeNull()

    const mixed = audio!.samples[0]!
    const sampleRate = audio!.sampleRate
    const steadyStateIndex = Math.floor((10 / composition.fps) * sampleRate)
    const overlapMidIndex = Math.floor((30 / composition.fps) * sampleRate)

    expect(mixed[steadyStateIndex]!).toBeCloseTo(0.1, 2)
    expect(mixed[overlapMidIndex]!).toBeLessThan(0.15)
  })

  it('treats imported legacy synced video/audio pairs as linked during audio export', async () => {
    const leftVideo = makeVideoItem({
      id: 'video-1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
      linkedGroupId: undefined,
      originId: undefined,
    })
    const leftAudio = makeAudioItem({
      id: 'audio-1',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceEnd: 35,
      sourceDuration: 120,
      linkedGroupId: undefined,
      originId: undefined,
    })
    const rightVideo = makeVideoItem({
      id: 'video-2',
      trackId: 'track-v1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:video-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
      linkedGroupId: undefined,
      originId: undefined,
    })
    const rightAudio = makeAudioItem({
      id: 'audio-2',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 30,
      mediaId: 'media-2',
      src: 'blob:audio-2',
      sourceStart: 5,
      sourceEnd: 35,
      sourceDuration: 120,
      linkedGroupId: undefined,
      originId: undefined,
    })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
        makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
      ],
      transitions: [
        {
          id: 'audio-transition-1',
          type: 'crossfade',
          leftClipId: 'audio-1',
          rightClipId: 'audio-2',
          trackId: 'track-a1',
          durationInFrames: 10,
          timing: 'linear',
          presentation: 'fade',
        },
      ],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)
    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.type === 'audio')).toBe(true)

    const audio = await processAudio(composition)

    expect(audio).not.toBeNull()

    const mixed = audio!.samples[0]!
    const sampleRate = audio!.sampleRate
    const steadyStateIndex = Math.floor((10 / composition.fps) * sampleRate)
    const overlapMidIndex = Math.floor((30 / composition.fps) * sampleRate)

    expect(mixed[steadyStateIndex]!).toBeCloseTo(0.1, 2)
    expect(mixed[overlapMidIndex]!).toBeLessThan(0.15)
  })

  it('includes bus, track, and clip EQ stages in exported audio segments', () => {
    const clip = makeAudioItem({
      audioEqHighGainDb: 3,
      audioEqOutputGainDb: 2,
    })
    const track = makeTrack({
      id: 'track-a1',
      order: 0,
      kind: 'audio',
      items: [clip],
    })
    track.audioEq = { lowGainDb: 4 }

    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      busAudioEq: {
        highCutEnabled: true,
        highCutFrequencyHz: 8000,
      },
      tracks: [track],
      transitions: [],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments[0]?.audioEqStages).toEqual([
      expect.objectContaining({
        highCutEnabled: true,
        highCutFrequencyHz: 8000,
      }),
      expect.objectContaining({ lowGainDb: 4 }),
      expect.objectContaining({ highGainDb: 3, outputGainDb: 2 }),
    ])
  })
})

describe('downmixToOutputChannels', () => {
  it('passes channel data through when source and target match', () => {
    const left = new Float32Array([1, 2, 3])
    const right = new Float32Array([4, 5, 6])
    const out = downmixToOutputChannels([left, right], 2)
    expect(out).toHaveLength(2)
    expect(Array.from(out[0]!)).toEqual([1, 2, 3])
    expect(Array.from(out[1]!)).toEqual([4, 5, 6])
  })

  it('duplicates a mono source when expanding to stereo', () => {
    const mono = new Float32Array([0.5, -0.5])
    const out = downmixToOutputChannels([mono], 2)
    expect(out[0]).toBe(out[1])
    expect(Array.from(out[0]!)).toEqual([0.5, -0.5])
  })

  it('downmixes 5.1 to stereo using ITU-R BS.775 coefficients with no LFE', () => {
    // 5.1 channel order: L, R, C, LFE, Ls, Rs.
    const channels = [
      new Float32Array([1]), // L
      new Float32Array([0]), // R
      new Float32Array([1]), // C
      new Float32Array([1]), // LFE — must be ignored
      new Float32Array([1]), // Ls
      new Float32Array([0]), // Rs
    ]
    const [Lo, Ro] = downmixToOutputChannels(channels, 2)
    // Lo = L + sqrt(0.5)*C + sqrt(0.5)*Ls = 1 + .707 + .707 ≈ 2.414
    expect(Lo![0]).toBeCloseTo(1 + Math.SQRT1_2 + Math.SQRT1_2, 5)
    // Ro = R + sqrt(0.5)*C + sqrt(0.5)*Rs = 0 + .707 + 0
    expect(Ro![0]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('drops the center channel into both stereo halves equally', () => {
    // Center-only signal — no L/R/Ls/Rs energy.
    const channels = [
      new Float32Array([0]), // L
      new Float32Array([0]), // R
      new Float32Array([1]), // C — dialogue
      new Float32Array([0]), // LFE
      new Float32Array([0]), // Ls
      new Float32Array([0]), // Rs
    ]
    const [Lo, Ro] = downmixToOutputChannels(channels, 2)
    expect(Lo![0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(Ro![0]).toBeCloseTo(Math.SQRT1_2, 5)
  })
})
