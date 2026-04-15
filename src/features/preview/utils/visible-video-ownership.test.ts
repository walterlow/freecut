import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import { hasVisibleVideoAtFrame } from './visible-video-ownership';

describe('hasVisibleVideoAtFrame', () => {
  it('returns true when a visible track contains a video covering the frame', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'clip-1',
            type: 'video',
            trackId: 'track-video',
            from: 10,
            durationInFrames: 20,
            src: 'blob:clip-1',
            label: 'Clip 1',
          },
        ],
      },
    ];

    expect(hasVisibleVideoAtFrame(tracks, 15)).toBe(true);
  });

  it('returns false for hidden tracks', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: false,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'clip-1',
            type: 'video',
            trackId: 'track-video',
            from: 10,
            durationInFrames: 20,
            src: 'blob:clip-1',
            label: 'Clip 1',
          },
        ],
      },
    ];

    expect(hasVisibleVideoAtFrame(tracks, 15)).toBe(false);
  });

  it('returns false when only non-video items cover the frame', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-text',
        name: 'Text',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-text',
            from: 10,
            durationInFrames: 20,
            label: 'Text 1',
            text: 'hello',
            color: '#ffffff',
          },
        ],
      },
    ];

    expect(hasVisibleVideoAtFrame(tracks, 15)).toBe(false);
  });

  it('treats the end frame as exclusive', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-video',
        name: 'Video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'clip-1',
            type: 'video',
            trackId: 'track-video',
            from: 10,
            durationInFrames: 20,
            src: 'blob:clip-1',
            label: 'Clip 1',
          },
        ],
      },
    ];

    expect(hasVisibleVideoAtFrame(tracks, 29)).toBe(true);
    expect(hasVisibleVideoAtFrame(tracks, 30)).toBe(false);
  });
});
