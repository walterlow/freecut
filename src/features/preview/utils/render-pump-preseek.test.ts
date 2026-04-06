import { describe, expect, it } from 'vitest';
import type { TimelineTrack, VideoItem } from '@/types/timeline';
import {
  collectClipVideoSourceTimesBySrcForFrame,
  collectClipVideoSourceTimesBySrcForFrameRange,
  collectPlaybackStartVariableSpeedPreseekTargets,
  collectPlaybackStartVariableSpeedPrewarmItemIds,
  collectVisibleTrackVideoSourceTimesBySrc,
  getVideoItemSourceTimeSeconds,
} from './render-pump-preseek';

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    trackId: 'track-1',
    type: 'video',
    label: 'Video',
    src: 'clip-a.mp4',
    from: 10,
    durationInFrames: 30,
    sourceStart: 120,
    sourceFps: 60,
    speed: 2,
    ...overrides,
  };
}

function makeTrack(items: VideoItem[]): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  };
}

describe('render pump preseek helpers', () => {
  it('computes source time at a timeline frame', () => {
    const item = makeVideoItem({
      from: 10,
      sourceStart: 120,
      sourceFps: 60,
      speed: 2,
    });

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).toBeCloseTo(2.4);
  });

  it('requires explicit source fps when requested', () => {
    const item = makeVideoItem({ sourceFps: undefined });

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).not.toBeNull();
    expect(getVideoItemSourceTimeSeconds(item, 16, 30, {
      requireExplicitSourceFps: true,
    })).toBeNull();
  });

  it('groups visible video source times by src', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({ id: 'a', src: 'same.mp4', from: 0, durationInFrames: 20, speed: 1, sourceStart: 0, sourceFps: 30 }),
        makeVideoItem({ id: 'b', src: 'same.mp4', from: 0, durationInFrames: 20, speed: 1, sourceStart: 30, sourceFps: 30 }),
        makeVideoItem({ id: 'c', src: 'other.mp4', from: 30, durationInFrames: 20, speed: 1, sourceStart: 0, sourceFps: 30 }),
      ]),
    ];

    expect(
      collectVisibleTrackVideoSourceTimesBySrc(tracks, 10, 30),
    ).toEqual(new Map([
      ['same.mp4', [10 / 30, 40 / 30]],
    ]));
  });

  it('collects transition clip source times for a frame range', () => {
    const items = [
      makeVideoItem({ id: 'left', src: 'left.mp4', from: 40, durationInFrames: 20, sourceStart: 0, sourceFps: 30, speed: 1 }),
      makeVideoItem({ id: 'right', src: 'right.mp4', from: 40, durationInFrames: 20, sourceStart: 90, sourceFps: 30, speed: 1 }),
    ];

    expect(
      collectClipVideoSourceTimesBySrcForFrameRange(items, 40, 3, 30, {
        requireExplicitSourceFps: true,
      }),
    ).toEqual(new Map([
      ['left.mp4', [0, 1 / 30, 2 / 30]],
      ['right.mp4', [3, 3 + (1 / 30), 3 + (2 / 30)]],
    ]));
  });

  it('collects transition clip source times for a single frame', () => {
    const items = [
      makeVideoItem({ id: 'left', src: 'left.mp4', from: 40, durationInFrames: 20, sourceStart: 0, sourceFps: 30, speed: 1 }),
      makeVideoItem({ id: 'right', src: 'right.mp4', from: 40, durationInFrames: 20, sourceStart: 60, sourceFps: 30, speed: 1 }),
    ];

    expect(
      collectClipVideoSourceTimesBySrcForFrame(items, 41, 30, {
        requireExplicitSourceFps: true,
      }),
    ).toEqual(new Map([
      ['left.mp4', [1 / 30]],
      ['right.mp4', [(60 / 30) + (1 / 30)]],
    ]));
  });

  it('collects variable-speed playback-start prewarm ids and preseek targets', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({ id: 'start-near', from: 100, durationInFrames: 60, speed: 1.5, sourceStart: 0, sourceFps: 30, src: 'near.mp4' }),
        makeVideoItem({ id: 'already-running', from: 90, durationInFrames: 60, speed: 1.5, sourceStart: 0, sourceFps: 30, src: 'running.mp4' }),
        makeVideoItem({ id: 'normal-speed', from: 100, durationInFrames: 60, speed: 1, sourceStart: 0, sourceFps: 30, src: 'normal.mp4' }),
      ]),
    ];

    expect(
      collectPlaybackStartVariableSpeedPrewarmItemIds(tracks, 101),
    ).toEqual(['start-near']);

    expect(
      collectPlaybackStartVariableSpeedPreseekTargets(tracks, 101, 30, 90),
    ).toEqual([
      { src: 'near.mp4', time: 2.95 },
      { src: 'running.mp4', time: 2.95 },
    ]);
  });
});
