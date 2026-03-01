import { describe, expect, it } from 'vitest';
import type { TimelineTrack, VideoItem } from '@/types/timeline';
import { convertTimelineToComposition } from './timeline-to-composition';

describe('convertTimelineToComposition IO marker conversion', () => {
  it('converts IO trims from timeline frames to source frames using source FPS', () => {
    const fps = 30;
    const sourceFps = 24;
    const inPoint = 100;
    const outPoint = 200;

    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    };

    const item: VideoItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 300,
      label: 'Video',
      src: 'blob:test',
      trimStart: 10,
      trimEnd: 5,
      sourceStart: 1000,
      sourceFps,
      speed: 1,
    };

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint
    );

    const exportedItem = composition.tracks[0]!.items[0] as VideoItem;

    // 100 timeline frames at 30fps = 3.333s => 80 source frames at 24fps
    expect(exportedItem.sourceStart).toBe(1080);
    expect(exportedItem.trimStart).toBe(90);
    expect(exportedItem.trimEnd).toBe(85);
    expect(exportedItem.offset).toBe(90);
    expect(exportedItem.durationInFrames).toBe(100);
    expect(composition.durationInFrames).toBe(100);
  });
});
