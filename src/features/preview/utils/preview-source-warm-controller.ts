import {
  SOURCE_WARM_HARD_CAP_ELEMENTS,
  SOURCE_WARM_HARD_CAP_SOURCES,
  SOURCE_WARM_MAX_SOURCES,
  SOURCE_WARM_MIN_SOURCES,
  SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS,
  SOURCE_WARM_SCRUB_WINDOW_SECONDS,
  SOURCE_WARM_STICKY_MS,
  type VideoSourceSpan,
} from './preview-constants';
import {
  getPreviewInteractionMode,
  type PreviewInteractionMode,
} from './preview-interaction-mode';
import { collectSourceWarmCandidateScores } from './preview-media-schedule';
import { getSourceWarmTarget, resolveSourceWarmSet } from './source-warm-target';

export interface PreviewSourceWarmPlanInput {
  playback: {
    currentFrame: number;
    previewFrame: number | null;
    isPlaying: boolean;
  };
  isGizmoInteracting: boolean;
  fps: number;
  poolStats: {
    sourceCount: number;
    totalElements: number;
  };
  playbackVideoSourceSpans: VideoSourceSpan[];
  scrubVideoSourceSpans: VideoSourceSpan[];
  recentTouches: Map<string, number>;
  nowMs: number;
}

export interface PreviewSourceWarmPlan {
  interactionMode: PreviewInteractionMode;
  warmTarget: number;
  selectedSources: string[];
  keepWarm: Set<string>;
  nextRecentTouches: Map<string, number>;
  evictions: number;
}

export function resolvePreviewSourceWarmPlan(
  input: PreviewSourceWarmPlanInput,
): PreviewSourceWarmPlan {
  const interactionMode = getPreviewInteractionMode({
    isPlaying: input.playback.isPlaying,
    previewFrame: input.playback.previewFrame,
    isGizmoInteracting: input.isGizmoInteracting,
  });
  const warmTarget = getSourceWarmTarget({
    mode: interactionMode,
    currentPoolSourceCount: input.poolStats.sourceCount,
    currentPoolElementCount: input.poolStats.totalElements,
    maxSources: SOURCE_WARM_MAX_SOURCES,
    minSources: SOURCE_WARM_MIN_SOURCES,
    hardCapSources: SOURCE_WARM_HARD_CAP_SOURCES,
    hardCapElements: SOURCE_WARM_HARD_CAP_ELEMENTS,
  });
  const playheadWindowFrames = Math.max(12, Math.round(input.fps * SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS));
  const scrubWindowFrames = Math.max(8, Math.round(input.fps * SOURCE_WARM_SCRUB_WINDOW_SECONDS));
  const candidateScores = collectSourceWarmCandidateScores([
    {
      spans: input.playbackVideoSourceSpans,
      anchorFrame: input.playback.currentFrame,
      windowFrames: playheadWindowFrames,
      baseScore: 100,
    },
    ...(interactionMode === 'scrubbing' && input.playback.previewFrame !== null
      ? [{
        spans: input.scrubVideoSourceSpans,
        anchorFrame: input.playback.previewFrame,
        windowFrames: scrubWindowFrames,
        baseScore: 0,
      }]
      : []),
  ]);
  const warmSelection = resolveSourceWarmSet({
    candidateScores,
    warmTarget,
    recentTouches: input.recentTouches,
    nowMs: input.nowMs,
    stickyMs: SOURCE_WARM_STICKY_MS,
    hardCapSources: SOURCE_WARM_HARD_CAP_SOURCES,
  });

  return {
    interactionMode,
    warmTarget,
    ...warmSelection,
  };
}
