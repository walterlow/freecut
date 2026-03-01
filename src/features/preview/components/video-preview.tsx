import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { Player, type PlayerRef } from '@/features/preview/deps/player-core';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  useTimelineStore,
  useItemsStore,
  useTransitionsStore,
  useTimelineSettingsStore,
  useMediaDependencyStore,
} from '@/features/preview/deps/timeline-store';
import { resolveEffectiveTrackStates } from '@/features/preview/deps/timeline-utils';
import {
  useRollingEditPreviewStore,
  useRippleEditPreviewStore,
  useSlipEditPreviewStore,
  useSlideEditPreviewStore,
} from '@/features/preview/deps/timeline-edit-preview';
import { useSelectionStore } from '@/shared/state/selection';
import { MainComposition } from '@/features/preview/deps/composition-runtime';
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver';
import { useMediaLibraryStore, proxyService } from '@/features/preview/deps/media-library';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool';
import { GizmoOverlay } from './gizmo-overlay';
import { RollingEditOverlay } from './rolling-edit-overlay';
import { RippleEditOverlay } from './ripple-edit-overlay';
import { SlipEditOverlay } from './slip-edit-overlay';
import { SlideEditOverlay } from './slide-edit-overlay';
import { useGizmoStore } from '../stores/gizmo-store';
import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem } from '@/types/timeline';
import type { ItemEffect } from '@/types/effects';
import type { ItemKeyframes } from '@/types/keyframe';
import { isMarqueeJustFinished } from '@/hooks/use-marquee-selection';
import { createCompositionRenderer } from '@/features/preview/deps/export';
import { shouldShowFastScrubOverlay } from '../utils/fast-scrub-overlay-guard';
import { getDirectionalPrewarmOffsets } from '../utils/fast-scrub-prewarm';
import {
  getPreviewAnchorFrame,
  getPreviewInteractionMode,
  type PreviewInteractionMode,
} from '../utils/preview-interaction-mode';
import { getPreloadWindowRange } from '../utils/preload-window';
import {
  resolvePreviewTransitionDecision,
} from '../utils/preview-state-coordinator';
import { getSourceWarmTarget } from '../utils/source-warm-target';
import {
  pushRenderSourceSwitchHistory,
  recordSeekLatency,
  recordSeekLatencyTimeout,
  type RenderSourceSwitchEntry,
  type SeekLatencyStats,
  type PreviewRenderSource,
} from '../utils/preview-perf-metrics';
import {
  createAdaptivePreviewQualityState,
  getEffectivePreviewQuality,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';

// Preload media files ahead of the playhead to reduce buffering
const PRELOAD_AHEAD_SECONDS = 5;
const PRELOAD_MAX_IDS_PER_TICK_PLAYING = 10;
const PRELOAD_MAX_IDS_PER_TICK_IDLE = 6;
const PRELOAD_MAX_IDS_PER_TICK_SCRUB = 3;
const PRELOAD_SCAN_TIME_BUDGET_MS = 6;
const PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS = 1.0;
const PRELOAD_BURST_EXTRA_IDS = 4;
const PRELOAD_BACKWARD_SCRUB_EXTRA_IDS = 1;
const PRELOAD_FORWARD_SCRUB_THROTTLE_MS = 24;
const PRELOAD_BACKWARD_SCRUB_THROTTLE_MS = 48;
const PRELOAD_SKIP_ON_BACKWARD_SCRUB = true;
const PRELOAD_BURST_MAX_IDS_PER_TICK = 12;
const PRELOAD_BURST_PASSES = 3;
const FAST_SCRUB_RENDERER_ENABLED = true;
const FAST_SCRUB_PRELOAD_BUDGET_MS = 180;
const FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS = 0.5;
const FAST_SCRUB_MAX_PREWARM_FRAMES = 256;
const FAST_SCRUB_MAX_PREWARM_SOURCES = 96;
const FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS = 1.0;
const FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME = 2;
const FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME = 2;
const FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME = 6;
const FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES = 6;
const FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD = true;
const FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD = true;
const FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS = 1;
const FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS = 2;
const FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS = 0;
const FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS = 1;
const FAST_SCRUB_PREWARM_QUEUE_MAX = 24;
const FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS = 24;
const FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES = 2;
const FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES = 8;
const PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS = 20;
const PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES = 2;
const PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES = 8;
const SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS = 8;
const SOURCE_WARM_SCRUB_WINDOW_SECONDS = 3;
const SOURCE_WARM_MAX_SOURCES = 20;
const SOURCE_WARM_HARD_CAP_SOURCES = 24;
const SOURCE_WARM_HARD_CAP_ELEMENTS = 40;
const SOURCE_WARM_MIN_SOURCES = 4;
const SOURCE_WARM_STICKY_MS = 2500;
const SOURCE_WARM_TICK_MS = 300;
const RESOLVE_RETRY_MIN_MS = 400;
const RESOLVE_RETRY_MAX_MS = 8000;
const RESOLVE_MAX_CONCURRENCY = 6;
const RESOLVE_MAX_IDS_PER_PASS_PLAYING = 12;
const RESOLVE_MAX_IDS_PER_PASS_IDLE = 8;
const RESOLVE_MAX_IDS_PER_PASS_SCRUB = 4;
const RESOLVE_DEFER_DURING_SCRUB_MS = 120;
const PREVIEW_PERF_PUBLISH_INTERVAL_MS = 750;
const PREVIEW_PERF_PANEL_STORAGE_KEY = 'freecut.preview.perf-panel';
const PREVIEW_PERF_PANEL_QUERY_KEY = 'previewPerfPanel';
const PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX = 6;
const PREVIEW_PERF_SEEK_TIMEOUT_MS = 2500;
const ADAPTIVE_PREVIEW_QUALITY_ENABLED = true;

type CompositionRenderer = Awaited<ReturnType<typeof createCompositionRenderer>>;
type VideoSourceSpan = { src: string; startFrame: number; endFrame: number };
type FastScrubBoundarySource = { frame: number; srcs: string[] };
type PreviewPerfSnapshot = {
  ts: number;
  unresolvedQueue: number;
  pendingResolves: number;
  renderSource: PreviewRenderSource;
  renderSourceSwitches: number;
  renderSourceHistory: RenderSourceSwitchEntry[];
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
  userPreviewQuality: PreviewQuality;
  adaptiveQualityCap: PreviewQuality;
  effectivePreviewQuality: PreviewQuality;
  frameTimeBudgetMs: number;
  frameTimeEmaMs: number;
  adaptiveQualityDowngrades: number;
  adaptiveQualityRecovers: number;
};

declare global {
  interface Window {
    __PREVIEW_PERF__?: PreviewPerfSnapshot;
    __PREVIEW_PERF_LOG__?: boolean;
    __PREVIEW_PERF_PANEL__?: boolean;
  }
}

function toTrackFingerprint(tracks: CompositionInputProps['tracks']): string {
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

function scaleEffectsForPreview(
  effects: ItemEffect[] | undefined,
  uniformScale: number
): ItemEffect[] | undefined {
  if (!effects || effects.length === 0) return effects;

  let changed = false;
  const scaled = effects.map((entry) => {
    const effect = entry.effect;

    if (effect.type === 'css-filter' && effect.filter === 'blur') {
      const nextValue = effect.value * uniformScale;
      if (nextValue !== effect.value) changed = true;
      return nextValue === effect.value
        ? entry
        : { ...entry, effect: { ...effect, value: nextValue } };
    }

    if (effect.type === 'canvas-effect' && effect.variant === 'halftone') {
      const nextDotSize = effect.dotSize * uniformScale;
      const nextSpacing = effect.spacing * uniformScale;
      if (nextDotSize !== effect.dotSize || nextSpacing !== effect.spacing) changed = true;
      return (nextDotSize === effect.dotSize && nextSpacing === effect.spacing)
        ? entry
        : {
            ...entry,
            effect: {
              ...effect,
              dotSize: nextDotSize,
              spacing: nextSpacing,
            },
          };
    }

    return entry;
  });

  return changed ? scaled : effects;
}

function scaleItemForPreview(
  item: TimelineItem,
  scaleX: number,
  scaleY: number,
  uniformScale: number
): TimelineItem {
  let scaled = item as TimelineItem;
  let changed = false;

  if (item.transform) {
    const nextTransform = {
      ...item.transform,
      x: item.transform.x !== undefined ? item.transform.x * scaleX : undefined,
      y: item.transform.y !== undefined ? item.transform.y * scaleY : undefined,
      width: item.transform.width !== undefined ? item.transform.width * scaleX : undefined,
      height: item.transform.height !== undefined ? item.transform.height * scaleY : undefined,
      cornerRadius: item.transform.cornerRadius !== undefined
        ? item.transform.cornerRadius * uniformScale
        : undefined,
    };
    scaled = { ...scaled, transform: nextTransform } as TimelineItem;
    changed = true;
  }

  switch (item.type) {
    case 'text': {
      const nextTextShadow = item.textShadow
        ? {
            ...item.textShadow,
            offsetX: item.textShadow.offsetX * scaleX,
            offsetY: item.textShadow.offsetY * scaleY,
            blur: item.textShadow.blur * uniformScale,
          }
        : item.textShadow;
      const nextStroke = item.stroke
        ? {
            ...item.stroke,
            width: item.stroke.width * uniformScale,
          }
        : item.stroke;

      scaled = {
        ...scaled,
        fontSize: item.fontSize !== undefined ? item.fontSize * uniformScale : undefined,
        letterSpacing: item.letterSpacing !== undefined ? item.letterSpacing * scaleX : undefined,
        textShadow: nextTextShadow,
        stroke: nextStroke,
      } as TimelineItem;
      changed = true;
      break;
    }
    case 'shape': {
      scaled = {
        ...scaled,
        strokeWidth: item.strokeWidth !== undefined ? item.strokeWidth * uniformScale : undefined,
        cornerRadius: item.cornerRadius !== undefined ? item.cornerRadius * uniformScale : undefined,
        maskFeather: item.maskFeather !== undefined ? item.maskFeather * uniformScale : undefined,
      } as TimelineItem;
      changed = true;
      break;
    }
    default:
      break;
  }

  const nextEffects = scaleEffectsForPreview(item.effects, uniformScale);
  if (nextEffects !== item.effects) {
    scaled = { ...scaled, effects: nextEffects } as TimelineItem;
    changed = true;
  }

  return changed ? scaled : item;
}

function scaleTracksForPreview(
  tracks: CompositionInputProps['tracks'],
  scaleX: number,
  scaleY: number,
  uniformScale: number
): CompositionInputProps['tracks'] {
  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) =>
      scaleItemForPreview(item, scaleX, scaleY, uniformScale)
    ),
  }));
}

function scaleKeyframesForPreview(
  keyframes: ItemKeyframes[] | undefined,
  scaleX: number,
  scaleY: number,
  uniformScale: number
): ItemKeyframes[] | undefined {
  if (!keyframes || keyframes.length === 0) return keyframes;

  let changed = false;
  const scaled = keyframes.map((itemKeyframes) => {
    let itemChanged = false;
    const nextProperties = itemKeyframes.properties.map((propertyKeyframes) => {
      const scaleForProperty =
        propertyKeyframes.property === 'x' || propertyKeyframes.property === 'width'
          ? scaleX
          : propertyKeyframes.property === 'y' || propertyKeyframes.property === 'height'
            ? scaleY
            : propertyKeyframes.property === 'cornerRadius'
              ? uniformScale
              : null;

      if (scaleForProperty === null) return propertyKeyframes;
      if (scaleForProperty === 1) return propertyKeyframes;

      itemChanged = true;
      return {
        ...propertyKeyframes,
        keyframes: propertyKeyframes.keyframes.map((keyframe) => ({
          ...keyframe,
          value: keyframe.value * scaleForProperty,
        })),
      };
    });

    if (!itemChanged) return itemKeyframes;
    changed = true;
    return { ...itemKeyframes, properties: nextProperties };
  });

  return changed ? scaled : keyframes;
}

function getPreloadBudget(mode: PreviewInteractionMode): number {
  if (mode === 'scrubbing') return PRELOAD_MAX_IDS_PER_TICK_SCRUB;
  if (mode === 'playing') return PRELOAD_MAX_IDS_PER_TICK_PLAYING;
  return PRELOAD_MAX_IDS_PER_TICK_IDLE;
}

function getResolvePassBudget(mode: PreviewInteractionMode): number {
  if (mode === 'scrubbing') return RESOLVE_MAX_IDS_PER_PASS_SCRUB;
  if (mode === 'playing') return RESOLVE_MAX_IDS_PER_PASS_PLAYING;
  return RESOLVE_MAX_IDS_PER_PASS_IDLE;
}

