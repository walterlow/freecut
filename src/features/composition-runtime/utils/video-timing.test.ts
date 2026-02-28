import { describe, expect, it } from 'vitest';
import { getVideoTargetTimeSeconds, getAudioTargetTimeSeconds } from './video-timing';

describe('video timing with shared Sequences', () => {
  it('produces identical target time for grouped and isolated split clips', () => {
    const timelineFps = 30;
    const sourceFps = 23.981;
    const playbackRate = 1;
    const sourceStart = 3425;
    const sequenceOffset = 4285;

    const groupedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      sequenceOffset,
      playbackRate,
      timelineFps,
      sequenceOffset
    );

    const isolatedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      0,
      playbackRate,
      timelineFps,
      0
    );

    expect(groupedTime).toBeCloseTo(isolatedTime, 8);
  });
});

describe('audio-video sync for non-native FPS sources', () => {
  // Regression: video audio segments did not pass sourceFps to audio components,
  // so audio interpreted trimBefore (in source FPS frames) using timeline FPS.
  // For a 23.981fps source at sourceStart=2666 on a 30fps timeline, this caused
  // audio to seek to 88.87s instead of 111.17s — a ~22s desync.

  it('audio and video seek to the same start position for 23.981fps source', () => {
    const timelineFps = 30;
    const sourceFps = 23.981;
    const sourceStart = 2666; // source frames at 23.981fps
    const playbackRate = 1.502;
    const frame = 0; // start of clip

    const videoSeek = getVideoTargetTimeSeconds(
      sourceStart, sourceFps, frame, playbackRate, timelineFps
    );
    const audioSeek = getAudioTargetTimeSeconds(
      sourceStart, sourceFps, frame, playbackRate, timelineFps
    );

    expect(videoSeek).toBeCloseTo(audioSeek, 10);
    // Both should seek to ~111.17s (2666 / 23.981)
    expect(videoSeek).toBeCloseTo(111.17, 1);
  });

  it('audio and video seek to the same end position for 23.981fps source', () => {
    const timelineFps = 30;
    const sourceFps = 23.981;
    const sourceStart = 2666;
    const playbackRate = 1.502;
    const durationInFrames = 1785;

    const videoEnd = getVideoTargetTimeSeconds(
      sourceStart, sourceFps, durationInFrames, playbackRate, timelineFps
    );
    const audioEnd = getAudioTargetTimeSeconds(
      sourceStart, sourceFps, durationInFrames, playbackRate, timelineFps
    );

    expect(videoEnd).toBeCloseTo(audioEnd, 10);
    // Both should reach ~200.54s
    expect(videoEnd).toBeCloseTo(200.54, 0);
  });

  it('audio and video stay in sync at every frame for mismatched FPS', () => {
    const timelineFps = 30;
    const sourceFps = 23.981;
    const sourceStart = 2666;
    const playbackRate = 1.502;
    const durationInFrames = 1785;

    // Check sync at multiple points throughout the clip
    for (const frame of [0, 1, 100, 500, 1000, 1784, durationInFrames]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );

      expect(videoTime).toBeCloseTo(audioTime, 10);
    }
  });

  it('using wrong FPS for trimBefore causes desync (documents the bug)', () => {
    const timelineFps = 30;
    const sourceFps = 23.981;
    const sourceStart = 2666;
    const playbackRate = 1.502;
    const frame = 0;

    const correctSeek = getAudioTargetTimeSeconds(
      sourceStart, sourceFps, frame, playbackRate, timelineFps
    );

    // Bug: using timelineFps instead of sourceFps for trimBefore conversion
    const buggySeek = getAudioTargetTimeSeconds(
      sourceStart, timelineFps, frame, playbackRate, timelineFps
    );

    // The buggy seek starts ~22 seconds too early
    expect(correctSeek).toBeCloseTo(111.17, 1);
    expect(buggySeek).toBeCloseTo(88.87, 1);
    expect(Math.abs(correctSeek - buggySeek)).toBeGreaterThan(20);
  });

  it('sync holds for various source FPS values', () => {
    const timelineFps = 30;
    const sourceStart = 1000;
    const playbackRate = 2;
    const frame = 500;

    // Test common non-30fps formats
    for (const sourceFps of [23.976, 23.981, 24, 25, 29.97, 48, 50, 59.94, 60]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );

      expect(videoTime).toBeCloseTo(audioTime, 10);

      // Start position should use source FPS, not timeline FPS
      const expectedStart = sourceStart / sourceFps;
      const atFrameZero = getAudioTargetTimeSeconds(
        sourceStart, sourceFps, 0, playbackRate, timelineFps
      );
      expect(atFrameZero).toBeCloseTo(expectedStart, 8);
    }
  });

  it('sync holds when sourceFps equals timelineFps (no conversion needed)', () => {
    const timelineFps = 30;
    const sourceFps = 30;
    const sourceStart = 2666;
    const playbackRate = 1.5;
    const durationInFrames = 1785;

    for (const frame of [0, 100, durationInFrames]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart, sourceFps, frame, playbackRate, timelineFps
      );
      expect(videoTime).toBeCloseTo(audioTime, 10);
    }
  });
});
