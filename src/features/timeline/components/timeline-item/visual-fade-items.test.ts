import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import { supportsVisualFadeControls } from './visual-fade-items';

describe('supportsVisualFadeControls', () => {
  it('returns true for video and compound video segments', () => {
    const videoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-video',
      label: 'Video clip',
      from: 0,
      durationInFrames: 120,
      mediaId: 'media-1',
    } as TimelineItem;
    const compositionItem = {
      id: 'comp-1',
      type: 'composition',
      trackId: 'track-video',
      label: 'Compound clip',
      from: 0,
      durationInFrames: 120,
      compositionId: 'composition-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    } as TimelineItem;

    expect(supportsVisualFadeControls(videoItem)).toBe(true);
    expect(supportsVisualFadeControls(compositionItem)).toBe(true);
  });

  it('keeps audio wrappers out of the visual fade control path', () => {
    const compositionAudioWrapper = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-audio',
      label: 'Compound audio',
      from: 0,
      durationInFrames: 120,
      compositionId: 'composition-1',
      mediaId: 'media-1',
    } as TimelineItem;

    expect(supportsVisualFadeControls(compositionAudioWrapper)).toBe(false);
  });
});