function getCodecCost(codec: string | undefined): number {
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

function getMediaResolveCost(media: {
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

function getCostAdjustedBudget(baseBudget: number, maxWindowCost: number): number {
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

function getDirectionalScrubStartIndex(
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

function getFrameDirection(previousFrame: number, nextFrame: number): -1 | 0 | 1 {
  if (nextFrame > previousFrame) return 1;
  if (nextFrame < previousFrame) return -1;
  return 0;
}

function parsePreviewPerfPanelQuery(value: string | null): boolean | null {
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

interface VideoPreviewProps {
  project: {
    width: number;
    height: number;
    backgroundColor?: string;
  };
  containerSize: {
    width: number;
    height: number;
  };
  suspendOverlay?: boolean;
}

/**
 * Hook for integrating custom Player with timeline playback state
 * 
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires frameupdate â†’ updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 */
function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const [playerReady, setPlayerReady] = useState(false);
  const lastSyncedFrameRef = useRef<number>(0);
  const lastSeekTargetRef = useRef<number | null>(null);
  const lastBackwardScrubSeekAtRef = useRef(0);
  const lastBackwardScrubSeekFrameRef = useRef<number | null>(null);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [playerRef]);

  const seekPlayerToFrame = useCallback((targetFrame: number) => {
    if (!playerRef.current) return;
    if (lastSeekTargetRef.current === targetFrame) return;

    const playerFrame = getPlayerFrame();
    if (playerFrame !== null && playerFrame === targetFrame) {
      lastSyncedFrameRef.current = targetFrame;
      lastSeekTargetRef.current = targetFrame;
      return;
    }

    ignorePlayerUpdatesRef.current = true;
    try {
      onPlayerSeek?.(targetFrame);
      playerRef.current.seekTo(targetFrame);
      lastSyncedFrameRef.current = targetFrame;
      lastSeekTargetRef.current = targetFrame;
    } catch (error) {
      console.error('Failed to seek Player:', error);
    }

    requestAnimationFrame(() => {
      ignorePlayerUpdatesRef.current = false;
    });
  }, [playerRef, getPlayerFrame, onPlayerSeek]);

  // Detect when Player becomes ready
  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true);
    }
    const checkReady = setInterval(() => {
      if (playerRef.current && !playerReady) {
        setPlayerReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(checkReady), 1000);

    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [playerRef, playerReady]);

  // Timeline â†’ Player: Sync play/pause state
  useEffect(() => {
    if (!playerRef.current) return;

    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    try {
      if (isPlaying && !wasPlaying) {
        // Always resume from the store playhead, not the hover-preview (gray) playhead.
        const { currentFrame, setPreviewFrame } = usePlaybackStore.getState();
        const playerFrame = getPlayerFrame();
        const needsSeek = playerFrame === null || Math.abs(playerFrame - currentFrame) > 1;
        if (needsSeek) {
          ignorePlayerUpdatesRef.current = true;
          onPlayerSeek?.(currentFrame);
          playerRef.current.seekTo(currentFrame);
          lastSyncedFrameRef.current = currentFrame;
          lastSeekTargetRef.current = currentFrame;
        }
        setPreviewFrame(null);

        // Start playback immediately after optional seek. Deferring to rAF adds
        // an extra frame of latency every time playback resumes.
        if (!usePlaybackStore.getState().isPlaying) {
          ignorePlayerUpdatesRef.current = false;
          return;
        }
        playerRef.current?.play();
        ignorePlayerUpdatesRef.current = false;
        return;
      } else if (!isPlaying && wasPlaying) {
        playerRef.current.pause();
      }
    } catch (error) {
      console.error('[Player Sync] Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, getPlayerFrame, onPlayerSeek]);

  // Wait for timeline to finish loading before syncing frame position.
  // Without this, the Player would seek to frame 0 (the default) before
  // loadTimeline() restores the saved currentFrame from IndexedDB.
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  // Timeline â†’ Player: Sync frame position
  useEffect(() => {
    if (!playerReady || !playerRef.current || isTimelineLoading) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    const playerFrame = getPlayerFrame();
    lastSyncedFrameRef.current = initialFrame;
    lastSeekTargetRef.current = initialFrame;
    if (playerFrame !== initialFrame) {
      onPlayerSeek?.(initialFrame);
    }
    playerRef.current.seekTo(initialFrame);

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const transition = resolvePreviewTransitionDecision({
        prev: {
          isPlaying: prevState.isPlaying,
          previewFrame: prevState.previewFrame,
          currentFrame: prevState.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
        next: {
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
      });

      if (!transition.currentFrameChanged) return;
      const currentFrame = state.currentFrame;

      const frameDiff = Math.abs(currentFrame - lastSyncedFrameRef.current);
      if (frameDiff === 0) return;

      if (transition.next.mode === 'playing') {
        const playerFrame = getPlayerFrame();
        // While actively playing, most store frame updates originate from the Player itself.
        // Only seek when there is real drift, which indicates an external timeline seek.
        if (playerFrame !== null && Math.abs(playerFrame - currentFrame) <= 2) {
          lastSyncedFrameRef.current = currentFrame;
          return;
        }
      }

      // During active gizmo interactions, don't seek from currentFrame updates.
      // Gizmo mode prioritizes real-time transform updates from Player output.
      if (transition.shouldSkipCurrentFrameSeek) {
        lastSyncedFrameRef.current = currentFrame;
        return;
      }

      seekPlayerToFrame(currentFrame);
    });

    return unsubscribe;
  }, [playerReady, isTimelineLoading, playerRef, getPlayerFrame, seekPlayerToFrame, isGizmoInteractingRef, onPlayerSeek]);

  // Preview frame seeking: seek to hovered position on timeline
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    return usePlaybackStore.subscribe((state, prev) => {
      if (!playerRef.current) return;
      const transition = resolvePreviewTransitionDecision({
        prev: {
          isPlaying: prev.isPlaying,
          previewFrame: prev.previewFrame,
          currentFrame: prev.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
        next: {
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
      });
      if (!transition.previewFrameChanged) return;
      const interactionMode = transition.next.mode;
      if (interactionMode === 'playing' || interactionMode === 'gizmo_dragging') {
        lastBackwardScrubSeekAtRef.current = 0;
        lastBackwardScrubSeekFrameRef.current = null;
        return;
      }
      if (interactionMode === 'scrubbing' && bypassPreviewSeekRef?.current) {
        lastBackwardScrubSeekAtRef.current = 0;
        lastBackwardScrubSeekFrameRef.current = null;
        return;
      }

      const targetFrame = transition.next.anchorFrame;
      const scrubDirection = interactionMode === 'scrubbing'
        ? getFrameDirection(transition.prev.anchorFrame, transition.next.anchorFrame)
        : 0;

      if (scrubDirection < 0) {
        const nowMs = performance.now();
        const quantizedFrame = Math.floor(
          targetFrame / PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES
        ) * PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES;
        const lastRequestedFrame = lastBackwardScrubSeekFrameRef.current;
        const withinThrottle = (
          (nowMs - lastBackwardScrubSeekAtRef.current) < PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS
        );
        const jumpDistance = lastRequestedFrame === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(quantizedFrame - lastRequestedFrame);
        if (
          withinThrottle
          && jumpDistance < PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES
        ) {
          return;
        }

        lastBackwardScrubSeekAtRef.current = nowMs;
        lastBackwardScrubSeekFrameRef.current = quantizedFrame;
        seekPlayerToFrame(quantizedFrame);
        return;
      }

      lastBackwardScrubSeekAtRef.current = 0;
      lastBackwardScrubSeekFrameRef.current = null;
      seekPlayerToFrame(targetFrame);
    });
  }, [playerReady, playerRef, seekPlayerToFrame, bypassPreviewSeekRef, isGizmoInteractingRef]);

  return { ignorePlayerUpdatesRef };
}

/**
 * Video Preview Component
 *
 * Displays the custom Player with:
 * - Real-time video rendering
 * - Bidirectional sync with timeline
 * - Responsive sizing based on zoom and container
 * - Frame counter
 * - Fullscreen toggle
 *
 * Memoized to prevent expensive Player re-renders.
 */
export const VideoPreview = memo(function VideoPreview({
  project,
  containerSize,
  suspendOverlay = false,
}: VideoPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const scrubCanvasRef = useRef<HTMLCanvasElement>(null);
  const bypassPreviewSeekRef = useRef(false);
  const scrubRendererRef = useRef<CompositionRenderer | null>(null);
  const scrubInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const scrubPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const scrubOffscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const scrubOffscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const scrubRenderInFlightRef = useRef(false);
  const scrubRequestedFrameRef = useRef<number | null>(null);
  const scrubPrewarmQueueRef = useRef<number[]>([]);
  const scrubPrewarmQueuedSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedFramesRef = useRef<number[]>([]);
  const scrubPrewarmedFrameSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedSourcesRef = useRef<Set<string>>(new Set());
  const scrubPrewarmedSourceOrderRef = useRef<string[]>([]);
  const scrubPrewarmedSourceTouchFrameRef = useRef<Map<string, number>>(new Map());
  const scrubDirectionRef = useRef<-1 | 0 | 1>(0);
  const suppressScrubBackgroundPrewarmRef = useRef(false);
  const fallbackToPlayerScrubRef = useRef(false);
  const lastForwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubRenderAtRef = useRef(0);
  const lastBackwardRequestedFrameRef = useRef<number | null>(null);
  const scrubMountedRef = useRef(true);
  const [showFastScrubOverlay, setShowFastScrubOverlay] = useState(false);
  const renderSourceRef = useRef<PreviewRenderSource>('player');
  const renderSourceSwitchCountRef = useRef(0);
  const renderSourceHistoryRef = useRef<RenderSourceSwitchEntry[]>([]);
  const pendingSeekLatencyRef = useRef<{ targetFrame: number; startedAtMs: number } | null>(null);
  const seekLatencyStatsRef = useRef<SeekLatencyStats>({
    samples: 0,
    totalMs: 0,
    lastMs: 0,
    timeouts: 0,
  });
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [perfPanelSnapshot, setPerfPanelSnapshot] = useState<PreviewPerfSnapshot | null>(null);

  // State for gizmo overlay positioning
  const [playerContainerRect, setPlayerContainerRect] = useState<DOMRect | null>(null);

  // Callback ref that measures immediately when element is available
  const setPlayerContainerRefCallback = useCallback((el: HTMLDivElement | null) => {
    playerContainerRef.current = el;
    if (el) {
      setPlayerContainerRect(el.getBoundingClientRect());
    }
  }, []);

  // Granular selectors - avoid subscribing to currentFrame here to prevent re-renders
  const fps = useTimelineStore((s) => s.fps);
  const tracks = useTimelineStore((s) => s.tracks);
  const keyframes = useTimelineStore((s) => s.keyframes);
  const items = useItemsStore((s) => s.items);
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId);
  const mediaDependencyVersion = useMediaDependencyStore((s) => s.mediaDependencyVersion);
  const transitions = useTransitionsStore((s) => s.transitions);
  const mediaById = useMediaLibraryStore((s) => s.mediaById);
  const hasRolling2Up = useRollingEditPreviewStore(
    (s) => Boolean(s.trimmedItemId && s.neighborItemId && s.handle),
  );
  const hasRipple2Up = useRippleEditPreviewStore((s) => Boolean(s.trimmedItemId && s.handle));
  const hasSlip4Up = useSlipEditPreviewStore((s) => Boolean(s.itemId));
  const hasSlide4Up = useSlideEditPreviewStore((s) => Boolean(s.itemId));
  const isGizmoInteracting = useGizmoStore((s) => s.activeGizmo !== null);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const zoom = usePlaybackStore((s) => s.zoom);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const previewQuality = usePlaybackStore((s) => s.previewQuality);
  // Derive a stable count of ready proxies to avoid recomputing resolvedTracks
  // on every proxyStatus Map recreation (e.g. during progress updates)
  const proxyReadyCount = useMediaLibraryStore((s) => {
    let count = 0;
    for (const status of s.proxyStatus.values()) {
      if (status === 'ready') count++;
    }
    return count;
  });

  const isGizmoInteractingRef = useRef(isGizmoInteracting);
  isGizmoInteractingRef.current = isGizmoInteracting;
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);
  const effectivePreviewQuality = useMemo(
    () => getEffectivePreviewQuality(previewQuality, adaptiveQualityCap),
    [previewQuality, adaptiveQualityCap],
  );

  const trackPlayerSeek = useCallback((targetFrame: number) => {
    if (!import.meta.env.DEV) return;
    pendingSeekLatencyRef.current = {
      targetFrame,
      startedAtMs: performance.now(),
    };
  }, []);

  const resolvePendingSeekLatency = useCallback((frame: number) => {
    if (!import.meta.env.DEV) return;
    const pending = pendingSeekLatencyRef.current;
    if (!pending) return;
    if (pending.targetFrame !== frame) return;
    seekLatencyStatsRef.current = recordSeekLatency(
      seekLatencyStatsRef.current,
      performance.now() - pending.startedAtMs
    );
    pendingSeekLatencyRef.current = null;
  }, []);

  // Custom Player integration (hook handles bidirectional sync)
  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  );

  useEffect(() => {
    isGizmoInteractingRef.current = isGizmoInteracting;
    if (!isGizmoInteracting) return;
    // During active transform drags, force preview output to come from Player.
    // Clear stale hover-scrub state so runtime logic doesn't treat gizmo drag
    // as scrubbing.
    const playbackState = usePlaybackStore.getState();
    if (playbackState.previewFrame !== null) {
      playbackState.setPreviewFrame(null);
    }
    scrubRequestedFrameRef.current = null;
    setShowFastScrubOverlay(false);
    bypassPreviewSeekRef.current = false;
  }, [isGizmoInteracting]);

  useEffect(() => {
    if (!ADAPTIVE_PREVIEW_QUALITY_ENABLED) {
      adaptiveFrameSampleRef.current = null;
      adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
      if (adaptiveQualityCap !== 1) {
        setAdaptiveQualityCap(1);
      }
      return;
    }

    if (isPlaying) {
      adaptiveFrameSampleRef.current = null;
      return;
    }

    adaptiveFrameSampleRef.current = null;
    adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
    if (adaptiveQualityCap !== 1) {
      setAdaptiveQualityCap(1);
    }
  }, [adaptiveQualityCap, isPlaying]);

  // Register frame capture function for project thumbnail generation and split transitions
  const setCaptureFrame = usePlaybackStore((s) => s.setCaptureFrame);
  useEffect(() => {
    const captureFunction = async () => {
      if (playerRef.current) {
        playerRef.current.getCurrentFrame();
        return null;
      }
      return null;
    };
    setCaptureFrame(captureFunction);

    return () => {
      setCaptureFrame(null);
    };
  }, [setCaptureFrame]);

  // Cache for resolved blob URLs (mediaId -> blobUrl)
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(new Map());
  const [isResolving, setIsResolving] = useState(false);
  // Bumped on tab wake-up to force re-resolution of media URLs
  const [urlRefreshVersion, setUrlRefreshVersion] = useState(0);
  const [resolveRetryTick, setResolveRetryTick] = useState(0);
  const unresolvedMediaIdsRef = useRef<string[]>([]);
  const unresolvedMediaIdSetRef = useRef<Set<string>>(new Set());
  const pendingResolvePromisesRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const preloadResolveInFlightRef = useRef(false);
  const preloadBurstRemainingRef = useRef(0);
  const preloadScanTrackCursorRef = useRef(0);
  const preloadScanItemCursorRef = useRef(0);
  const preloadLastAnchorFrameRef = useRef<number | null>(null);
  const resolveFailureCountRef = useRef<Map<string, number>>(new Map());
  const resolveRetryAfterRef = useRef<Map<string, number>>(new Map());
  const resolveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvePassInFlightRef = useRef(false);
  const previewPerfRef = useRef({
    resolveSamples: 0,
    resolveTotalMs: 0,
    resolveTotalIds: 0,
    resolveLastMs: 0,
    resolveLastIds: 0,
    preloadScanSamples: 0,
    preloadScanTotalMs: 0,
    preloadScanLastMs: 0,
    preloadBatchSamples: 0,
    preloadBatchTotalMs: 0,
    preloadBatchLastMs: 0,
    preloadBatchLastIds: 0,
    preloadCandidateIds: 0,
    preloadBudgetBase: 0,
    preloadBudgetAdjusted: 0,
    preloadWindowMaxCost: 0,
    preloadScanBudgetYields: 0,
    preloadContinuations: 0,
    preloadScrubDirection: 0 as -1 | 0 | 1,
    preloadDirectionPenaltyCount: 0,
    sourceWarmTarget: 0,
    sourceWarmKeep: 0,
    sourceWarmEvictions: 0,
    sourcePoolSources: 0,
    sourcePoolElements: 0,
    sourcePoolActiveClips: 0,
    fastScrubPrewarmedSources: 0,
    fastScrubPrewarmSourceEvictions: 0,
    staleScrubOverlayDrops: 0,
    scrubDroppedFrames: 0,
    scrubUpdates: 0,
    adaptiveQualityDowngrades: 0,
    adaptiveQualityRecovers: 0,
  });
  const lastSyncedMediaDependencyVersionRef = useRef<number>(-1);

  useEffect(() => {
    const nextSource: PreviewRenderSource = showFastScrubOverlay ? 'fast_scrub_overlay' : 'player';
    const prevSource = renderSourceRef.current;
    if (prevSource !== nextSource) {
      renderSourceSwitchCountRef.current += 1;
      renderSourceHistoryRef.current = pushRenderSourceSwitchHistory(
        renderSourceHistoryRef.current,
        {
          ts: Date.now(),
          atFrame: usePlaybackStore.getState().currentFrame,
          from: prevSource,
          to: nextSource,
        },
        PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX,
      );
    }
    renderSourceRef.current = nextSource;
  }, [showFastScrubOverlay]);

  const rebuildUnresolvedMediaIds = useCallback((resolvedMap: Map<string, string>) => {
    const mediaIds = useMediaDependencyStore.getState().mediaIds;
    const unresolvedSet = new Set<string>();
    for (const mediaId of mediaIds) {
      if (!resolvedMap.has(mediaId)) {
        unresolvedSet.add(mediaId);
      }
    }
    unresolvedMediaIdSetRef.current = unresolvedSet;
    unresolvedMediaIdsRef.current = [...unresolvedSet];
    return unresolvedMediaIdsRef.current;
  }, []);

  const addUnresolvedMediaIds = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    const activeMediaIds = useMediaDependencyStore.getState().mediaIds;
    const activeMediaIdSet = new Set(activeMediaIds);
    const unresolvedSet = unresolvedMediaIdSetRef.current;
    let changed = false;

    for (const mediaId of mediaIds) {
      if (!activeMediaIdSet.has(mediaId)) continue;
      if (!unresolvedSet.has(mediaId)) {
        unresolvedSet.add(mediaId);
        changed = true;
      }
    }

    if (changed) {
      unresolvedMediaIdsRef.current = [...unresolvedSet];
    }
  }, []);

  const removeUnresolvedMediaIds = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    const unresolvedSet = unresolvedMediaIdSetRef.current;
    let changed = false;

    for (const mediaId of mediaIds) {
      if (unresolvedSet.delete(mediaId)) {
        changed = true;
      }
    }

    if (changed) {
      unresolvedMediaIdsRef.current = [...unresolvedSet];
    }
  }, []);

  const clearResolveRetryState = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    for (const mediaId of mediaIds) {
      resolveFailureCountRef.current.delete(mediaId);
      resolveRetryAfterRef.current.delete(mediaId);
    }
  }, []);

  const pruneResolveRetryState = useCallback((activeMediaIdSet: Set<string>) => {
    for (const mediaId of resolveFailureCountRef.current.keys()) {
      if (!activeMediaIdSet.has(mediaId)) {
        resolveFailureCountRef.current.delete(mediaId);
      }
    }
    for (const mediaId of resolveRetryAfterRef.current.keys()) {
      if (!activeMediaIdSet.has(mediaId)) {
        resolveRetryAfterRef.current.delete(mediaId);
      }
    }
  }, []);

  const markResolveFailures = useCallback((mediaIds: string[]): number | null => {
    if (mediaIds.length === 0) return null;
    const now = Date.now();
    let earliestRetryAt: number | null = null;

    for (const mediaId of mediaIds) {
      const nextFailures = (resolveFailureCountRef.current.get(mediaId) ?? 0) + 1;
      resolveFailureCountRef.current.set(mediaId, nextFailures);

      const exponent = Math.min(nextFailures - 1, 6);
      const retryDelayMs = Math.min(
        RESOLVE_RETRY_MAX_MS,
        RESOLVE_RETRY_MIN_MS * Math.pow(2, exponent)
      );
      const retryAt = now + retryDelayMs;
      resolveRetryAfterRef.current.set(mediaId, retryAt);
      if (earliestRetryAt === null || retryAt < earliestRetryAt) {
        earliestRetryAt = retryAt;
      }
    }

    return earliestRetryAt;
  }, []);

  const getResolveRetryAt = useCallback((mediaId: string): number => {
    return resolveRetryAfterRef.current.get(mediaId) ?? 0;
  }, []);

  const scheduleResolveRetryWake = useCallback((retryAt: number | null) => {
    if (resolveRetryTimerRef.current) {
      clearTimeout(resolveRetryTimerRef.current);
      resolveRetryTimerRef.current = null;
    }
    if (retryAt === null) return;

    const delayMs = Math.max(0, retryAt - Date.now());
    resolveRetryTimerRef.current = setTimeout(() => {
      resolveRetryTimerRef.current = null;
      setResolveRetryTick((v) => v + 1);
    }, delayMs);
  }, []);

  const resetResolveRetryState = useCallback(() => {
    resolveFailureCountRef.current.clear();
    resolveRetryAfterRef.current.clear();
    if (resolveRetryTimerRef.current) {
      clearTimeout(resolveRetryTimerRef.current);
      resolveRetryTimerRef.current = null;
    }
  }, []);

  const kickResolvePass = useCallback(() => {
    if (resolvePassInFlightRef.current) return;
    setResolveRetryTick((tick) => tick + 1);
  }, []);

  const resolveMediaUrlDeduped = useCallback((mediaId: string): Promise<string | null> => {
    const pendingMap = pendingResolvePromisesRef.current;
    const existingPromise = pendingMap.get(mediaId);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = resolveMediaUrl(mediaId)
      .then((url) => url ?? null)
      .catch(() => null)
      .finally(() => {
        pendingMap.delete(mediaId);
      });

    pendingMap.set(mediaId, promise);
    return promise;
  }, []);

  const resolveMediaBatch = useCallback(async (mediaIds: string[]): Promise<{
    resolvedEntries: Array<{ mediaId: string; url: string }>;
    failedIds: string[];
  }> => {
    if (mediaIds.length === 0) {
      return { resolvedEntries: [], failedIds: [] };
    }

    const resolvedEntries: Array<{ mediaId: string; url: string }> = [];
    const failedIds: string[] = [];
    let cursor = 0;
    const workerCount = Math.min(RESOLVE_MAX_CONCURRENCY, mediaIds.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= mediaIds.length) break;
          const mediaId = mediaIds[index]!;
          const url = await resolveMediaUrlDeduped(mediaId);
          if (url) {
            resolvedEntries.push({ mediaId, url });
          } else {
            failedIds.push(mediaId);
          }
        }
      })
    );

    return { resolvedEntries, failedIds };
  }, [resolveMediaUrlDeduped]);

  // Combine tracks and items into TimelineTrack format
  // resolveEffectiveTrackStates applies parent group gate behavior (mute/hide/lock)
  // and filters out group container tracks (which hold no items)
  const combinedTracks = useMemo(() => {
    const effectiveTracks = resolveEffectiveTrackStates(tracks).toSorted((a, b) => b.order - a.order);
    return effectiveTracks.map((track) => ({
      ...track,
      items: itemsByTrackId[track.id] ?? [],
    }));
  }, [tracks, itemsByTrackId]);

  const mediaResolveCostById = useMemo(() => {
    const costs = new Map<string, number>();
    for (const [mediaId, media] of Object.entries(mediaById)) {
      costs.set(mediaId, getMediaResolveCost(media));
    }
    return costs;
  }, [mediaById]);

  const {
    resolvedTracks,
    fastScrubTracks,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    fastScrubTracksFingerprint,
  } = useMemo(() => {
    const resolvedTrackList: CompositionInputProps['tracks'] = [];
    const fastScrubTrackList: CompositionInputProps['tracks'] = [];
    const playbackSpans: VideoSourceSpan[] = [];
    const scrubSpans: VideoSourceSpan[] = [];
    const boundaryFrames = new Set<number>();
    const boundarySources = new Map<number, Set<string>>();

    for (const track of combinedTracks) {
      const resolvedItems: typeof track.items = [];
      const fastScrubItems: typeof track.items = [];

      for (const item of track.items) {
        if (!item.mediaId || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) {
          resolvedItems.push(item);
          fastScrubItems.push(item);
          continue;
        }

        const sourceUrl = resolvedUrls.get(item.mediaId) ?? '';
        const proxyUrl = item.type === 'video'
          ? (resolveProxyUrl(item.mediaId) || sourceUrl)
          : sourceUrl;
        const resolvedSrc = useProxy && item.type === 'video' ? proxyUrl : sourceUrl;
        const fastScrubSrc = item.type === 'video' ? proxyUrl : sourceUrl;

        const resolvedItem = ('src' in item && item.src === resolvedSrc)
          ? item
          : { ...item, src: resolvedSrc };
        const fastScrubItem = ('src' in item && item.src === fastScrubSrc)
          ? item
          : { ...item, src: fastScrubSrc };

        resolvedItems.push(resolvedItem);
        fastScrubItems.push(fastScrubItem);

        if (resolvedItem.type === 'video' && resolvedSrc) {
          playbackSpans.push({
            src: resolvedSrc,
            startFrame: resolvedItem.from,
            endFrame: resolvedItem.from + resolvedItem.durationInFrames,
          });
        }

        if (fastScrubItem.type === 'video' && fastScrubSrc) {
          scrubSpans.push({
            src: fastScrubSrc,
            startFrame: fastScrubItem.from,
            endFrame: fastScrubItem.from + fastScrubItem.durationInFrames,
          });
          if (fastScrubItem.durationInFrames > 0) {
            const startFrame = fastScrubItem.from;
            const endFrame = fastScrubItem.from + fastScrubItem.durationInFrames;
            boundaryFrames.add(startFrame);
            boundaryFrames.add(endFrame);

            let startSet = boundarySources.get(startFrame);
            if (!startSet) {
              startSet = new Set<string>();
              boundarySources.set(startFrame, startSet);
            }
            startSet.add(fastScrubSrc);

            let endSet = boundarySources.get(endFrame);
            if (!endSet) {
              endSet = new Set<string>();
              boundarySources.set(endFrame, endSet);
            }
            endSet.add(fastScrubSrc);
          }
        }
      }

      resolvedTrackList.push({ ...track, items: resolvedItems });
      fastScrubTrackList.push({ ...track, items: fastScrubItems });
    }

    const sortedBoundaryFrames = [...boundaryFrames].sort((a, b) => a - b);
    const sortedBoundarySources: FastScrubBoundarySource[] = [...boundarySources.entries()]
      .map(([frame, srcSet]) => ({ frame, srcs: [...srcSet] }))
      .sort((a, b) => a.frame - b.frame);

    return {
      resolvedTracks: resolvedTrackList,
      fastScrubTracks: fastScrubTrackList,
      playbackVideoSourceSpans: playbackSpans,
      scrubVideoSourceSpans: scrubSpans,
      fastScrubBoundaryFrames: sortedBoundaryFrames,
      fastScrubBoundarySources: sortedBoundarySources,
      fastScrubTracksFingerprint: toTrackFingerprint(fastScrubTrackList),
    };
  }, [combinedTracks, resolvedUrls, useProxy, proxyReadyCount]);

  // Track broken media count so relinking (which removes entries) re-triggers resolution
  const brokenMediaCount = useMediaLibraryStore((s) => s.brokenMediaIds.length);

  // Calculate total frames from item data in local memoized pass.
  const furthestItemEndFrame = useMemo(
    () => items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0),
    [items]
  );
  const totalFrames = useMemo(() => {
    if (furthestItemEndFrame === 0) return 900; // Default 30s at 30fps
    return furthestItemEndFrame + (fps * 5);
  }, [furthestItemEndFrame, fps]);

  // When media is relinked (removed from brokenMediaIds), clear its stale
  // resolved URL so the resolution effect re-fetches from the new file handle.
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds);
  const prevBrokenRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevBrokenRef.current;
    prevBrokenRef.current = brokenMediaIds;
    // Find IDs that were broken but are now healthy (relinked)
    const relinkedIds = prev.filter((id) => !brokenMediaIds.includes(id));
    if (relinkedIds.length > 0) {
      clearResolveRetryState(relinkedIds);
      addUnresolvedMediaIds(relinkedIds);
      setResolvedUrls((prevUrls) => {
        const next = new Map(prevUrls);
        let changed = false;
        for (const id of relinkedIds) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prevUrls;
      });
    }
  }, [addUnresolvedMediaIds, brokenMediaIds, clearResolveRetryState]);

  // Resolve media URLs when media dependencies change (not on transform changes)
  useEffect(() => {
    let isCancelled = false;

    async function resolve() {
      resolvePassInFlightRef.current = true;
      try {
      const mediaIds = useMediaDependencyStore.getState().mediaIds;

      if (mediaIds.length === 0) {
        unresolvedMediaIdSetRef.current.clear();
        unresolvedMediaIdsRef.current = [];
        resetResolveRetryState();
        setResolvedUrls(new Map());
        setIsResolving(false);
        return;
      }

      const activeMediaIdSet = new Set(mediaIds);
      pruneResolveRetryState(activeMediaIdSet);
      let effectiveResolvedUrls = resolvedUrls;
      let unresolved = unresolvedMediaIdsRef.current;

      if (lastSyncedMediaDependencyVersionRef.current !== mediaDependencyVersion) {
        lastSyncedMediaDependencyVersionRef.current = mediaDependencyVersion;
        if (resolvedUrls.size > 0) {
          const prunedUrls = new Map<string, string>();
          for (const [mediaId, url] of resolvedUrls.entries()) {
            if (activeMediaIdSet.has(mediaId)) {
              prunedUrls.set(mediaId, url);
            }
          }
          effectiveResolvedUrls = prunedUrls;
          if (prunedUrls.size !== resolvedUrls.size) {
            setResolvedUrls(prunedUrls);
          }
        }
        unresolved = rebuildUnresolvedMediaIds(effectiveResolvedUrls);
      } else if (unresolved.length === 0) {
        unresolved = rebuildUnresolvedMediaIds(effectiveResolvedUrls);
      }

      if (unresolved.length === 0) {
        scheduleResolveRetryWake(null);
        setIsResolving(false);
        return;
      }

      const unresolvedSet = new Set(unresolved);
      const now = Date.now();
      let earliestRetryAt: number | null = null;
      const playbackState = usePlaybackStore.getState();
      const interactionMode = getPreviewInteractionMode({
        isPlaying: playbackState.isPlaying,
        previewFrame: playbackState.previewFrame,
        isGizmoInteracting: isGizmoInteractingRef.current,
      });
      const anchorFrame = getPreviewAnchorFrame(interactionMode, {
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
      });
      if (
        interactionMode === 'scrubbing'
        && effectiveResolvedUrls.size > 0
      ) {
        // Active scrubbing prioritizes seek responsiveness over URL resolution.
        // Keep retry ticking, but defer heavy resolve passes while pointer moves.
        scheduleResolveRetryWake(Date.now() + RESOLVE_DEFER_DURING_SCRUB_MS);
        setIsResolving(false);
        return;
      }
      const costPenaltyFrames = Math.max(12, Math.round(fps * 0.6));
      const activeWindowFrames = Math.max(24, Math.round(fps * PRELOAD_AHEAD_SECONDS));
      const minActiveWindowFrame = anchorFrame - activeWindowFrames;
      const maxActiveWindowFrame = anchorFrame + activeWindowFrames;
      const priorityByMediaId = new Map<string, number>();
      let maxActiveWindowCost = 0;

      for (const track of combinedTracks) {
        for (const item of track.items) {
          if (!item.mediaId || !unresolvedSet.has(item.mediaId)) continue;
          const itemEndFrame = item.from + item.durationInFrames;
          const distanceToAnchor = anchorFrame < item.from
            ? item.from - anchorFrame
            : anchorFrame > itemEndFrame
              ? anchorFrame - itemEndFrame
              : 0;
          const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1;
          const score = distanceToAnchor + (mediaCost * costPenaltyFrames);
          const previousScore = priorityByMediaId.get(item.mediaId);
          if (previousScore === undefined || score < previousScore) {
            priorityByMediaId.set(item.mediaId, score);
          }
          if (!(itemEndFrame < minActiveWindowFrame || item.from > maxActiveWindowFrame)) {
            if (mediaCost > maxActiveWindowCost) {
              maxActiveWindowCost = mediaCost;
            }
          }
        }
      }

      const readyCandidates: Array<{ mediaId: string; score: number }> = [];
      for (const mediaId of unresolved) {
        const retryAt = getResolveRetryAt(mediaId);
        if (retryAt > now) {
          if (earliestRetryAt === null || retryAt < earliestRetryAt) {
            earliestRetryAt = retryAt;
          }
          continue;
        }

        const mediaCost = mediaResolveCostById.get(mediaId) ?? 1;
        const fallbackScore = (activeWindowFrames * 4) + (mediaCost * costPenaltyFrames);
        readyCandidates.push({
          mediaId,
          score: priorityByMediaId.get(mediaId) ?? fallbackScore,
        });
      }

      if (readyCandidates.length === 0) {
        scheduleResolveRetryWake(earliestRetryAt);
        setIsResolving(false);
        return;
      }

      const resolvePassBudget = getCostAdjustedBudget(
        getResolvePassBudget(interactionMode),
        maxActiveWindowCost
      );
      const readyToResolve = readyCandidates
        .toSorted((a, b) => a.score - b.score)
        .slice(0, resolvePassBudget)
        .map((candidate) => candidate.mediaId);
      const hasMoreReadyCandidates = readyCandidates.length > readyToResolve.length;

      scheduleResolveRetryWake(null);

      if (effectiveResolvedUrls.size === 0) {
        setIsResolving(true);
        await new Promise(r => setTimeout(r, 150));
      }

      if (isCancelled) {
        setIsResolving(false);
        return;
      }

      try {
        const newUrls = new Map(effectiveResolvedUrls);
        const resolveBatchStartMs = performance.now();
        const { resolvedEntries, failedIds } = await resolveMediaBatch(readyToResolve);
        const resolveBatchDurationMs = performance.now() - resolveBatchStartMs;
        previewPerfRef.current.resolveSamples += 1;
        previewPerfRef.current.resolveTotalMs += resolveBatchDurationMs;
        previewPerfRef.current.resolveTotalIds += readyToResolve.length;
        previewPerfRef.current.resolveLastMs = resolveBatchDurationMs;
        previewPerfRef.current.resolveLastIds = readyToResolve.length;
        const resolvedNow = resolvedEntries.map((entry) => entry.mediaId);
        for (const entry of resolvedEntries) {
          newUrls.set(entry.mediaId, entry.url);
        }
        clearResolveRetryState(resolvedNow);
        const retryAt = markResolveFailures(failedIds);
        if (retryAt !== null) {
          scheduleResolveRetryWake(retryAt);
        }
        if (hasMoreReadyCandidates) {
          scheduleResolveRetryWake(Date.now() + 16);
        }
        removeUnresolvedMediaIds(resolvedNow);

        if (!isCancelled) {
          setResolvedUrls(newUrls);
        }
      } catch (error) {
        console.error('Failed to resolve media URLs:', error);
      } finally {
        setIsResolving(false);
      }
      } finally {
        resolvePassInFlightRef.current = false;
      }
    }

    resolve();

    return () => {
      isCancelled = true;
    };
  }, [
    clearResolveRetryState,
    combinedTracks,
    fps,
    getResolveRetryAt,
    markResolveFailures,
    mediaResolveCostById,
    pruneResolveRetryState,
    rebuildUnresolvedMediaIds,
    removeUnresolvedMediaIds,
    resetResolveRetryState,
    resolveMediaBatch,
    resolveRetryTick,
    scheduleResolveRetryWake,
    mediaDependencyVersion,
    brokenMediaCount,
    urlRefreshVersion,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const publish = () => {
      const stats = previewPerfRef.current;
      const seekNow = performance.now();
      const playbackState = usePlaybackStore.getState();
      const timelineFps = useTimelineStore.getState().fps;
      const adaptiveQualityState = adaptiveQualityStateRef.current;
      const frameTimeBudgetMs = getFrameBudgetMs(timelineFps, playbackState.playbackRate);
      const userPreviewQuality = playbackState.previewQuality;
      const effectiveQuality = getEffectivePreviewQuality(
        userPreviewQuality,
        adaptiveQualityState.qualityCap
      );
      const pendingSeek = pendingSeekLatencyRef.current;
      if (
        pendingSeek
        && (seekNow - pendingSeek.startedAtMs) >= PREVIEW_PERF_SEEK_TIMEOUT_MS
      ) {
        seekLatencyStatsRef.current = recordSeekLatencyTimeout(seekLatencyStatsRef.current);
        pendingSeekLatencyRef.current = null;
      }
      const seekStats = seekLatencyStatsRef.current;
      const pendingSeekAgeMs = pendingSeekLatencyRef.current
        ? Math.max(0, seekNow - pendingSeekLatencyRef.current.startedAtMs)
        : 0;
      const snapshot: PreviewPerfSnapshot = {
        ts: Date.now(),
        unresolvedQueue: unresolvedMediaIdsRef.current.length,
        pendingResolves: pendingResolvePromisesRef.current.size,
        renderSource: renderSourceRef.current,
        renderSourceSwitches: renderSourceSwitchCountRef.current,
        renderSourceHistory: [...renderSourceHistoryRef.current],
        resolveAvgMs: stats.resolveSamples > 0 ? stats.resolveTotalMs / stats.resolveSamples : 0,
        resolveMsPerId: stats.resolveTotalIds > 0 ? stats.resolveTotalMs / stats.resolveTotalIds : 0,
        resolveLastMs: stats.resolveLastMs,
        resolveLastIds: stats.resolveLastIds,
        preloadScanAvgMs: stats.preloadScanSamples > 0 ? stats.preloadScanTotalMs / stats.preloadScanSamples : 0,
        preloadScanLastMs: stats.preloadScanLastMs,
        preloadBatchAvgMs: stats.preloadBatchSamples > 0 ? stats.preloadBatchTotalMs / stats.preloadBatchSamples : 0,
        preloadBatchLastMs: stats.preloadBatchLastMs,
        preloadBatchLastIds: stats.preloadBatchLastIds,
        preloadCandidateIds: stats.preloadCandidateIds,
        preloadBudgetBase: stats.preloadBudgetBase,
        preloadBudgetAdjusted: stats.preloadBudgetAdjusted,
        preloadWindowMaxCost: stats.preloadWindowMaxCost,
        preloadScanBudgetYields: stats.preloadScanBudgetYields,
        preloadContinuations: stats.preloadContinuations,
        preloadScrubDirection: stats.preloadScrubDirection,
        preloadDirectionPenaltyCount: stats.preloadDirectionPenaltyCount,
        sourceWarmTarget: stats.sourceWarmTarget,
        sourceWarmKeep: stats.sourceWarmKeep,
        sourceWarmEvictions: stats.sourceWarmEvictions,
        sourcePoolSources: stats.sourcePoolSources,
        sourcePoolElements: stats.sourcePoolElements,
        sourcePoolActiveClips: stats.sourcePoolActiveClips,
        fastScrubPrewarmedSources: stats.fastScrubPrewarmedSources,
        fastScrubPrewarmSourceEvictions: stats.fastScrubPrewarmSourceEvictions,
        staleScrubOverlayDrops: stats.staleScrubOverlayDrops,
        scrubDroppedFrames: stats.scrubDroppedFrames,
        scrubUpdates: stats.scrubUpdates,
        seekLatencyAvgMs: seekStats.samples > 0 ? seekStats.totalMs / seekStats.samples : 0,
        seekLatencyLastMs: seekStats.lastMs,
        seekLatencyPendingMs: pendingSeekAgeMs,
        seekLatencyTimeouts: seekStats.timeouts,
        userPreviewQuality,
        adaptiveQualityCap: adaptiveQualityState.qualityCap,
        effectivePreviewQuality: effectiveQuality,
        frameTimeBudgetMs,
        frameTimeEmaMs: adaptiveQualityState.frameTimeEmaMs,
        adaptiveQualityDowngrades: stats.adaptiveQualityDowngrades,
        adaptiveQualityRecovers: stats.adaptiveQualityRecovers,
      };

      window.__PREVIEW_PERF__ = snapshot;
      if (window.__PREVIEW_PERF_LOG__) {
        console.warn('[PreviewPerf]', snapshot);
      }
    };

    publish();
    const intervalId = setInterval(publish, PREVIEW_PERF_PUBLISH_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      window.__PREVIEW_PERF__ = undefined;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let panelEnabled = window.__PREVIEW_PERF_PANEL__ === true;
    const queryOverride = parsePreviewPerfPanelQuery(
      new URLSearchParams(window.location.search).get(PREVIEW_PERF_PANEL_QUERY_KEY)
    );
    if (queryOverride !== null) {
      panelEnabled = queryOverride;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, panelEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    } else {
      try {
        const persisted = window.localStorage.getItem(PREVIEW_PERF_PANEL_STORAGE_KEY);
        if (persisted === '1' || persisted === '0') {
          panelEnabled = persisted === '1';
        }
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    }
    window.__PREVIEW_PERF_PANEL__ = panelEnabled;
    setShowPerfPanel(panelEnabled);
    setPerfPanelSnapshot(panelEnabled ? window.__PREVIEW_PERF__ ?? null : null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'p')) return;
      event.preventDefault();
      const nextEnabled = !(window.__PREVIEW_PERF_PANEL__ === true);
      window.__PREVIEW_PERF_PANEL__ = nextEnabled;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, nextEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
      setShowPerfPanel(nextEnabled);
      if (!nextEnabled) {
        setPerfPanelSnapshot(null);
      }
    };

    const intervalId = setInterval(() => {
      if (window.__PREVIEW_PERF_PANEL__ !== true) return;
      setPerfPanelSnapshot(window.__PREVIEW_PERF__ ?? null);
    }, 250);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(intervalId);
    };
  }, []);

  // Keep a capped moving warm set in VideoSourcePool instead of preloading all sources.
  // This avoids memory blowups on large projects while keeping nearby clips hot.
  useEffect(() => {
    const pool = getGlobalVideoSourcePool();
    if (resolvedUrls.size === 0) {
      pool.pruneUnused(new Set());
      const poolStats = pool.getStats();
      previewPerfRef.current.sourceWarmTarget = 0;
      previewPerfRef.current.sourceWarmKeep = 0;
      previewPerfRef.current.sourcePoolSources = poolStats.sourceCount;
      previewPerfRef.current.sourcePoolElements = poolStats.totalElements;
      previewPerfRef.current.sourcePoolActiveClips = poolStats.activeClips;
      return;
    }

    const recentTouches = new Map<string, number>();
    let rafId: number | null = null;

    const collectCandidates = (
      spans: VideoSourceSpan[],
      anchorFrame: number,
      windowFrames: number,
      baseScore: number,
      candidateScores: Map<string, number>
    ) => {
      const minFrame = anchorFrame - windowFrames;
      const maxFrame = anchorFrame + windowFrames;

      for (const span of spans) {
        if (span.endFrame < minFrame || span.startFrame > maxFrame) continue;

        const distance = anchorFrame < span.startFrame
          ? (span.startFrame - anchorFrame)
          : anchorFrame > span.endFrame
            ? (anchorFrame - span.endFrame)
            : 0;

        const score = baseScore + distance;
        const existing = candidateScores.get(span.src);
        if (existing === undefined || score < existing) {
          candidateScores.set(span.src, score);
        }
      }
    };

    const refreshWarmSet = () => {
      const now = performance.now();
      const playback = usePlaybackStore.getState();
      const interactionMode = getPreviewInteractionMode({
        isPlaying: playback.isPlaying,
        previewFrame: playback.previewFrame,
        isGizmoInteracting: isGizmoInteractingRef.current,
      });
      const poolStatsBefore = pool.getStats();
      const warmTarget = getSourceWarmTarget({
        mode: interactionMode,
        currentPoolSourceCount: poolStatsBefore.sourceCount,
        currentPoolElementCount: poolStatsBefore.totalElements,
        maxSources: SOURCE_WARM_MAX_SOURCES,
        minSources: SOURCE_WARM_MIN_SOURCES,
        hardCapSources: SOURCE_WARM_HARD_CAP_SOURCES,
        hardCapElements: SOURCE_WARM_HARD_CAP_ELEMENTS,
      });
      const candidateScores = new Map<string, number>();
      const playheadWindowFrames = Math.max(12, Math.round(fps * SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS));
      const scrubWindowFrames = Math.max(8, Math.round(fps * SOURCE_WARM_SCRUB_WINDOW_SECONDS));

      collectCandidates(
        playbackVideoSourceSpans,
        playback.currentFrame,
        playheadWindowFrames,
        100,
        candidateScores
      );

      if (interactionMode === 'scrubbing' && playback.previewFrame !== null) {
        collectCandidates(
          scrubVideoSourceSpans,
          playback.previewFrame,
          scrubWindowFrames,
          0,
          candidateScores
        );
      }

      const selectedSources = [...candidateScores.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, warmTarget)
        .map(([src]) => src);

      for (const src of selectedSources) {
        recentTouches.set(src, now);
        pool.preloadSource(src).catch(() => {});
      }

      const keepWarm = new Set<string>(selectedSources);
      const stickySources = [...recentTouches.entries()]
        .filter(([src, touchedAt]) =>
          !keepWarm.has(src) && (now - touchedAt) <= SOURCE_WARM_STICKY_MS
        )
        .sort((a, b) => b[1] - a[1]);

      for (const [src] of stickySources) {
        if (keepWarm.size >= warmTarget) break;
        keepWarm.add(src);
      }

      let warmEvictionsThisTick = 0;
      for (const [src, touchedAt] of recentTouches.entries()) {
        if ((now - touchedAt) > SOURCE_WARM_STICKY_MS) {
          recentTouches.delete(src);
          warmEvictionsThisTick += 1;
        }
      }

      const touchOverflow = Math.max(0, recentTouches.size - SOURCE_WARM_HARD_CAP_SOURCES);
      if (touchOverflow > 0) {
        const evictionCandidates = [...recentTouches.entries()]
          .filter(([src]) => !keepWarm.has(src))
          .sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < evictionCandidates.length && i < touchOverflow; i++) {
          const [src] = evictionCandidates[i]!;
          if (recentTouches.delete(src)) {
            warmEvictionsThisTick += 1;
          }
        }
      }

      pool.pruneUnused(keepWarm);
      const poolStatsAfter = pool.getStats();
      previewPerfRef.current.sourceWarmTarget = warmTarget;
      previewPerfRef.current.sourceWarmKeep = keepWarm.size;
      previewPerfRef.current.sourceWarmEvictions += warmEvictionsThisTick;
      previewPerfRef.current.sourcePoolSources = poolStatsAfter.sourceCount;
      previewPerfRef.current.sourcePoolElements = poolStatsAfter.totalElements;
      previewPerfRef.current.sourcePoolActiveClips = poolStatsAfter.activeClips;
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
        // start loading immediately â€” don't wait for the next animation frame.
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
  }, [resolvedUrls, playbackVideoSourceSpans, scrubVideoSourceSpans, fps]);

  // Memoize inputProps to prevent Player from re-rendering
  const inputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: resolvedTracks as CompositionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes,
  }), [fps, project.width, project.height, resolvedTracks, transitions, project.backgroundColor, keyframes]);

  // Keep main Player geometry fixed at project resolution.
  // This prevents quality toggles from changing the live preview sampling path,
  // which can look like layout drift on certain source aspect ratios.
  const playerRenderSize = useMemo(() => {
    const w = Math.max(2, project.width);
    const h = Math.max(2, project.height);
    return { width: w, height: h };
  }, [project.width, project.height]);

  // Fast scrub renderer uses integer dimensions; keep them even for decoder
  // compatibility in OffscreenCanvas/video paths.
  const renderSize = useMemo(() => {
    const projectWidth = Math.max(1, Math.round(project.width));
    const projectHeight = Math.max(1, Math.round(project.height));
    if (effectivePreviewQuality === 1) {
      return { width: projectWidth, height: projectHeight };
    }
    const w = Math.floor(projectWidth * effectivePreviewQuality / 2) * 2;
    const h = Math.floor(projectHeight * effectivePreviewQuality / 2) * 2;
    return { width: Math.max(2, w), height: Math.max(2, h) };
  }, [project.width, project.height, effectivePreviewQuality]);

  const fastScrubScaledTracks = useMemo(() => {
    const tracks = fastScrubTracks as CompositionInputProps['tracks'];
    if (effectivePreviewQuality === 1) return tracks;

    const sx = project.width > 0 ? renderSize.width / project.width : 1;
    const sy = project.height > 0 ? renderSize.height / project.height : 1;
    const s = Math.min(sx, sy);
    return scaleTracksForPreview(tracks, sx, sy, s);
  }, [
    fastScrubTracks,
    fastScrubTracksFingerprint,
    effectivePreviewQuality,
    renderSize.width,
    renderSize.height,
    project.width,
    project.height,
  ]);

  const fastScrubScaledKeyframes = useMemo(() => {
    if (effectivePreviewQuality === 1) return keyframes;

    const sx = project.width > 0 ? renderSize.width / project.width : 1;
    const sy = project.height > 0 ? renderSize.height / project.height : 1;
    const s = Math.min(sx, sy);
    return scaleKeyframesForPreview(keyframes, sx, sy, s);
  }, [
    keyframes,
    effectivePreviewQuality,
    renderSize.width,
    renderSize.height,
    project.width,
    project.height,
  ]);

  const fastScrubInputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: renderSize.width,
    height: renderSize.height,
    tracks: fastScrubScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: fastScrubScaledKeyframes,
  }), [
    fps,
    renderSize.width,
    renderSize.height,
    fastScrubScaledTracks,
    transitions,
    project.backgroundColor,
    fastScrubScaledKeyframes,
  ]);

  // Keep fast scrub canvas dimensions in sync with preview render dimensions.
  useLayoutEffect(() => {
    const canvas = scrubCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== renderSize.width) canvas.width = renderSize.width;
    if (canvas.height !== renderSize.height) canvas.height = renderSize.height;
  }, [renderSize.width, renderSize.height]);

  const disposeFastScrubRenderer = useCallback(() => {
    scrubInitPromiseRef.current = null;
    scrubPreloadPromiseRef.current = null;
    scrubRequestedFrameRef.current = null;
    scrubRenderInFlightRef.current = false;
    scrubPrewarmQueueRef.current = [];
    scrubPrewarmQueuedSetRef.current.clear();
    scrubPrewarmedFramesRef.current = [];
    scrubPrewarmedFrameSetRef.current.clear();
    scrubPrewarmedSourcesRef.current.clear();
    scrubPrewarmedSourceOrderRef.current = [];
    scrubPrewarmedSourceTouchFrameRef.current.clear();
    previewPerfRef.current.fastScrubPrewarmedSources = 0;
    bypassPreviewSeekRef.current = false;

    if (scrubRendererRef.current) {
      try {
        scrubRendererRef.current.dispose();
      } catch (error) {
        console.warn('[FastScrub] Failed to dispose renderer:', error);
      }
      scrubRendererRef.current = null;
    }

    scrubOffscreenCanvasRef.current = null;
    scrubOffscreenCtxRef.current = null;
  }, []);

  const ensureFastScrubRenderer = useCallback(async (): Promise<CompositionRenderer | null> => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (isResolving) return null;
    if (scrubRendererRef.current) return scrubRendererRef.current;
    if (scrubInitPromiseRef.current) return scrubInitPromiseRef.current;

    scrubInitPromiseRef.current = (async () => {
      try {
        const offscreen = new OffscreenCanvas(renderSize.width, renderSize.height);
        const offscreenCtx = offscreen.getContext('2d');
        if (!offscreenCtx) return null;

        const renderer = await createCompositionRenderer(fastScrubInputProps, offscreen, offscreenCtx, { mode: 'preview' });
        const playbackState = usePlaybackStore.getState();
        const interactionMode = getPreviewInteractionMode({
          isPlaying: playbackState.isPlaying,
          previewFrame: playbackState.previewFrame,
          isGizmoInteracting: isGizmoInteractingRef.current,
        });
        const preloadPriorityFrame = getPreviewAnchorFrame(interactionMode, {
          currentFrame: playbackState.currentFrame,
          previewFrame: playbackState.previewFrame,
        });
        const preloadPromise = renderer.preload({
          priorityFrame: preloadPriorityFrame,
          priorityWindowFrames: Math.max(12, Math.round(fps * 4)),
        })
          .catch((error) => {
            console.warn('[FastScrub] Renderer preload failed:', error);
          })
          .finally(() => {
            if (scrubPreloadPromiseRef.current === preloadPromise) {
              scrubPreloadPromiseRef.current = null;
            }
          });
        scrubPreloadPromiseRef.current = preloadPromise;

        await Promise.race([
          preloadPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, FAST_SCRUB_PRELOAD_BUDGET_MS);
          }),
        ]);

        scrubOffscreenCanvasRef.current = offscreen;
        scrubOffscreenCtxRef.current = offscreenCtx;
        scrubRendererRef.current = renderer;
        return renderer;
      } catch (error) {
        console.warn('[FastScrub] Failed to initialize renderer, falling back to Player seeks:', error);
        scrubRendererRef.current = null;
        scrubOffscreenCanvasRef.current = null;
        scrubOffscreenCtxRef.current = null;
        return null;
      } finally {
        scrubInitPromiseRef.current = null;
      }
    })();

    return scrubInitPromiseRef.current;
  }, [fastScrubInputProps, fps, isResolving, renderSize.height, renderSize.width]);

  // Dispose/recreate fast scrub renderer when composition inputs change.
  useEffect(() => {
    disposeFastScrubRenderer();
  }, [disposeFastScrubRenderer, fastScrubInputProps, renderSize.height, renderSize.width]);

  // Background warm-up so first scrub has lower startup latency.
  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED || isResolving) return;
    if (scrubRendererRef.current || scrubInitPromiseRef.current) return;

    let cancelled = false;
    const warmup = () => {
      if (cancelled || scrubRendererRef.current || scrubInitPromiseRef.current) return;
      void ensureFastScrubRenderer();
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = (window as Window & { requestIdleCallback: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number })
        .requestIdleCallback(() => warmup(), { timeout: 400 });
    } else {
      timeoutId = setTimeout(warmup, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [ensureFastScrubRenderer, isResolving]);

  // Drive full-composition fast scrub rendering from previewFrame.
  useEffect(() => {
    scrubMountedRef.current = true;

    const drawToDisplay = () => {
      const displayCanvas = scrubCanvasRef.current;
      const offscreen = scrubOffscreenCanvasRef.current;
      if (!displayCanvas || !offscreen) return;

      const displayCtx = displayCanvas.getContext('2d');
      if (!displayCtx) return;
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.drawImage(offscreen, 0, 0, displayCanvas.width, displayCanvas.height);
    };

    const pumpRenderLoop = async () => {
      if (scrubRenderInFlightRef.current) return;
      scrubRenderInFlightRef.current = true;

      try {
        const enqueuePrewarmFrame = (frame: number) => {
          if (frame < 0) return;
          if (scrubPrewarmQueuedSetRef.current.has(frame)) return;
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return;
          scrubPrewarmQueuedSetRef.current.add(frame);
          scrubPrewarmQueueRef.current.push(frame);
          while (scrubPrewarmQueueRef.current.length > FAST_SCRUB_PREWARM_QUEUE_MAX) {
            const dropped = scrubPrewarmQueueRef.current.shift();
            if (dropped !== undefined) {
              scrubPrewarmQueuedSetRef.current.delete(dropped);
            }
          }
        };

        const markPrewarmed = (frame: number) => {
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return;
          scrubPrewarmedFrameSetRef.current.add(frame);
          scrubPrewarmedFramesRef.current.push(frame);

          if (scrubPrewarmedFramesRef.current.length > FAST_SCRUB_MAX_PREWARM_FRAMES) {
            const dropped = scrubPrewarmedFramesRef.current.shift();
            if (dropped !== undefined) {
              scrubPrewarmedFrameSetRef.current.delete(dropped);
            }
          }
        };

        const enqueueBoundaryPrewarm = (targetFrame: number) => {
          if (fastScrubBoundaryFrames.length === 0) return;

          const windowFrames = Math.max(
            4,
            Math.round(fps * FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS)
          );
          const minFrame = targetFrame - windowFrames;
          const maxFrame = targetFrame + windowFrames;
          const direction = scrubDirectionRef.current;
          const directionalCandidates: number[] = [];
          const fallbackCandidates: number[] = [];

          for (const boundary of fastScrubBoundaryFrames) {
            if (boundary < minFrame) continue;
            if (boundary > maxFrame) break;
            fallbackCandidates.push(boundary);
            if (direction > 0 && boundary < targetFrame - 1) continue;
            if (direction < 0 && boundary > targetFrame + 1) continue;
            directionalCandidates.push(boundary);
          }

          const candidates = directionalCandidates.length > 0
            ? directionalCandidates
            : fallbackCandidates;
          if (candidates.length === 0) return;

          const selectedBoundaries = [...candidates]
            .sort((a, b) => Math.abs(a - targetFrame) - Math.abs(b - targetFrame))
            .slice(0, FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME);

          for (const boundary of selectedBoundaries) {
            enqueuePrewarmFrame(Math.max(0, boundary - 1));
            enqueuePrewarmFrame(boundary);
            enqueuePrewarmFrame(boundary + 1);
          }
        };

        const enqueueBoundarySourcePrewarm = (targetFrame: number) => {
          if (fastScrubBoundarySources.length === 0) return;

          const pool = getGlobalVideoSourcePool();
          const touchFrameMap = scrubPrewarmedSourceTouchFrameRef.current;
          const markBoundarySourcePrewarmed = (src: string, currentFrame: number): boolean => {
            const lastTouchedFrame = touchFrameMap.get(src);
            if (
              lastTouchedFrame !== undefined
              && Math.abs(currentFrame - lastTouchedFrame) < FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES
            ) {
              return false;
            }
            touchFrameMap.set(src, currentFrame);
            const prewarmedSet = scrubPrewarmedSourcesRef.current;
            const prewarmedOrder = scrubPrewarmedSourceOrderRef.current;
            const existingIndex = prewarmedOrder.indexOf(src);
            if (existingIndex >= 0) {
              prewarmedOrder.splice(existingIndex, 1);
            } else {
              prewarmedSet.add(src);
            }
            prewarmedOrder.push(src);

            while (prewarmedOrder.length > FAST_SCRUB_MAX_PREWARM_SOURCES) {
              const evicted = prewarmedOrder.shift();
              if (evicted === undefined) break;
              if (prewarmedSet.delete(evicted)) {
                touchFrameMap.delete(evicted);
                previewPerfRef.current.fastScrubPrewarmSourceEvictions += 1;
              }
            }

            previewPerfRef.current.fastScrubPrewarmedSources = prewarmedSet.size;
            return true;
          };
          const windowFrames = Math.max(
            8,
            Math.round(fps * FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS)
          );
          const minFrame = targetFrame - windowFrames;
          const maxFrame = targetFrame + windowFrames;
          const direction = scrubDirectionRef.current;
          const directionalEntries: FastScrubBoundarySource[] = [];
          const fallbackEntries: FastScrubBoundarySource[] = [];

          for (const entry of fastScrubBoundarySources) {
            if (entry.frame < minFrame) continue;
            if (entry.frame > maxFrame) break;
            fallbackEntries.push(entry);
            if (direction > 0 && entry.frame < targetFrame - 1) continue;
            if (direction < 0 && entry.frame > targetFrame + 1) continue;
            directionalEntries.push(entry);
          }

          const candidateEntries = directionalEntries.length > 0
            ? directionalEntries
            : fallbackEntries;
          if (candidateEntries.length === 0) return;

          const selectedEntries = [...candidateEntries]
            .sort((a, b) => Math.abs(a.frame - targetFrame) - Math.abs(b.frame - targetFrame))
            .slice(0, FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME);
          let sourcesBudget = FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME;

          for (const entry of selectedEntries) {
            for (const src of entry.srcs) {
              if (sourcesBudget <= 0) return;
              const wasPrewarmed = scrubPrewarmedSourcesRef.current.has(src);
              const touched = markBoundarySourcePrewarmed(src, targetFrame);
              if (!touched) continue;
              sourcesBudget -= 1;
              if (!wasPrewarmed) {
                pool.preloadSource(src).catch(() => {});
              }
            }
          }
        };

        const enqueueDirectionalPrewarm = (targetFrame: number) => {
          const offsets = getDirectionalPrewarmOffsets(scrubDirectionRef.current, {
            forwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
            backwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
            oppositeSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
            neutralRadius: FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
          });
          for (const offset of offsets) {
            enqueuePrewarmFrame(targetFrame + offset);
          }
        };

        while (scrubMountedRef.current) {
          if (isGizmoInteractingRef.current) {
            setShowFastScrubOverlay(false);
            bypassPreviewSeekRef.current = false;
            scrubRequestedFrameRef.current = null;
            break;
          }
          if (fallbackToPlayerScrubRef.current) {
            scrubRequestedFrameRef.current = null;
            scrubPrewarmQueueRef.current = [];
            scrubPrewarmQueuedSetRef.current.clear();
            setShowFastScrubOverlay(false);
            bypassPreviewSeekRef.current = false;
            break;
          }

          const targetFrame = scrubRequestedFrameRef.current;
          const isPriorityFrame = targetFrame !== null;
          const frameToRender = isPriorityFrame
            ? targetFrame
            : (scrubPrewarmQueueRef.current.shift() ?? null);

          if (frameToRender === null) break;

          if (isPriorityFrame) {
            scrubRequestedFrameRef.current = null;
          } else {
            scrubPrewarmQueuedSetRef.current.delete(frameToRender);
            // Skip stale prewarm if a newer scrub frame is pending.
            if (scrubRequestedFrameRef.current !== null) {
              continue;
            }
            if (suppressScrubBackgroundPrewarmRef.current) {
              continue;
            }
          }

          const renderer = await ensureFastScrubRenderer();
          if (!renderer || !scrubMountedRef.current) {
            setShowFastScrubOverlay(false);
            bypassPreviewSeekRef.current = false;
            break;
          }

          if (isPriorityFrame || !('prewarmFrame' in renderer) || typeof renderer.prewarmFrame !== 'function') {
            await renderer.renderFrame(frameToRender);
          } else {
            await renderer.prewarmFrame(frameToRender);
          }
          if (!scrubMountedRef.current) break;

          if (isPriorityFrame) {
            const playbackState = usePlaybackStore.getState();
            if (fallbackToPlayerScrubRef.current) {
              setShowFastScrubOverlay(false);
              bypassPreviewSeekRef.current = false;
              continue;
            }
            // Guard against stale in-flight renders that finish after scrub has ended.
            // Without this, a completed old render can re-show the overlay and hide
            // live Player updates (e.g. ruler click + gizmo interaction).
            if (!shouldShowFastScrubOverlay({
              isGizmoInteracting: isGizmoInteractingRef.current,
              isPlaying: playbackState.isPlaying,
              previewFrame: playbackState.previewFrame,
              renderedFrame: frameToRender,
            })) {
              previewPerfRef.current.staleScrubOverlayDrops += 1;
              setShowFastScrubOverlay(false);
              bypassPreviewSeekRef.current = false;
              continue;
            }

            drawToDisplay();
            setShowFastScrubOverlay(true);
            bypassPreviewSeekRef.current = true;
            if (!suppressScrubBackgroundPrewarmRef.current) {
              enqueueDirectionalPrewarm(frameToRender);
              enqueueBoundaryPrewarm(frameToRender);
              enqueueBoundarySourcePrewarm(frameToRender);
            }
          } else {
            markPrewarmed(frameToRender);
          }
        }
      } catch (error) {
        console.warn('[FastScrub] Render failed, using Player seek fallback:', error);
        setShowFastScrubOverlay(false);
        bypassPreviewSeekRef.current = false;
        disposeFastScrubRenderer();
      } finally {
        scrubRenderInFlightRef.current = false;
      }
    };

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      if (isGizmoInteractingRef.current) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        setShowFastScrubOverlay(false);
        bypassPreviewSeekRef.current = false;
        return;
      }

      if (state.isPlaying) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        setShowFastScrubOverlay(false);
        bypassPreviewSeekRef.current = false;
        return;
      }

      if (state.previewFrame === prev.previewFrame) return;

      if (state.previewFrame !== null && prev.previewFrame !== null) {
        const previewDelta = state.previewFrame - prev.previewFrame;
        scrubDirectionRef.current = previewDelta > 0 ? 1 : previewDelta < 0 ? -1 : 0;
        const deltaFrames = Math.abs(previewDelta);
        previewPerfRef.current.scrubUpdates += 1;
        if (deltaFrames > 1) {
          previewPerfRef.current.scrubDroppedFrames += (deltaFrames - 1);
        }
      } else if (state.previewFrame !== null) {
        scrubDirectionRef.current = 0;
      }

      const nextSuppressBackgroundPrewarm = FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD
        && scrubDirectionRef.current < 0;
      const nextFallbackToPlayer = FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD
        && scrubDirectionRef.current < 0;
      if (nextSuppressBackgroundPrewarm !== suppressScrubBackgroundPrewarmRef.current) {
        suppressScrubBackgroundPrewarmRef.current = nextSuppressBackgroundPrewarm;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
      }
      if (nextFallbackToPlayer !== fallbackToPlayerScrubRef.current) {
        fallbackToPlayerScrubRef.current = nextFallbackToPlayer;
        scrubRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        if (nextFallbackToPlayer) {
          setShowFastScrubOverlay(false);
          bypassPreviewSeekRef.current = false;
        }
      }
      if (fallbackToPlayerScrubRef.current && state.previewFrame !== null) {
        // Let Player seek path handle backward scrubbing directly.
        setShowFastScrubOverlay(false);
        bypassPreviewSeekRef.current = false;
        return;
      }

      if (state.previewFrame === null) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        setShowFastScrubOverlay(false);
        bypassPreviewSeekRef.current = false;
        // Ensure the Player lands on the actual playhead after overlay scrub.
        try {
          const playerFrame = playerRef.current?.getCurrentFrame();
          const roundedFrame = Number.isFinite(playerFrame)
            ? Math.round(playerFrame as number)
            : null;
          if (roundedFrame !== state.currentFrame) {
            trackPlayerSeek(state.currentFrame);
          }
          playerRef.current?.seekTo(state.currentFrame);
        } catch {
          // Fallback path remains active via useCustomPlayer subscription.
        }
        return;
      }

      if (scrubRequestedFrameRef.current === state.previewFrame) {
        return;
      }

      let nextRequestedFrame = state.previewFrame;
      if (scrubDirectionRef.current < 0) {
        const nowMs = performance.now();
        const quantizedFrame = Math.floor(
          state.previewFrame / FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES
        ) * FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES;
        const lastRequested = lastBackwardRequestedFrameRef.current;
        const withinThrottle = (
          (nowMs - lastBackwardScrubRenderAtRef.current) < FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS
        );
        const jumpDistance = lastRequested === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(quantizedFrame - lastRequested);

        if (withinThrottle && jumpDistance < FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES) {
          return;
        }

        lastBackwardScrubRenderAtRef.current = nowMs;
        lastBackwardRequestedFrameRef.current = quantizedFrame;
        nextRequestedFrame = quantizedFrame;
      } else {
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
      }

      // New scrub target should preempt stale background prewarm work.
      scrubPrewarmQueueRef.current = [];
      scrubPrewarmQueuedSetRef.current.clear();
      scrubRequestedFrameRef.current = nextRequestedFrame;
      void pumpRenderLoop();
    });

    return () => {
      scrubMountedRef.current = false;
      suppressScrubBackgroundPrewarmRef.current = false;
      fallbackToPlayerScrubRef.current = false;
      lastBackwardScrubRenderAtRef.current = 0;
      lastBackwardRequestedFrameRef.current = null;
      unsubscribe();
    };
  }, [
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    fps,
    trackPlayerSeek,
  ]);

  // Preload media files ahead of the current playhead to reduce buffering
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let continuationTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedulePreloadContinuation = () => {
      if (continuationTimeoutId !== null) return;
      previewPerfRef.current.preloadContinuations += 1;
      continuationTimeoutId = setTimeout(() => {
        continuationTimeoutId = null;
        void preloadMedia();
      }, 16);
    };

    const preloadMedia = async () => {
      if (preloadResolveInFlightRef.current) return;
      if (combinedTracks.length === 0) return;
      const burstActive = preloadBurstRemainingRef.current > 0;
      if (burstActive) {
        preloadBurstRemainingRef.current = Math.max(0, preloadBurstRemainingRef.current - 1);
      }

      const playbackState = usePlaybackStore.getState();
      const interactionMode = getPreviewInteractionMode({
        isPlaying: playbackState.isPlaying,
        previewFrame: playbackState.previewFrame,
        isGizmoInteracting: isGizmoInteractingRef.current,
      });
      const anchorFrame = getPreviewAnchorFrame(interactionMode, {
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
      });
      const previousAnchorFrame = preloadLastAnchorFrameRef.current;
      preloadLastAnchorFrameRef.current = anchorFrame;
      const scrubDirection: -1 | 0 | 1 = interactionMode === 'scrubbing' && previousAnchorFrame !== null
        ? getFrameDirection(previousAnchorFrame, anchorFrame)
        : 0;
      if (
        PRELOAD_SKIP_ON_BACKWARD_SCRUB
        && interactionMode === 'scrubbing'
        && scrubDirection < 0
      ) {
        previewPerfRef.current.preloadCandidateIds = 0;
        previewPerfRef.current.preloadBudgetBase = getPreloadBudget(interactionMode);
        previewPerfRef.current.preloadBudgetAdjusted = 0;
        previewPerfRef.current.preloadWindowMaxCost = 0;
        previewPerfRef.current.preloadScrubDirection = scrubDirection;
        previewPerfRef.current.preloadDirectionPenaltyCount = 0;
        return;
      }
      const { startFrame: preloadStartFrame, endFrame: preloadEndFrame } = getPreloadWindowRange({
        mode: interactionMode,
        anchorFrame,
        scrubDirection,
        fps,
        aheadSeconds: PRELOAD_AHEAD_SECONDS,
      });
      const baseMaxIdsPerTick = getPreloadBudget(interactionMode);
      const backwardScrubExtraIds = (
        interactionMode === 'scrubbing' && scrubDirection < 0
      )
        ? PRELOAD_BACKWARD_SCRUB_EXTRA_IDS
        : 0;
      const boostedBaseMaxIdsPerTick = burstActive
        ? Math.min(
            PRELOAD_BURST_MAX_IDS_PER_TICK,
            baseMaxIdsPerTick + PRELOAD_BURST_EXTRA_IDS + backwardScrubExtraIds
          )
        : (baseMaxIdsPerTick + backwardScrubExtraIds);
      const now = Date.now();
      const unresolvedSet = unresolvedMediaIdSetRef.current;
      const costPenaltyFrames = Math.max(8, Math.round(fps * 0.6));
      const scrubDirectionBiasFrames = Math.max(
        8,
        Math.round(fps * PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS)
      );
      const scanStartTime = performance.now();
      let maxActiveWindowCost = 0;
      let directionPenaltyCount = 0;
      let reachedScanTimeBudget = false;
      let trackIndex = ((preloadScanTrackCursorRef.current % combinedTracks.length) + combinedTracks.length) % combinedTracks.length;
      let itemIndex = Math.max(0, preloadScanItemCursorRef.current);

      const mediaToPreloadScores = new Map<string, number>();
      if (interactionMode === 'scrubbing') {
        for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
          const currentTrackIndex = (trackIndex + trackCount) % combinedTracks.length;
          const track = combinedTracks[currentTrackIndex]!;
          const trackItems = track.items;
          if (trackItems.length === 0) continue;

          const step = scrubDirection < 0 ? -1 : 1;
          let localItemIndex = getDirectionalScrubStartIndex(
            trackItems,
            anchorFrame,
            scrubDirection
          );

          while (localItemIndex >= 0 && localItemIndex < trackItems.length) {
            const item = trackItems[localItemIndex]!;
            if (!item.mediaId) {
              localItemIndex += step;
              continue;
            }

            const itemEnd = item.from + item.durationInFrames;
            if (item.from <= preloadEndFrame && itemEnd >= preloadStartFrame) {
              if (
                unresolvedSet.has(item.mediaId)
                && getResolveRetryAt(item.mediaId) <= now
              ) {
                const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1;
                if (mediaCost > maxActiveWindowCost) {
                  maxActiveWindowCost = mediaCost;
                }
                const distanceToPlayhead = anchorFrame < item.from
                  ? item.from - anchorFrame
                  : anchorFrame > itemEnd
                    ? anchorFrame - itemEnd
                    : 0;
                let score = distanceToPlayhead + (mediaCost * costPenaltyFrames);
                if (scrubDirection !== 0) {
                  const itemCenterFrame = item.from + (item.durationInFrames * 0.5);
                  const isDirectionAligned = scrubDirection > 0
                    ? itemCenterFrame >= anchorFrame
                    : itemCenterFrame <= anchorFrame;
                  if (!isDirectionAligned) {
                    score += scrubDirectionBiasFrames;
                    directionPenaltyCount += 1;
                  }
                }
                const previousScore = mediaToPreloadScores.get(item.mediaId);
                if (previousScore === undefined || score < previousScore) {
                  mediaToPreloadScores.set(item.mediaId, score);
                }
              }
            }

            if ((performance.now() - scanStartTime) >= PRELOAD_SCAN_TIME_BUDGET_MS) {
              preloadScanTrackCursorRef.current = currentTrackIndex;
              preloadScanItemCursorRef.current = 0;
              reachedScanTimeBudget = true;
              break;
            }

            localItemIndex += step;
          }

          if (reachedScanTimeBudget) break;
        }

        if (!reachedScanTimeBudget) {
          preloadScanTrackCursorRef.current = (trackIndex + 1) % combinedTracks.length;
          preloadScanItemCursorRef.current = 0;
        }
      } else {
        for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
          const track = combinedTracks[trackIndex]!;
          const trackItems = track.items;
          const startItemIndex = trackCount === 0 ? itemIndex : 0;

          for (let localItemIndex = startItemIndex; localItemIndex < trackItems.length; localItemIndex++) {
            const item = trackItems[localItemIndex]!;
            if (!item.mediaId) continue;
            const itemEnd = item.from + item.durationInFrames;
            if (item.from <= preloadEndFrame && itemEnd >= preloadStartFrame) {
              if (
                unresolvedSet.has(item.mediaId)
                && getResolveRetryAt(item.mediaId) <= now
              ) {
                const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1;
                if (mediaCost > maxActiveWindowCost) {
                  maxActiveWindowCost = mediaCost;
                }
                const distanceToPlayhead = anchorFrame < item.from
                  ? item.from - anchorFrame
                  : anchorFrame > itemEnd
                    ? anchorFrame - itemEnd
                    : 0;
                let score = distanceToPlayhead + (mediaCost * costPenaltyFrames);
                if (scrubDirection !== 0) {
                  const itemCenterFrame = item.from + (item.durationInFrames * 0.5);
                  const isDirectionAligned = scrubDirection > 0
                    ? itemCenterFrame >= anchorFrame
                    : itemCenterFrame <= anchorFrame;
                  if (!isDirectionAligned) {
                    score += scrubDirectionBiasFrames;
                    directionPenaltyCount += 1;
                  }
                }
                const previousScore = mediaToPreloadScores.get(item.mediaId);
                if (previousScore === undefined || score < previousScore) {
                  mediaToPreloadScores.set(item.mediaId, score);
                }
              }
            }

            if ((performance.now() - scanStartTime) >= PRELOAD_SCAN_TIME_BUDGET_MS) {
              let nextTrackIndex = trackIndex;
              let nextItemIndex = localItemIndex + 1;
              if (nextItemIndex >= trackItems.length) {
                nextTrackIndex = (trackIndex + 1) % combinedTracks.length;
                nextItemIndex = 0;
              }
              preloadScanTrackCursorRef.current = nextTrackIndex;
              preloadScanItemCursorRef.current = nextItemIndex;
              reachedScanTimeBudget = true;
              break;
            }
          }

          if (reachedScanTimeBudget) break;

          trackIndex = (trackIndex + 1) % combinedTracks.length;
          itemIndex = 0;
        }

        if (!reachedScanTimeBudget) {
          preloadScanTrackCursorRef.current = trackIndex;
          preloadScanItemCursorRef.current = 0;
        }
      }

      const scanDurationMs = performance.now() - scanStartTime;
      previewPerfRef.current.preloadScanSamples += 1;
      previewPerfRef.current.preloadScanTotalMs += scanDurationMs;
      previewPerfRef.current.preloadScanLastMs = scanDurationMs;
      if (reachedScanTimeBudget) {
        previewPerfRef.current.preloadScanBudgetYields += 1;
      }

      const maxIdsPerTick = getCostAdjustedBudget(boostedBaseMaxIdsPerTick, maxActiveWindowCost);
      previewPerfRef.current.preloadCandidateIds = mediaToPreloadScores.size;
      previewPerfRef.current.preloadBudgetBase = baseMaxIdsPerTick;
      previewPerfRef.current.preloadBudgetAdjusted = maxIdsPerTick;
      previewPerfRef.current.preloadWindowMaxCost = maxActiveWindowCost;
      previewPerfRef.current.preloadScrubDirection = scrubDirection;
      previewPerfRef.current.preloadDirectionPenaltyCount = directionPenaltyCount;

      if (mediaToPreloadScores.size === 0) {
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation();
        }
        return;
      }

      const mediaToPreload = [...mediaToPreloadScores.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, maxIdsPerTick)
        .map(([mediaId]) => mediaId);

      preloadResolveInFlightRef.current = true;
      try {
        const preloadBatchStartMs = performance.now();
        const { resolvedEntries, failedIds } = await resolveMediaBatch(mediaToPreload);
        const preloadBatchDurationMs = performance.now() - preloadBatchStartMs;
        previewPerfRef.current.preloadBatchSamples += 1;
        previewPerfRef.current.preloadBatchTotalMs += preloadBatchDurationMs;
        previewPerfRef.current.preloadBatchLastMs = preloadBatchDurationMs;
        previewPerfRef.current.preloadBatchLastIds = mediaToPreload.length;
        if (resolvedEntries.length > 0) {
          const resolvedNow: string[] = [];
          const applicableEntries: Array<{ mediaId: string; url: string }> = [];
          for (const entry of resolvedEntries) {
            if (!unresolvedMediaIdSetRef.current.has(entry.mediaId)) continue;
            resolvedNow.push(entry.mediaId);
            applicableEntries.push(entry);
          }
          setResolvedUrls((prevUrls) => {
            const nextUrls = new Map(prevUrls);
            let changed = false;
            for (const entry of applicableEntries) {
              if (nextUrls.get(entry.mediaId) === entry.url) continue;
              nextUrls.set(entry.mediaId, entry.url);
              changed = true;
            }
            return changed ? nextUrls : prevUrls;
          });
          clearResolveRetryState(resolvedNow);
          removeUnresolvedMediaIds(resolvedNow);
        }
        if (failedIds.length > 0) {
          const retryAt = markResolveFailures(failedIds);
          if (retryAt !== null) {
            scheduleResolveRetryWake(retryAt);
          }
        }
      } finally {
        preloadResolveInFlightRef.current = false;
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation();
        }
      }
    };

    const startPreloadBurst = () => {
      preloadBurstRemainingRef.current = Math.max(
        preloadBurstRemainingRef.current,
        PRELOAD_BURST_PASSES
      );
      void preloadMedia();
    };

    void preloadMedia();

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      const transition = resolvePreviewTransitionDecision({
        prev: {
          isPlaying: prevState.isPlaying,
          previewFrame: prevState.previewFrame,
          currentFrame: prevState.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef.current,
        },
        next: {
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef.current,
        },
        fps,
      });
      const interactionMode = transition.next.mode;
      const burstTrigger = transition.preloadBurstTrigger;

      if (transition.enteredPlaying) {
        lastForwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubPreloadAtRef.current = 0;
        // Kick off an immediate preload pass so the first playback frames
        // don't stall waiting for the 1-second interval to fire.
        void preloadMedia();
        intervalId = setInterval(() => {
          void preloadMedia();
        }, 1000);
      } else if (burstTrigger === 'scrub_enter') {
        lastForwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubPreloadAtRef.current = 0;
        // Scrub-enter is latency-sensitive: front-load a few passes and
        // reprioritize URL resolution around the scrub anchor immediately.
        startPreloadBurst();
        kickResolvePass();
      } else if (
        interactionMode === 'scrubbing'
        && transition.previewFrameChanged
      ) {
        const previewDelta = (state.previewFrame ?? 0) - (prevState.previewFrame ?? 0);
        if (previewDelta < 0) {
          if (PRELOAD_SKIP_ON_BACKWARD_SCRUB) {
            return;
          }
          const nowMs = performance.now();
          if ((nowMs - lastBackwardScrubPreloadAtRef.current) < PRELOAD_BACKWARD_SCRUB_THROTTLE_MS) {
            return;
          }
          lastBackwardScrubPreloadAtRef.current = nowMs;
        } else if (previewDelta > 0) {
          const nowMs = performance.now();
          if ((nowMs - lastForwardScrubPreloadAtRef.current) < PRELOAD_FORWARD_SCRUB_THROTTLE_MS) {
            return;
          }
          lastForwardScrubPreloadAtRef.current = nowMs;
        }
        void preloadMedia();
      } else if (
        interactionMode !== 'playing'
        && interactionMode !== 'scrubbing'
        && transition.currentFrameChanged
      ) {
        lastForwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubPreloadAtRef.current = 0;
        // Ruler click sets currentFrame directly (no previewFrame).
        // Preload around the new position so sources are warm before play.
        if (burstTrigger === 'paused_short_seek') {
          startPreloadBurst();
        } else {
          void preloadMedia();
        }
        kickResolvePass();
      } else if (transition.exitedPlaying) {
        lastForwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubPreloadAtRef.current = 0;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    });

    return () => {
      unsubscribe();
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (continuationTimeoutId !== null) {
        clearTimeout(continuationTimeoutId);
      }
      lastForwardScrubPreloadAtRef.current = 0;
      lastBackwardScrubPreloadAtRef.current = 0;
      preloadBurstRemainingRef.current = 0;
    };
  }, [
    clearResolveRetryState,
    fps,
    combinedTracks,
    getResolveRetryAt,
    markResolveFailures,
    mediaResolveCostById,
    kickResolvePass,
    resolveMediaBatch,
    removeUnresolvedMediaIds,
    scheduleResolveRetryWake,
  ]);

  // Refresh blob URLs on tab wake-up to recover from stale URLs.
  // After extended inactivity, browsers may reclaim memory backing blob URLs
  // created from OPFS File objects, causing video elements to hang at readyState 0.
  useEffect(() => {
    let lastHiddenAt = 0;
    const STALE_THRESHOLD_MS = 30_000; // Only refresh if hidden for >30s

    const handleVisibilityChange = async () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
        return;
      }

      // Tab became visible â€” check if we were hidden long enough for staleness
      if (lastHiddenAt === 0 || Date.now() - lastHiddenAt < STALE_THRESHOLD_MS) {
        return;
      }

      // 1. Refresh proxy blob URLs from OPFS (re-reads files, creates fresh URLs)
      //    Must complete before step 2 so re-resolution picks up fresh proxy URLs.
      try {
        await proxyService.refreshAllBlobUrls();
      } catch {
        // Best-effort â€” continue with source URL refresh even if proxy refresh fails
      }

      // 2. Invalidate source media blob URLs so they get re-created on next resolve
      blobUrlManager.invalidateAll();

      // 3. Clear resolved URL cache and bump version to trigger re-resolution
      const clearedUrls = new Map<string, string>();
      resetResolveRetryState();
      setResolvedUrls(clearedUrls);
      rebuildUnresolvedMediaIds(clearedUrls);
      setUrlRefreshVersion((v) => v + 1);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [rebuildUnresolvedMediaIds, resetResolveRetryState]);

  useEffect(() => {
    return () => {
      scrubMountedRef.current = false;
      resetResolveRetryState();
      disposeFastScrubRenderer();
    };
  }, [disposeFastScrubRenderer, resetResolveRetryState]);

  // Calculate player size based on zoom mode
  const playerSize = useMemo(() => {
    const aspectRatio = project.width / project.height;

    if (zoom === -1) {
      if (containerSize.width > 0 && containerSize.height > 0) {
        const containerAspectRatio = containerSize.width / containerSize.height;

        let width: number;
        let height: number;

        if (containerAspectRatio > aspectRatio) {
          height = containerSize.height;
          width = height * aspectRatio;
        } else {
          width = containerSize.width;
          height = width / aspectRatio;
        }

        return { width, height };
      }
      return { width: project.width, height: project.height };
    }

    const targetWidth = project.width * zoom;
    const targetHeight = project.height * zoom;
    return { width: targetWidth, height: targetHeight };
  }, [project.width, project.height, zoom, containerSize]);

  // Check if overflow is needed (video larger than container)
  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false;
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [zoom, playerSize, containerSize]);

  // Track player container rect changes for gizmo positioning
  useLayoutEffect(() => {
    if (suspendOverlay) return;
    const container = playerContainerRef.current;
    if (!container) return;

    const updateRect = () => {
      const nextRect = container.getBoundingClientRect();
      setPlayerContainerRect((prev) => {
        if (
          prev
          && prev.left === nextRect.left
          && prev.top === nextRect.top
          && prev.width === nextRect.width
          && prev.height === nextRect.height
        ) {
          return prev;
        }
        return nextRect;
      });
    };

    updateRect();

    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);

    window.addEventListener('scroll', updateRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [suspendOverlay]);

  // Handle click on background area to deselect items
  const backgroundRef = useRef<HTMLDivElement>(null);
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (isMarqueeJustFinished()) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-gizmo]')) return;

    useSelectionStore.getState().clearItemSelection();
  }, []);

  // Handle frame change from player
  // Skip when in preview mode to keep primary playhead stationary
  const handleFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.round(frame);
    resolvePendingSeekLatency(nextFrame);
    if (ignorePlayerUpdatesRef.current) return;
    const playbackState = usePlaybackStore.getState();
    const interactionMode = getPreviewInteractionMode({
      isPlaying: playbackState.isPlaying,
      previewFrame: playbackState.previewFrame,
      isGizmoInteracting: isGizmoInteractingRef.current,
    });
    if (interactionMode === 'scrubbing') return;

    if (ADAPTIVE_PREVIEW_QUALITY_ENABLED && interactionMode === 'playing') {
      const nowMs = performance.now();
      const previousSample = adaptiveFrameSampleRef.current;
      if (previousSample && nextFrame !== previousSample.frame) {
        const frameDelta = Math.max(1, Math.abs(nextFrame - previousSample.frame));
        const elapsedMs = nowMs - previousSample.tsMs;
        if (elapsedMs > 0) {
          const result = updateAdaptivePreviewQuality({
            state: adaptiveQualityStateRef.current,
            sampleMsPerFrame: elapsedMs / frameDelta,
            frameBudgetMs: getFrameBudgetMs(fps, playbackState.playbackRate),
            userQuality: playbackState.previewQuality,
            nowMs,
            allowRecovery: false,
          });
          adaptiveQualityStateRef.current = result.state;
          if (result.qualityChanged) {
            if (result.qualityChangeDirection === 'degrade') {
              previewPerfRef.current.adaptiveQualityDowngrades += 1;
            } else if (result.qualityChangeDirection === 'recover') {
              previewPerfRef.current.adaptiveQualityRecovers += 1;
            }
            setAdaptiveQualityCap(result.state.qualityCap);
          }
        }
      }
      adaptiveFrameSampleRef.current = { frame: nextFrame, tsMs: nowMs };
    } else {
      adaptiveFrameSampleRef.current = null;
      if (
        adaptiveQualityStateRef.current.overBudgetSamples !== 0
        || adaptiveQualityStateRef.current.underBudgetSamples !== 0
      ) {
        adaptiveQualityStateRef.current = {
          ...adaptiveQualityStateRef.current,
          overBudgetSamples: 0,
          underBudgetSamples: 0,
        };
      }
    }

    const { currentFrame, setCurrentFrame } = playbackState;
    if (currentFrame === nextFrame) return;
    setCurrentFrame(nextFrame);
  }, [fps, resolvePendingSeekLatency]);

  // Handle play state change from player
  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play();
    } else {
      usePlaybackStore.getState().pause();
    }
  }, []);
  const latestRenderSourceSwitch = perfPanelSnapshot?.renderSourceHistory[
    perfPanelSnapshot.renderSourceHistory.length - 1
  ] ?? null;

  return (
    <div
      ref={backgroundRef}
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      onClick={handleBackgroundClick}
    >
      <div
        className="min-w-full min-h-full grid place-items-center p-6"
        onClick={handleBackgroundClick}
      >
        <div className="relative">
          <div
            ref={setPlayerContainerRefCallback}
            data-player-container
            className="relative shadow-2xl"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              transition: 'none',
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
            onDoubleClick={(e) => e.preventDefault()}
          >
            {isResolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                <p className="text-white text-sm">Loading media...</p>
              </div>
            )}

            <Player
              ref={playerRef}
              durationInFrames={totalFrames}
              fps={fps}
              width={playerRenderSize.width}
              height={playerRenderSize.height}
              autoPlay={false}
              loop={false}
              controls={false}
              style={{
                width: '100%',
                height: '100%',
              }}
              onFrameChange={handleFrameChange}
              onPlayStateChange={handlePlayStateChange}
            >
              <MainComposition {...inputProps} />
            </Player>

            {FAST_SCRUB_RENDERER_ENABLED && (
              <canvas
                ref={scrubCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                  width: '100%',
                  height: '100%',
                  zIndex: 4,
                  visibility: showFastScrubOverlay ? 'visible' : 'hidden',
                }}
              />
            )}

            {import.meta.env.DEV && showPerfPanel && perfPanelSnapshot && (
              <div
                className="absolute right-2 bottom-2 z-30 bg-black/75 text-white px-2 py-1 rounded text-[11px] leading-tight font-mono pointer-events-none select-none"
                data-testid="preview-perf-panel"
                title={`Toggle panel: Alt+Shift+P (persisted). URL override: ?${PREVIEW_PERF_PANEL_QUERY_KEY}=1`}
              >
                <div>
                  src:{' '}
                  {perfPanelSnapshot.renderSource === 'fast_scrub_overlay'
                    ? 'overlay'
                    : 'player'}
                  {' '}
                  stale:{perfPanelSnapshot.staleScrubOverlayDrops}
                </div>
                <div>
                  q:{perfPanelSnapshot.unresolvedQueue}
                  {' '}
                  pend:{perfPanelSnapshot.pendingResolves}
                  {' '}
                  scrub:{perfPanelSnapshot.scrubUpdates}/{perfPanelSnapshot.scrubDroppedFrames}
                </div>
                <div>
                  r:{perfPanelSnapshot.resolveAvgMs.toFixed(1)}ms
                  {' '}
                  ps:{perfPanelSnapshot.preloadScanAvgMs.toFixed(1)}ms
                  {' '}
                  pb:{perfPanelSnapshot.preloadBatchAvgMs.toFixed(1)}ms
                </div>
                <div>
                  pre:{perfPanelSnapshot.preloadCandidateIds}
                  {'>'}
                  {perfPanelSnapshot.preloadBudgetAdjusted}
                  {' '}
                  base:{perfPanelSnapshot.preloadBudgetBase}
                  {' '}
                  cost:{perfPanelSnapshot.preloadWindowMaxCost}
                  {' '}
                  y:{perfPanelSnapshot.preloadScanBudgetYields}
                  {' '}
                  c:{perfPanelSnapshot.preloadContinuations}
                  {' '}
                  dir:{perfPanelSnapshot.preloadScrubDirection}
                  {' '}
                  p:{perfPanelSnapshot.preloadDirectionPenaltyCount}
                </div>
                <div>
                  warm:{perfPanelSnapshot.sourceWarmKeep}/{perfPanelSnapshot.sourceWarmTarget}
                  {' '}
                  ev:{perfPanelSnapshot.sourceWarmEvictions}
                  {' '}
                  pool:{perfPanelSnapshot.sourcePoolSources}/{perfPanelSnapshot.sourcePoolElements}/{perfPanelSnapshot.sourcePoolActiveClips}
                  {' '}
                  fs:{perfPanelSnapshot.fastScrubPrewarmedSources}
                  {' '}
                  fe:{perfPanelSnapshot.fastScrubPrewarmSourceEvictions}
                </div>
                <div>
                  seek:{perfPanelSnapshot.seekLatencyAvgMs.toFixed(1)}ms
                  {' '}
                  last:{perfPanelSnapshot.seekLatencyLastMs.toFixed(1)}ms
                  {' '}
                  pend:{perfPanelSnapshot.seekLatencyPendingMs.toFixed(0)}ms
                  {' '}
                  to:{perfPanelSnapshot.seekLatencyTimeouts}
                </div>
                <div>
                  qual:{perfPanelSnapshot.effectivePreviewQuality}x
                  {' '}
                  usr:{perfPanelSnapshot.userPreviewQuality}x
                  {' '}
                  cap:{perfPanelSnapshot.adaptiveQualityCap}x
                  {' '}
                  ft:{perfPanelSnapshot.frameTimeEmaMs.toFixed(1)}/{perfPanelSnapshot.frameTimeBudgetMs.toFixed(1)}ms
                  {' '}
                  a:{perfPanelSnapshot.adaptiveQualityDowngrades}/{perfPanelSnapshot.adaptiveQualityRecovers}
                </div>
                <div>
                  sw:{perfPanelSnapshot.renderSourceSwitches}
                  {latestRenderSourceSwitch ? (
                    <>
                      {' '}
                      last:
                      {latestRenderSourceSwitch.from === 'fast_scrub_overlay' ? 'overlay' : 'player'}
                      {'>'}
                      {latestRenderSourceSwitch.to === 'fast_scrub_overlay' ? 'overlay' : 'player'}
                      @{latestRenderSourceSwitch.atFrame}
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {/* Edit frame comparison overlays */}
            {hasRolling2Up ? (
              <RollingEditOverlay fps={fps} />
            ) : hasRipple2Up ? (
              <RippleEditOverlay fps={fps} />
            ) : hasSlip4Up ? (
              <SlipEditOverlay fps={fps} />
            ) : hasSlide4Up ? (
              <SlideEditOverlay fps={fps} />
            ) : null}
          </div>

          {!suspendOverlay && (
            <GizmoOverlay
              containerRect={playerContainerRect}
              playerSize={playerSize}
              projectSize={{ width: project.width, height: project.height }}
              zoom={zoom}
              hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
            />
          )}
        </div>
      </div>
    </div>
  );
});
