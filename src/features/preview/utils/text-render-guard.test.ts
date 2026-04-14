import { describe, expect, it } from 'vitest';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineTrack } from '@/types/timeline';
import { shouldPreferPlayerForStyledTextScrub } from './text-render-guard';

const BASE_TRACK: TimelineTrack = {
  id: 'track-1',
  name: 'Track 1',
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
};

describe('shouldPreferPlayerForStyledTextScrub', () => {
  it('returns true for visible glow text with animation', () => {
    const tracks: TimelineTrack[] = [
      {
        ...BASE_TRACK,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            label: 'Glow text',
            text: 'Glow',
            color: '#ffffff',
            textShadow: {
              offsetX: 0,
              offsetY: 0,
              blur: 18,
              color: '#00ffff',
            },
          },
        ],
      },
    ];
    const keyframes: ItemKeyframes[] = [
      {
        itemId: 'text-1',
        properties: [
          {
            property: 'opacity',
            keyframes: [
              { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-2', frame: 12, value: 1, easing: 'linear' },
            ],
          },
        ],
      },
    ];

    expect(shouldPreferPlayerForStyledTextScrub(tracks, keyframes)).toBe(true);
  });

  it('returns false for styled text without animation', () => {
    const tracks: TimelineTrack[] = [
      {
        ...BASE_TRACK,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            label: 'Glow text',
            text: 'Glow',
            color: '#ffffff',
            textShadow: {
              offsetX: 0,
              offsetY: 0,
              blur: 18,
              color: '#00ffff',
            },
          },
        ],
      },
    ];

    expect(shouldPreferPlayerForStyledTextScrub(tracks, [])).toBe(false);
  });

  it('ignores hidden tracks', () => {
    const tracks: TimelineTrack[] = [
      {
        ...BASE_TRACK,
        visible: false,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            label: 'Glow text',
            text: 'Glow',
            color: '#ffffff',
            textShadow: {
              offsetX: 0,
              offsetY: 0,
              blur: 18,
              color: '#00ffff',
            },
          },
        ],
      },
    ];
    const keyframes: ItemKeyframes[] = [
      {
        itemId: 'text-1',
        properties: [
          {
            property: 'opacity',
            keyframes: [
              { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-2', frame: 12, value: 1, easing: 'linear' },
            ],
          },
        ],
      },
    ];

    expect(shouldPreferPlayerForStyledTextScrub(tracks, keyframes)).toBe(false);
  });
});
