import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import { buildPreviewCompositionData } from './use-preview-composition-model';

describe('buildPreviewCompositionData', () => {
  it('derives playback and fast-scrub sources separately and computes boundaries', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'video',
          mediaId: 'media-1',
          src: '',
          label: 'Clip',
          from: 10,
          durationInFrames: 60,
        },
      ],
    };

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map([['media-1', 'blob://video']]),
      useProxy: false,
      blobUrlVersion: 0,
      project: { width: 1920, height: 1080, backgroundColor: '#000000' },
      resolveProxyUrlFn: () => 'proxy://video',
    });

    expect(result.playbackVideoSourceSpans).toEqual([
      { src: 'blob://video', startFrame: 10, endFrame: 70 },
    ]);
    expect(result.scrubVideoSourceSpans).toEqual([
      { src: 'proxy://video', startFrame: 10, endFrame: 70 },
    ]);
    expect(result.fastScrubBoundaryFrames).toEqual([10, 70]);
    expect(result.fastScrubBoundarySources).toEqual([
      { frame: 10, srcs: ['proxy://video'] },
      { frame: 70, srcs: ['proxy://video'] },
    ]);
    expect(result.totalFrames).toBe(220);
    const playbackVideoItem = result.inputProps.tracks[0]?.items[0];
    const scrubVideoItem = result.fastScrubInputProps.tracks[0]?.items[0];
    expect(playbackVideoItem?.type).toBe('video');
    expect(scrubVideoItem?.type).toBe('video');
    if (playbackVideoItem?.type === 'video' && scrubVideoItem?.type === 'video') {
      expect(playbackVideoItem.audioSrc).toBe('blob://video');
      expect(scrubVideoItem.audioSrc).toBe('blob://video');
    }
  });

  it('falls back to default duration for empty timelines', () => {
    const result = buildPreviewCompositionData({
      combinedTracks: [],
      fps: 30,
      items: [],
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map(),
      useProxy: true,
      blobUrlVersion: 0,
      project: { width: 1280, height: 720 },
    });

    expect(result.totalFrames).toBe(900);
    expect(result.playerRenderSize).toEqual({ width: 1280, height: 720 });
    expect(result.renderSize).toEqual({ width: 1280, height: 720 });
  });

  it('uses an already-acquired blob URL before resolvedUrls catches up', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'video',
          mediaId: 'media-1',
          src: '',
          label: 'Clip',
          from: 0,
          durationInFrames: 90,
        },
      ],
    };

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map(),
      useProxy: false,
      blobUrlVersion: 1,
      project: { width: 1920, height: 1080 },
      getBlobUrlFn: (mediaId) => mediaId === 'media-1' ? 'blob://warm-audio' : null,
    });

    const playbackVideoItem = result.inputProps.tracks[0]?.items[0];
    expect(playbackVideoItem?.type).toBe('video');
    if (playbackVideoItem?.type === 'video') {
      expect(playbackVideoItem.src).toBe('blob://warm-audio');
      expect(playbackVideoItem.audioSrc).toBe('blob://warm-audio');
    }
  });
});
