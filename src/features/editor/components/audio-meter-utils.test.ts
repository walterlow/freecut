import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  clearLiveTrackVolumeOverride,
  compileAudioMeterGraph,
  estimateAudioMeterLevel,
  estimatePerTrackLevels,
  isAudioMixerTrack,
  formatMeterDb,
  resolveCompiledAudioMeterSources,
  resolveAudioMeterSources,
  setLiveTrackVolumeOverride,
} from './audio-meter-utils'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'A1',
    kind: 'audio',
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Audio',
    src: 'blob:audio',
    mediaId: 'media-audio',
    sourceStart: 0,
    sourceFps: 30,
    volume: 0,
    ...overrides,
  }
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Video',
    src: 'blob:video',
    mediaId: 'media-video',
    sourceStart: 0,
    sourceFps: 30,
    volume: 0,
    ...overrides,
  }
}

describe('audio meter utils', () => {
  it('resolves a direct audio source with source offset and gain', () => {
    const audioItem = makeAudioItem({
      sourceStart: 15,
      volume: 6,
    })
    const tracks = [makeTrack({ items: [audioItem] })]

    const sources = resolveAudioMeterSources({
      tracks,
      transitions: [],
      frame: 15,
      fps: 30,
      masterGain: 1,
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]?.mediaId).toBe('media-audio')
    expect(sources[0]?.sourceTimeSeconds).toBeCloseTo(1, 5)
    expect(sources[0]?.gain).toBeCloseTo(Math.pow(10, 6 / 20), 5)
  })

  it('resolves nested sources from composition audio wrappers', () => {
    const wrapper = makeAudioItem({
      id: 'comp-audio',
      compositionId: 'composition-1',
      mediaId: undefined,
      src: '',
      volume: 6,
    })
    const nestedAudio = makeAudioItem({
      id: 'nested-audio',
      mediaId: 'nested-media',
      src: 'blob:nested',
    })

    const sources = resolveAudioMeterSources({
      tracks: [makeTrack({ items: [wrapper] })],
      transitions: [],
      frame: 15,
      fps: 30,
      masterGain: 1,
      compositionsById: {
        'composition-1': {
          id: 'composition-1',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ items: [nestedAudio] })],
        },
      },
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]?.mediaId).toBe('nested-media')
    expect(sources[0]?.gain).toBeCloseTo(Math.pow(10, 6 / 20), 5)
  })

  it('reuses a compiled graph for frame-by-frame source resolution', () => {
    const audioItem = makeAudioItem({ sourceStart: 12 })
    const graph = compileAudioMeterGraph({
      tracks: [makeTrack({ items: [audioItem] })],
      transitions: [],
      fps: 30,
    })

    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 18,
      masterGain: 1,
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]?.sourceTimeSeconds).toBeCloseTo(1, 5)
  })

  it('keeps compiled direct sources at unity correction until a live override is applied', () => {
    const audioItem = makeAudioItem()
    const graph = compileAudioMeterGraph({
      tracks: [makeTrack({ volume: -6, items: [audioItem] })],
      transitions: [],
      fps: 30,
    })

    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 15,
      masterGain: 1,
    })

    expect(sources[0]?.trackVolumeGain).toBeCloseTo(1, 5)

    setLiveTrackVolumeOverride('track-1', 0)
    const liveSources = resolveCompiledAudioMeterSources({
      graph,
      frame: 15,
      masterGain: 1,
    })
    clearLiveTrackVolumeOverride('track-1')

    expect(liveSources[0]?.trackVolumeGain).toBeCloseTo(Math.pow(10, 6 / 20), 5)
  })

  it('renders legacy audio tracks in the mixer', () => {
    const track = makeTrack({
      name: 'Track 2',
      kind: undefined,
      items: [makeAudioItem()],
    })

    expect(isAudioMixerTrack(track)).toBe(true)
  })

  it('renders standalone video tracks in the mixer when they have audible media', () => {
    const track = makeTrack({
      name: 'V1',
      kind: undefined,
      items: [makeVideoItem()],
    })

    expect(isAudioMixerTrack(track)).toBe(true)
  })

  it('does not render linked video tracks in the mixer when a companion audio track exists', () => {
    const videoItem = makeVideoItem({
      id: 'video-linked',
      linkedGroupId: 'linked-1',
    })
    const audioItem = makeAudioItem({
      id: 'audio-linked',
      linkedGroupId: 'linked-1',
      trackId: 'track-audio',
    })
    const track = makeTrack({
      name: 'V1',
      kind: undefined,
      items: [videoItem],
    })

    expect(isAudioMixerTrack(track, [videoItem, audioItem])).toBe(false)
  })

  it('estimates per-track levels for composition-backed audio tracks', () => {
    const wrapper = makeAudioItem({
      id: 'comp-audio',
      compositionId: 'composition-1',
      mediaId: undefined,
      src: '',
    })
    const nestedAudio = makeAudioItem({
      id: 'nested-audio',
      mediaId: 'nested-media',
      src: 'blob:nested',
    })
    const track = makeTrack({ items: [wrapper] })
    const graph = compileAudioMeterGraph({
      tracks: [track],
      transitions: [],
      fps: 30,
      compositionsById: {
        'composition-1': {
          id: 'composition-1',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ items: [nestedAudio] })],
        },
      },
    })
    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 15,
      masterGain: 1,
    })

    expect(sources[0]?.trackId).toBe('track-1')

    const levels = estimatePerTrackLevels({
      tracks: [track],
      sources,
      waveformsByMediaId: new Map([
        [
          'nested-media',
          {
            peaks: new Float32Array([1, 0.5, 0.25, 0.1]),
            sampleRate: 1,
            channels: 1,
          },
        ],
      ]),
    })

    expect(levels.get('track-1')?.left ?? 0).toBeGreaterThan(0)
    expect(levels.get('track-1')?.right ?? 0).toBeGreaterThan(0)
  })

  it('keeps nested composition audio assigned to the parent mixer track', () => {
    const wrapperTrack = makeTrack({
      id: 'track-parent',
      name: 'A2',
      items: [
        makeAudioItem({
          id: 'comp-audio-parent',
          trackId: 'track-parent',
          compositionId: 'composition-1',
          mediaId: undefined,
          src: '',
        }),
      ],
    })
    const emptyTrack = makeTrack({
      id: 'track-empty',
      name: 'A3',
      items: [],
    })
    const nestedAudio = makeAudioItem({
      id: 'nested-audio-parent',
      trackId: 'nested-track',
      mediaId: 'nested-parent-media',
      src: 'blob:nested-parent',
    })

    const graph = compileAudioMeterGraph({
      tracks: [wrapperTrack, emptyTrack],
      transitions: [],
      fps: 30,
      compositionsById: {
        'composition-1': {
          id: 'composition-1',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ id: 'nested-track', items: [nestedAudio] })],
        },
      },
    })
    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 15,
      masterGain: 1,
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]?.trackId).toBe('track-parent')

    const levels = estimatePerTrackLevels({
      tracks: [wrapperTrack, emptyTrack],
      sources,
      targetTrackIds: ['track-parent', 'track-empty'],
      waveformsByMediaId: new Map([
        [
          'nested-parent-media',
          {
            peaks: new Float32Array([1, 0.5, 0.25, 0.1]),
            sampleRate: 1,
            channels: 1,
          },
        ],
      ]),
    })

    expect(levels.get('track-parent')?.left ?? 0).toBeGreaterThan(0)
    expect(levels.get('track-empty')?.left ?? 0).toBe(0)
  })

  it('applies live track overrides to composition-backed mixer tracks in compiled graphs', () => {
    const wrapperTrack = makeTrack({
      id: 'track-parent',
      name: 'A2',
      volume: -12,
      items: [
        makeAudioItem({
          id: 'comp-audio-parent',
          trackId: 'track-parent',
          compositionId: 'composition-1',
          mediaId: undefined,
          src: '',
        }),
      ],
    })
    const nestedAudio = makeAudioItem({
      id: 'nested-audio-parent',
      trackId: 'nested-track',
      mediaId: 'nested-parent-media',
      src: 'blob:nested-parent',
    })
    const graph = compileAudioMeterGraph({
      tracks: [wrapperTrack],
      transitions: [],
      fps: 30,
      compositionsById: {
        'composition-1': {
          id: 'composition-1',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ id: 'nested-track', items: [nestedAudio] })],
        },
      },
    })
    const waveformsByMediaId = new Map([
      [
        'nested-parent-media',
        {
          peaks: new Float32Array([1, 0.5, 0.25, 0.1]),
          sampleRate: 1,
          channels: 1,
        },
      ],
    ])

    const committedLevels = estimatePerTrackLevels({
      tracks: [wrapperTrack],
      sources: resolveCompiledAudioMeterSources({
        graph,
        frame: 15,
        masterGain: 1,
      }),
      waveformsByMediaId,
    })

    setLiveTrackVolumeOverride('track-parent', 0)
    const liveLevels = estimatePerTrackLevels({
      tracks: [wrapperTrack],
      sources: resolveCompiledAudioMeterSources({
        graph,
        frame: 15,
        masterGain: 1,
      }),
      waveformsByMediaId,
    })
    clearLiveTrackVolumeOverride('track-parent')

    expect(liveLevels.get('track-parent')?.left ?? 0).toBeGreaterThan(
      committedLevels.get('track-parent')?.left ?? 0,
    )
    expect(liveLevels.get('track-parent')?.right ?? 0).toBeGreaterThan(
      committedLevels.get('track-parent')?.right ?? 0,
    )
  })

  it('resolves audio through deeply nested compound clips in compiled graphs', () => {
    const rootWrapper = makeAudioItem({
      id: 'comp-audio-root',
      trackId: 'track-root',
      compositionId: 'composition-1',
      mediaId: undefined,
      src: '',
    })
    const childWrapper = makeAudioItem({
      id: 'comp-audio-child',
      trackId: 'track-child',
      compositionId: 'composition-2',
      mediaId: undefined,
      src: '',
    })
    const grandchildWrapper = makeAudioItem({
      id: 'comp-audio-grandchild',
      trackId: 'track-grandchild',
      compositionId: 'composition-3',
      mediaId: undefined,
      src: '',
    })
    const deepestAudio = makeAudioItem({
      id: 'deep-audio',
      trackId: 'track-deep',
      mediaId: 'deep-media',
      src: 'blob:deep',
    })

    const graph = compileAudioMeterGraph({
      tracks: [makeTrack({ id: 'track-root', items: [rootWrapper] })],
      transitions: [],
      fps: 30,
      compositionsById: {
        'composition-1': {
          id: 'composition-1',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ id: 'track-child', items: [childWrapper] })],
        },
        'composition-2': {
          id: 'composition-2',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ id: 'track-grandchild', items: [grandchildWrapper] })],
        },
        'composition-3': {
          id: 'composition-3',
          fps: 30,
          transitions: [],
          tracks: [makeTrack({ id: 'track-deep', items: [deepestAudio] })],
        },
      },
    })

    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 15,
      masterGain: 1,
    })

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      mediaId: 'deep-media',
      trackId: 'track-root',
    })
  })

  it('estimates a mixed level from cached waveform peaks', () => {
    const estimate = estimateAudioMeterLevel({
      sources: [
        {
          mediaId: 'media-audio',
          gain: 1,
          trackVolumeGain: 1,
          sourceTimeSeconds: 2,
          windowSeconds: 0.1,
        },
      ],
      waveformsByMediaId: new Map([
        [
          'media-audio',
          {
            peaks: new Float32Array([0, 0.25, 1, 0.5]),
            sampleRate: 1,
            channels: 1,
          },
        ],
      ]),
    })

    expect(estimate.resolvedSourceCount).toBe(1)
    expect(estimate.unresolvedSourceCount).toBe(0)
    expect(estimate.left).toBeGreaterThan(0.9)
    expect(estimate.right).toBeGreaterThan(0.9)
    expect(formatMeterDb(estimate.left)).toMatch(/dB$/)
  })

  it('estimates separate L/R levels from stereo waveform data', () => {
    const estimate = estimateAudioMeterLevel({
      sources: [
        {
          mediaId: 'media-audio',
          gain: 1,
          trackVolumeGain: 1,
          sourceTimeSeconds: 0.5,
          windowSeconds: 0.5,
        },
      ],
      waveformsByMediaId: new Map([
        [
          'media-audio',
          {
            peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]), // L=0.8,1.0  R=0.2,0.3
            sampleRate: 2,
            channels: 2,
          },
        ],
      ]),
    })

    expect(estimate.resolvedSourceCount).toBe(1)
    expect(estimate.left).toBeGreaterThan(estimate.right)
  })
})
