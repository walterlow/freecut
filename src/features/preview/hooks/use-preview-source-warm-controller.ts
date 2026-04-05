import { useEffect } from 'react';
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool';
import { usePlaybackStore } from '@/shared/state/playback';
import { SOURCE_WARM_TICK_MS, type VideoSourceSpan } from '../utils/preview-constants';
import { resolvePreviewSourceWarmPlan } from '../utils/preview-source-warm-controller';

interface PreviewSourceWarmPerfStats {
  sourceWarmTarget: number;
  sourceWarmKeep: number;
  sourceWarmEvictions: number;
  sourcePoolSources: number;
  sourcePoolElements: number;
  sourcePoolActiveClips: number;
}

export interface UsePreviewSourceWarmControllerInput {
  resolvedUrlCount: number;
  fps: number;
  playbackVideoSourceSpans: VideoSourceSpan[];
  scrubVideoSourceSpans: VideoSourceSpan[];
  isGizmoInteractingRef: React.RefObject<boolean>;
  previewPerfRef: React.MutableRefObject<PreviewSourceWarmPerfStats>;
}

export function usePreviewSourceWarmController(
  input: UsePreviewSourceWarmControllerInput,
): void {
  useEffect(() => {
    const pool = getGlobalVideoSourcePool();
    if (input.resolvedUrlCount === 0) {
      pool.pruneUnused(new Set());
      const poolStats = pool.getStats();
      input.previewPerfRef.current.sourceWarmTarget = 0;
      input.previewPerfRef.current.sourceWarmKeep = 0;
      input.previewPerfRef.current.sourcePoolSources = poolStats.sourceCount;
      input.previewPerfRef.current.sourcePoolElements = poolStats.totalElements;
      input.previewPerfRef.current.sourcePoolActiveClips = poolStats.activeClips;
      return;
    }

    const recentTouches = new Map<string, number>();
    let rafId: number | null = null;

    const refreshWarmSet = () => {
      const now = performance.now();
      const playback = usePlaybackStore.getState();
      const poolStatsBefore = pool.getStats();
      const warmPlan = resolvePreviewSourceWarmPlan({
        playback,
        isGizmoInteracting: input.isGizmoInteractingRef.current === true,
        fps: input.fps,
        poolStats: poolStatsBefore,
        playbackVideoSourceSpans: input.playbackVideoSourceSpans,
        scrubVideoSourceSpans: input.scrubVideoSourceSpans,
        recentTouches,
        nowMs: now,
      });
      const {
        warmTarget,
        selectedSources,
        keepWarm,
        nextRecentTouches,
        evictions,
      } = warmPlan;

      for (const src of selectedSources) {
        pool.preloadSource(src).catch(() => {});
      }
      recentTouches.clear();
      for (const [src, touchedAt] of nextRecentTouches.entries()) {
        recentTouches.set(src, touchedAt);
      }

      pool.pruneUnused(keepWarm);
      const poolStatsAfter = pool.getStats();
      input.previewPerfRef.current.sourceWarmTarget = warmTarget;
      input.previewPerfRef.current.sourceWarmKeep = keepWarm.size;
      input.previewPerfRef.current.sourceWarmEvictions += evictions;
      input.previewPerfRef.current.sourcePoolSources = poolStatsAfter.sourceCount;
      input.previewPerfRef.current.sourcePoolElements = poolStatsAfter.totalElements;
      input.previewPerfRef.current.sourcePoolActiveClips = poolStatsAfter.activeClips;
    };

    refreshWarmSet();
    const intervalId = setInterval(refreshWarmSet, SOURCE_WARM_TICK_MS);
    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      if (
        state.currentFrame !== prev.currentFrame
        || state.previewFrame !== prev.previewFrame
        || state.isPlaying !== prev.isPlaying
      ) {
        // When playback starts, warm sources synchronously so video elements
        // start loading immediately - don't wait for the next animation frame.
        if (state.isPlaying && !prev.isPlaying) {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          refreshWarmSet();
        } else {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
          }
          rafId = requestAnimationFrame(() => {
            rafId = null;
            refreshWarmSet();
          });
        }
      }
    });

    return () => {
      unsubscribe();
      clearInterval(intervalId);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    input.resolvedUrlCount,
    input.fps,
    input.playbackVideoSourceSpans,
    input.scrubVideoSourceSpans,
    input.isGizmoInteractingRef,
    input.previewPerfRef,
  ]);
}
