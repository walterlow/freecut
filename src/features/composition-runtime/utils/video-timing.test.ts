import { describe, expect, it } from 'vite-plus/test'
import {
  getVideoTargetTimeSeconds,
  getAudioTargetTimeSeconds,
  snapSourceTime,
} from './video-timing'

describe('video timing with shared Sequences', () => {
  it('produces identical target time for grouped and isolated split clips', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const playbackRate = 1
    const sourceStart = 3425
    const sequenceOffset = 4285

    const groupedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      sequenceOffset,
      playbackRate,
      timelineFps,
      sequenceOffset,
    )

    const isolatedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      0,
      playbackRate,
      timelineFps,
      0,
    )

    expect(groupedTime).toBeCloseTo(isolatedTime, 8)
  })
})

describe('audio-video sync for non-native FPS sources', () => {
  // Regression: video audio segments did not pass sourceFps to audio components,
  // so audio interpreted trimBefore (in source FPS frames) using timeline FPS.
  // For a 23.981fps source at sourceStart=2666 on a 30fps timeline, this caused
  // audio to seek to 88.87s instead of 111.17s — a ~22s desync.

  it('audio and video seek to the same start position for 23.981fps source', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666 // source frames at 23.981fps
    const playbackRate = 1.502
    const frame = 0 // start of clip

    const videoSeek = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )
    const audioSeek = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )

    expect(videoSeek).toBeCloseTo(audioSeek, 10)
    // Both should seek to ~111.17s (2666 / 23.981)
    expect(videoSeek).toBeCloseTo(111.17, 1)
  })

  it('audio and video seek to the same end position for 23.981fps source', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const durationInFrames = 1785

    const videoEnd = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      durationInFrames,
      playbackRate,
      timelineFps,
    )
    const audioEnd = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      durationInFrames,
      playbackRate,
      timelineFps,
    )

    expect(videoEnd).toBeCloseTo(audioEnd, 10)
    // Both should reach ~200.54s
    expect(videoEnd).toBeCloseTo(200.54, 0)
  })

  it('audio and video stay in sync at every frame for mismatched FPS', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const durationInFrames = 1785

    // Check sync at multiple points throughout the clip
    for (const frame of [0, 1, 100, 500, 1000, 1784, durationInFrames]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )

      expect(videoTime).toBeCloseTo(audioTime, 10)
    }
  })

  it('using wrong FPS for trimBefore causes desync (documents the bug)', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const frame = 0

    const correctSeek = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )

    // Bug: using timelineFps instead of sourceFps for trimBefore conversion
    const buggySeek = getAudioTargetTimeSeconds(
      sourceStart,
      timelineFps,
      frame,
      playbackRate,
      timelineFps,
    )

    // The buggy seek starts ~22 seconds too early
    expect(correctSeek).toBeCloseTo(111.17, 1)
    expect(buggySeek).toBeCloseTo(88.87, 1)
    expect(Math.abs(correctSeek - buggySeek)).toBeGreaterThan(20)
  })

  it('sync holds for various source FPS values', () => {
    const timelineFps = 30
    const sourceStart = 1000
    const playbackRate = 2
    const frame = 500

    // Test common non-30fps formats
    for (const sourceFps of [23.976, 23.981, 24, 25, 29.97, 48, 50, 59.94, 60]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )

      expect(videoTime).toBeCloseTo(audioTime, 10)

      // Start position should use source FPS, not timeline FPS
      const expectedStart = sourceStart / sourceFps
      const atFrameZero = getAudioTargetTimeSeconds(
        sourceStart,
        sourceFps,
        0,
        playbackRate,
        timelineFps,
      )
      expect(atFrameZero).toBeCloseTo(expectedStart, 4)
    }
  })

  it('sync holds when sourceFps equals timelineFps (no conversion needed)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 2666
    const playbackRate = 1.5
    const durationInFrames = 1785

    for (const frame of [0, 100, durationInFrames]) {
      const videoTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )
      const audioTime = getAudioTargetTimeSeconds(
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      )
      expect(videoTime).toBeCloseTo(audioTime, 10)
    }
  })
})

