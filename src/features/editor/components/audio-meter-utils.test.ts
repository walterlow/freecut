import { describe, expect, it } from 'vitest';
import type { AudioItem, TimelineTrack } from '@/types/timeline';
import {
  compileAudioMeterGraph,
  estimateAudioMeterLevel,
  formatMeterDb,
  resolveCompiledAudioMeterSources,
  resolveAudioMeterSources,
} from './audio-meter-utils';

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
  };
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
  };
}

describe('audio meter utils', () => {
  it('resolves a direct audio source with source offset and gain', () => {
    const audioItem = makeAudioItem({
      sourceStart: 15,
      volume: 6,
    });
    const tracks = [makeTrack({ items: [audioItem] })];

    const sources = resolveAudioMeterSources({
      tracks,
      transitions: [],
      frame: 15,
      fps: 30,
      masterGain: 1,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.mediaId).toBe('media-audio');
    expect(sources[0]?.sourceTimeSeconds).toBeCloseTo(1, 5);
    expect(sources[0]?.gain).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it('resolves nested sources from composition audio wrappers', () => {
    const wrapper = makeAudioItem({
      id: 'comp-audio',
      compositionId: 'composition-1',
      mediaId: undefined,
      src: '',
      volume: 6,
    });
    const nestedAudio = makeAudioItem({
      id: 'nested-audio',
      mediaId: 'nested-media',
      src: 'blob:nested',
    });

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
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.mediaId).toBe('nested-media');
    expect(sources[0]?.gain).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it('reuses a compiled graph for frame-by-frame source resolution', () => {
    const audioItem = makeAudioItem({ sourceStart: 12 });
    const graph = compileAudioMeterGraph({
      tracks: [makeTrack({ items: [audioItem] })],
      transitions: [],
      fps: 30,
    });

    const sources = resolveCompiledAudioMeterSources({
      graph,
      frame: 18,
      masterGain: 1,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.sourceTimeSeconds).toBeCloseTo(1, 5);
  });

  it('estimates a mixed level from cached waveform peaks', () => {
    const estimate = estimateAudioMeterLevel({
      sources: [{
        mediaId: 'media-audio',
        gain: 1,
        sourceTimeSeconds: 2,
        windowSeconds: 0.1,
      }],
      waveformsByMediaId: new Map([
        ['media-audio', {
          peaks: new Float32Array([0, 0.25, 1, 0.5]),
          sampleRate: 1,
          channels: 1,
        }],
      ]),
    });

    expect(estimate.resolvedSourceCount).toBe(1);
    expect(estimate.unresolvedSourceCount).toBe(0);
    expect(estimate.left).toBeGreaterThan(0.9);
    expect(estimate.right).toBeGreaterThan(0.9);
    expect(formatMeterDb(estimate.left)).toMatch(/dB$/);
  });

  it('estimates separate L/R levels from stereo waveform data', () => {
    const estimate = estimateAudioMeterLevel({
      sources: [{
        mediaId: 'media-audio',
        gain: 1,
        sourceTimeSeconds: 0.5,
        windowSeconds: 0.5,
      }],
      waveformsByMediaId: new Map([
        ['media-audio', {
          peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]),  // L=0.8,1.0  R=0.2,0.3
          sampleRate: 2,
          channels: 2,
        }],
      ]),
    });

    expect(estimate.resolvedSourceCount).toBe(1);
    expect(estimate.left).toBeGreaterThan(estimate.right);
  });
});
