import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import type { SubComposition } from '../deps/timeline-contract';
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

  it('detects visible video inside a compound clip while paused', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-comp',
        name: 'Compound',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'compound-1',
            type: 'composition',
            compositionId: 'compound-a',
            compositionWidth: 1920,
            compositionHeight: 1080,
            trackId: 'track-comp',
            from: 10,
            durationInFrames: 20,
            sourceStart: 5,
            label: 'Compound 1',
          },
        ],
      },
    ];
    const compositionById: Record<string, SubComposition> = {
      'compound-a': {
        id: 'compound-a',
        name: 'Compound A',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
        items: [
          {
            id: 'nested-video',
            type: 'video',
            trackId: 'nested-track',
            from: 12,
            durationInFrames: 20,
            src: 'blob:nested-video',
            label: 'Nested Video',
          },
        ],
        tracks: [
          {
            id: 'nested-track',
            name: 'Nested Track',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [
              {
                id: 'nested-video',
                type: 'video',
                trackId: 'nested-track',
                from: 12,
                durationInFrames: 20,
                src: 'blob:nested-video',
                label: 'Nested Video',
              },
            ],
          },
        ],
        transitions: [],
        keyframes: [],
      },
    };

    expect(hasVisibleVideoAtFrame(tracks, 18, { compositionById, fps: 30 })).toBe(true);
  });

  it('recurses through nested compound clips', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-comp',
        name: 'Compound',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'compound-root',
            type: 'composition',
            compositionId: 'compound-root',
            compositionWidth: 1920,
            compositionHeight: 1080,
            trackId: 'track-comp',
            from: 0,
            durationInFrames: 30,
            label: 'Root Compound',
          },
        ],
      },
    ];
    const compositionById: Record<string, SubComposition> = {
      'compound-root': {
        id: 'compound-root',
        name: 'Root Compound',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
        items: [
          {
            id: 'compound-child',
            type: 'composition',
            compositionId: 'compound-child',
            compositionWidth: 1920,
            compositionHeight: 1080,
            trackId: 'root-track',
            from: 4,
            durationInFrames: 20,
            label: 'Child Compound',
          },
        ],
        tracks: [
          {
            id: 'root-track',
            name: 'Root Track',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [
              {
                id: 'compound-child',
                type: 'composition',
                compositionId: 'compound-child',
                compositionWidth: 1920,
                compositionHeight: 1080,
                trackId: 'root-track',
                from: 4,
                durationInFrames: 20,
                label: 'Child Compound',
              },
            ],
          },
        ],
        transitions: [],
        keyframes: [],
      },
      'compound-child': {
        id: 'compound-child',
        name: 'Child Compound',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
        items: [
          {
            id: 'nested-video',
            type: 'video',
            trackId: 'child-track',
            from: 8,
            durationInFrames: 10,
            src: 'blob:child-video',
            label: 'Nested Video',
          },
        ],
        tracks: [
          {
            id: 'child-track',
            name: 'Child Track',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [
              {
                id: 'nested-video',
                type: 'video',
                trackId: 'child-track',
                from: 8,
                durationInFrames: 10,
                src: 'blob:child-video',
                label: 'Nested Video',
              },
            ],
          },
        ],
        transitions: [],
        keyframes: [],
      },
    };

    expect(hasVisibleVideoAtFrame(tracks, 12, { compositionById, fps: 30 })).toBe(true);
  });
});
