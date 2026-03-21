import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { backgroundPreseek as workerBackgroundPreseek } from '../utils/decoder-prewarm';
import { Player, type PlayerRef } from '@/features/preview/deps/player-core';
import type { CaptureOptions, PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  useTimelineStore,
  useItemsStore,
  useTransitionsStore,
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
import { blobUrlManager, useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager';
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool';
import { GizmoOverlay } from './gizmo-overlay';
import { MaskEditorContainer } from './mask-editor-container';
import { CornerPinContainer } from './corner-pin-container';
import { RollingEditOverlay } from './rolling-edit-overlay';
import { RippleEditOverlay } from './ripple-edit-overlay';
import { SlipEditOverlay } from './slip-edit-overlay';
import { SlideEditOverlay } from './slide-edit-overlay';
import { useGizmoStore } from '../stores/gizmo-store';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import type { CompositionInputProps } from '@/types/export';
import type { ItemEffect } from '@/types/effects';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { isMarqueeJustFinished } from '@/hooks/use-marquee-selection';
import { createCompositionRenderer } from '@/features/preview/deps/export';
import {
  resolveTransitionWindows,
  type ResolvedTransitionWindow,
} from '@/domain/timeline/transitions/transition-planner';
import { shouldShowFastScrubOverlay } from '../utils/fast-scrub-overlay-guard';
import { getDirectionalPrewarmOffsets } from '../utils/fast-scrub-prewarm';
import { resolvePlaybackTransitionOverlayState } from '../utils/playback-transition-overlay';
import {
  getPreviewAnchorFrame,
  getPreviewInteractionMode,
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
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard';
import { useGpuEffectsOverlay } from '../hooks/use-gpu-effects-overlay';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { getBestDomVideoElementForItem } from '@/features/preview/deps/composition-runtime';
import { createLogger, createOperationId, type WideEvent } from '@/shared/logging/logger';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';

// DEV-only: cached reference loaded via dynamic import so the module
// is excluded from production bundles entirely.
let _devJitterMonitor: import('@/shared/logging/frame-jitter-monitor').FrameJitterMonitor | null = null;
if (import.meta.env.DEV) {
  void import('@/shared/logging/frame-jitter-monitor').then((m) => {
    _devJitterMonitor = m.getFrameJitterMonitor();
  });
}
import {
  PRELOAD_AHEAD_SECONDS,
  PRELOAD_SCAN_TIME_BUDGET_MS,
  PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS,
  PRELOAD_BURST_EXTRA_IDS,
  PRELOAD_BACKWARD_SCRUB_EXTRA_IDS,
  PRELOAD_FORWARD_SCRUB_THROTTLE_MS,
  PRELOAD_BACKWARD_SCRUB_THROTTLE_MS,
  PRELOAD_SKIP_ON_BACKWARD_SCRUB,
  PRELOAD_BURST_MAX_IDS_PER_TICK,
  PRELOAD_BURST_PASSES,
  FAST_SCRUB_RENDERER_ENABLED,
  FAST_SCRUB_PRELOAD_BUDGET_MS,
  FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS,
  FAST_SCRUB_MAX_PREWARM_FRAMES,
  FAST_SCRUB_MAX_PREWARM_SOURCES,
  FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS,
  FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME,
  FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES,
  FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD,
  FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD,
  FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
  FAST_SCRUB_PREWARM_QUEUE_MAX,
  FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS,
  FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES,
  FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES,
  FAST_SCRUB_PREWARM_RENDER_BUDGET_MS,
  FAST_SCRUB_HANDOFF_TIMEOUT_MS,
  SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS,
  SOURCE_WARM_SCRUB_WINDOW_SECONDS,
  SOURCE_WARM_MAX_SOURCES,
  SOURCE_WARM_HARD_CAP_SOURCES,
  SOURCE_WARM_HARD_CAP_ELEMENTS,
  SOURCE_WARM_MIN_SOURCES,
  SOURCE_WARM_STICKY_MS,
  SOURCE_WARM_TICK_MS,
  RESOLVE_RETRY_MIN_MS,
  RESOLVE_RETRY_MAX_MS,
  RESOLVE_MAX_CONCURRENCY,
  RESOLVE_DEFER_DURING_SCRUB_MS,
  PREVIEW_PERF_PUBLISH_INTERVAL_MS,
  PREVIEW_PERF_PANEL_STORAGE_KEY,
  PREVIEW_PERF_PANEL_QUERY_KEY,
  PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX,
  PREVIEW_PERF_SEEK_TIMEOUT_MS,
  ADAPTIVE_PREVIEW_QUALITY_ENABLED,
  type VideoSourceSpan,
  type FastScrubBoundarySource,
  type PreviewPerfSnapshot,
  toTrackFingerprint,
  getPreloadBudget,
  getResolvePassBudget,
  getMediaResolveCost,
  getCostAdjustedBudget,
  getDirectionalScrubStartIndex,
  getFrameDirection,
  parsePreviewPerfPanelQuery,
  blobToDataUrl,
} from '../utils/preview-constants';

const logger = createLogger('VideoPreview');

type CompositionRenderer = Awaited<ReturnType<typeof createCompositionRenderer>>;

type TransitionPreviewSessionTrace = {
  opId: string;
  event: WideEvent;
  startedAtMs: number;
  startFrame: number;
  endFrame: number;
  mode: 'dom' | 'render';
  complex: boolean;
  leftClipId: string;
  rightClipId: string;
  leftSpeed: number;
  rightSpeed: number;
  leftHasEffects: boolean;
  rightHasEffects: boolean;
  prepareStartedAtMs: number | null;
  firstPreparedAtMs: number | null;
  enteredAtMs: number | null;
  exitedAtMs: number | null;
  lastPrepareMs: number;
  lastPreparedFrame: number;
  bufferedFramesPeak: number;
  entryMisses: number;
  lastEntryMissFrame: number | null;
};

type TransitionPreviewTelemetry = {
  sessionCount: number;
  lastPrepareMs: number;
  lastReadyLeadMs: number;
  lastEntryMisses: number;
  lastSessionDurationMs: number;
};

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
  const gpuEffectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrubFrameDirtyRef = useRef(false);
  const bypassPreviewSeekRef = useRef(false);
  const scrubRendererRef = useRef<CompositionRenderer | null>(null);
  const scrubInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const scrubPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const scrubOffscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const scrubOffscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const scrubRenderInFlightRef = useRef(false);
  const scrubRenderGenerationRef = useRef(0);
  const scrubRequestedFrameRef = useRef<number | null>(null);
  const scrubPrewarmQueueRef = useRef<number[]>([]);
  const scrubPrewarmQueuedSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedFramesRef = useRef<number[]>([]);
  const scrubPrewarmedFrameSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedSourcesRef = useRef<Set<string>>(new Set());
  const scrubPrewarmedSourceOrderRef = useRef<string[]>([]);
  const scrubPrewarmedSourceTouchFrameRef = useRef<Map<string, number>>(new Map());
  const scrubOffscreenRenderedFrameRef = useRef<number | null>(null);
  const playbackTransitionPreparePromiseRef = useRef<Promise<boolean> | null>(null);
  const playbackTransitionPreparingFrameRef = useRef<number | null>(null);
  const deferredPlaybackTransitionPrepareFrameRef = useRef<number | null>(null);
  const transitionPrepareTimeoutRef = useRef<number | null>(null);
  const transitionSessionWindowRef = useRef<ResolvedTransitionWindow<TimelineItem> | null>(null);
  const transitionSessionPinnedElementsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const transitionSessionBufferedFramesRef = useRef<Map<number, OffscreenCanvas>>(new Map());
  const captureCanvasSourceInFlightRef = useRef<Promise<OffscreenCanvas | HTMLCanvasElement | null> | null>(null);
  const captureInFlightRef = useRef<Promise<string | null> | null>(null);
  const captureImageDataInFlightRef = useRef<Promise<ImageData | null> | null>(null);
  const captureScaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrubDirectionRef = useRef<-1 | 0 | 1>(0);
  const suppressScrubBackgroundPrewarmRef = useRef(false);
  const fallbackToPlayerScrubRef = useRef(false);
  const lastForwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubRenderAtRef = useRef(0);
  const lastBackwardRequestedFrameRef = useRef<number | null>(null);
  const pendingFastScrubHandoffFrameRef = useRef<number | null>(null);
  const pendingFastScrubHandoffStartedAtRef = useRef(0);
  const pendingFastScrubHandoffRafRef = useRef<number | null>(null);
  const resumeScrubLoopRef = useRef<() => void>(() => {});
  const scrubMountedRef = useRef(true);
  const [showFastScrubOverlay, setShowFastScrubOverlay] = useState(false);
  const [showPlaybackTransitionOverlay, setShowPlaybackTransitionOverlay] = useState(false);
  const showFastScrubOverlayRef = useRef(false);
  const showPlaybackTransitionOverlayRef = useRef(false);
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
  const transitionSessionTraceRef = useRef<TransitionPreviewSessionTrace | null>(null);
  const transitionTelemetryRef = useRef<TransitionPreviewTelemetry>({
    sessionCount: 0,
    lastPrepareMs: 0,
    lastReadyLeadMs: 0,
    lastEntryMisses: 0,
    lastSessionDurationMs: 0,
  });
  const lastPausedPrearmTargetRef = useRef<number | null>(null);
  const lastPlayingPrearmTargetRef = useRef<number | null>(null);

  const pushTransitionTrace = useCallback((phase: string, data: Record<string, unknown> = {}) => {
    if (!import.meta.env.DEV) return;

    const nextEntry: Record<string, unknown> = {
      ts: Date.now(),
      phase,
      renderSource: renderSourceRef.current,
      currentFrame: usePlaybackStore.getState().currentFrame,
      ...data,
    };
    const history = window.__PREVIEW_TRANSITIONS__ ?? [];
    window.__PREVIEW_TRANSITIONS__ = [...history.slice(-99), nextEntry];
  }, []);

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
  const activeGizmoItemId = useGizmoStore((s) => s.activeGizmo?.itemId ?? null);
  const isGizmoInteracting = useGizmoStore((s) => s.activeGizmo !== null);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const showGpuEffectsOverlay = useGpuEffectsOverlay(gpuEffectsCanvasRef, playerContainerRef, scrubOffscreenCanvasRef, scrubFrameDirtyRef);
  const zoom = usePlaybackStore((s) => s.zoom);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  // Derive a stable count of ready proxies to avoid recomputing resolvedTracks
  // on every proxyStatus Map recreation (e.g. during progress updates)
  const proxyReadyCount = useMediaLibraryStore((s) => {
    let count = 0;
    for (const status of s.proxyStatus.values()) {
      if (status === 'ready') count++;
    }
    return count;
  });
  const activeGizmoItemType = useMemo(
    () => activeGizmoItemId
      ? (items.find((item) => item.id === activeGizmoItemId)?.type ?? null)
      : null,
    [activeGizmoItemId, items]
  );

  const isGizmoInteractingRef = useRef(isGizmoInteracting);
  isGizmoInteractingRef.current = isGizmoInteracting;
  const preferPlayerForTextGizmoRef = useRef(false);
  const preferPlayerForStyledTextScrubRef = useRef(false);
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);

  const shouldPreferPlayerForPreview = useCallback((previewFrame: number | null) => {
    return (
      preferPlayerForTextGizmoRef.current
      || (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
    );
  }, []);

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

  const clearPendingFastScrubHandoff = useCallback(() => {
    pendingFastScrubHandoffFrameRef.current = null;
    pendingFastScrubHandoffStartedAtRef.current = 0;
    if (pendingFastScrubHandoffRafRef.current !== null) {
      cancelAnimationFrame(pendingFastScrubHandoffRafRef.current);
      pendingFastScrubHandoffRafRef.current = null;
    }
  }, []);

  const hideFastScrubOverlay = useCallback(() => {
    clearPendingFastScrubHandoff();
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    bypassPreviewSeekRef.current = false;
  }, [clearPendingFastScrubHandoff]);

  const hidePlaybackTransitionOverlay = useCallback(() => {
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
  }, []);

  const maybeCompleteFastScrubHandoff = useCallback((resolvedFrame?: number | null) => {
    const targetFrame = pendingFastScrubHandoffFrameRef.current;
    if (targetFrame === null) return false;

    let playerFrame = resolvedFrame ?? null;
    if (playerFrame === null) {
      const currentFrame = playerRef.current?.getCurrentFrame();
      playerFrame = Number.isFinite(currentFrame)
        ? Math.round(currentFrame as number)
        : null;
    }

    if (playerFrame !== targetFrame) return false;
    hideFastScrubOverlay();
    return true;
  }, [hideFastScrubOverlay]);

  const scheduleFastScrubHandoffCheck = useCallback(() => {
    if (pendingFastScrubHandoffFrameRef.current === null) return;
    if (pendingFastScrubHandoffRafRef.current !== null) return;

    pendingFastScrubHandoffRafRef.current = requestAnimationFrame(() => {
      pendingFastScrubHandoffRafRef.current = null;

      if (pendingFastScrubHandoffFrameRef.current === null) return;
      const playbackState = usePlaybackStore.getState();
      if (playbackState.previewFrame !== null) {
        clearPendingFastScrubHandoff();
        return;
      }
      if (playbackState.isPlaying || shouldPreferPlayerForPreview(playbackState.previewFrame)) {
        hideFastScrubOverlay();
        return;
      }
      if (maybeCompleteFastScrubHandoff()) {
        return;
      }
      if (
        performance.now() - pendingFastScrubHandoffStartedAtRef.current
        >= FAST_SCRUB_HANDOFF_TIMEOUT_MS
      ) {
        hideFastScrubOverlay();
        return;
      }
      scheduleFastScrubHandoffCheck();
    });
  }, [
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    maybeCompleteFastScrubHandoff,
    shouldPreferPlayerForPreview,
  ]);

  const beginFastScrubHandoff = useCallback((targetFrame: number) => {
    pendingFastScrubHandoffFrameRef.current = targetFrame;
    pendingFastScrubHandoffStartedAtRef.current = performance.now();
    scheduleFastScrubHandoffCheck();
  }, [scheduleFastScrubHandoffCheck]);

  const showFastScrubOverlayForFrame = useCallback(() => {
    clearPendingFastScrubHandoff();
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
    showFastScrubOverlayRef.current = true;
    setShowFastScrubOverlay(true);
    bypassPreviewSeekRef.current = true;
  }, [clearPendingFastScrubHandoff]);

  const showPlaybackTransitionOverlayForFrame = useCallback(() => {
    clearPendingFastScrubHandoff();
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    showPlaybackTransitionOverlayRef.current = true;
    setShowPlaybackTransitionOverlay(true);
    bypassPreviewSeekRef.current = false;
  }, [clearPendingFastScrubHandoff]);

  // Custom Player integration (hook handles bidirectional sync)
  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  );

  useEffect(() => {
    const playback = usePlaybackStore.getState();
    if (playback.previewFrame !== null) {
      // Preserve the currently viewed frame before clearing preview mode.
      if (playback.currentFrame !== playback.previewFrame) {
        playback.setCurrentFrame(playback.previewFrame);
      }
      playback.setPreviewFrame(null);
    }
  }, []);

  useEffect(() => {
    isGizmoInteractingRef.current = isGizmoInteracting;
    if (!isGizmoInteracting) return;
    // During active transform drags, clear stale hover-scrub state without
    // changing the viewed frame. This avoids a one-frame render source/frame jump.
    const playbackState = usePlaybackStore.getState();
    if (playbackState.previewFrame !== null) {
      if (playbackState.currentFrame !== playbackState.previewFrame) {
        playbackState.setCurrentFrame(playbackState.previewFrame);
      }
      playbackState.setPreviewFrame(null);
    }
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

  const setCaptureFrame = usePlaybackStore((s) => s.setCaptureFrame);
  const setCaptureFrameImageData = usePlaybackStore((s) => s.setCaptureFrameImageData);
  const setDisplayedFrame = usePlaybackStore((s) => s.setDisplayedFrame);

  // Cache for resolved blob URLs (mediaId -> blobUrl)
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(new Map());
  const blobUrlVersion = useBlobUrlVersion();
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

  const isRenderedOverlayVisible = showFastScrubOverlay || showPlaybackTransitionOverlay;

  useEffect(() => {
    showFastScrubOverlayRef.current = showFastScrubOverlay;
    showPlaybackTransitionOverlayRef.current = showPlaybackTransitionOverlay;
    const nextSource: PreviewRenderSource = showFastScrubOverlay
      ? 'fast_scrub_overlay'
      : showPlaybackTransitionOverlay
        ? 'playback_transition_overlay'
        : 'player';
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
  }, [showFastScrubOverlay, showPlaybackTransitionOverlay]);

  useEffect(() => {
    if (!isRenderedOverlayVisible) {
      setDisplayedFrame(null);
    }
  }, [isRenderedOverlayVisible, setDisplayedFrame]);

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

  // If blob URLs are invalidated globally/relinked elsewhere, drop stale
  // resolved entries so the resolve pass re-acquires fresh URLs.
  useEffect(() => {
    if (resolvedUrls.size === 0) {
      return;
    }

    const activeMediaIds = useMediaDependencyStore.getState().mediaIds;
    if (activeMediaIds.length === 0) {
      return;
    }

    const activeMediaIdSet = new Set(activeMediaIds);
    const staleMediaIds: string[] = [];

    for (const [mediaId, resolvedUrl] of resolvedUrls.entries()) {
      if (!activeMediaIdSet.has(mediaId)) continue;
      const latestBlobUrl = blobUrlManager.get(mediaId);
      if (latestBlobUrl !== resolvedUrl) {
        staleMediaIds.push(mediaId);
      }
    }

    if (staleMediaIds.length === 0) {
      return;
    }

    clearResolveRetryState(staleMediaIds);
    addUnresolvedMediaIds(staleMediaIds);
    setResolvedUrls((prevUrls) => {
      const nextUrls = new Map(prevUrls);
      let changed = false;
      for (const mediaId of staleMediaIds) {
        if (nextUrls.delete(mediaId)) {
          changed = true;
        }
      }
      return changed ? nextUrls : prevUrls;
    });
    kickResolvePass();
  }, [
    addUnresolvedMediaIds,
    blobUrlVersion,
    clearResolveRetryState,
    kickResolvePass,
    resolvedUrls,
  ]);

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
        logger.error('Failed to resolve media URLs:', error);
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
      const activeTransitionTrace = transitionSessionTraceRef.current;
      const transitionTelemetry = transitionTelemetryRef.current;
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
        transitionSessionActive: activeTransitionTrace !== null,
        transitionSessionMode: activeTransitionTrace?.mode ?? 'none',
        transitionSessionComplex: activeTransitionTrace?.complex ?? false,
        transitionSessionStartFrame: activeTransitionTrace?.startFrame ?? -1,
        transitionSessionEndFrame: activeTransitionTrace?.endFrame ?? -1,
        transitionBufferedFrames: transitionSessionBufferedFramesRef.current.size,
        transitionPreparedFrame: activeTransitionTrace?.lastPreparedFrame ?? -1,
        transitionLastPrepareMs: activeTransitionTrace?.lastPrepareMs ?? transitionTelemetry.lastPrepareMs,
        transitionLastReadyLeadMs: activeTransitionTrace && activeTransitionTrace.enteredAtMs !== null && activeTransitionTrace.firstPreparedAtMs !== null
          ? Math.max(0, activeTransitionTrace.enteredAtMs - activeTransitionTrace.firstPreparedAtMs)
          : transitionTelemetry.lastReadyLeadMs,
        transitionLastEntryMisses: activeTransitionTrace?.entryMisses ?? transitionTelemetry.lastEntryMisses,
        transitionLastSessionDurationMs: activeTransitionTrace
          ? Math.max(0, seekNow - activeTransitionTrace.startedAtMs)
          : transitionTelemetry.lastSessionDurationMs,
        transitionSessionCount: transitionTelemetry.sessionCount,
      };

      window.__PREVIEW_PERF__ = snapshot;
      if (window.__PREVIEW_PERF_LOG__) {
        logger.warn('PreviewPerf', snapshot);
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

  // Keep fast-scrub renderer at project resolution until the renderer
  // separates logical composition space from physical canvas size.
  const renderSize = useMemo(() => {
    const projectWidth = Math.max(1, Math.round(project.width));
    const projectHeight = Math.max(1, Math.round(project.height));
    return { width: Math.max(2, projectWidth), height: Math.max(2, projectHeight) };
  }, [project.width, project.height]);

  // Provide live gizmo preview transforms to fast-scrub renderer so dragged
  // items move with LUT preview instead of freezing at committed transforms.
  const getPreviewTransformOverride = useCallback((itemId: string): Partial<ResolvedTransform> | undefined => {
    const gizmoState = useGizmoStore.getState();
    const unifiedPreviewTransform = gizmoState.preview?.[itemId]?.transform;
    if (unifiedPreviewTransform) return unifiedPreviewTransform;
    if (gizmoState.activeGizmo?.itemId === itemId && gizmoState.previewTransform) {
      return gizmoState.previewTransform;
    }
    return undefined;
  }, []);

  const getPreviewEffectsOverride = useCallback((itemId: string): ItemEffect[] | undefined => {
    const gizmoState = useGizmoStore.getState();
    return gizmoState.preview?.[itemId]?.effects;
  }, []);

  const getPreviewCornerPinOverride = useCallback((itemId: string) => {
    const cpState = useCornerPinStore.getState();
    if (cpState.editingItemId === itemId && cpState.previewCornerPin) {
      return cpState.previewCornerPin;
    }
    return undefined;
  }, []);

  const getPreviewPathVerticesOverride = useCallback((itemId: string) => {
    const maskState = useMaskEditorStore.getState();
    if (maskState.editingItemId === itemId && maskState.previewVertices) {
      return maskState.previewVertices;
    }
    return undefined;
  }, []);

  const fastScrubScaledTracks = useMemo(() => {
    return fastScrubTracks as CompositionInputProps['tracks'];
  }, [
    fastScrubTracks,
    fastScrubTracksFingerprint,
  ]);

  const fastScrubScaledKeyframes = useMemo(() => {
    return keyframes;
  }, [
    keyframes,
  ]);

  const fastScrubInputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: fastScrubScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: fastScrubScaledKeyframes,
  }), [
    fps,
    project.width,
    project.height,
    fastScrubScaledTracks,
    transitions,
    project.backgroundColor,
    fastScrubScaledKeyframes,
  ]);

  const playbackTransitionWindows = useMemo(() => {
    const clipMap = new Map<string, TimelineItem>();
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        clipMap.set(item.id, item);
      }
    }
    return resolveTransitionWindows(transitions, clipMap);
  }, [fastScrubScaledTracks, transitions]);

  const playbackTransitionLookaheadFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.25)),
    [fps],
  );
  const playbackTransitionCooldownFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.1)),
    [fps],
  );
  const pausedTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 0.75)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playingComplexTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 1.5)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playbackTransitionPrerenderRunwayFrames = 3;
  const playbackTransitionEffectfulStartFrames = useMemo(() => {
    const hasExpensiveVisuals = (item: TimelineItem) => (
      item.effects?.some((effect) => effect.enabled)
      || (item.blendMode !== undefined && item.blendMode !== 'normal')
    );

    const effectfulStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      if (hasExpensiveVisuals(window.leftClip) || hasExpensiveVisuals(window.rightClip)) {
        effectfulStartFrames.add(window.startFrame);
      }
    }

    return effectfulStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionVariableSpeedStartFrames = useMemo(() => {
    const variableSpeedStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      const leftSpeed = window.leftClip.speed ?? 1;
      const rightSpeed = window.rightClip.speed ?? 1;
      if (Math.abs(leftSpeed - 1) > 0.001 || Math.abs(rightSpeed - 1) > 0.001) {
        variableSpeedStartFrames.add(window.startFrame);
      }
    }
    return variableSpeedStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionComplexStartFrames = useMemo(() => {
    const complexStartFrames = new Set<number>();
    for (const frame of playbackTransitionEffectfulStartFrames) {
      complexStartFrames.add(frame);
    }
    for (const frame of playbackTransitionVariableSpeedStartFrames) {
      complexStartFrames.add(frame);
    }
    return complexStartFrames;
  }, [playbackTransitionEffectfulStartFrames, playbackTransitionVariableSpeedStartFrames]);

  const transitionWindowUsesDomProvider = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) return true;
    return !playbackTransitionComplexStartFrames.has(window.startFrame);
  }, [playbackTransitionComplexStartFrames]);

  const getTransitionWindowByStartFrame = useCallback((startFrame: number | null) => {
    if (startFrame === null) return null;
    return playbackTransitionWindows.find((window) => window.startFrame === startFrame) ?? null;
  }, [playbackTransitionWindows]);

  const getTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame + playbackTransitionCooldownFrames
    )) ?? null;
  }, [playbackTransitionCooldownFrames, playbackTransitionWindows]);

  const clearTransitionPlaybackSession = useCallback(() => {
    const activeTrace = transitionSessionTraceRef.current;
    if (activeTrace) {
      const finishedAtMs = performance.now();
      activeTrace.exitedAtMs = finishedAtMs;
      transitionTelemetryRef.current.lastPrepareMs = activeTrace.lastPrepareMs;
      transitionTelemetryRef.current.lastEntryMisses = activeTrace.entryMisses;
      transitionTelemetryRef.current.lastSessionDurationMs = Math.max(0, finishedAtMs - activeTrace.startedAtMs);
      transitionTelemetryRef.current.lastReadyLeadMs = (
        activeTrace.enteredAtMs !== null && activeTrace.firstPreparedAtMs !== null
      )
        ? Math.max(0, activeTrace.enteredAtMs - activeTrace.firstPreparedAtMs)
        : 0;
      activeTrace.event.success({
        startFrame: activeTrace.startFrame,
        endFrame: activeTrace.endFrame,
        mode: activeTrace.mode,
        complex: activeTrace.complex,
        leftClipId: activeTrace.leftClipId,
        rightClipId: activeTrace.rightClipId,
        leftSpeed: activeTrace.leftSpeed,
        rightSpeed: activeTrace.rightSpeed,
        leftHasEffects: activeTrace.leftHasEffects,
        rightHasEffects: activeTrace.rightHasEffects,
        prepareMs: activeTrace.lastPrepareMs,
        preparedFrame: activeTrace.lastPreparedFrame,
        bufferedFramesPeak: activeTrace.bufferedFramesPeak,
        entryMisses: activeTrace.entryMisses,
        readyLeadMs: transitionTelemetryRef.current.lastReadyLeadMs,
        sessionDurationMs: transitionTelemetryRef.current.lastSessionDurationMs,
      });
      pushTransitionTrace('session_end', {
        opId: activeTrace.opId,
        mode: activeTrace.mode,
        complex: activeTrace.complex,
        startFrame: activeTrace.startFrame,
        endFrame: activeTrace.endFrame,
        prepareMs: activeTrace.lastPrepareMs,
        preparedFrame: activeTrace.lastPreparedFrame,
        bufferedFramesPeak: activeTrace.bufferedFramesPeak,
        entryMisses: activeTrace.entryMisses,
        readyLeadMs: transitionTelemetryRef.current.lastReadyLeadMs,
        sessionDurationMs: transitionTelemetryRef.current.lastSessionDurationMs,
      });
      transitionSessionTraceRef.current = null;
    }

    transitionSessionWindowRef.current = null;
    transitionSessionPinnedElementsRef.current.clear();
    transitionSessionBufferedFramesRef.current.clear();
  }, [pushTransitionTrace]);

  const pinTransitionPlaybackSession = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) {
      clearTransitionPlaybackSession();
      return null;
    }

    const activeWindow = transitionSessionWindowRef.current;
    if (activeWindow?.transition.id === window.transition.id && activeWindow.startFrame === window.startFrame) {
      return activeWindow;
    }

    clearTransitionPlaybackSession();

    transitionSessionWindowRef.current = window;
    const opId = createOperationId();
    const event = logger.startEvent('preview_transition_session', opId);
    const leftSpeed = window.leftClip.speed ?? 1;
    const rightSpeed = window.rightClip.speed ?? 1;
    const leftHasEffects = Boolean(window.leftClip.effects?.some((effect) => effect.enabled));
    const rightHasEffects = Boolean(window.rightClip.effects?.some((effect) => effect.enabled));
    const mode = transitionWindowUsesDomProvider(window) ? 'dom' : 'render';
    const complex = mode === 'render';
    transitionTelemetryRef.current.sessionCount += 1;
    transitionSessionTraceRef.current = {
      opId,
      event,
      startedAtMs: performance.now(),
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      mode,
      complex,
      leftClipId: window.leftClip.id,
      rightClipId: window.rightClip.id,
      leftSpeed,
      rightSpeed,
      leftHasEffects,
      rightHasEffects,
      prepareStartedAtMs: null,
      firstPreparedAtMs: null,
      enteredAtMs: null,
      exitedAtMs: null,
      lastPrepareMs: 0,
      lastPreparedFrame: -1,
      bufferedFramesPeak: 0,
      entryMisses: 0,
      lastEntryMissFrame: null,
    };
    pushTransitionTrace('session_start', {
      opId,
      mode,
      complex,
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      leftClipId: window.leftClip.id,
      rightClipId: window.rightClip.id,
      leftSpeed,
      rightSpeed,
      leftHasEffects,
      rightHasEffects,
    });
    transitionSessionPinnedElementsRef.current = new Map([
      [window.leftClip.id, getBestDomVideoElementForItem(window.leftClip.id)],
      [window.rightClip.id, getBestDomVideoElementForItem(window.rightClip.id)],
    ]);
    transitionSessionBufferedFramesRef.current.clear();
    return window;
  }, [clearTransitionPlaybackSession, pushTransitionTrace, transitionWindowUsesDomProvider]);

  const getPinnedTransitionElementForItem = useCallback((itemId: string) => {
    const sessionWindow = transitionSessionWindowRef.current;
    const isSessionParticipant = sessionWindow?.leftClip.id === itemId || sessionWindow?.rightClip.id === itemId;
    if (!isSessionParticipant) {
      return getBestDomVideoElementForItem(itemId);
    }

    // During playback, always provide DOM video elements for transition
    // participants — even for complex transitions (effects/variable speed).
    // The Player's <video> elements are already at the correct frame
    // during playback, so the renderer can read pixels from them (zero-copy
    // ~1ms) instead of falling back to mediabunny WASM decode (40-80ms).
    // The GPU pipeline applies effects on top of the DOM video source.
    // When paused/scrubbing, complex transitions still return null so the
    // renderer uses mediabunny for frame-accurate decode.
    const isPlaying = usePlaybackStore.getState().isPlaying;
    if (!isPlaying && !transitionWindowUsesDomProvider(sessionWindow)) {
      return null;
    }

    const pinned = transitionSessionPinnedElementsRef.current.get(itemId) ?? null;
    if (pinned && pinned.isConnected && pinned.readyState >= 2 && pinned.videoWidth > 0) {
      return pinned;
    }

    const next = getBestDomVideoElementForItem(itemId);
    transitionSessionPinnedElementsRef.current.set(itemId, next);
    return next;
  }, [transitionWindowUsesDomProvider]);

  const getUpcomingTransitionStartFrame = useCallback((
    frame: number,
    maxLookaheadFrames: number,
    options?: { complexOnly?: boolean },
  ) => {
    const nextWindow = playbackTransitionWindows.find((window) => {
      if (frame > window.startFrame) {
        return false;
      }
      if (options?.complexOnly && !playbackTransitionComplexStartFrames.has(window.startFrame)) {
        return false;
      }
      return true;
    });
    if (!nextWindow) return null;
    if ((nextWindow.startFrame - frame) > maxLookaheadFrames) {
      return null;
    }
    return nextWindow.startFrame;
  }, [playbackTransitionComplexStartFrames, playbackTransitionWindows]);

  const getPausedTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, pausedTransitionPrearmFrames);
  }, [getUpcomingTransitionStartFrame, pausedTransitionPrearmFrames]);

  const getPlayingComplexTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, playingComplexTransitionPrearmFrames, { complexOnly: true });
  }, [getUpcomingTransitionStartFrame, playingComplexTransitionPrearmFrames]);

  const forceFastScrubOverlay = showGpuEffectsOverlay;
  // Styled, animated text can visibly flip between the DOM Player renderer
  // and the fast-scrub canvas renderer. Keep scrub preview on the Player path.
  const preferPlayerForStyledTextScrub = (
    !forceFastScrubOverlay
    && shouldPreferPlayerForStyledTextScrubGuard(combinedTracks, keyframes)
  );
  const preferPlayerForTextGizmo = (
    !forceFastScrubOverlay
    && isGizmoInteracting
    && activeGizmoItemType === 'text'
  );
  preferPlayerForTextGizmoRef.current = preferPlayerForTextGizmo;
  preferPlayerForStyledTextScrubRef.current = preferPlayerForStyledTextScrub;

  // Keep the on-screen scrub canvas at project resolution so quality toggles
  // only change offscreen sampling, not display buffer geometry.
  useLayoutEffect(() => {
    const canvas = scrubCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== playerRenderSize.width) canvas.width = playerRenderSize.width;
    if (canvas.height !== playerRenderSize.height) canvas.height = playerRenderSize.height;
  }, [playerRenderSize.width, playerRenderSize.height]);

  const disposeFastScrubRenderer = useCallback(() => {
    clearPendingFastScrubHandoff();
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
    scrubOffscreenRenderedFrameRef.current = null;
    playbackTransitionPreparePromiseRef.current = null;
    playbackTransitionPreparingFrameRef.current = null;
    deferredPlaybackTransitionPrepareFrameRef.current = null;
    if (transitionPrepareTimeoutRef.current !== null) {
      clearTimeout(transitionPrepareTimeoutRef.current);
      transitionPrepareTimeoutRef.current = null;
    }
    clearTransitionPlaybackSession();
    captureCanvasSourceInFlightRef.current = null;
    previewPerfRef.current.fastScrubPrewarmedSources = 0;
    bypassPreviewSeekRef.current = false;

    if (scrubRendererRef.current) {
      try {
        scrubRendererRef.current.dispose();
      } catch (error) {
        logger.warn('Failed to dispose renderer:', error);
      }
      scrubRendererRef.current = null;
    }

    scrubOffscreenCanvasRef.current = null;
    scrubOffscreenCtxRef.current = null;
  }, [clearPendingFastScrubHandoff, clearTransitionPlaybackSession]);

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

        const renderer = await createCompositionRenderer(fastScrubInputProps, offscreen, offscreenCtx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
        });
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
            logger.warn('Renderer preload failed:', error);
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
        scrubOffscreenRenderedFrameRef.current = null;
        scrubRendererRef.current = renderer;
        // Eagerly warm the GPU pipeline in the background so the first
        // transition frame doesn't pay the ~100-150ms WebGPU init cost.
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }
        return renderer;
      } catch (error) {
        logger.warn('Failed to initialize renderer, falling back to Player seeks:', error);
        scrubRendererRef.current = null;
        scrubOffscreenCanvasRef.current = null;
        scrubOffscreenCtxRef.current = null;
        scrubOffscreenRenderedFrameRef.current = null;
        return null;
      } finally {
        scrubInitPromiseRef.current = null;
      }
    })();

    return scrubInitPromiseRef.current;
  }, [fastScrubInputProps, fps, getPreviewTransformOverride, getPreviewEffectsOverride, getPreviewCornerPinOverride, getPreviewPathVerticesOverride, isResolving, renderSize.height, renderSize.width]);

  const renderOffscreenFrame = useCallback(async (targetFrame: number): Promise<OffscreenCanvas | null> => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (offscreen && scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return offscreen;
    }

    const renderer = await ensureFastScrubRenderer();
    const nextOffscreen = scrubOffscreenCanvasRef.current;
    if (!renderer || !nextOffscreen) return null;

    if (scrubOffscreenRenderedFrameRef.current !== targetFrame) {
      await renderer.renderFrame(targetFrame);
      scrubOffscreenRenderedFrameRef.current = targetFrame;
    }

    return nextOffscreen;
  }, [ensureFastScrubRenderer]);

  const cacheTransitionSessionFrame = useCallback((frame: number) => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (!offscreen || !transitionSessionWindowRef.current) return;

    const snapshot = new OffscreenCanvas(offscreen.width, offscreen.height);
    const snapshotCtx = snapshot.getContext('2d');
    if (!snapshotCtx) return;

    snapshotCtx.drawImage(offscreen, 0, 0);
    transitionSessionBufferedFramesRef.current.set(frame, snapshot);
    const trace = transitionSessionTraceRef.current;
    if (trace) {
      trace.lastPreparedFrame = frame;
      trace.bufferedFramesPeak = Math.max(
        trace.bufferedFramesPeak,
        transitionSessionBufferedFramesRef.current.size,
      );
      if (trace.firstPreparedAtMs === null) {
        trace.firstPreparedAtMs = performance.now();
        pushTransitionTrace('prepare_ready', {
          opId: trace.opId,
          preparedFrame: frame,
          bufferedFrames: transitionSessionBufferedFramesRef.current.size,
        });
      }
    }

    const maxBufferedFrames = playbackTransitionPrerenderRunwayFrames + playbackTransitionCooldownFrames + 2;
    while (transitionSessionBufferedFramesRef.current.size > maxBufferedFrames) {
      const oldestFrame = transitionSessionBufferedFramesRef.current.keys().next().value;
      if (oldestFrame === undefined) break;
      transitionSessionBufferedFramesRef.current.delete(oldestFrame);
    }
  }, [playbackTransitionCooldownFrames, playbackTransitionPrerenderRunwayFrames, pushTransitionTrace]);

  const preparePlaybackTransitionFrame = useCallback(async (targetFrame: number): Promise<boolean> => {
    if (targetFrame < 0) return false;
    if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return true;
    }
    if (
      playbackTransitionPreparingFrameRef.current === targetFrame
      && playbackTransitionPreparePromiseRef.current
    ) {
      return playbackTransitionPreparePromiseRef.current;
    }
    if (scrubRenderInFlightRef.current) {
      return false;
    }

    playbackTransitionPreparingFrameRef.current = targetFrame;
    // During playback with rAF pump active, don't hold scrubRenderInFlightRef
    // while pre-rendering transition frames. Holding the lock blocks the rAF
    // pump from calling pumpRenderLoop, causing 500-1200ms presentation gaps.
    // Instead, use a separate flag so prepares and the pump can run concurrently.
    const isPlaybackPrepare = usePlaybackStore.getState().isPlaying && forceFastScrubOverlay;
    const task = (async () => {
      if (!isPlaybackPrepare) {
        scrubRenderInFlightRef.current = true;
      }
      try {
        pinTransitionPlaybackSession(getTransitionWindowByStartFrame(targetFrame));
        const prepareStartedAtMs = performance.now();
        const trace = transitionSessionTraceRef.current;
        if (trace) {
          trace.prepareStartedAtMs = prepareStartedAtMs;
          pushTransitionTrace('prepare_start', {
            opId: trace.opId,
            targetFrame,
            mode: trace.mode,
            complex: trace.complex,
          });
        }
        const renderer = await ensureFastScrubRenderer();
        if (!renderer || !scrubMountedRef.current) return false;

        if ('setDomVideoElementProvider' in renderer) {
          renderer.setDomVideoElementProvider(getPinnedTransitionElementForItem);
        }

        const isComplexTransitionStart = playbackTransitionComplexStartFrames.has(targetFrame);
        const shouldRenderFullTargetFrame = forceFastScrubOverlay || isComplexTransitionStart;
        if (shouldRenderFullTargetFrame) {
          await renderer.renderFrame(targetFrame);
          cacheTransitionSessionFrame(targetFrame);
        }
        for (let offset = 1; offset < playbackTransitionPrerenderRunwayFrames; offset += 1) {
          const runwayFrame = targetFrame + offset;
          if (forceFastScrubOverlay && !isComplexTransitionStart) {
            await renderer.renderFrame(runwayFrame);
            cacheTransitionSessionFrame(runwayFrame);
          } else {
            await renderer.prewarmFrame(runwayFrame);
          }
        }
        if (!shouldRenderFullTargetFrame) {
          await renderer.renderFrame(targetFrame);
          cacheTransitionSessionFrame(targetFrame);
        }
        if (!scrubMountedRef.current) return false;
        scrubOffscreenRenderedFrameRef.current = targetFrame;
        const finishedAtMs = performance.now();
        if (trace) {
          trace.lastPrepareMs = Math.max(0, finishedAtMs - prepareStartedAtMs);
          pushTransitionTrace('prepare_done', {
            opId: trace.opId,
            targetFrame,
            prepareMs: trace.lastPrepareMs,
            preparedFrame: trace.lastPreparedFrame,
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          });
        }
        return true;
      } catch (error) {
        logger.debug('Hidden transition prerender failed:', targetFrame, error);
        return false;
      } finally {
        if (!isPlaybackPrepare) {
          scrubRenderInFlightRef.current = false;
        }
        if (playbackTransitionPreparingFrameRef.current === targetFrame) {
          playbackTransitionPreparingFrameRef.current = null;
          playbackTransitionPreparePromiseRef.current = null;
        }
        if (scrubRequestedFrameRef.current !== null) {
          resumeScrubLoopRef.current();
        }
      }
    })();

    playbackTransitionPreparePromiseRef.current = task;
    return task;
  }, [
    ensureFastScrubRenderer,
    getPinnedTransitionElementForItem,
    getTransitionWindowByStartFrame,
    pinTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    forceFastScrubOverlay,
    playbackTransitionComplexStartFrames,
    playbackTransitionPrerenderRunwayFrames,
    pushTransitionTrace,
  ]);

  // Dispose/recreate fast scrub renderer when composition inputs change.
  useEffect(() => {
    disposeFastScrubRenderer();
  }, [disposeFastScrubRenderer, fastScrubInputProps, renderSize.height, renderSize.width]);

  const captureCurrentFrame = useCallback(async (options?: CaptureOptions): Promise<string | null> => {
    if (captureInFlightRef.current) {
      return captureInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const format = options?.format ?? 'image/jpeg';
        const quality = options?.quality ?? 0.9;
        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const blob = await offscreen.convertToBlob({
            type: format,
            quality,
          });
          return blobToDataUrl(blob);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return null;

        ctx2d.drawImage(offscreen, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, format, quality);
        });
        if (!blob) return null;
        return blobToDataUrl(blob);
      } catch (error) {
        logger.warn('Failed to capture frame:', error);
        return null;
      } finally {
        captureInFlightRef.current = null;
      }
    })();

    captureInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const captureCurrentFrameImageData = useCallback(async (options?: CaptureOptions): Promise<ImageData | null> => {
    if (captureImageDataInFlightRef.current) {
      return captureImageDataInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const offscreenCtx = scrubOffscreenCtxRef.current
            ?? offscreen.getContext('2d', { willReadFrequently: true });
          if (!offscreenCtx) return null;
          return offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
        }

        let scaleCanvas = captureScaleCanvasRef.current;
        if (!scaleCanvas) {
          scaleCanvas = document.createElement('canvas');
          captureScaleCanvasRef.current = scaleCanvas;
        }
        if (scaleCanvas.width !== targetWidth || scaleCanvas.height !== targetHeight) {
          scaleCanvas.width = targetWidth;
          scaleCanvas.height = targetHeight;
        }
        const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
        if (!scaleCtx) return null;

        scaleCtx.clearRect(0, 0, targetWidth, targetHeight);
        scaleCtx.drawImage(offscreen, 0, 0, targetWidth, targetHeight);
        return scaleCtx.getImageData(0, 0, targetWidth, targetHeight);
      } catch (error) {
        logger.warn('Failed to capture raw frame:', error);
        return null;
      } finally {
        captureImageDataInFlightRef.current = null;
      }
    })();

    captureImageDataInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const captureCanvasSource = useCallback(async (): Promise<OffscreenCanvas | HTMLCanvasElement | null> => {
    if (captureCanvasSourceInFlightRef.current) {
      return captureCanvasSourceInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        return await renderOffscreenFrame(targetFrame);
      } catch (error) {
        logger.warn('Failed to capture canvas source:', error);
        return null;
      } finally {
        captureCanvasSourceInFlightRef.current = null;
      }
    })();

    captureCanvasSourceInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const setCaptureCanvasSource = usePlaybackStore((s) => s.setCaptureCanvasSource);

  // Register frame capture function for scopes and thumbnail workflows.
  useEffect(() => {
    setCaptureFrame(captureCurrentFrame);
    setCaptureFrameImageData?.(captureCurrentFrameImageData);
    setCaptureCanvasSource?.(captureCanvasSource);
    return () => {
      setCaptureFrame(null);
      setCaptureFrameImageData?.(null);
      setCaptureCanvasSource?.(null);
      setDisplayedFrame(null);
      captureInFlightRef.current = null;
      captureImageDataInFlightRef.current = null;
      captureScaleCanvasRef.current = null;
    };
  }, [captureCurrentFrame, captureCurrentFrameImageData, captureCanvasSource, setCaptureFrame, setCaptureFrameImageData, setCaptureCanvasSource, setDisplayedFrame]);

  // Eager GPU warm-up on mount — request the WebGPU device BEFORE media
  // finishes resolving. This is the most expensive single cold-start cost
  // (~50-100ms for device request, plus ~100-400ms for shader compilation).
  // The device is cached globally so the renderer reuses it instead of
  // requesting a second one.
  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return;
    void (async () => {
      try {
        const { EffectsPipeline } = await import('@/infrastructure/gpu/effects');
        // requestCachedDevice warms the adapter + device. The subsequent
        // EffectsPipeline.create() inside the renderer reuses it.
        const device = await EffectsPipeline.requestCachedDevice();
        if (device) {
          // Pre-create a throwaway pipeline to compile all effect shaders.
          // Shader binaries are cached by the GPU driver, so the renderer's
          // own pipeline creation will be near-instant.
          const warmPipeline = await EffectsPipeline.create();
          if (warmPipeline) {
            try {
              const { TransitionPipeline } = await import('@/infrastructure/gpu/transitions');
              TransitionPipeline.create(device)?.destroy();
            } finally {
              warmPipeline.destroy();
            }
          }
        }
      } catch {
        // GPU not available — renderer will fall back to CPU path.
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-time mount

  // Background warm-up of full renderer once media URLs are resolved.
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

  // Drive full-composition fast renderer from preview/scrub frames.
  useEffect(() => {
    scrubMountedRef.current = true;

    const drawSourceToDisplay = (source: OffscreenCanvas | HTMLCanvasElement, renderedFrame: number) => {
      const displayCanvas = scrubCanvasRef.current;
      if (!displayCanvas) return;
      const displayCtx = displayCanvas.getContext('2d');
      if (!displayCtx) return;
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.drawImage(source, 0, 0, displayCanvas.width, displayCanvas.height);
      setDisplayedFrame(renderedFrame);
    };

    const drawToDisplay = (renderedFrame: number) => {
      const offscreen = scrubOffscreenCanvasRef.current;
      if (!offscreen) return;
      drawSourceToDisplay(offscreen, renderedFrame);
    };

    const getPlaybackTransitionStateForFrame = (frame: number) => (
      resolvePlaybackTransitionOverlayState(
        playbackTransitionWindows,
        frame,
        playbackTransitionLookaheadFrames,
        playbackTransitionCooldownFrames,
      )
    );

    const tryShowPreparedPlaybackTransitionOverlay = (frame: number) => {
      const bufferedFrame = transitionSessionBufferedFramesRef.current.get(frame);
      if (bufferedFrame) {
        const trace = transitionSessionTraceRef.current;
        if (trace && trace.enteredAtMs === null) {
          trace.enteredAtMs = performance.now();
          pushTransitionTrace('entry_show', {
            opId: trace.opId,
            frame,
            via: 'buffer',
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          });
        }
        drawSourceToDisplay(bufferedFrame, frame);
        showPlaybackTransitionOverlayForFrame();
        return true;
      }
      if (scrubOffscreenRenderedFrameRef.current !== frame) {
        return false;
      }
      const trace = transitionSessionTraceRef.current;
      if (trace && trace.enteredAtMs === null) {
        trace.enteredAtMs = performance.now();
        pushTransitionTrace('entry_show', {
          opId: trace.opId,
          frame,
          via: 'offscreen',
          bufferedFrames: transitionSessionBufferedFramesRef.current.size,
        });
      }
      drawToDisplay(frame);
      showPlaybackTransitionOverlayForFrame();
      return true;
    };

    const schedulePlaybackTransitionPrepare = (frame: number | null) => {
      if (frame === null) {
        deferredPlaybackTransitionPrepareFrameRef.current = null;
        if (transitionPrepareTimeoutRef.current !== null) {
          clearTimeout(transitionPrepareTimeoutRef.current);
          transitionPrepareTimeoutRef.current = null;
        }
        return;
      }
      deferredPlaybackTransitionPrepareFrameRef.current = frame;
      if (!scrubRenderInFlightRef.current) {
        void preparePlaybackTransitionFrame(frame);
      }
    };

    const clearScheduledTransitionPrepare = () => {
      if (transitionPrepareTimeoutRef.current !== null) {
        clearTimeout(transitionPrepareTimeoutRef.current);
        transitionPrepareTimeoutRef.current = null;
      }
    };

    const scheduleOpportunisticTransitionPrepare = () => {
      const deferredFrame = deferredPlaybackTransitionPrepareFrameRef.current;
      if (deferredFrame === null) {
        clearScheduledTransitionPrepare();
        return;
      }
      if (transitionPrepareTimeoutRef.current !== null) {
        return;
      }

      transitionPrepareTimeoutRef.current = window.setTimeout(() => {
        transitionPrepareTimeoutRef.current = null;
        if (!scrubMountedRef.current) return;

        const playbackState = usePlaybackStore.getState();
        if (!playbackState.isPlaying) return;

        const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
        if (!playbackTransitionState.shouldPrewarm || playbackTransitionState.nextTransitionStartFrame !== deferredFrame) {
          return;
        }

        if (scrubRenderInFlightRef.current) {
          scheduleOpportunisticTransitionPrepare();
          return;
        }

        const trace = transitionSessionTraceRef.current;
        if (trace) {
          pushTransitionTrace('prepare_opportunistic', {
            opId: trace.opId,
            targetFrame: deferredFrame,
          });
        }

        deferredPlaybackTransitionPrepareFrameRef.current = null;
        void preparePlaybackTransitionFrame(deferredFrame);
      }, 0);
    };

    const pumpRenderLoop = async () => {
      if (scrubRenderInFlightRef.current) return;
      scrubRenderInFlightRef.current = true;
      const generation = scrubRenderGenerationRef.current;

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

        let prewarmBudgetStart = 0;
        while (scrubMountedRef.current) {
          if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) {
            hideFastScrubOverlay();
            hidePlaybackTransitionOverlay();
            scrubRequestedFrameRef.current = null;
            break;
          }
          if (fallbackToPlayerScrubRef.current) {
            scrubRequestedFrameRef.current = null;
            scrubPrewarmQueueRef.current = [];
            scrubPrewarmQueuedSetRef.current.clear();
            hideFastScrubOverlay();
            hidePlaybackTransitionOverlay();
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
            prewarmBudgetStart = 0; // Reset budget for prewarm after this priority frame
          } else {
            scrubPrewarmQueuedSetRef.current.delete(frameToRender);
            // Skip stale prewarm if a newer scrub frame is pending.
            if (scrubRequestedFrameRef.current !== null) {
              continue;
            }
            if (suppressScrubBackgroundPrewarmRef.current) {
              continue;
            }
            // Skip prewarm during playback — WASM decode prewarm renders
            // (40-80ms each) block the loop from processing priority frames,
            // causing the overlay to fall behind and show stale content.
            if (usePlaybackStore.getState().isPlaying) {
              break;
            }
            // Time-budget prewarm renders to keep scrubbing responsive.
            // After exhausting the budget, yield so new priority frames aren't delayed.
            if (prewarmBudgetStart > 0 && performance.now() - prewarmBudgetStart > FAST_SCRUB_PREWARM_RENDER_BUDGET_MS) {
              break;
            }
          }

          const renderer = await ensureFastScrubRenderer();
          if (!renderer || !scrubMountedRef.current) {
            hideFastScrubOverlay();
            break;
          }

          // Enable DOM video element provider during playback for zero-copy rendering.
          // During playback, the Player's <video> elements are already at
          // the correct frame — reading from them avoids mediabunny decode entirely.
          if ('setDomVideoElementProvider' in renderer) {
            const playbackNow = usePlaybackStore.getState();
            if (playbackNow.isPlaying) {
              // Only pin/clear the transition session when the rendered frame is
              // actually inside a transition window. Passing null for pre-transition
              // frames would destroy sessions that the prearm subscription just
              // pinned, causing churn and losing the DOM video element provider
              // needed for smooth transition entry.
              const windowForFrame = getTransitionWindowForFrame(frameToRender);
              if (windowForFrame) {
                const prevSession = transitionSessionWindowRef.current;
                const isNewSession = !prevSession || prevSession.transition.id !== windowForFrame.transition.id;
                pinTransitionPlaybackSession(windowForFrame);
                // Pre-warm mediabunny decoders when entering a transition mid-playback
                // (e.g. starting playback inside a transition zone). Pre-seek to
                // the current frame (not startFrame) so the decoder cursor lands
                // close to where the first real render will need it.
                if (isNewSession && 'prewarmItems' in renderer) {
                  void renderer.prewarmItems(
                    [windowForFrame.leftClip.id, windowForFrame.rightClip.id],
                    frameToRender,
                  );
                }
              }
              renderer.setDomVideoElementProvider(getPinnedTransitionElementForItem);
            } else {
              renderer.setDomVideoElementProvider(undefined);
            }
          }

          if (isPriorityFrame) {
            // Visible scrub targets still use full composition rendering.
            const renderStartMs = performance.now();
            await renderer.renderFrame(frameToRender);
            const renderMs = performance.now() - renderStartMs;
            scrubOffscreenRenderedFrameRef.current = frameToRender;
            // Dev: capture ALL frame times to window global for jitter debugging
            if (import.meta.env.DEV) {
              const log = (window as unknown as Record<string, unknown>).__ALL_FRAME_TIMES__ as Array<{ f: number; ms: number }> | undefined;
              if (log && log.length < 300) {
                log.push({ f: frameToRender, ms: Math.round(renderMs * 100) / 100 });
              }
              // Feed the frame jitter monitor with transition context
              const tw = transitionSessionWindowRef.current;
              const inTrans = tw !== null
                && frameToRender >= tw.startFrame
                && frameToRender < tw.endFrame;
              _devJitterMonitor?.recordRenderFrame(
                frameToRender,
                renderMs,
                inTrans,
                tw?.transition.id ?? null,
                inTrans && tw ? (frameToRender - tw.startFrame) / (tw.endFrame - tw.startFrame) : null,
              );
            }
            // Log transition-area frame timing for diagnostics.
            if (import.meta.env.DEV && transitionSessionWindowRef.current) {
              const tw = transitionSessionWindowRef.current;
              if (frameToRender >= tw.startFrame - 10 && frameToRender <= tw.endFrame + 5) {
                pushTransitionTrace(renderMs > 16 ? 'render_frame_slow' : 'render_frame', {
                  frame: frameToRender,
                  renderMs: Math.round(renderMs * 100) / 100,
                  inTransition: frameToRender >= tw.startFrame && frameToRender < tw.endFrame,
                });
              }
            }
          } else {
            // Background scrub prewarm only needs to advance decode state for
            // nearby sources. Avoid full composition work for non-visible frames.
            await renderer.prewarmFrame(frameToRender);
          }
          if (!scrubMountedRef.current) break;

          if (isPriorityFrame) {

            const playbackState = usePlaybackStore.getState();
            const playbackTransitionState = getPlaybackTransitionStateForFrame(frameToRender);
            const shouldShowPlaybackTransitionOverlay = (
              playbackState.isPlaying
              && playbackState.previewFrame === null
              && (playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay)
              && !forceFastScrubOverlay
            );
            if (fallbackToPlayerScrubRef.current) {
              hideFastScrubOverlay();
              hidePlaybackTransitionOverlay();
              continue;
            }
            // Guard against stale in-flight renders that finish after scrub has ended.
            // Without this, a completed old render can re-show the overlay and hide
            // live Player updates (e.g. ruler click + gizmo interaction).
            if (
              !shouldShowPlaybackTransitionOverlay
              && !forceFastScrubOverlay
              && !shouldShowFastScrubOverlay({
                isGizmoInteracting: isGizmoInteractingRef.current,
                isPlaying: playbackState.isPlaying,
                currentFrame: playbackState.currentFrame,
                previewFrame: playbackState.previewFrame,
                renderedFrame: frameToRender,
              })
            ) {
              previewPerfRef.current.staleScrubOverlayDrops += 1;
              hideFastScrubOverlay();
              hidePlaybackTransitionOverlay();
              continue;
            }

            drawToDisplay(frameToRender);
            if (shouldShowPlaybackTransitionOverlay) {
              showPlaybackTransitionOverlayForFrame();
            } else {
              showFastScrubOverlayForFrame();
            }
            if (!shouldShowPlaybackTransitionOverlay && !suppressScrubBackgroundPrewarmRef.current) {
              enqueueDirectionalPrewarm(frameToRender);
              enqueueBoundaryPrewarm(frameToRender);
              enqueueBoundarySourcePrewarm(frameToRender);
            }
            if (deferredPlaybackTransitionPrepareFrameRef.current !== null) {
              scheduleOpportunisticTransitionPrepare();
            }
            prewarmBudgetStart = performance.now();
          } else {
            markPrewarmed(frameToRender);
          }
        }
      } catch (error) {
        logger.warn('Render failed, using Player seek fallback:', error);
        hideFastScrubOverlay();
        hidePlaybackTransitionOverlay();
        disposeFastScrubRenderer();
      } finally {
        // Only release the lock if this pump owns the current generation.
        // A playback-start force-clear bumps the generation, so stale pumps
        // don't accidentally release a newer pump's lock.
        if (scrubRenderGenerationRef.current === generation) {
          scrubRenderInFlightRef.current = false;
          const deferredPrepareFrame = deferredPlaybackTransitionPrepareFrameRef.current;
          if (deferredPrepareFrame !== null) {
            scheduleOpportunisticTransitionPrepare();
          }
        }
      }
    };

    resumeScrubLoopRef.current = () => {
      void pumpRenderLoop();
    };

    // rAF-driven render pump for playback — fires at display vsync (60Hz+),
    // catching frames the Zustand subscription misses due to event loop
    // contention from React renders, GC pauses, etc. This reduces the ~9%
    // frame drop rate during playback to near zero.
    let playbackRafId: number | null = null;
    let lastRafRenderedFrame = -1;
    let playbackPrewarmInFlight = false;
    const pausePrewarmedItemIds = new Set<string>();

    const playbackRafPump = () => {
      playbackRafId = null;
      if (!scrubMountedRef.current) return;
      const playbackState = usePlaybackStore.getState();
      if (!playbackState.isPlaying || !forceFastScrubOverlay) return;
      const currentFrame = playbackState.currentFrame;
      // Only pump when the frame has actually advanced — avoids redundant
      // renders at 60Hz rAF when the Player runs at 30fps.
      if (currentFrame !== lastRafRenderedFrame) {
        lastRafRenderedFrame = currentFrame;
        scrubRequestedFrameRef.current = currentFrame;
        if (!scrubRenderInFlightRef.current) {
          void pumpRenderLoop();
        }
      }
      playbackRafId = requestAnimationFrame(playbackRafPump);
    };

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      // Start/stop rAF render pump on play state transitions
      if (state.isPlaying && forceFastScrubOverlay && !prev.isPlaying) {
        if (playbackRafId === null) {
          lastRafRenderedFrame = -1;
          // Force-clear any in-flight scrub render from the paused seek so
          // the rAF pump can take over immediately. Bump the generation so
          // the stale pump's finally block won't release the new pump's lock.
          scrubRenderGenerationRef.current += 1;
          scrubRenderInFlightRef.current = false;
          scrubPrewarmQueueRef.current = [];
          scrubPrewarmQueuedSetRef.current.clear();
          // Pre-warm mediabunny decoders for variable-speed video clips at the
          // current frame BEFORE starting the rAF render pump. These clips can't
          // use DOM video zero-copy (browser plays at 1x) so they need mediabunny,
          // which takes 150-500ms on first decode without prewarm.
          // Check if any variable-speed clips need mediabunny prewarm
          const frame = state.currentFrame;
          const prewarmItemIds: string[] = [];
          for (const track of combinedTracks) {
            for (const item of track.items) {
              if (item.type !== 'video') continue;
              if (frame < item.from || frame >= item.from + item.durationInFrames) continue;
              const speed = item.speed ?? 1;
              if (Math.abs(speed - 1) < 0.01) continue;
              // Only prewarm clips where playback starts AT or very near the
              // clip start (within 2 frames). Clips that started much earlier
              // will use DOM video during playback — pre-seeking their decoder
              // to the current frame wastes time and positions it wrong.
              const framesIntoClip = frame - item.from;
              if (framesIntoClip <= 2) {
                prewarmItemIds.push(item.id);
              }
            }
          }
          // Fire ONE background worker preseek per variable-speed clip at the
          // furthest lookahead position. The worker runs mediabunny off the main
          // thread and caches the decoded ImageBitmap for the render loop.
          for (const track of combinedTracks) {
            for (const item of track.items) {
              if (item.type !== 'video' || !('src' in item) || !item.src) continue;
              const speed = item.speed ?? 1;
              if (Math.abs(speed - 1) < 0.01) continue;
              const itemEnd = item.from + item.durationInFrames;
              const lookahead = Math.round(fps * 3);
              if (item.from <= frame + lookahead && itemEnd > frame) {
                const targetFrame = Math.min(frame + lookahead, itemEnd - 1);
                const localFrame = Math.max(0, targetFrame - item.from);
                const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
                const sourceFps = item.sourceFps ?? fps;
                const sourceTime = (sourceStart / sourceFps) + (localFrame / fps) * speed;
                void workerBackgroundPreseek(item.src, sourceTime);
              }
            }
          }

          if (prewarmItemIds.length > 0) {
            // Prewarm first, then start rAF pump — avoids 150ms+ first-frame stall.
            // Set flag to prevent subscription from pumping render loop during prewarm.
            // SKIP items already pre-seeked by the paused occlusion prewarm — re-seeking
            // to the current frame would undo the precise visibility-frame positioning.
            playbackPrewarmInFlight = true;
            void (async () => {
              const renderer = await ensureFastScrubRenderer();
              if (renderer && 'prewarmItems' in renderer) {
                // Only prewarm items that weren't already positioned by pause prewarm
                const needsPrewarm = prewarmItemIds.filter(
                  (id) => !pausePrewarmedItemIds.has(id),
                );
                if (needsPrewarm.length > 0) {
                  await renderer.prewarmItems(needsPrewarm, frame);
                }
              }
              pausePrewarmedItemIds.clear();
              playbackPrewarmInFlight = false;
              if (playbackRafId === null && usePlaybackStore.getState().isPlaying) {
                playbackRafId = requestAnimationFrame(playbackRafPump);
              }
            })();
          } else {
            // No prewarm needed — start immediately
            playbackRafId = requestAnimationFrame(playbackRafPump);
          }
        }
      } else if (!state.isPlaying && playbackRafId !== null) {
        cancelAnimationFrame(playbackRafId);
        playbackRafId = null;
      }

      if (state.isPlaying && forceFastScrubOverlay) {
        const complexPrewarmStartFrame = getPlayingComplexTransitionPrewarmStartFrame(state.currentFrame);
        if (complexPrewarmStartFrame !== null) {
          // Pin the session so the render loop knows a transition is active.
          // Also schedule a deferred (opportunistic) prep — this warms up
          // mediabunny decoders for the transition clips without blocking
          // pumpRenderLoop. The prep runs between frames via setTimeout(0).
          const transitionWindow = getTransitionWindowByStartFrame(complexPrewarmStartFrame);
          if (transitionWindow) {
            pinTransitionPlaybackSession(transitionWindow);
          }
          // Pre-initialize mediabunny decoders for transition clips without
          // blocking the render loop. This fire-and-forget warmup runs in the
          // background so the first transition frame doesn't pay the 300-500ms
          // WASM decoder init cost.
          if (lastPlayingPrearmTargetRef.current !== complexPrewarmStartFrame) {
            lastPlayingPrearmTargetRef.current = complexPrewarmStartFrame;
            if (transitionWindow) {
              const renderer = scrubRendererRef.current;
              if (renderer && 'prewarmItems' in renderer) {
                void renderer.prewarmItems(
                  [transitionWindow.leftClip.id, transitionWindow.rightClip.id],
                  transitionWindow.startFrame,
                );
              }
            }
            pushTransitionTrace('playing_complex_prearm', {
              targetFrame: complexPrewarmStartFrame,
            });
          }
        } else {
          // No upcoming complex transition — clean up if we've moved past
          // the active transition window (not just entered it).
          lastPlayingPrearmTargetRef.current = null;
          const activeWindow = transitionSessionWindowRef.current;
          if (activeWindow && state.currentFrame >= activeWindow.endFrame) {
            clearTransitionPlaybackSession();
          }
        }
      }

      // Pre-seek mediabunny decoders for variable-speed clips while paused.
      // Blocking the main thread during pause is acceptable (~400ms for keyframe
      // seek). This positions the decoder cursor at ~3s ahead, so when the clip
      // becomes visible during playback, the seek gap is within the 3s sequential
      // advance threshold (fast) instead of triggering a keyframe restart (slow).
      if (!state.isPlaying && state.previewFrame === null && prev.currentFrame !== state.currentFrame) {
        const varSpeedItemIds: string[] = [];
        let furthestFrame = state.currentFrame;
        const lookahead = Math.round(fps * 3);
        for (const track of combinedTracks) {
          for (const item of track.items) {
            if (item.type !== 'video') continue;
            const speed = item.speed ?? 1;
            if (Math.abs(speed - 1) < 0.01) continue;
            const itemEnd = item.from + item.durationInFrames;
            // Only prewarm clips that START ahead (upcoming clip boundaries).
            // Clips already active use DOM video during playback — pre-seeking
            // their decoder wastes main-thread time and mispositions the cursor.
            if (item.from > state.currentFrame && item.from <= state.currentFrame + lookahead) {
              varSpeedItemIds.push(item.id);
              furthestFrame = Math.max(furthestFrame, Math.min(state.currentFrame + lookahead, itemEnd - 1));
            }
          }
        }
        if (varSpeedItemIds.length > 0) {
          // Find where occluding clips end — that's where the variable-speed
          // clip becomes visible and needs its decoder positioned.
          const visibilityFrame = (() => {
            // Find the track order of the variable-speed clip
            for (const track of combinedTracks) {
              const varItem = track.items.find(i => varSpeedItemIds.includes(i.id));
              if (!varItem) continue;
              const varTrackOrder = track.order ?? 0;
              // Scan tracks above (lower order = visually higher = occluding)
              let latestOccluderEnd = state.currentFrame;
              for (const otherTrack of combinedTracks) {
                const otherOrder = otherTrack.order ?? 0;
                if (otherOrder >= varTrackOrder) continue; // Not above
                for (const otherItem of otherTrack.items) {
                  if (otherItem.type === 'audio' || otherItem.type === 'adjustment') continue;
                  const otherEnd = otherItem.from + otherItem.durationInFrames;
                  // Occluder overlaps with our range
                  if (otherItem.from <= state.currentFrame + lookahead && otherEnd > state.currentFrame) {
                    latestOccluderEnd = Math.max(latestOccluderEnd, otherEnd);
                  }
                }
              }
              return latestOccluderEnd;
            }
            return state.currentFrame;
          })();
          for (const id of varSpeedItemIds) pausePrewarmedItemIds.add(id);
          // Seek to 1 frame BEFORE the visibility point. drawFrame advances
          // the iterator past the target — seeking exactly to the visibility
          // frame would cause a backward restart when the render loop requests
          // the same timestamp. Seeking 1 frame early leaves the decoder
          // positioned for an instant sequential advance.
          // Seek to 1 frame before visibility point (drawFrame advances past
          // the target — seeking exactly to it would cause a backward restart).
          // This runs async — if it completes before playback reaches the clip,
          // the keyframe seek is absorbed during pause (0ms at playback time).
          const preseekFrame = Math.max(state.currentFrame, visibilityFrame - 1);
          const renderer = scrubRendererRef.current;
          if (renderer && 'prewarmItems' in renderer) {
            void renderer.prewarmItems(varSpeedItemIds, preseekFrame);
          }
        }
      }

      if (!state.isPlaying && state.previewFrame === null) {
        const pausedPrewarmStartFrame = getPausedTransitionPrewarmStartFrame(state.currentFrame);
        if (pausedPrewarmStartFrame !== null) {
          if (forceFastScrubOverlay) {
            // When GPU effects overlay is active, use non-blocking prewarmItems
            // instead of preparePlaybackTransitionFrame. The prep would set
            // scrubRenderInFlightRef=true and block pumpRenderLoop for 300ms+
            // when playback resumes.
            const tw = getTransitionWindowByStartFrame(pausedPrewarmStartFrame);
            if (tw) {
              pinTransitionPlaybackSession(tw);
              if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
                void (async () => {
                  const renderer = await ensureFastScrubRenderer();
                  if (renderer && 'prewarmItems' in renderer) {
                    await renderer.prewarmItems(
                      [tw.leftClip.id, tw.rightClip.id],
                      state.currentFrame,
                    );
                  }
                })();
              }
            }
          } else {
            schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame);
          }
          if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
            lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame;
            pushTransitionTrace('paused_prearm', {
              targetFrame: pausedPrewarmStartFrame,
            });
          }
        } else {
          // No nearby transition while paused — clean up.
          // Check on any frame change OR play-state transition (isPlaying toggled).
          if (prev.currentFrame !== state.currentFrame || prev.isPlaying !== state.isPlaying) {
            lastPausedPrearmTargetRef.current = null;
            schedulePlaybackTransitionPrepare(null);
            clearTransitionPlaybackSession();
          }
        }
      }

      if (shouldPreferPlayerForPreview(state.previewFrame)) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        hideFastScrubOverlay();
        hidePlaybackTransitionOverlay();
        return;
      }

      if (state.isPlaying && !forceFastScrubOverlay) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        const playbackTransitionState = getPlaybackTransitionStateForFrame(state.currentFrame);
        if (playbackTransitionState.shouldPrewarm) {
          void ensureFastScrubRenderer();
          if (!playbackTransitionState.hasActiveTransition && playbackTransitionState.nextTransitionStartFrame !== null) {
            schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
          }
        }
        if (!(playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay)) {
          if (!playbackTransitionState.shouldPrewarm) {
            clearTransitionPlaybackSession();
          }
          hideFastScrubOverlay();
          hidePlaybackTransitionOverlay();
          return;
        }
        clearPendingFastScrubHandoff();
        if (showFastScrubOverlayRef.current) {
          hideFastScrubOverlay();
        }
        if (tryShowPreparedPlaybackTransitionOverlay(state.currentFrame)) {
          return;
        }
        if (playbackTransitionState.hasActiveTransition) {
          const trace = transitionSessionTraceRef.current;
          if (trace && trace.lastEntryMissFrame !== state.currentFrame) {
            trace.entryMisses += 1;
            trace.lastEntryMissFrame = state.currentFrame;
            pushTransitionTrace('entry_miss', {
              opId: trace.opId,
              frame: state.currentFrame,
              bufferedFrames: transitionSessionBufferedFramesRef.current.size,
            });
          }
        }
        scrubRequestedFrameRef.current = state.currentFrame;
        void pumpRenderLoop();
        return;
      }

      const useCurrentFrameAsTarget = (
        forceFastScrubOverlay
        || (isGizmoInteractingRef.current && !preferPlayerForTextGizmoRef.current)
      );
      const targetFrame = state.previewFrame ?? (useCurrentFrameAsTarget ? state.currentFrame : null);
      const prevTargetFrame = prev.previewFrame ?? (useCurrentFrameAsTarget ? prev.currentFrame : null);
      const playStateChanged = state.isPlaying !== prev.isPlaying;
      const isAtomicScrubTarget = (
        state.previewFrame !== null
        && state.currentFrame === state.previewFrame
        && state.currentFrameEpoch === state.previewFrameEpoch
      );

      if (targetFrame === prevTargetFrame && !playStateChanged) return;

      if (state.previewFrame !== null && prev.previewFrame !== null) {
        const previewDelta = state.previewFrame - prev.previewFrame;
        scrubDirectionRef.current = previewDelta > 0 ? 1 : previewDelta < 0 ? -1 : 0;
        const deltaFrames = Math.abs(previewDelta);
        previewPerfRef.current.scrubUpdates += 1;
        if (deltaFrames > 1) {
          previewPerfRef.current.scrubDroppedFrames += (deltaFrames - 1);
        }
      } else if (targetFrame !== null && prevTargetFrame !== null) {
        const targetDelta = targetFrame - prevTargetFrame;
        scrubDirectionRef.current = targetDelta > 0 ? 1 : targetDelta < 0 ? -1 : 0;
      } else if (targetFrame !== null) {
        scrubDirectionRef.current = 0;
      }

      const nextSuppressBackgroundPrewarm = FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD
        && scrubDirectionRef.current < 0;
      const nextFallbackToPlayer = !forceFastScrubOverlay
        && FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD
        && scrubDirectionRef.current < 0
        && !isAtomicScrubTarget;
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
          hideFastScrubOverlay();
          hidePlaybackTransitionOverlay();
        }
      }
      if (fallbackToPlayerScrubRef.current && targetFrame !== null) {
        // Let Player seek path handle backward scrubbing directly.
        hideFastScrubOverlay();
        hidePlaybackTransitionOverlay();
        return;
      }

      if (targetFrame === null) {
        scrubRequestedFrameRef.current = null;
        scrubDirectionRef.current = 0;
        suppressScrubBackgroundPrewarmRef.current = false;
        fallbackToPlayerScrubRef.current = false;
        lastBackwardScrubPreloadAtRef.current = 0;
        lastBackwardScrubRenderAtRef.current = 0;
        lastBackwardRequestedFrameRef.current = null;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
        clearPendingFastScrubHandoff();
        bypassPreviewSeekRef.current = false;
        // Ensure the Player lands on the actual playhead after overlay scrub.
        try {
          const playerFrame = playerRef.current?.getCurrentFrame();
          const roundedFrame = Number.isFinite(playerFrame)
            ? Math.round(playerFrame as number)
            : null;
          if (roundedFrame === state.currentFrame) {
            playerRef.current?.seekTo(state.currentFrame);
            hideFastScrubOverlay();
            hidePlaybackTransitionOverlay();
            return;
          }
          if (showFastScrubOverlayRef.current && roundedFrame !== state.currentFrame) {
            beginFastScrubHandoff(state.currentFrame);
          }
          if (roundedFrame !== state.currentFrame) {
            trackPlayerSeek(state.currentFrame);
          }
          playerRef.current?.seekTo(state.currentFrame);
          if (!maybeCompleteFastScrubHandoff()) {
            if (pendingFastScrubHandoffFrameRef.current !== null) {
              scheduleFastScrubHandoffCheck();
            } else {
              hideFastScrubOverlay();
              hidePlaybackTransitionOverlay();
            }
          }
        } catch {
          // Fallback path remains active via useCustomPlayer subscription.
          hideFastScrubOverlay();
          hidePlaybackTransitionOverlay();
        }
        return;
      }

      clearPendingFastScrubHandoff();
      if (scrubRequestedFrameRef.current === targetFrame) {
        return;
      }

      let nextRequestedFrame = targetFrame;
      if (scrubDirectionRef.current < 0 && !isAtomicScrubTarget) {
        const nowMs = performance.now();
        const quantizedFrame = Math.floor(
          targetFrame / FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES
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
      // During playback with rAF pump active or prewarm in flight, let
      // rAF drive the render loop to avoid contention and first-frame stalls.
      if (playbackRafId === null && !playbackPrewarmInFlight) {
        void pumpRenderLoop();
      }
    });

    // During gizmo drags or live preview changes, trigger re-renders even when
    // the frame is unchanged so the fast-scrub overlay does not reuse a stale
    // cached bitmap for the current frame.
    const unsubscribeGizmo = useGizmoStore.subscribe((state, prev) => {
      if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) return;
      if (!forceFastScrubOverlay && !isGizmoInteractingRef.current) return;
      const unifiedPreviewChanged = state.preview !== prev.preview;
      const transformPreviewChanged = state.previewTransform !== prev.previewTransform;
      // Gizmo transform changes require an active gizmo; effect preview changes don't.
      if (!unifiedPreviewChanged && !(transformPreviewChanged && state.activeGizmo)) return;

      const playbackState = usePlaybackStore.getState();
      const currentFrame = playbackState.currentFrame;

      // Preview-only changes don't advance the frame number, so the frame
      // cache would otherwise return the stale bitmap for the current frame.
      // Invalidate before requesting a repaint so gizmo resize/translate and
      // live panel previews re-composite immediately.
      if ((unifiedPreviewChanged || transformPreviewChanged) && scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache([currentFrame]);
      }

      scrubRequestedFrameRef.current = currentFrame;
      void pumpRenderLoop();
    });

    // During corner pin drag, re-render with the live preview values so the
    // scrub overlay reflects the warp in real-time instead of waiting for commit.
    const unsubscribeCornerPin = useCornerPinStore.subscribe((state, prev) => {
      if (!forceFastScrubOverlay) return;
      if (state.previewCornerPin === prev.previewCornerPin) return;

      const currentFrame = usePlaybackStore.getState().currentFrame;
      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache([currentFrame]);
      }
      scrubRequestedFrameRef.current = currentFrame;
      void pumpRenderLoop();
    });

    const unsubscribeMaskEditor = useMaskEditorStore.subscribe((state, prev) => {
      const previewVerticesChanged = state.previewVertices !== prev.previewVertices;
      const editingItemChanged = state.editingItemId !== prev.editingItemId;
      if (!previewVerticesChanged && !editingItemChanged) return;

      const playbackState = usePlaybackStore.getState();
      const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
      if (!forceFastScrubOverlay && playbackState.previewFrame === null) return;

      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache([targetFrame]);
      }
      scrubRequestedFrameRef.current = targetFrame;
      void pumpRenderLoop();
    });

    const initialPlaybackState = usePlaybackStore.getState();
    if (initialPlaybackState.isPlaying && forceFastScrubOverlay) {
      const complexPrewarmStartFrame = getPlayingComplexTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
      if (complexPrewarmStartFrame !== null) {
        lastPlayingPrearmTargetRef.current = complexPrewarmStartFrame;
        // Pin session only — render loop handles per-frame rendering.
        const transitionWindow = getTransitionWindowByStartFrame(complexPrewarmStartFrame);
        if (transitionWindow) {
          pinTransitionPlaybackSession(transitionWindow);
        }
        pushTransitionTrace('playing_complex_prearm', {
          targetFrame: complexPrewarmStartFrame,
        });
      }
    }
    if (!initialPlaybackState.isPlaying && initialPlaybackState.previewFrame === null) {
      const pausedPrewarmStartFrame = getPausedTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
      if (pausedPrewarmStartFrame !== null) {
        lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame;
        if (forceFastScrubOverlay) {
          // Non-blocking prewarm — avoid schedulePlaybackTransitionPrepare which
          // blocks the render loop via scrubRenderInFlightRef on playback resume.
          const tw = getTransitionWindowByStartFrame(pausedPrewarmStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            void (async () => {
              const renderer = await ensureFastScrubRenderer();
              if (renderer && 'prewarmItems' in renderer) {
                await renderer.prewarmItems(
                  [tw.leftClip.id, tw.rightClip.id],
                  initialPlaybackState.currentFrame,
                );
              }
            })();
          }
        } else {
          schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame);
        }
        pushTransitionTrace('paused_prearm', {
          targetFrame: pausedPrewarmStartFrame,
        });
      }
    }

    if (
      !initialPlaybackState.isPlaying
      && initialPlaybackState.previewFrame !== null
      && !forceFastScrubOverlay
      && !shouldPreferPlayerForPreview(initialPlaybackState.previewFrame)
    ) {
      const previewTransitionState = getPlaybackTransitionStateForFrame(initialPlaybackState.previewFrame);
      if (
        previewTransitionState.shouldPrewarm
        && !previewTransitionState.hasActiveTransition
        && previewTransitionState.nextTransitionStartFrame !== null
      ) {
        schedulePlaybackTransitionPrepare(previewTransitionState.nextTransitionStartFrame);
      }
      scrubRequestedFrameRef.current = initialPlaybackState.previewFrame;
      void pumpRenderLoop();
    } else if (forceFastScrubOverlay || (isGizmoInteracting && !preferPlayerForTextGizmo)) {
      const playbackState = usePlaybackStore.getState();
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
      if (playbackState.isPlaying && playbackTransitionState.shouldPrewarm && playbackTransitionState.nextTransitionStartFrame !== null) {
        if (forceFastScrubOverlay) {
          // Non-blocking prewarm path
          const tw = getTransitionWindowByStartFrame(playbackTransitionState.nextTransitionStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            const renderer = scrubRendererRef.current;
            if (renderer && 'prewarmItems' in renderer) {
              void renderer.prewarmItems(
                [tw.leftClip.id, tw.rightClip.id],
                tw.startFrame,
              );
            }
          }
        } else {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
        }
      }
      const initialFrame = playbackState.previewFrame ?? playbackState.currentFrame;
      scrubRequestedFrameRef.current = initialFrame;
      void pumpRenderLoop();
      // Start rAF pump if already playing
      if (playbackState.isPlaying && forceFastScrubOverlay && playbackRafId === null) {
        playbackRafId = requestAnimationFrame(playbackRafPump);
      }
    } else if (usePlaybackStore.getState().isPlaying && !forceFastScrubOverlay) {
      const playbackState = usePlaybackStore.getState();
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
      if (playbackTransitionState.shouldPrewarm) {
        void ensureFastScrubRenderer();
        if (!playbackTransitionState.hasActiveTransition && playbackTransitionState.nextTransitionStartFrame !== null) {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
        }
      }
      if (playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay) {
        if (tryShowPreparedPlaybackTransitionOverlay(playbackState.currentFrame)) {
          return;
        }
        if (playbackTransitionState.hasActiveTransition) {
          const trace = transitionSessionTraceRef.current;
          if (trace && trace.lastEntryMissFrame !== playbackState.currentFrame) {
            trace.entryMisses += 1;
            trace.lastEntryMissFrame = playbackState.currentFrame;
            pushTransitionTrace('entry_miss', {
              opId: trace.opId,
              frame: playbackState.currentFrame,
              bufferedFrames: transitionSessionBufferedFramesRef.current.size,
            });
          }
        }
        scrubRequestedFrameRef.current = playbackState.currentFrame;
        void pumpRenderLoop();
      } else {
        if (!playbackTransitionState.shouldPrewarm) {
          clearTransitionPlaybackSession();
        }
        hideFastScrubOverlay();
        hidePlaybackTransitionOverlay();
      }
    } else if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) {
      clearTransitionPlaybackSession();
      hideFastScrubOverlay();
      hidePlaybackTransitionOverlay();
    } else if (usePlaybackStore.getState().previewFrame === null) {
      clearTransitionPlaybackSession();
      hideFastScrubOverlay();
      hidePlaybackTransitionOverlay();
    }

    return () => {
      scrubMountedRef.current = false;
      suppressScrubBackgroundPrewarmRef.current = false;
      fallbackToPlayerScrubRef.current = false;
      lastBackwardScrubRenderAtRef.current = 0;
      lastBackwardRequestedFrameRef.current = null;
      clearPendingFastScrubHandoff();
      clearScheduledTransitionPrepare();
      clearTransitionPlaybackSession();
      hidePlaybackTransitionOverlay();
      if (playbackRafId !== null) {
        cancelAnimationFrame(playbackRafId);
        playbackRafId = null;
      }
      resumeScrubLoopRef.current = () => {};
      unsubscribe();
      unsubscribeGizmo();
      unsubscribeCornerPin();
      unsubscribeMaskEditor();
    };
  }, [
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    forceFastScrubOverlay,
    fps,
    // Re-run when gizmo interaction toggles so drag overlays are requested
    // immediately on interaction start/end.
    isGizmoInteracting,
    preferPlayerForStyledTextScrub,
    preferPlayerForTextGizmo,
    clearPendingFastScrubHandoff,
    clearTransitionPlaybackSession,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    getTransitionWindowForFrame,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    pinTransitionPlaybackSession,
    preparePlaybackTransitionFrame,
    showPlaybackTransitionOverlayForFrame,
    beginFastScrubHandoff,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    playbackTransitionComplexStartFrames,
    playbackTransitionCooldownFrames,
    playbackTransitionLookaheadFrames,
    playbackTransitionWindows,
    pushTransitionTrace,
    setDisplayedFrame,
    shouldPreferPlayerForPreview,
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
    if (isMaskEditingActive) {
      e.stopPropagation();
      return;
    }
    if (isMarqueeJustFinished()) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-gizmo]')) return;

    useSelectionStore.getState().clearItemSelection();
  }, [isMaskEditingActive]);

  // Handle frame change from player
  // Skip when in preview mode to keep primary playhead stationary
  const handleFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.round(frame);
    resolvePendingSeekLatency(nextFrame);
    maybeCompleteFastScrubHandoff(nextFrame);
    const pendingHandoffFrame = pendingFastScrubHandoffFrameRef.current;
    if (pendingHandoffFrame !== null && nextFrame !== pendingHandoffFrame) {
      scheduleFastScrubHandoffCheck();
      return;
    }
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
  }, [
    fps,
    maybeCompleteFastScrubHandoff,
    resolvePendingSeekLatency,
    scheduleFastScrubHandoffCheck,
  ]);

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
      role="img"
      aria-label="Video preview"
    >
      <div
        className="min-w-full min-h-full grid place-items-center"
        style={{ padding: `calc(${EDITOR_LAYOUT_CSS_VALUES.previewPadding} / 2)` }}
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
                  visibility: isRenderedOverlayVisible ? 'visible' : 'hidden',
                }}
              />
            )}

            {/* GPU effects overlay canvas — kept hidden. GPU effects are now
                applied per-item in the composition renderer. The canvas ref is
                retained for API compatibility. */}
            <canvas
              ref={gpuEffectsCanvasRef}
              className="absolute inset-0 pointer-events-none"
              style={{
                width: '100%',
                height: '100%',
                zIndex: 5,
                visibility: 'hidden',
              }}
            />

            {import.meta.env.DEV && showPerfPanel && perfPanelSnapshot && (() => {
              const p = perfPanelSnapshot;
              const srcLabel = p.renderSource === 'fast_scrub_overlay' ? 'Overlay'
                : p.renderSource === 'playback_transition_overlay' ? 'Transition' : 'Player';
              const srcColor = p.renderSource === 'player' ? '#4ade80' : '#60a5fa';
              const seekOk = p.seekLatencyAvgMs < 50;
              const qualOk = p.effectivePreviewQuality >= p.userPreviewQuality;
              const frameOk = p.frameTimeEmaMs <= p.frameTimeBudgetMs * 1.2;
              const trActive = p.transitionSessionActive;
              const trMode = p.transitionSessionMode === 'none' ? null
                : p.transitionSessionMode === 'dom' ? 'DOM' : 'Canvas';
              const lastSw = latestRenderSourceSwitch;
              const fmtSrc = (s: string) => s === 'fast_scrub_overlay' ? 'Overlay'
                : s === 'playback_transition_overlay' ? 'Transition' : 'Player';
              return (
                <div
                  className="absolute right-2 bottom-2 z-30 bg-black/80 text-white/90 rounded-md text-[10px] leading-[14px] font-mono pointer-events-none select-none backdrop-blur-sm"
                  style={{ padding: '6px 8px', minWidth: 180 }}
                  data-testid="preview-perf-panel"
                  title={`Toggle: Alt+Shift+P | URL: ?${PREVIEW_PERF_PANEL_QUERY_KEY}=1`}
                >
                  {/* Render source */}
                  <div style={{ marginBottom: 3 }}>
                    <span style={{ color: srcColor }}>{srcLabel}</span>
                    {p.staleScrubOverlayDrops > 0 && (
                      <span style={{ color: '#f87171' }}> {p.staleScrubOverlayDrops} stale</span>
                    )}
                    {lastSw && (
                      <span style={{ color: '#a1a1aa' }}>
                        {' '}{fmtSrc(lastSw.from)}{'\u2192'}{fmtSrc(lastSw.to)} @{lastSw.atFrame}
                      </span>
                    )}
                  </div>

                  {/* Seek & scrub */}
                  <div>
                    <span style={{ color: seekOk ? '#a1a1aa' : '#fbbf24' }}>
                      Seek {p.seekLatencyAvgMs.toFixed(0)}ms
                    </span>
                    {p.seekLatencyTimeouts > 0 && (
                      <span style={{ color: '#f87171' }}> {p.seekLatencyTimeouts} timeout</span>
                    )}
                    {p.scrubDroppedFrames > 0 && (
                      <span style={{ color: '#fbbf24' }}>
                        {' '}Scrub {p.scrubDroppedFrames}/{p.scrubUpdates} dropped
                      </span>
                    )}
                  </div>

                  {/* Quality & frame time */}
                  <div>
                    <span style={{ color: qualOk ? '#a1a1aa' : '#fbbf24' }}>
                      Quality {p.effectivePreviewQuality}x
                      {p.effectivePreviewQuality < p.userPreviewQuality && ` (cap ${p.adaptiveQualityCap}x)`}
                    </span>
                    {' '}
                    <span style={{ color: frameOk ? '#a1a1aa' : '#f87171' }}>
                      {p.frameTimeEmaMs.toFixed(0)}/{p.frameTimeBudgetMs.toFixed(0)}ms
                    </span>
                    {(p.adaptiveQualityDowngrades > 0 || p.adaptiveQualityRecovers > 0) && (
                      <span style={{ color: '#a1a1aa' }}>
                        {' '}{'\u2193'}{p.adaptiveQualityDowngrades} {'\u2191'}{p.adaptiveQualityRecovers}
                      </span>
                    )}
                  </div>

                  {/* Source pool */}
                  <div style={{ color: '#a1a1aa' }}>
                    Pool {p.sourceWarmKeep}/{p.sourceWarmTarget}
                    {' '}({p.sourcePoolSources}src {p.sourcePoolElements}el)
                    {p.sourceWarmEvictions > 0 && (
                      <span style={{ color: '#fbbf24' }}> {p.sourceWarmEvictions} evict</span>
                    )}
                  </div>

                  {/* Media resolution */}
                  {(p.unresolvedQueue > 0 || p.pendingResolves > 0) && (
                    <div style={{ color: '#fbbf24' }}>
                      Resolving {p.pendingResolves} pending, {p.unresolvedQueue} queued
                      {' '}({p.resolveAvgMs.toFixed(0)}ms avg)
                    </div>
                  )}

                  {/* Transition session — only show when active or recent */}
                  {(trActive || p.transitionSessionCount > 0) && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 3, paddingTop: 3 }}>
                      <div>
                        <span style={{ color: trActive ? '#60a5fa' : '#a1a1aa' }}>
                          {trActive ? `Transition ${trMode}` : 'Last transition'}
                          {p.transitionSessionComplex ? ' (complex)' : ''}
                        </span>
                        {trActive && (
                          <span style={{ color: '#a1a1aa' }}>
                            {' '}{p.transitionSessionStartFrame}{'\u2192'}{p.transitionSessionEndFrame}
                            {' '}buf:{p.transitionBufferedFrames}
                          </span>
                        )}
                      </div>
                      {p.transitionLastPrepareMs > 0 && (
                        <div style={{ color: p.transitionLastEntryMisses > 0 ? '#f87171' : '#a1a1aa' }}>
                          Prep {p.transitionLastPrepareMs.toFixed(0)}ms
                          {p.transitionLastReadyLeadMs > 0 && ` lead ${p.transitionLastReadyLeadMs.toFixed(0)}ms`}
                          {p.transitionLastEntryMisses > 0 && ` ${p.transitionLastEntryMisses} miss`}
                          <span style={{ color: '#a1a1aa' }}> #{p.transitionSessionCount}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

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
            <>
              <GizmoOverlay
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
                hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
              />
              <MaskEditorContainer
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
              />
              <CornerPinContainer
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
