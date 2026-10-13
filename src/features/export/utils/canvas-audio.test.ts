import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { AudioItem, CompositionItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useCompositionsStore } from '@/features/export/deps/timeline-compositions'

const { inputConstructor } = vi.hoisted(() => ({ inputConstructor: vi.fn() }))

vi.mock('mediabunny', () => {
  class UrlSource {
    constructor(public readonly url: string) {}
  }

  class Input {
    readonly source: UrlSource
    private disposed = false

    constructor(params: { source: UrlSource }) {
      inputConstructor()
      this.source = params.source
    }

    async getPrimaryAudioTrack() {
      return { src: this.source.url, isDisposed: () => this.disposed }
    }

    async computeDuration() {
      return 10
    }

    dispose() {
      this.disposed = true
    }
  }

  class AudioSampleSink {
    constructor(private readonly track: { src: string; isDisposed: () => boolean }) {}

    async *samples(startTime = 0, endTime = 0) {
      if (this.track.isDisposed()) throw new Error('Input has been disposed')
      if (this.track.src.includes('mediabunny-fails')) {
        throw new Error('Mediabunny range decode failed')
      }
      const sampleRate = this.track.src.includes('44100') ? 44100 : 48000
      const frameCount = Math.max(1, Math.round((endTime - startTime) * sampleRate))
      // 'ramp' sources yield a monotone ramp tied to the ABSOLUTE source
      // position, so tests can observe reversal and speed consumption.
      const ramp = this.track.src.includes('ramp')
      const startIndex = Math.round(startTime * sampleRate)
      const makePlane = () => {
        const plane = new Float32Array(frameCount)
        if (ramp) {
          for (let i = 0; i < frameCount; i++) plane[i] = (startIndex + i) / 1_000_000
        } else {
          plane.fill(0.1)
        }
        return plane
      }
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

import {
  applyDucking,
  clearAudioDecodeCache,
  collectDuckingSources,
  downmixToOutputChannels,
  extractAudioSegments,
  getAudioPacketPassthroughPlan,
  hasAudioContent,
  processAudio,
  processAudioWindows,
  supportsWindowedAudioProcessing,
  type DuckingSource,
} from './canvas-audio'

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

function makeLinkedTransitionComposition(params: {
  includeVideoTransition?: boolean
  includeAudioTransition?: boolean
  legacyLinkedPair?: boolean
}): CompositionInputProps {
  const leftVideo = makeVideoItem({
    id: 'video-1',
    linkedGroupId: params.legacyLinkedPair ? undefined : 'group-1',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 30,
    sourceStart: 0,
    sourceEnd: 35,
    sourceDuration: 120,
  })
  const leftAudio = makeAudioItem({
    id: 'audio-1',
    linkedGroupId: params.legacyLinkedPair ? undefined : 'group-1',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 30,
    sourceStart: 0,
    sourceEnd: 35,
    sourceDuration: 120,
  })
  const rightVideo = makeVideoItem({
    id: 'video-2',
    linkedGroupId: params.legacyLinkedPair ? undefined : 'group-2',
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
    linkedGroupId: params.legacyLinkedPair ? undefined : 'group-2',
    trackId: 'track-a1',
    from: 30,
    durationInFrames: 30,
    mediaId: 'media-2',
    src: 'blob:audio-2',
    sourceStart: 5,
    sourceEnd: 35,
    sourceDuration: 120,
  })

  const transitions: CompositionInputProps['transitions'] = []
  if (params.includeVideoTransition) {
    transitions.push({
      id: 'video-transition-1',
      type: 'crossfade',
      leftClipId: 'video-1',
      rightClipId: 'video-2',
      trackId: 'track-v1',
      durationInFrames: 10,
      timing: 'linear',
      presentation: 'fade',
    })
  }
  if (params.includeAudioTransition) {
    transitions.push({
      id: 'audio-transition-1',
      type: 'crossfade',
      leftClipId: 'audio-1',
      rightClipId: 'audio-2',
      trackId: 'track-a1',
      durationInFrames: 10,
      timing: 'linear',
      presentation: 'fade',
    })
  }

  return {
    fps: 30,
    durationInFrames: 60,
    width: 1920,
    height: 1080,
    tracks: [
      makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [leftVideo, rightVideo] }),
      makeTrack({ id: 'track-a1', order: 1, kind: 'audio', items: [leftAudio, rightAudio] }),
    ],
    transitions,
    keyframes: [],
  }
}

function expectLinkedAudioSegments(composition: CompositionInputProps) {
  const segments = extractAudioSegments(composition, composition.fps)

  expect(segments).toHaveLength(2)
  expect(segments.every((segment) => segment.type === 'audio')).toBe(true)

  return segments
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

  it('yields embedded video audio when the composition has no transitions', () => {
    // Regression: buildManagedTransitionAudioSegments used to bail out on an
    // empty `transitions`, silently dropping ALL embedded video audio (the
    // export then produced a file with no audio track at all).
    const video = makeVideoItem({ volume: 0 })
    const composition: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [video] })],
      transitions: [],
      keyframes: [],
    }

    const segments = extractAudioSegments(composition, composition.fps)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      itemId: 'video-1',
      type: 'video',
      startFrame: 0,
      durationFrames: 90,
      muted: false,
    })
  })

  it('is invariant to a transition between unrelated clips', () => {
    // A transition between two OTHER clips must not change the mix segments of
    // an uninvolved video (its existence used to resurrect/alter other audio).
    const voice = makeVideoItem({ id: 'voice', trackId: 'track-v1', volume: 0 })
    const docLeft = makeVideoItem({
      id: 'doc2',
      trackId: 'track-top',
      from: 0,
      durationInFrames: 45,
      embeddedAudioMuted: true,
    })
    const docRight = makeVideoItem({
      id: 'doc3',
      trackId: 'track-top',
      from: 45,
      durationInFrames: 45,
      embeddedAudioMuted: true,
    })
    const buildComposition = (withTransition: boolean): CompositionInputProps => ({
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({ id: 'track-v1', order: 0, kind: 'video', items: [voice] }),
        makeTrack({ id: 'track-top', order: 1, kind: 'video', items: [docLeft, docRight] }),
      ],
      transitions: withTransition
        ? [
            {
              id: 'tr-1',
              type: 'fade',
              presentation: 'fade',
              timing: 'linear',
              leftClipId: 'doc2',
              rightClipId: 'doc3',
              trackId: 'track-top',
              durationInFrames: 2,
            } as unknown as Transition,
          ]
        : [],
      keyframes: [],
    })

    const without = extractAudioSegments(buildComposition(false), 30)
    const withUnrelated = extractAudioSegments(buildComposition(true), 30)

    const voiceWithout = without.filter((s) => s.itemId === 'voice')
    const voiceWith = withUnrelated.filter((s) => s.itemId === 'voice')
    expect(voiceWithout).toHaveLength(1)
    expect(voiceWith).toEqual(voiceWithout)
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
    const composition = makeLinkedTransitionComposition({ includeVideoTransition: true })

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
    const composition = makeLinkedTransitionComposition({ includeAudioTransition: true })

    const segments = expectLinkedAudioSegments(composition)
    expect(segments.map((segment) => segment.itemId)).toEqual(['audio-1', 'audio-2'])
  })

  it('does not duplicate linked audio when video and audio transitions coexist', () => {
    const composition = makeLinkedTransitionComposition({
      includeVideoTransition: true,
      includeAudioTransition: true,
    })

    const segments = expectLinkedAudioSegments(composition)
    expect(segments.map((segment) => segment.itemId)).toEqual(['audio-1', 'audio-2'])
  })

  it('crossfades linked audio companions during export without doubling them', async () => {
    const composition = makeLinkedTransitionComposition({ includeAudioTransition: true })

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
    const composition = makeLinkedTransitionComposition({
      includeVideoTransition: true,
      includeAudioTransition: true,
    })

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
    const composition = makeLinkedTransitionComposition({
      includeAudioTransition: true,
      legacyLinkedPair: true,
    })

    expectLinkedAudioSegments(composition)

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

describe('windowed audio processing', () => {
  function simpleComposition(itemOverrides: Partial<AudioItem> = {}): CompositionInputProps {
    return {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({
          id: 'track-a1',
          order: 0,
          kind: 'audio',
          items: [makeAudioItem(itemOverrides)],
        }),
      ],
    }
  }

  it('uses bounded windows for ordinary long-form clips', async () => {
    const composition = simpleComposition()

    expect(supportsWindowedAudioProcessing(composition)).toBe(true)

    const windows = []
    for await (const window of processAudioWindows(composition)) windows.push(window)

    expect(windows).toHaveLength(1)
    expect(windows[0]?.samples[0]).toHaveLength(3 * 48_000)
    expect(windows[0]?.samples[0]?.[24_000]).toBeCloseTo(0.1, 4)
  })

  it('reuses one media input across successive windows of the same source', async () => {
    inputConstructor.mockClear()
    const composition = simpleComposition({ durationInFrames: 1_830 })
    composition.durationInFrames = 1_830

    const windows = []
    for await (const window of processAudioWindows(composition)) windows.push(window)

    expect(windows).toHaveLength(3)
    expect(inputConstructor).toHaveBeenCalledTimes(1)
  })

  it('uses the Web Audio fallback when a window range cannot be decoded', async () => {
    const fallbackSamples = new Float32Array(10 * 48_000).fill(0.2)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    class FallbackOfflineAudioContext {
      async decodeAudioData() {
        return {
          sampleRate: 48_000,
          numberOfChannels: 2,
          duration: 10,
          getChannelData: () => fallbackSamples,
        }
      }
    }
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('OfflineAudioContext', FallbackOfflineAudioContext)

    try {
      const windows = []
      for await (const window of processAudioWindows(
        simpleComposition({ src: 'blob:mediabunny-fails' }),
      )) {
        windows.push(window)
      }

      expect(windows[0]?.samples[0]?.[24_000]).toBeCloseTo(0.2, 4)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      clearAudioDecodeCache()
      vi.unstubAllGlobals()
    }
  })

  it('applies 44.1 kHz fades before resampling, matching full processing', async () => {
    class ResamplingOfflineAudioContext {
      readonly destination = {}
      private sourceBuffer: AudioBuffer | null = null

      constructor(
        _channels: number,
        private readonly length: number,
        private readonly sampleRate: number,
      ) {}

      createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
        const channelData = Array.from({ length: channels }, () => new Float32Array(length))
        return {
          length,
          sampleRate,
          duration: length / sampleRate,
          numberOfChannels: channels,
          getChannelData: (channel: number) => channelData[channel]!,
        } as AudioBuffer
      }

      createBufferSource() {
        const context = this
        return {
          set buffer(value: AudioBuffer | null) {
            context.sourceBuffer = value
          },
          connect() {},
          start() {},
        }
      }

      async startRendering(): Promise<AudioBuffer> {
        const source = this.sourceBuffer!
        const output = this.createBuffer(1, this.length, this.sampleRate)
        const sourceSamples = source.getChannelData(0)
        const outputSamples = output.getChannelData(0)
        for (let i = 0; i < outputSamples.length; i++) {
          outputSamples[i] =
            sourceSamples[
              Math.min(
                sourceSamples.length - 1,
                Math.floor((i * source.sampleRate) / this.sampleRate),
              )
            ]!
        }
        return output
      }
    }
    vi.stubGlobal('OfflineAudioContext', ResamplingOfflineAudioContext)

    try {
      const composition = simpleComposition({ src: 'blob:audio-44100', audioFadeIn: 1 })
      const full = await processAudio(composition)
      const windows = []
      for await (const window of processAudioWindows(composition)) windows.push(window)

      expect(full).not.toBeNull()
      expect(windows[0]?.samples[0]?.[23_999]).toBeCloseTo(full!.samples[0]![23_999]!, 7)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retains full-segment processing for stateful DSP clips', () => {
    expect(supportsWindowedAudioProcessing(simpleComposition({ speed: 1.25 }))).toBe(false)
    expect(supportsWindowedAudioProcessing(simpleComposition({ audioEqHighGainDb: 3 }))).toBe(false)
  })
})

describe('audio packet passthrough eligibility', () => {
  const compositionWith = (overrides: Partial<AudioItem> = {}): CompositionInputProps => ({
    fps: 30,
    durationInFrames: 90,
    width: 1920,
    height: 1080,
    tracks: [
      makeTrack({
        id: 'track-a1',
        order: 0,
        kind: 'audio',
        items: [makeAudioItem(overrides)],
      }),
    ],
  })

  it('copies one continuous unmodified source', () => {
    expect(getAudioPacketPassthroughPlan(compositionWith())).toEqual({
      src: 'blob:audio',
      durationSeconds: 3,
    })
  })

  it.each([
    [{ sourceStart: 15 }, 'trimmed'],
    [{ volume: -3 }, 'gain-adjusted'],
    [{ speed: 1.25 }, 'speed-adjusted'],
    [{ audioFadeIn: 10 }, 'faded'],
    [{ audioEqHighGainDb: 3 }, 'equalized'],
  ] as const)('rejects %s audio (%s)', (overrides, _label) => {
    expect(getAudioPacketPassthroughPlan(compositionWith(overrides))).toBeNull()
  })

  it('rejects a modified master bus', () => {
    expect(getAudioPacketPassthroughPlan({ ...compositionWith(), masterBusDb: -2 })).toBeNull()
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

describe('audio DSP through processAudio (real pipeline, mocked decode)', () => {
  beforeEach(() => {
    clearAudioDecodeCache()
  })

  function dspComposition(itemOverrides: Partial<AudioItem>): CompositionInputProps {
    return {
      fps: 30,
      durationInFrames: 90, // 3s output window
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({
          id: 'track-a1',
          order: 0,
          kind: 'audio',
          items: [makeAudioItem(itemOverrides)],
        }),
      ],
      transitions: [],
      keyframes: [],
    }
  }

  it('isReversed plays the source backwards (ramp arrives descending)', async () => {
    const result = await processAudio(dspComposition({ src: 'blob:audio-ramp', isReversed: true }))
    expect(result).not.toBeNull()
    const samples = result!.samples[0]!
    // Forward ramp is ascending; reversed output must descend.
    expect(samples[0]!).toBeGreaterThan(samples[24_000]!)
    expect(samples[24_000]!).toBeGreaterThan(samples[47_000]!)
  })

  it('speed 2x consumes twice the source material into the same window', async () => {
    const result = await processAudio(
      dspComposition({ src: 'blob:audio-ramp', speed: 2, durationInFrames: 90 }),
    )
    expect(result).not.toBeNull()
    const samples = result!.samples[0]!
    expect(samples).toHaveLength(3 * 48_000)
    // At 1s of output the time-stretcher has consumed ~2s of source
    // (ramp ≈ 0.096); an unstretched read would sit at ~0.048. The WSOLA
    // stretcher flushes with silence at the very tail, so probe mid-window.
    const midway = samples[48_000]!
    expect(midway).toBeGreaterThan(0.07)
    expect(midway).toBeLessThan(0.125)
  })

  it('hasAudioContent: true for an audible clip, false when its track is muted', async () => {
    await expect(hasAudioContent(dspComposition({}))).resolves.toBe(true)
    const muted = dspComposition({})
    muted.tracks[0]! = { ...muted.tracks[0]!, muted: true }
    await expect(hasAudioContent(muted)).resolves.toBe(false)
  })
})

describe('sidechain ducking', () => {
  const FPS = 30
  const RATE = 48_000
  const gainDb = (db: number) => Math.pow(10, db / 20)

  const source = (overrides: Partial<DuckingSource> = {}): DuckingSource => ({
    itemId: 'duck-src',
    trackId: 'track-sfx',
    startFrame: 30,
    endFrame: 60,
    duckDb: -12,
    attackFrames: 3,
    releaseFrames: 6,
    ...overrides,
  })

  const ones = (seconds: number) => new Float32Array(RATE * seconds).fill(1)
  const at = (samples: Float32Array, frame: number) => samples[Math.round((frame / FPS) * RATE)]!

  it('applyDucking dips to duckDb inside the window with attack/release ramps', () => {
    const out = applyDucking(ones(3), [source()], { itemId: 't', trackId: 'a' }, 0, FPS, RATE)
    expect(at(out, 10)).toBeCloseTo(1, 5) // before window
    expect(at(out, 45)).toBeCloseTo(gainDb(-12), 4) // fully ducked
    expect(at(out, 31.5)).toBeCloseTo(gainDb(-6), 2) // mid-attack (half depth)
    expect(at(out, 63)).toBeCloseTo(gainDb(-6), 2) // mid-release
    expect(at(out, 75)).toBeCloseTo(1, 5) // recovered
  })

  it('applyDucking never ducks the source itself and honors targetTrackIds', () => {
    const untouched = applyDucking(
      ones(3),
      [source()],
      { itemId: 'duck-src', trackId: 'track-sfx' },
      0,
      FPS,
      RATE,
    )
    expect(at(untouched, 45)).toBeCloseTo(1, 5)

    const scoped = applyDucking(
      ones(3),
      [source({ targetTrackIds: ['track-music'] })],
      { itemId: 't', trackId: 'track-speech' },
      0,
      FPS,
      RATE,
    )
    expect(at(scoped, 45)).toBeCloseTo(1, 5)
  })

  it('overlapping sources take the deepest gain, offset segments align by timeline frame', () => {
    const two = [source(), source({ itemId: 'duck-2', duckDb: -20, startFrame: 40, endFrame: 50 })]
    const out = applyDucking(ones(3), two, { itemId: 't', trackId: 'a' }, 0, FPS, RATE)
    expect(at(out, 36)).toBeCloseTo(gainDb(-12), 4)
    expect(at(out, 45)).toBeCloseTo(gainDb(-20), 4)
    // Segment that starts mid-timeline: samples[0] maps to frame 40.
    const offset = applyDucking(ones(1), [source()], { itemId: 't', trackId: 'a' }, 40, FPS, RATE)
    expect(offset[0]!).toBeCloseTo(gainDb(-12), 4)
  })

  it('collectDuckingSources picks audible flagged items and skips muted/positive/videos without audio', () => {
    const composition: CompositionInputProps = {
      fps: FPS,
      durationInFrames: 300,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({
          id: 'track-sfx',
          order: 0,
          kind: 'audio',
          items: [
            makeAudioItem({
              id: 'meme',
              from: 60,
              durationInFrames: 45,
              audioDucking: { duckOthersDb: -9, attackSec: 0.1, targetTrackIds: ['track-a1'] },
            }),
            makeAudioItem({
              id: 'bad-positive',
              from: 150,
              audioDucking: { duckOthersDb: 3 },
            }),
          ],
        }),
        makeTrack({
          id: 'track-muted',
          order: 1,
          kind: 'audio',
          items: [makeAudioItem({ id: 'silent', audioDucking: { duckOthersDb: -9 } })],
        }),
        makeTrack({
          id: 'track-v',
          order: 2,
          items: [
            makeVideoItem({
              id: 'muted-video',
              embeddedAudioMuted: true,
              audioDucking: { duckOthersDb: -9 },
            }),
          ],
        }),
      ],
      transitions: [],
      keyframes: [],
    }
    composition.tracks[1] = { ...composition.tracks[1]!, muted: true }
    const sources = collectDuckingSources(composition, FPS)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      itemId: 'meme',
      trackId: 'track-sfx',
      startFrame: 60,
      endFrame: 105,
      duckDb: -9,
      attackFrames: 3,
      targetTrackIds: ['track-a1'],
    })
  })

  it('collectDuckingSources finds sources inside a pre-composition, in parent frames', () => {
    // Regression: the mix expands nested composition audio, but the source scan
    // only walked the root tracks — so the same arrangement ducked at root level
    // and silently did not one level down.
    const nestedSource = makeAudioItem({
      id: 'nested-sting',
      trackId: 'sub-a1',
      from: 10,
      durationInFrames: 20,
      audioDucking: { duckOthersDb: -9, attackSec: 0.1, releaseSec: 0.1 },
    })
    const subComp = {
      id: 'sub-duck',
      name: 'Sting',
      items: [nestedSource],
      tracks: [makeTrack({ id: 'sub-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
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

    const compositionItem = {
      id: 'comp-item',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'root-v1',
      from: 40,
      durationInFrames: 90,
      label: 'Sting',
      compositionWidth: 1920,
      compositionHeight: 1080,
      transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    } as unknown as CompositionItem

    const composition: CompositionInputProps = {
      fps: FPS,
      durationInFrames: 200,
      width: 1920,
      height: 1080,
      tracks: [makeTrack({ id: 'root-v1', order: 0, kind: 'video', items: [compositionItem] })],
      transitions: [],
      keyframes: [],
    }

    const sources = collectDuckingSources(composition, FPS)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      itemId: 'nested-sting',
      // The ROOT track, because that is the track the nested audio is mixed onto
      // and therefore what "never duck yourself" must compare against.
      trackId: 'root-v1',
      // Wrapper starts at 40, item sits at 10 inside it → 50..70 in parent frames.
      startFrame: 40 + 10,
      endFrame: 40 + 30,
      duckDb: -9,
    })
  })

  it('a duck source gives the same window at root level and inside a pre-comp', () => {
    const ducking = { duckOthersDb: -12, attackSec: 0.1, releaseSec: 0.2 }
    const atRoot = collectDuckingSources(
      {
        fps: FPS,
        durationInFrames: 200,
        width: 1920,
        height: 1080,
        tracks: [
          makeTrack({
            id: 'root-a1',
            order: 0,
            kind: 'audio',
            items: [
              makeAudioItem({
                id: 'sting',
                trackId: 'root-a1',
                from: 55,
                durationInFrames: 20,
                audioDucking: ducking,
              }),
            ],
          }),
        ],
        transitions: [],
        keyframes: [],
      },
      FPS,
    )

    const subComp = {
      id: 'sub-equiv',
      name: 'Equivalent',
      items: [
        makeAudioItem({
          id: 'sting',
          trackId: 'sub-a1',
          from: 15,
          durationInFrames: 20,
          audioDucking: ducking,
        }),
      ],
      tracks: [makeTrack({ id: 'sub-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
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
    const nested = collectDuckingSources(
      {
        fps: FPS,
        durationInFrames: 200,
        width: 1920,
        height: 1080,
        tracks: [
          makeTrack({
            id: 'root-a1',
            order: 0,
            kind: 'audio',
            items: [
              {
                id: 'wrapper',
                type: 'composition',
                compositionId: subComp.id,
                trackId: 'root-a1',
                from: 40, // 40 + 15 == 55, the root-level position
                durationInFrames: 90,
                label: 'Equivalent',
                compositionWidth: 1920,
                compositionHeight: 1080,
                transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
              } as unknown as CompositionItem,
            ],
          }),
        ],
        transitions: [],
        keyframes: [],
      },
      FPS,
    )

    // Same arrangement, same balance — this equality is the whole point.
    expect(nested).toEqual(atRoot)
  })

  it('a hidden but unmuted nested track still ducks (the mix still plays it)', () => {
    // The audio expansion only consults `muted`; excluding hidden tracks here
    // would leave an audible source attenuating nothing.
    const subComp = {
      id: 'sub-hidden',
      name: 'Hidden',
      items: [
        makeAudioItem({
          id: 'hidden-sting',
          trackId: 'sub-a1',
          from: 0,
          durationInFrames: 20,
          audioDucking: { duckOthersDb: -9 },
        }),
      ],
      tracks: [{ ...makeTrack({ id: 'sub-a1', order: 0, kind: 'audio' }), visible: false }],
      transitions: [],
      keyframes: [],
      fps: FPS,
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

    const sources = collectDuckingSources(
      {
        fps: FPS,
        durationInFrames: 200,
        width: 1920,
        height: 1080,
        tracks: [
          makeTrack({
            id: 'root-a1',
            order: 0,
            kind: 'audio',
            items: [
              {
                id: 'wrapper',
                type: 'composition',
                compositionId: subComp.id,
                trackId: 'root-a1',
                from: 0,
                durationInFrames: 90,
                label: 'Hidden',
                compositionWidth: 1920,
                compositionHeight: 1080,
                transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
              } as unknown as CompositionItem,
            ],
          }),
        ],
        transitions: [],
        keyframes: [],
      },
      FPS,
    )
    expect(sources.map((s) => s.itemId)).toEqual(['hidden-sting'])
  })

  it('a composition-backed audio item keeps its OWN ducking as well as its children', () => {
    // Regression: intercepting composition items for recursion used to skip
    // `duckingSourceFromItem` on the wrapper, silently dropping its own settings.
    const subComp = {
      id: 'sub-both',
      name: 'Both',
      items: [
        makeAudioItem({
          id: 'child',
          trackId: 'sub-a1',
          from: 5,
          durationInFrames: 10,
          audioDucking: { duckOthersDb: -6 },
        }),
      ],
      tracks: [makeTrack({ id: 'sub-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
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

    const sources = collectDuckingSources(
      {
        fps: FPS,
        durationInFrames: 200,
        width: 1920,
        height: 1080,
        tracks: [
          makeTrack({
            id: 'root-a1',
            order: 0,
            kind: 'audio',
            items: [
              makeAudioItem({
                id: 'wrapper',
                trackId: 'root-a1',
                from: 0,
                durationInFrames: 90,
                audioDucking: { duckOthersDb: -3 },
                compositionId: subComp.id,
              } as Partial<AudioItem>),
            ],
          }),
        ],
        transitions: [],
        keyframes: [],
      },
      FPS,
    )
    expect(sources.map((s) => s.itemId).sort()).toEqual(['child', 'wrapper'])
    expect(sources.find((s) => s.itemId === 'wrapper')!.duckDb).toBe(-3)
    expect(sources.find((s) => s.itemId === 'child')!.duckDb).toBe(-6)
  })

  it('a clipped intermediate composition gives the duck scan the SAME window as the mix', () => {
    // Two levels deep with a `sourceEnd` clip on the middle wrapper — the case
    // where an omitted sourceEnd remap in the recursion shows up. Asserted against
    // the audio segment rather than a hand-computed number, because "the mix and
    // the duck scan agree" is the actual contract, not any particular frame.
    const inner = {
      id: 'inner',
      name: 'Inner',
      items: [
        makeAudioItem({
          id: 'deep-sting',
          trackId: 'inner-a1',
          from: 0,
          durationInFrames: 60,
          audioDucking: { duckOthersDb: -9 },
        }),
      ],
      tracks: [makeTrack({ id: 'inner-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
      width: 1920,
      height: 1080,
      durationInFrames: 60,
    }
    const middle = {
      id: 'middle',
      name: 'Middle',
      items: [
        {
          id: 'inner-wrapper',
          type: 'composition',
          compositionId: 'inner',
          trackId: 'middle-a1',
          from: 0,
          durationInFrames: 60,
          // Clipped: only the first 25 frames of `inner` are used.
          sourceStart: 0,
          sourceEnd: 25,
          label: 'Inner',
          compositionWidth: 1920,
          compositionHeight: 1080,
          transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
        } as unknown as CompositionItem,
      ],
      tracks: [makeTrack({ id: 'middle-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
      width: 1920,
      height: 1080,
      durationInFrames: 60,
    }
    useCompositionsStore.setState({
      compositions: [inner, middle],
      compositionById: { inner, middle },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })

    const composition: CompositionInputProps = {
      fps: FPS,
      durationInFrames: 200,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({
          id: 'root-a1',
          order: 0,
          kind: 'audio',
          items: [
            {
              id: 'middle-wrapper',
              type: 'composition',
              compositionId: 'middle',
              trackId: 'root-a1',
              from: 30,
              durationInFrames: 20,
              // Clipped at BOTH levels: this is what makes the recursive
              // sourceEnd remap observable — without it the inner wrapper keeps
              // an end that outruns the window the mix actually uses.
              sourceStart: 0,
              sourceEnd: 20,
              label: 'Middle',
              compositionWidth: 1920,
              compositionHeight: 1080,
              transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
            } as unknown as CompositionItem,
          ],
        }),
      ],
      transitions: [],
      keyframes: [],
    }

    const segment = extractAudioSegments(composition, FPS).find((s) => s.itemId === 'deep-sting')
    const source = collectDuckingSources(composition, FPS).find((s) => s.itemId === 'deep-sting')

    expect(segment).toBeDefined()
    expect(source).toBeDefined()
    expect(source!.startFrame).toBe(segment!.startFrame)
    expect(source!.endFrame).toBe(segment!.startFrame + segment!.durationFrames)
  })

  it('a self-referencing pre-comp does not hang the duck-source scan', () => {
    const cyclic = {
      id: 'cyclic',
      name: 'Cyclic',
      items: [
        {
          id: 'self',
          type: 'composition',
          compositionId: 'cyclic',
          trackId: 'sub-a1',
          from: 0,
          durationInFrames: 30,
          label: 'self',
          compositionWidth: 1920,
          compositionHeight: 1080,
          transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
        } as unknown as CompositionItem,
      ],
      tracks: [makeTrack({ id: 'sub-a1', order: 0, kind: 'audio' })],
      transitions: [],
      keyframes: [],
      fps: FPS,
      width: 1920,
      height: 1080,
      durationInFrames: 90,
    }
    useCompositionsStore.setState({
      compositions: [cyclic],
      compositionById: { [cyclic.id]: cyclic },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })

    expect(() =>
      collectDuckingSources(
        {
          fps: FPS,
          durationInFrames: 200,
          width: 1920,
          height: 1080,
          tracks: [
            makeTrack({
              id: 'root-a1',
              order: 0,
              kind: 'audio',
              items: [
                {
                  id: 'wrapper',
                  type: 'composition',
                  compositionId: 'cyclic',
                  trackId: 'root-a1',
                  from: 0,
                  durationInFrames: 30,
                  label: 'Cyclic',
                  compositionWidth: 1920,
                  compositionHeight: 1080,
                  transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
                } as unknown as CompositionItem,
              ],
            }),
          ],
          transitions: [],
          keyframes: [],
        },
        FPS,
      ),
    ).not.toThrow()
  })

  it('processAudio ducks a constant target under the duck window (real pipeline)', async () => {
    clearAudioDecodeCache()
    const composition: CompositionInputProps = {
      fps: FPS,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [
        makeTrack({
          id: 'track-a1',
          order: 0,
          kind: 'audio',
          items: [makeAudioItem({ id: 'speech', durationInFrames: 90 })],
        }),
        makeTrack({
          id: 'track-sfx',
          order: 1,
          kind: 'audio',
          items: [
            makeAudioItem({
              id: 'stinger',
              from: 30,
              durationInFrames: 30,
              volume: -60, // keep the source near-silent so probes isolate the ducked target
              audioDucking: { duckOthersDb: -12, attackSec: 0.1, releaseSec: 0.1 },
            }),
          ],
        }),
      ],
      transitions: [],
      keyframes: [],
    }
    const result = await processAudio(composition)
    expect(result).not.toBeNull()
    const samples = result!.samples[0]!
    const probe = (sec: number) => samples[Math.round(sec * 48_000)]!
    expect(probe(0.5)).toBeCloseTo(0.1, 2) // before window: untouched
    expect(probe(1.5)).toBeCloseTo(0.1 * gainDb(-12), 2) // mid window: ducked
    expect(probe(2.7)).toBeCloseTo(0.1, 2) // after release: recovered
  })
})
