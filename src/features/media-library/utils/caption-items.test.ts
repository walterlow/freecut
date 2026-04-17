import { describe, expect, it, vi } from 'vitest';

vi.mock('../deps/timeline-contract', () => ({
  DEFAULT_TRACK_HEIGHT: 100,
  timelineToSourceFrames: (
    timelineFrames: number,
    speed = 1,
    timelineFps: number,
    sourceFps: number,
  ) => Math.max(0, Math.round((timelineFrames / timelineFps) * sourceFps * speed)),
  getNextClassicTrackName: (tracks: Array<{ name: string; kind?: string }>, kind: 'video' | 'audio') => {
    const prefix = kind === 'video' ? 'V' : 'A';
    const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');
    const used = new Set(
      tracks
        .filter((track) => track.kind === undefined || track.kind === kind)
        .map((track) => {
          const match = track.name.match(regex);
          return match?.[1] ? Number.parseInt(match[1], 10) : NaN;
        })
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    let next = 1;
    while (used.has(next)) next += 1;
    return `${prefix}${next}`;
  },
}));

import {
  aiCaptionsToSegments,
  buildCaptionTextItems,
  buildCaptionTrack,
  buildCaptionTrackAbove,
  findGeneratedCaptionItemsForClip,
  findReplaceableCaptionItemsForClip,
  getCaptionTextItemTemplate,
  findCompatibleCaptionTrack,
  getCaptionRangeForClip,
  getCaptionFrameRange,
  normalizeCaptionSegments,
} from './caption-items';
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { getTrackKind } from '@/features/timeline/utils/classic-tracks';

describe('caption-items', () => {
  it('normalizes empty and invalid transcript segments', () => {
    const normalized = normalizeCaptionSegments([
      { text: '  Hello  ', start: 0, end: 1.2 },
      { text: '   ', start: 2, end: 3 },
      { text: 'Backwards', start: 5, end: 4 },
    ]);

    expect(normalized).toEqual([
      { text: 'Hello', start: 0, end: 1.2 },
    ]);
  });

  it('maps transcript segments to timed text items within a trimmed clip using source fps', () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-1',
      from: 120,
      durationInFrames: 30,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 30,
      sourceEnd: 90,
      sourceDuration: 300,
      sourceFps: 60,
      speed: 1,
    };

    const items = buildCaptionTextItems({
      mediaId: 'media-1',
      trackId: 'track-captions',
      segments: [
        { text: 'First line', start: 0.25, end: 1.0 },
        { text: 'Second line', start: 1.0, end: 1.5 },
        { text: 'Outside', start: 2.0, end: 3.0 },
      ],
      clip,
      timelineFps: 30,
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'text',
      trackId: 'track-captions',
      mediaId: 'media-1',
      from: 120,
      durationInFrames: 15,
      text: 'First line',
      captionSource: {
        type: 'transcript',
        clipId: 'clip-1',
        mediaId: 'media-1',
      },
    });
    expect(items[1]).toMatchObject({
      from: 135,
      durationInFrames: 15,
      text: 'Second line',
    });
    expect(items[0]?.transform?.y).toBeGreaterThan(0);
  });

  it('derives caption range using clip speed and converted fps', () => {
    const clip: VideoItem = {
      id: 'clip-2',
      type: 'video',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 15,
      label: 'Fast Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 30,
      sourceEnd: 90,
      sourceDuration: 300,
      sourceFps: 60,
      speed: 2,
    };

    const range = getCaptionRangeForClip(
      clip,
      [{ text: 'Fast segment', start: 0.5, end: 1.5 }],
      30,
    );

    expect(range).toEqual({
      startFrame: 200,
      endFrame: 215,
    });
  });

  it('finds a compatible track without overlap', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-1',
        name: 'Track 1',
        height: 64,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
      {
        id: 'track-2',
        name: 'Track 2',
        height: 64,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ];
    const items: TimelineItem[] = [
      {
        id: 'clip-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 300,
        label: 'Clip',
        src: 'blob:test',
      },
    ];

    const track = findCompatibleCaptionTrack(tracks, items, 30, 90);
    expect(track?.id).toBe('track-2');
  });

  it('returns the overall transcript frame range', () => {
    const frameRange = getCaptionFrameRange(
      [
        { text: 'One', start: 0.2, end: 1.1 },
        { text: 'Two', start: 2.5, end: 4 },
      ],
      30,
    );

    expect(frameRange).toEqual({
      startFrame: 6,
      endFrame: 120,
    });
  });

  it('finds generated caption items for a clip and reuses their style template', () => {
    const clip: VideoItem = {
      id: 'clip-3',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 120,
      sourceFps: 30,
    };

    const generatedCaptions = buildCaptionTextItems({
      mediaId: 'media-1',
      trackId: 'track-captions',
      segments: [{ text: 'Original line', start: 0, end: 1 }],
      clip,
      timelineFps: 30,
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    const existingCaption = {
      ...generatedCaptions[0]!,
      color: '#ffcc00',
      backgroundColor: undefined,
      fontFamily: 'Sora',
      transform: {
        ...generatedCaptions[0]!.transform!,
        y: 420,
      },
    };

    const foundCaptions = findGeneratedCaptionItemsForClip(
      [
        existingCaption,
        {
          id: 'manual-text',
          type: 'text' as const,
          trackId: 'track-2',
          from: 0,
          durationInFrames: 30,
          label: 'Manual',
          text: 'Manual',
          color: '#ffffff',
        },
      ],
      clip.id,
    );

    expect(foundCaptions).toHaveLength(1);

    const regeneratedCaptions = buildCaptionTextItems({
      mediaId: 'media-1',
      trackId: 'track-captions',
      segments: [{ text: 'Updated line', start: 0, end: 1 }],
      clip,
      timelineFps: 30,
      canvasWidth: 1920,
      canvasHeight: 1080,
      styleTemplate: getCaptionTextItemTemplate(existingCaption),
    });

    expect(regeneratedCaptions[0]).toMatchObject({
      text: 'Updated line',
      color: '#ffcc00',
      backgroundColor: undefined,
      fontFamily: 'Sora',
      transform: {
        y: 420,
      },
    });
  });

  it('falls back to legacy generated caption detection when source metadata is missing', () => {
    const clip: VideoItem = {
      id: 'clip-legacy',
      type: 'video',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 40,
      label: 'Legacy Clip',
      mediaId: 'media-legacy',
      src: 'blob:test',
    };

    const replaceableCaptions = findReplaceableCaptionItemsForClip(
      [
        {
          id: 'legacy-caption',
          type: 'text',
          trackId: 'track-captions',
          from: 205,
          durationInFrames: 12,
          label: 'Legacy caption',
          mediaId: 'media-legacy',
          text: 'Legacy caption',
          color: '#ffffff',
        },
        {
          id: 'manual-text',
          type: 'text',
          trackId: 'track-captions',
          from: 205,
          durationInFrames: 12,
          label: 'Manual title',
          mediaId: 'media-legacy',
          text: 'Different text',
          color: '#ffffff',
        },
      ],
      clip,
    );

    expect(replaceableCaptions.map((item) => item.id)).toEqual(['legacy-caption']);
  });
});

