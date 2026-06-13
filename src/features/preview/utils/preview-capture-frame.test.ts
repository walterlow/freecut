import { describe, expect, it } from 'vitest'
import { resolvePreviewCaptureFrame } from './preview-capture-frame'

describe('resolvePreviewCaptureFrame', () => {
  it('uses live playback frame ahead of previewFrame while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: 42,
        isPlaying: true,
        livePlaybackFrame: 11,
      }),
    ).toBe(11)
  })

  it('uses the live playback frame while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: 11.6,
      }),
    ).toBe(12)
  })

  it('uses the store frame when the live player frame lags too far while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 30,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: 25,
      }),
    ).toBe(30)
  })

  it('uses the store frame when the live player frame is stale ahead while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 30,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: 80,
      }),
    ).toBe(30)
  })

  it('ignores a leftover scrub preview frame while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 30,
        previewFrame: 24,
        isPlaying: true,
        livePlaybackFrame: null,
      }),
    ).toBe(30)
  })

  it('falls back to currentFrame while paused', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: null,
        isPlaying: false,
        livePlaybackFrame: 80,
      }),
    ).toBe(10)
  })

  it('falls back to a normalized currentFrame when live playback is unavailable', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 7.4,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: null,
      }),
    ).toBe(7)
  })

  it('ignores non-finite live playback frames', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 12,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: Number.NaN,
      }),
    ).toBe(12)
  })
})
