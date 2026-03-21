/**
 * Constants and pure utility functions for VideoPreview.
 * Extracted from video-preview.tsx to reduce file size.
 */

// Preload media files ahead of the playhead to reduce buffering
export const PRELOAD_AHEAD_SECONDS = 5;
export const PRELOAD_MAX_IDS_PER_TICK_PLAYING = 10;
export const PRELOAD_MAX_IDS_PER_TICK_IDLE = 6;
export const PRELOAD_MAX_IDS_PER_TICK_SCRUB = 3;
export const PRELOAD_SCAN_TIME_BUDGET_MS = 6;
export const PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS = 1.0;
export const PRELOAD_BURST_EXTRA_IDS = 4;
export const PRELOAD_BACKWARD_SCRUB_EXTRA_IDS = 1;
export const PRELOAD_FORWARD_SCRUB_THROTTLE_MS = 24;
export const PRELOAD_BACKWARD_SCRUB_THROTTLE_MS = 48;
export const PRELOAD_SKIP_ON_BACKWARD_SCRUB = true;
export const PRELOAD_BURST_MAX_IDS_PER_TICK = 12;
export const PRELOAD_BURST_PASSES = 3;
export const FAST_SCRUB_RENDERER_ENABLED = true;
export const FAST_SCRUB_PRELOAD_BUDGET_MS = 180;
export const FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS = 0.5;
export const FAST_SCRUB_MAX_PREWARM_FRAMES = 256;
export const FAST_SCRUB_MAX_PREWARM_SOURCES = 96;
export const FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS = 1.0;
export const FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME = 2;
export const FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME = 2;
export const FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME = 6;
export const FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES = 6;
export const FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD = true;
export const FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD = true;
export const FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS = 3;
export const FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS = 2;
export const FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS = 0;
export const FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS = 1;
export const FAST_SCRUB_PREWARM_QUEUE_MAX = 24;
export const FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS = 24;
export const FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES = 2;
export const FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES = 8;
export const FAST_SCRUB_PREWARM_RENDER_BUDGET_MS = 16;
export const FAST_SCRUB_HANDOFF_TIMEOUT_MS = 200;

export const PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS = 20;
export const PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES = 2;
export const PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES = 8;
export const SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS = 8;
export const SOURCE_WARM_SCRUB_WINDOW_SECONDS = 3;
export const SOURCE_WARM_MAX_SOURCES = 20;
export const SOURCE_WARM_HARD_CAP_SOURCES = 24;
export const SOURCE_WARM_HARD_CAP_ELEMENTS = 40;
export const SOURCE_WARM_MIN_SOURCES = 4;
export const SOURCE_WARM_STICKY_MS = 2500;
export const SOURCE_WARM_TICK_MS = 300;
export const RESOLVE_RETRY_MIN_MS = 400;
export const RESOLVE_RETRY_MAX_MS = 8000;
export const RESOLVE_MAX_CONCURRENCY = 6;
export const RESOLVE_MAX_IDS_PER_PASS_PLAYING = 12;
export const RESOLVE_MAX_IDS_PER_PASS_IDLE = 8;
export const RESOLVE_MAX_IDS_PER_PASS_SCRUB = 4;
export const RESOLVE_DEFER_DURING_SCRUB_MS = 120;
export const PREVIEW_PERF_PUBLISH_INTERVAL_MS = 750;
export const PREVIEW_PERF_PANEL_STORAGE_KEY = 'freecut.preview.perf-panel';
export const PREVIEW_PERF_PANEL_QUERY_KEY = 'previewPerfPanel';
export const PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX = 6;
export const PREVIEW_PERF_SEEK_TIMEOUT_MS = 2500;
export const ADAPTIVE_PREVIEW_QUALITY_ENABLED = true;

import type { PreviewRenderSource } from './preview-perf-metrics';

export type VideoSourceSpan = { src: string; startFrame: number; endFrame: number };
export type FastScrubBoundarySource = { frame: number; srcs: string[] };
export type PreviewPerfSnapshot = {
  ts: number;
  unresolvedQueue: number;
  pendingResolves: number;
  renderSource: PreviewRenderSource;
  renderSourceSwitches: number;
  renderSourceHistory: import('./preview-perf-metrics').RenderSourceSwitchEntry[];
  resolveAvgMs: number;
  resolveMsPerId: number;
  resolveLastMs: number;
  resolveLastIds: number;
  preloadScanAvgMs: number;
  preloadScanLastMs: number;
  preloadBatchAvgMs: number;
  preloadBatchLastMs: number;
  preloadBatchLastIds: number;
  preloadCandidateIds: number;
  preloadBudgetBase: number;
  preloadBudgetAdjusted: number;
  preloadWindowMaxCost: number;
  preloadScanBudgetYields: number;
  preloadContinuations: number;
  preloadScrubDirection: -1 | 0 | 1;
  preloadDirectionPenaltyCount: number;
  sourceWarmTarget: number;
  sourceWarmKeep: number;
  sourceWarmEvictions: number;
  sourcePoolSources: number;
  sourcePoolElements: number;
  sourcePoolActiveClips: number;
  fastScrubPrewarmedSources: number;
  fastScrubPrewarmSourceEvictions: number;
  staleScrubOverlayDrops: number;
  scrubDroppedFrames: number;
  scrubUpdates: number;
  seekLatencyAvgMs: number;
  seekLatencyLastMs: number;
  seekLatencyPendingMs: number;
  seekLatencyTimeouts: number;
  userPreviewQuality: import('@/shared/state/playback').PreviewQuality;
  adaptiveQualityCap: import('@/shared/state/playback').PreviewQuality;
  effectivePreviewQuality: import('@/shared/state/playback').PreviewQuality;
  frameTimeBudgetMs: number;
  frameTimeEmaMs: number;
  adaptiveQualityDowngrades: number;
  adaptiveQualityRecovers: number;
  transitionSessionActive: boolean;
  transitionSessionMode: 'none' | 'dom' | 'render';
  transitionSessionComplex: boolean;
  transitionSessionStartFrame: number;
  transitionSessionEndFrame: number;
  transitionBufferedFrames: number;
  transitionPreparedFrame: number;
  transitionLastPrepareMs: number;
  transitionLastReadyLeadMs: number;
  transitionLastEntryMisses: number;
  transitionLastSessionDurationMs: number;
  transitionSessionCount: number;
};