function makeTrack(id: string, order: number): TimelineTrack {
  return {
    id,
    name: id,
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  };
}

describe('aiCaptionsToSegments', () => {
  it('returns [] for empty input', () => {
    expect(aiCaptionsToSegments([])).toEqual([]);
  });

  it('derives end from next caption start for all but the last', () => {
    const segments = aiCaptionsToSegments([
      { timeSec: 0, text: 'a' },
      { timeSec: 3, text: 'b' },
      { timeSec: 7, text: 'c' },
    ]);
    expect(segments).toEqual([
      { text: 'a', start: 0, end: 3 },
      { text: 'b', start: 3, end: 7 },
      { text: 'c', start: 7, end: 10 }, // 3s fallback for the tail
    ]);
  });

  it('uses provided sampleIntervalSec for the trailing caption', () => {
    const segments = aiCaptionsToSegments([{ timeSec: 0, text: 'only' }], 5);
    expect(segments).toEqual([{ text: 'only', start: 0, end: 5 }]);
  });

  it('sorts captions by timeSec before converting', () => {
    const segments = aiCaptionsToSegments([
      { timeSec: 5, text: 'b' },
      { timeSec: 0, text: 'a' },
    ]);
    expect(segments.map((s) => s.text)).toEqual(['a', 'b']);
  });
});

describe('buildCaptionTrackAbove', () => {
  it('places the caption track halfway between the reference and the next track up', () => {
    const tracks = [makeTrack('a', 0), makeTrack('b', 1), makeTrack('c', 2)];
    const captionTrack = buildCaptionTrackAbove(tracks, 2);
    expect(captionTrack.order).toBe(1.5);
  });

  it('places the track a full integer above when nothing sits higher', () => {
    const tracks = [makeTrack('a', 5)];
    const captionTrack = buildCaptionTrackAbove(tracks, 5);
    expect(captionTrack.order).toBe(4);
  });

  it('sorts visually higher than the reference clip track after insertion', () => {
    const tracks = [makeTrack('a', 0), makeTrack('clip', 1), makeTrack('b', 2)];
    const captionTrack = buildCaptionTrackAbove(tracks, 1);
    const sorted = [...tracks, captionTrack].sort((x, y) => x.order - y.order);
    const clipIndex = sorted.findIndex((t) => t.id === 'clip');
    const captionIndex = sorted.findIndex((t) => t.id === captionTrack.id);
    // CLAUDE.md convention: lower order = visually higher (top of timeline).
    expect(captionIndex).toBeLessThan(clipIndex);
  });

  it('creates a video-kind overlay track so the timeline renders it immediately', () => {
    const tracks = [makeTrack('clip', 1)];
    const captionTrack = buildCaptionTrackAbove(tracks, 1);
    expect(captionTrack.kind).toBe('video');
    expect(getTrackKind(captionTrack)).toBe('video');
    expect(captionTrack.name).toBe('V1');
  });
});

describe('buildCaptionTrack (append-to-bottom helper)', () => {
  it('still creates tracks at maxOrder + 1', () => {
    const tracks = [
      { ...makeTrack('a', 0), name: 'V1', kind: 'video' as const },
      { ...makeTrack('b', 1), name: 'A1', kind: 'audio' as const },
      { ...makeTrack('c', 2), name: 'V2', kind: 'video' as const },
    ];
    const captionTrack = buildCaptionTrack(tracks);
    expect(captionTrack.order).toBe(3);
    expect(captionTrack.kind).toBe('video');
    expect(captionTrack.name).toBe('V3');
  });
});