describe('snapSourceTime floating-point regression', () => {
  it('maps consecutive timeline frames to consecutive source frames (sourceStart=439, fps=30)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 439
    const clipFrom = 11260

    // Check 10 consecutive frames around a transition exit boundary
    for (let frame = clipFrom; frame < clipFrom + 50; frame++) {
      const localFrame = frame - clipFrom
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      const sourceFrame = Math.floor(sourceTime * sourceFps)
      const expectedSourceFrame = sourceStart + localFrame
      expect(sourceFrame).toBe(expectedSourceFrame)
    }
  })

  it('maps consecutive timeline frames to consecutive source frames (sourceStart=2128, fps=30)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 2128
    const clipFrom = 12806

    for (let frame = clipFrom; frame < clipFrom + 50; frame++) {
      const localFrame = frame - clipFrom
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      const sourceFrame = Math.floor(sourceTime * sourceFps)
      const expectedSourceFrame = sourceStart + localFrame
      expect(sourceFrame).toBe(expectedSourceFrame)
    }
  })

  it('never skips or duplicates source frames for mismatched FPS', () => {
    const timelineFps = 30
    const sourceFps = 23.976
    const sourceStart = 1000

    // Get first source frame to initialize
    const firstSourceTime = getVideoTargetTimeSeconds(sourceStart, sourceFps, 0, 1, timelineFps)
    let prevSourceFrame = Math.floor(firstSourceTime * sourceFps)

    for (let localFrame = 1; localFrame < 200; localFrame++) {
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      const sourceFrame = Math.floor(sourceTime * sourceFps)

      // Source frame should never go backward
      expect(sourceFrame).toBeGreaterThanOrEqual(prevSourceFrame)

      // When source frame advances, it should advance by exactly 1
      // (for 1x speed with sourceFps < timelineFps, some frames repeat but none skip)
      if (sourceFrame > prevSourceFrame) {
        expect(sourceFrame - prevSourceFrame).toBe(1)
      }

      prevSourceFrame = sourceFrame
    }
  })

  it('never skips source frames for same-FPS clips at various sourceStart values', () => {
    const fps = 30

    // Test sourceStart values that are known to cause floating-point issues
    // (values where sourceStart/fps produces repeating decimals)
    for (const sourceStart of [
      1, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 100, 439, 997, 1234, 2128, 3333, 9999,
    ]) {
      for (let localFrame = 0; localFrame < 100; localFrame++) {
        const sourceTime = getVideoTargetTimeSeconds(sourceStart, fps, localFrame, 1, fps)
        const sourceFrame = Math.floor(sourceTime * fps)
        const expected = sourceStart + localFrame
        expect(sourceFrame).toBe(expected)
      }
    }
  })

  it('snapSourceTime corrects near-integer floating-point results', () => {
    // 439/30 + 44/30 = 16.1 but floating point gives 16.099999999999998
    // 16.099999999999998 * 30 = 482.99999999999994 → Math.floor = 482 (WRONG, should be 483)
    const rawTime = 439 / 30 + 44 / 30 // ~16.099999999999998
    const snapped = snapSourceTime(rawTime, 30)
    expect(Math.floor(snapped * 30)).toBe(483) // correct
    expect(Math.floor(rawTime * 30)).toBe(482) // would be wrong without snap
  })

  it('snapSourceTime preserves genuinely fractional times', () => {
    // A time that genuinely falls mid-frame should not be snapped
    const midFrameTime = 10.5 / 30 // exactly between frames 10 and 11
    const snapped = snapSourceTime(midFrameTime, 30)
    expect(snapped).toBe(midFrameTime)
  })

  it('snapSourceTime preserves times for mismatched FPS ratios', () => {
    // 23.976fps source on 30fps timeline: many frames land between source frames
    const sourceFps = 23.976
    const timelineFps = 30
    const sourceStart = 1000
    for (let localFrame = 0; localFrame < 50; localFrame++) {
      const rawTime = sourceStart / sourceFps + localFrame / timelineFps
      const snapped = snapSourceTime(rawTime, sourceFps)
      // For genuinely inter-frame times, snap should not alter the result
      const rawSourceFrame = rawTime * sourceFps
      const fracPart = rawSourceFrame - Math.floor(rawSourceFrame)
      if (fracPart > 0.001 && fracPart < 0.999) {
        expect(snapped).toBe(rawTime)
      }
    }
  })
})