declare global {
  interface Window {
    __PREVIEW_PERF__?: PreviewPerfSnapshot;
    __PREVIEW_PERF_LOG__?: boolean;
    __PREVIEW_PERF_PANEL__?: boolean;
    __PREVIEW_TRANSITIONS__?: Array<Record<string, unknown>>;
  }
}

import type { PreviewInteractionMode } from './preview-interaction-mode';
import type { CompositionInputProps } from '@/types/export';

export function toTrackFingerprint(tracks: CompositionInputProps['tracks']): string {
  const parts: string[] = [];
  for (const track of tracks) {
    parts.push(
      `t:${track.id}:${track.order}:${track.visible ? 1 : 0}:${track.solo ? 1 : 0}:${track.muted ? 1 : 0}`
    );
    for (const item of track.items) {
      const src = 'src' in item ? (item.src ?? '') : '';
      parts.push(
        `i:${item.id}:${item.type}:${item.from}:${item.durationInFrames}:${item.mediaId ?? ''}:${src}:${item.speed ?? 1}:${item.volume ?? 1}:${item.sourceStart ?? 0}:${item.sourceEnd ?? 0}`
      );
    }
  }
  return parts.join('|');
}

export function getPreloadBudget(mode: PreviewInteractionMode): number {
  if (mode === 'scrubbing') return PRELOAD_MAX_IDS_PER_TICK_SCRUB;
  if (mode === 'playing') return PRELOAD_MAX_IDS_PER_TICK_PLAYING;
  return PRELOAD_MAX_IDS_PER_TICK_IDLE;
}

export function getResolvePassBudget(mode: PreviewInteractionMode): number {
  if (mode === 'scrubbing') return RESOLVE_MAX_IDS_PER_PASS_SCRUB;
  if (mode === 'playing') return RESOLVE_MAX_IDS_PER_PASS_PLAYING;
  return RESOLVE_MAX_IDS_PER_PASS_IDLE;
}

export function getCodecCost(codec: string | undefined): number {
  if (!codec) return 0;
  const normalized = codec.toLowerCase();
  if (normalized.includes('ec-3') || normalized.includes('eac3') || normalized.includes('ac-3') || normalized.includes('ac3')) {
    return 5;
  }
  if (normalized.includes('avc') || normalized.includes('h264')) {
    return 2;
  }
  if (normalized.includes('hevc') || normalized.includes('h265')) {
    return 3;
  }
  return 1;
}

export function getMediaResolveCost(media: {
  mimeType: string;
  width: number;
  height: number;
  codec?: string;
  audioCodec?: string;
} | undefined): number {
  if (!media) return 1;

  let cost = 1;
  if (media.mimeType.startsWith('video/')) {
    const pixels = Math.max(0, media.width) * Math.max(0, media.height);
    if (pixels >= 3840 * 2160) {
      cost += 6;
    } else if (pixels >= 2560 * 1440) {
      cost += 4;
    } else if (pixels >= 1920 * 1080) {
      cost += 3;
    } else if (pixels >= 1280 * 720) {
      cost += 2;
    }
    cost += getCodecCost(media.codec);
    cost += getCodecCost(media.audioCodec);
  } else if (media.mimeType.startsWith('audio/')) {
    cost += getCodecCost(media.audioCodec);
  }

  return Math.max(1, cost);
}

export function getCostAdjustedBudget(baseBudget: number, maxWindowCost: number): number {
  if (maxWindowCost >= 10) {
    return Math.max(1, baseBudget - 5);
  }
  if (maxWindowCost >= 7) {
    return Math.max(1, baseBudget - 3);
  }
  if (maxWindowCost >= 4) {
    return Math.max(1, baseBudget - 1);
  }
  return baseBudget;
}

export function getDirectionalScrubStartIndex(
  items: Array<{ from: number; durationInFrames: number }>,
  anchorFrame: number,
  scrubDirection: -1 | 0 | 1
): number {
  if (items.length === 0) return -1;

  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid]!.from < anchorFrame) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const lowerBound = lo;
  if (scrubDirection < 0) {
    let index = lowerBound;
    if (index >= items.length) {
      index = items.length - 1;
    } else if (items[index]!.from > anchorFrame && index > 0) {
      index -= 1;
    }
    return index;
  }

  return Math.max(0, lowerBound - 1);
}

export function getFrameDirection(previousFrame: number, nextFrame: number): -1 | 0 | 1 {
  if (nextFrame > previousFrame) return 1;
  if (nextFrame < previousFrame) return -1;
  return 0;
}

export function parsePreviewPerfPanelQuery(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return true;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Invalid data URL result'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
