import { describe, expect, it } from 'vitest';
import { resolvePreviewSourceWarmPlan } from './preview-source-warm-controller';

describe('resolvePreviewSourceWarmPlan', () => {
  it('uses playback spans only while playing and applies pool pressure to the warm target', () => {
    const result = resolvePreviewSourceWarmPlan({
      playback: {
        currentFrame: 50,
        previewFrame: 100,
        isPlaying: true,
      },
      isGizmoInteracting: false,
      fps: 30,
      poolStats: {
        sourceCount: 28,
        totalElements: 45,
      },
      playbackVideoSourceSpans: [
        { src: 'blob:playhead', startFrame: 40, endFrame: 60 },
      ],
      scrubVideoSourceSpans: [
        { src: 'blob:scrub', startFrame: 90, endFrame: 110 },
      ],
      recentTouches: new Map(),
      nowMs: 1000,
    });

    expect(result.interactionMode).toBe('playing');
    expect(result.warmTarget).toBe(13);
    expect(result.selectedSources).toEqual(['blob:playhead']);
    expect([...result.keepWarm]).toEqual(['blob:playhead']);
  });

  it('prefers scrub-window spans and retains fresh sticky sources while scrubbing', () => {
    const result = resolvePreviewSourceWarmPlan({
      playback: {
        currentFrame: 40,
        previewFrame: 100,
        isPlaying: false,
      },
      isGizmoInteracting: false,
      fps: 30,
      poolStats: {
        sourceCount: 0,
        totalElements: 0,
      },
      playbackVideoSourceSpans: [
        { src: 'blob:playback', startFrame: 36, endFrame: 44 },
      ],
      scrubVideoSourceSpans: [
        { src: 'blob:scrub', startFrame: 96, endFrame: 104 },
      ],
      recentTouches: new Map([
        ['blob:sticky', 9500],
        ['blob:stale', 1000],
      ]),
      nowMs: 10_000,
    });

    expect(result.interactionMode).toBe('scrubbing');
    expect(result.selectedSources).toEqual(['blob:scrub', 'blob:playback']);
    expect([...result.keepWarm]).toEqual(['blob:scrub', 'blob:playback', 'blob:sticky']);
    expect([...result.nextRecentTouches.entries()]).toEqual([
      ['blob:sticky', 9500],
      ['blob:scrub', 10_000],
      ['blob:playback', 10_000],
    ]);
    expect(result.evictions).toBe(1);
  });
});
