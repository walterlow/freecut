import { describe, expect, it } from 'vitest';
import type { CompositionItem, TextItem, VideoItem } from '@/types/timeline';
import { getAnimatedTransform } from './canvas-keyframes';

describe('canvas-keyframes text sizing', () => {
  it('expands text height to fit content during export', () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Text',
      text: 'line one\nline two\nline three\nline four',
      color: '#ffffff',
      fontSize: 48,
      lineHeight: 1.2,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      fontStyle: 'normal',
      transform: {
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        rotation: 0,
        opacity: 1,
      },
    };

    const transform = getAnimatedTransform(item, undefined, 0, {
      width: 1920,
      height: 1080,
      fps: 30,
    });

    expect(transform.height).toBeGreaterThan(80);
  });
});

describe('canvas-keyframes visual fades', () => {
  it('applies video fade in to export opacity', () => {
    const item: VideoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 90,
      label: 'Video',
      src: 'blob:test',
      fadeIn: 1,
      transform: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 0.8,
      },
    };

    const transform = getAnimatedTransform(item, undefined, 25, {
      width: 1920,
      height: 1080,
      fps: 30,
    });

    expect(transform.opacity).toBeCloseTo(0.4, 5);
  });

  it('applies overlapping compound clip fades to export opacity', () => {
    const item: CompositionItem = {
      id: 'composition-1',
      type: 'composition',
      compositionId: 'sub-comp-1',
      compositionWidth: 1280,
      compositionHeight: 720,
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Compound clip',
      fadeIn: 2,
      fadeOut: 2,
      transform: {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      },
    };

    const transform = getAnimatedTransform(item, undefined, 45, {
      width: 1920,
      height: 1080,
      fps: 30,
    });

    expect(transform.opacity).toBeCloseTo(0.75, 5);
  });
});
