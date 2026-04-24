import { describe, expect, it } from 'vitest';
import {
  assertRenderMediaSources,
  collectMediaUsageFromTracks,
  collectProjectMediaUsage,
  normalizeRenderMediaSources,
  planRenderMediaSources,
} from '../src/index.ts';

describe('media planning', () => {
  it('collects project media usage for a render range and nested compositions', () => {
    const project = {
      timeline: {
        items: [
          { id: 'early', type: 'video', mediaId: 'media-early', trackId: 'track-1', from: 0, durationInFrames: 30 },
          { id: 'late', type: 'audio', mediaId: 'media-late', trackId: 'track-1', from: 90, durationInFrames: 30 },
          { id: 'nested', type: 'composition', compositionId: 'comp-1', trackId: 'track-1', from: 0, durationInFrames: 30 },
        ],
        compositions: [
          {
            id: 'comp-1',
            items: [
              { id: 'nested-media', type: 'image', mediaId: 'media-nested', trackId: 'comp-track', from: 0, durationInFrames: 30 },
            ],
          },
        ],
      },
    };

    const usage = collectProjectMediaUsage(project, { inFrame: 0, outFrame: 60 });
    expect([...usage.keys()]).toEqual(['media-early', 'media-nested']);
    expect(usage.get('media-early')).toMatchObject({ itemCount: 1 });
    expect(usage.get('media-nested')?.items[0]).toMatchObject({ id: 'nested-media', trackId: 'comp-track' });
  });

  it('normalizes string and object media sources', () => {
    const sources = normalizeRenderMediaSources({
      'media-a': 'blob:a',
      'media-b': { url: 'blob:b', audioUrl: 'blob:b-audio', keyframeTimestamps: [0, 1] },
    });

    expect(sources.get('media-a')).toEqual({ url: 'blob:a' });
    expect(sources.get('media-b')).toEqual({
      url: 'blob:b',
      audioUrl: 'blob:b-audio',
      keyframeTimestamps: [0, 1],
    });
    expect(() => normalizeRenderMediaSources({ 'media-c': { audioUrl: 'no-url' } })).toThrow(/invalid media source/);
  });

  it('plans missing and unused media sources deterministically', () => {
    const plan = planRenderMediaSources(['media-a', 'media-b'], {
      'media-a': 'blob:a',
      'media-unused': 'blob:unused',
    });

    expect(plan.ok).toBe(false);
    expect(plan.requiredMediaIds).toEqual(['media-a', 'media-b']);
    expect(plan.missingMediaIds).toEqual(['media-b']);
    expect(plan.unusedMediaIds).toEqual(['media-unused']);
    expect(() => assertRenderMediaSources(plan)).toThrow(/missing media source URL for media-b/);
  });

  it('collects only track media items that still need external sources', () => {
    const usage = collectMediaUsageFromTracks([
      {
        id: 'track-1',
        items: [
          { id: 'ready', type: 'video', mediaId: 'media-ready', src: 'blob:ready', from: 0, durationInFrames: 30 },
          { id: 'missing', type: 'image', mediaId: 'media-missing', from: 0, durationInFrames: 30 },
        ],
      },
    ], null, { requireExternalSource: true });

    expect([...usage.keys()]).toEqual(['media-missing']);
    expect(usage.get('media-missing')?.items[0]).toMatchObject({ id: 'missing', trackId: 'track-1' });
  });
});
