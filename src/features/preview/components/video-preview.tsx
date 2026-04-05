import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import {
  backgroundPreseek as workerBackgroundPreseek,
  backgroundBatchPreseek as workerBackgroundBatchPreseek,
  getDecoderPrewarmMetricsSnapshot,
} from '../utils/decoder-prewarm';
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
import { getDirectionalPrewarmOffsets } from '../utils/preview-renderer-prewarm';
import { usePreviewDisplayedFrameController } from '../hooks/use-preview-displayed-frame-controller';
import { usePreviewSourceWarmController } from '../hooks/use-preview-source-warm-controller';
import { resolvePlaybackTransitionOverlayState } from '../utils/playback-transition-overlay';
import {
  getPreviewAnchorFrame,
  getPreviewInteractionMode,
} from '../utils/preview-interaction-mode';
import { getPreloadWindowRange } from '../utils/preload-window';
import {
  resolvePreviewTransitionDecision,
} from '../utils/preview-state-coordinator';
import {
  collectResolveMediaPriorities,
  createPreviewMediaScheduleIndex,
  scanPreloadMediaPriorities,
} from '../utils/preview-media-schedule';
import {
  pushRenderSourceSwitchHistory,
  recordSeekLatency,
  recordSeekLatencyTimeout,
  type RenderSourceSwitchEntry,
  type SeekLatencyStats,
  type PreviewRenderSource,
} from '../utils/preview-perf-metrics';
import {
  createPreviewPresenterModel,
  createPreviewPresenterState,
  resolvePreviewPresenterBootstrapDecision,
  resolvePreviewPresenterPausedTransitionDecision,
  resolvePreviewPresenterRenderLoopDecision,
  updatePreviewPresenterModel,
  type PreviewPresenterAction,
  type PreviewPresenterModel,
  type PreviewPresenterSurface,
  type PreviewPresenterTransitionPlaybackDecision,
} from '../utils/preview-presenter';
import { resolvePreviewPresenterStoreSyncPlan } from '../utils/preview-presenter-controller';
import {
  createAdaptivePreviewQualityState,
  getEffectivePreviewQuality,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import {
  shouldForceContinuousPreviewOverlay,
} from '../hooks/use-gpu-effects-overlay';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { createLogger, createOperationId, type WideEvent } from '@/shared/logging/logger';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { isFrameInRanges } from '@/shared/utils/frame-invalidation';

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
  PREVIEW_RENDERER_ENABLED,
  PREVIEW_RENDERER_PRELOAD_BUDGET_MS,
  PREVIEW_RENDERER_BOUNDARY_PREWARM_WINDOW_SECONDS,
  PREVIEW_RENDERER_MAX_PREWARM_FRAMES,
  PREVIEW_RENDERER_MAX_PREWARM_SOURCES,
  PREVIEW_RENDERER_SOURCE_PREWARM_WINDOW_SECONDS,
  PREVIEW_RENDERER_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME,
  PREVIEW_RENDERER_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME,
  PREVIEW_RENDERER_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME,
  PREVIEW_RENDERER_SOURCE_TOUCH_COOLDOWN_FRAMES,
  PREVIEW_RENDERER_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD,
  PREVIEW_RENDERER_DIRECTIONAL_PREWARM_FORWARD_STEPS,
  PREVIEW_RENDERER_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
  PREVIEW_RENDERER_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
  PREVIEW_RENDERER_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
  PREVIEW_RENDERER_PREWARM_QUEUE_MAX,
  PREVIEW_RENDERER_BACKWARD_RENDER_THROTTLE_MS,
  PREVIEW_RENDERER_BACKWARD_RENDER_QUANTIZE_FRAMES,
  PREVIEW_RENDERER_BACKWARD_FORCE_JUMP_FRAMES,
  PREVIEW_RENDERER_PREWARM_RENDER_BUDGET_MS,
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
  type PreviewRendererBoundarySource,
  type PreviewPerfSnapshot,
  toTrackFingerprint,
  getPreloadBudget,
  getResolvePassBudget,
  getMediaResolveCost,
  getCostAdjustedBudget,
  getFrameDirection,
  parsePreviewPerfPanelQuery,
  blobToDataUrl,
} from '../utils/preview-constants';
import { collectVisualInvalidationRanges } from '../utils/preview-frame-invalidation';

const logger = createLogger('VideoPreview');

type CompositionRenderer = Awaited<ReturnType<typeof createCompositionRenderer>>;

type TransitionPreviewSessionTrace = {
  opId: string;
  event: WideEvent;
  startedAtMs: number;
  startFrame: number;
  endFrame: number;
  backend: 'renderer';
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
  const scrubFrameDirtyRef = useRef(false);
  const scrubRendererRef = useRef<CompositionRenderer | null>(null);
  const scrubInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const scrubPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const scrubOffscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const scrubOffscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const scrubRendererStructureKeyRef = useRef<string | null>(null);
  const scrubRenderInFlightRef = useRef(false);
  const scrubRenderGenerationRef = useRef(0);
  const scrubRequestedFrameRef = useRef<number | null>(null);
  // Dedicated background renderer for transition pre-rendering.
  // Separate from the main scrub renderer so pre-renders don't conflict
  // with the rAF pump's render loop (different canvas, different decoders).
  const bgTransitionRendererRef = useRef<CompositionRenderer | null>(null);
  const bgTransitionInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const bgTransitionRendererStructureKeyRef = useRef<string | null>(null);
  const bgTransitionRenderInFlightRef = useRef(false);
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
  const transitionSessionBufferedFramesRef = useRef<Map<number, OffscreenCanvas>>(new Map());
  const retainedTransitionExitWindowRef = useRef<ResolvedTransitionWindow<TimelineItem> | null>(null);
  const retainedTransitionExitBufferedFramesRef = useRef<Map<number, OffscreenCanvas>>(new Map());
  const transitionPrewarmPromiseRef = useRef<Promise<void> | null>(null);
  const captureCanvasSourceInFlightRef = useRef<Promise<OffscreenCanvas | HTMLCanvasElement | null> | null>(null);
  const captureInFlightRef = useRef<Promise<string | null> | null>(null);
  const captureImageDataInFlightRef = useRef<Promise<ImageData | null> | null>(null);
  const captureScaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrubDirectionRef = useRef<-1 | 0 | 1>(0);
  const suppressScrubBackgroundPrewarmRef = useRef(false);
  const lastForwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubRenderAtRef = useRef(0);
  const lastBackwardRequestedFrameRef = useRef<number | null>(null);
  const presenterModelRef = useRef<PreviewPresenterModel>(
    createPreviewPresenterModel('renderer'),
  );
  const resumeScrubLoopRef = useRef<() => void>(() => {});
  const scrubMountedRef = useRef(true);
  const [presenterSurface, setPresenterSurface] = useState<PreviewPresenterSurface>(
    presenterModelRef.current.surface,
  );
  const renderSourceRef = useRef<PreviewRenderSource>('renderer');
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
  const playStartWarmUntilRef = useRef(0);
  const lastPlayStartWarmFrameRef = useRef<number | null>(null);
  const lastPausedPrearmTargetRef = useRef<number | null>(null);
  const lastPlayingPrearmTargetRef = useRef<number | null>(null);
  const lastScrubTransitionWarmStartRef = useRef<number | null>(null);
  const lastScrubTransitionWarmFrameRef = useRef<number | null>(null);
  const presenterState = createPreviewPresenterState(presenterModelRef.current);
  const isRenderedOverlayVisible = presenterState.isRenderedOverlayVisible;

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
  const isGizmoInteracting = useGizmoStore((s) => s.activeGizmo !== null);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
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
  const isGizmoInteractingRef = useRef(isGizmoInteracting);
  isGizmoInteractingRef.current = isGizmoInteracting;
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);

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

  const commitPresenterModel = useCallback((nextModel: PreviewPresenterModel) => {
    presenterModelRef.current = nextModel;
    setPresenterSurface(nextModel.surface);
  }, []);

  const readPresenterState = useCallback(() => {
    return createPreviewPresenterState(presenterModelRef.current);
  }, []);

  const dispatchPresenterAction = useCallback((action: PreviewPresenterAction) => {
    const nextModel = updatePreviewPresenterModel(presenterModelRef.current, action);
    commitPresenterModel(nextModel);
    return nextModel;
  }, [commitPresenterModel]);

  const clearQueuedScrubPrewarmWork = useCallback(() => {
    scrubPrewarmQueueRef.current = [];
    scrubPrewarmQueuedSetRef.current.clear();
  }, []);

  const resetTransientScrubState = useCallback(() => {
    scrubRequestedFrameRef.current = null;
    scrubDirectionRef.current = 0;
    suppressScrubBackgroundPrewarmRef.current = false;
    lastScrubTransitionWarmStartRef.current = null;
    lastScrubTransitionWarmFrameRef.current = null;
    lastBackwardScrubPreloadAtRef.current = 0;
    lastBackwardScrubRenderAtRef.current = 0;
    lastBackwardRequestedFrameRef.current = null;
    clearQueuedScrubPrewarmWork();
  }, [clearQueuedScrubPrewarmWork]);

  const showRendererSurface = useCallback(() => {
    if (readPresenterState().surface === 'renderer') return;
    dispatchPresenterAction({ kind: 'show_renderer' });
  }, [dispatchPresenterAction, readPresenterState]);

  const showTransitionOverlaySurface = useCallback(() => {
    if (readPresenterState().surface === 'transition_overlay') return;
    dispatchPresenterAction({ kind: 'show_transition_overlay' });
  }, [dispatchPresenterAction, readPresenterState]);

  const hideRenderedOverlays = useCallback(() => {
    showRendererSurface();
  }, [showRendererSurface]);

  // Player integration for transport/audio only.
  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    isGizmoInteracting,
    trackPlayerSeek,
  );

  useEffect(() => {
    const playback = usePlaybackStore.getState();
    if (playback.previewFrame !== null) {
      playback.commitPreviewFrame();
    }
  }, []);

  useEffect(() => {
    isGizmoInteractingRef.current = isGizmoInteracting;
    if (!isGizmoInteracting) return;
    // During active transform drags, clear stale hover-scrub state without
    // changing the viewed frame. This avoids a one-frame render source/frame jump.
    const playbackState = usePlaybackStore.getState();
    if (playbackState.previewFrame !== null) {
      playbackState.commitPreviewFrame();
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
  const publishDisplayedFrame = usePreviewDisplayedFrameController({ isRenderedOverlayVisible });

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
    previewRendererPrewarmedSources: 0,
    previewRendererPrewarmSourceEvictions: 0,
    staleRendererFrameDrops: 0,
    scrubDroppedFrames: 0,
    scrubUpdates: 0,
    adaptiveQualityDowngrades: 0,
    adaptiveQualityRecovers: 0,
  });
  const lastSyncedMediaDependencyVersionRef = useRef<number>(-1);

  useEffect(() => {
    const nextSource: PreviewRenderSource = presenterState.renderSource;
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
  }, [presenterSurface]);

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

  const mediaScheduleIndex = useMemo(() => {
    return createPreviewMediaScheduleIndex(combinedTracks, mediaResolveCostById);
  }, [combinedTracks, mediaResolveCostById]);

  const {
    resolvedTracks,
    previewRendererTracks,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    previewRendererBoundaryFrames,
    previewRendererBoundarySources,
    previewRendererTracksFingerprint,
  } = useMemo(() => {
    const resolvedTrackList: CompositionInputProps['tracks'] = [];
    const previewRendererTrackList: CompositionInputProps['tracks'] = [];
    const playbackSpans: VideoSourceSpan[] = [];
    const scrubSpans: VideoSourceSpan[] = [];
    const boundaryFrames = new Set<number>();
    const boundarySources = new Map<number, Set<string>>();

    for (const track of combinedTracks) {
      const resolvedItems: typeof track.items = [];
      const previewRendererItems: typeof track.items = [];

      for (const item of track.items) {
        if (!item.mediaId || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) {
          resolvedItems.push(item);
          previewRendererItems.push(item);
          continue;
        }

        const sourceUrl = resolvedUrls.get(item.mediaId) ?? '';
        const proxyUrl = item.type === 'video'
          ? (resolveProxyUrl(item.mediaId) || sourceUrl)
          : sourceUrl;
        const resolvedSrc = useProxy && item.type === 'video' ? proxyUrl : sourceUrl;
        const previewRendererSrc = item.type === 'video' ? proxyUrl : sourceUrl;

        const resolvedItem = ('src' in item && item.src === resolvedSrc)
          ? item
          : { ...item, src: resolvedSrc };
        const previewRendererItem = ('src' in item && item.src === previewRendererSrc)
          ? item
          : { ...item, src: previewRendererSrc };

        resolvedItems.push(resolvedItem);
        previewRendererItems.push(previewRendererItem);

        if (resolvedItem.type === 'video' && resolvedSrc) {
          playbackSpans.push({
            src: resolvedSrc,
            startFrame: resolvedItem.from,
            endFrame: resolvedItem.from + resolvedItem.durationInFrames,
          });
        }

        if (previewRendererItem.type === 'video' && previewRendererSrc) {
          scrubSpans.push({
            src: previewRendererSrc,
            startFrame: previewRendererItem.from,
            endFrame: previewRendererItem.from + previewRendererItem.durationInFrames,
          });
          if (previewRendererItem.durationInFrames > 0) {
            const startFrame = previewRendererItem.from;
            const endFrame = previewRendererItem.from + previewRendererItem.durationInFrames;
            boundaryFrames.add(startFrame);
            boundaryFrames.add(endFrame);

            let startSet = boundarySources.get(startFrame);
            if (!startSet) {
              startSet = new Set<string>();
              boundarySources.set(startFrame, startSet);
            }
            startSet.add(previewRendererSrc);

            let endSet = boundarySources.get(endFrame);
            if (!endSet) {
              endSet = new Set<string>();
              boundarySources.set(endFrame, endSet);
            }
            endSet.add(previewRendererSrc);
          }
        }
      }

      resolvedTrackList.push({ ...track, items: resolvedItems });
      previewRendererTrackList.push({ ...track, items: previewRendererItems });
    }

    const sortedBoundaryFrames = [...boundaryFrames].sort((a, b) => a - b);
    const sortedBoundarySources: PreviewRendererBoundarySource[] = [...boundarySources.entries()]
      .map(([frame, srcSet]) => ({ frame, srcs: [...srcSet] }))
      .sort((a, b) => a.frame - b.frame);

    return {
      resolvedTracks: resolvedTrackList,
      previewRendererTracks: previewRendererTrackList,
      playbackVideoSourceSpans: playbackSpans,
      scrubVideoSourceSpans: scrubSpans,
      previewRendererBoundaryFrames: sortedBoundaryFrames,
      previewRendererBoundarySources: sortedBoundarySources,
      previewRendererTracksFingerprint: toTrackFingerprint(previewRendererTrackList),
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
      const {
        priorityByMediaId,
        maxActiveWindowCost,
      } = collectResolveMediaPriorities({
        index: mediaScheduleIndex,
        unresolvedMediaIds: unresolvedSet,
        anchorFrame,
        activeWindowStartFrame: minActiveWindowFrame,
        activeWindowEndFrame: maxActiveWindowFrame,
        costPenaltyFrames,
      });

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
    fps,
    getResolveRetryAt,
    markResolveFailures,
    mediaScheduleIndex,
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
      const preseekMetrics = getDecoderPrewarmMetricsSnapshot();
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
        previewRendererPrewarmedSources: stats.previewRendererPrewarmedSources,
        previewRendererPrewarmSourceEvictions: stats.previewRendererPrewarmSourceEvictions,
        preseekRequests: preseekMetrics.requests,
        preseekCacheHits: preseekMetrics.cacheHits,
        preseekInflightReuses: preseekMetrics.inflightReuses,
        preseekWorkerPosts: preseekMetrics.workerPosts,
        preseekWorkerSuccesses: preseekMetrics.workerSuccesses,
        preseekWorkerFailures: preseekMetrics.workerFailures,
        preseekWaitRequests: preseekMetrics.waitRequests,
        preseekWaitMatches: preseekMetrics.waitMatches,
        preseekWaitResolved: preseekMetrics.waitResolved,
        preseekWaitTimeouts: preseekMetrics.waitTimeouts,
        preseekCachedBitmaps: preseekMetrics.cacheBitmaps,
        staleRendererFrameDrops: stats.staleRendererFrameDrops,
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
        transitionSessionBackend: activeTransitionTrace?.backend ?? 'none',
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
  usePreviewSourceWarmController({
    resolvedUrlCount: resolvedUrls.size,
    fps,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    isGizmoInteractingRef,
    previewPerfRef,
  });

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

  // Keep preview renderer at project resolution until the renderer
  // separates logical composition space from physical canvas size.
  const renderSize = useMemo(() => {
    const projectWidth = Math.max(1, Math.round(project.width));
    const projectHeight = Math.max(1, Math.round(project.height));
    return { width: Math.max(2, projectWidth), height: Math.max(2, projectHeight) };
  }, [project.width, project.height]);

  // Provide live gizmo preview transforms to preview renderer so dragged
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

  const previewRendererScaledTracks = useMemo(() => {
    return previewRendererTracks as CompositionInputProps['tracks'];
  }, [
    previewRendererTracks,
    previewRendererTracksFingerprint,
  ]);

  const previewRendererLiveItemsById = useMemo(() => {
    const map = new Map<string, TimelineItem>();
    for (const track of previewRendererScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [previewRendererScaledTracks]);
  const previewRendererLiveItemsByIdRef = useRef<Map<string, TimelineItem>>(previewRendererLiveItemsById);
  previewRendererLiveItemsByIdRef.current = previewRendererLiveItemsById;

  const previewRendererKeyframesByItemId = useMemo(() => (
    new Map(keyframes.map((entry) => [entry.itemId, entry]))
  ), [keyframes]);
  const previewRendererKeyframesByItemIdRef = useRef<Map<string, typeof keyframes[number]>>(previewRendererKeyframesByItemId);
  previewRendererKeyframesByItemIdRef.current = previewRendererKeyframesByItemId;

  const getLiveItemSnapshot = useCallback((itemId: string) => {
    return previewRendererLiveItemsByIdRef.current.get(itemId);
  }, []);

  const getLiveKeyframes = useCallback((itemId: string) => {
    return previewRendererKeyframesByItemIdRef.current.get(itemId);
  }, []);

  const previewRendererScaledKeyframes = useMemo(() => {
    return keyframes;
  }, [
    keyframes,
  ]);
  const previousPreviewRendererVisualStateRef = useRef<{
    tracks: CompositionInputProps['tracks'];
    keyframes: typeof previewRendererScaledKeyframes;
  }>({
    tracks: previewRendererScaledTracks,
    keyframes: previewRendererScaledKeyframes,
  });

  const previewRendererInputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: previewRendererScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: previewRendererScaledKeyframes,
  }), [
    fps,
    project.width,
    project.height,
    previewRendererScaledTracks,
    transitions,
    project.backgroundColor,
    previewRendererScaledKeyframes,
  ]);

  const playbackTransitionFingerprint = useMemo(() => (
    transitions
      .map((transition) => (
        [
          transition.id,
          transition.type,
          transition.leftClipId,
          transition.rightClipId,
          transition.trackId ?? '',
          transition.durationInFrames,
          transition.presentation ?? '',
          transition.direction ?? '',
          transition.timing ?? '',
          transition.alignment ?? 0.5,
          JSON.stringify(transition.params ?? {}),
          JSON.stringify(transition.bezierPoints ?? null),
        ].join(':')
      ))
      .join('|')
  ), [transitions]);

  const previewRendererStructureKey = useMemo(() => (
    [
      fps,
      project.width,
      project.height,
      project.backgroundColor ?? '',
      previewRendererTracksFingerprint,
      playbackTransitionFingerprint,
    ].join('::')
  ), [
    previewRendererTracksFingerprint,
    fps,
    playbackTransitionFingerprint,
    project.backgroundColor,
    project.height,
    project.width,
  ]);

  const playbackTransitionWindows = useMemo(() => {
    const clipMap = new Map<string, TimelineItem>();
    for (const track of previewRendererScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        clipMap.set(item.id, item);
      }
    }
    return resolveTransitionWindows(transitions, clipMap);
  }, [previewRendererScaledTracks, transitions]);
  const previewRendererItems = useMemo(
    () => previewRendererScaledTracks.flatMap((track) => track.items as TimelineItem[]),
    [previewRendererScaledTracks],
  );

  const playbackTransitionLookaheadFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.25)),
    [fps],
  );
  const playbackTransitionCooldownFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.1)),
    [fps],
  );
  const pausedTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 3)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playingComplexTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 1.5)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playbackTransitionPrerenderRunwayFrames = 8;
  const getTransitionWindowByStartFrame = useCallback((startFrame: number | null) => {
    if (startFrame === null) return null;
    return playbackTransitionWindows.find((window) => window.startFrame === startFrame) ?? null;
  }, [playbackTransitionWindows]);

  const getTransitionCooldownForWindow = useCallback((window: ResolvedTransitionWindow<TimelineItem>) => {
    const leftOriginId = window.leftClip.originId;
    const rightOriginId = window.rightClip.originId;
    const leftSpeed = window.leftClip.speed ?? 1;
    const rightSpeed = window.rightClip.speed ?? 1;

    // Split/same-origin handoffs keep the primary lane alive across the exit,
    // so extra post-overlap transition frames just prolong stale session state
    // and can leak a visible 1-2 frame hitch.
    if (leftOriginId && rightOriginId && leftOriginId === rightOriginId) {
      return 0;
    }

    // Variable-speed clips already pay more sync/decoder cost at the exact
    // transition exit. Holding the transition surface past the active span
    // just prolongs renderer/session churn with no visible upside.
    if (Math.abs(leftSpeed - 1) >= 0.01 || Math.abs(rightSpeed - 1) >= 0.01) {
      return 0;
    }

    return playbackTransitionCooldownFrames;
  }, [playbackTransitionCooldownFrames]);

  const getTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame + getTransitionCooldownForWindow(window)
    )) ?? null;
  }, [getTransitionCooldownForWindow, playbackTransitionWindows]);

  /** Like getTransitionWindowForFrame but without cooldown — true only in the active span. */
  const getActiveTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame
    )) ?? null;
  }, [playbackTransitionWindows]);

  const isVariableSpeedTransitionWindow = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) return false;
    const leftSpeed = window.leftClip.speed ?? 1;
    const rightSpeed = window.rightClip.speed ?? 1;
    return Math.abs(leftSpeed - 1) >= 0.01 || Math.abs(rightSpeed - 1) >= 0.01;
  }, []);

  const getTransitionWarmFrames = useCallback((
    window: ResolvedTransitionWindow<TimelineItem>,
    anchorFrame: number,
    direction: -1 | 0 | 1,
  ) => {
    const directionalOffsets = getDirectionalPrewarmOffsets(
      direction,
      isVariableSpeedTransitionWindow(window)
        ? {
            forwardSteps: 6,
            backwardSteps: 6,
            oppositeSteps: 2,
            neutralRadius: 2,
          }
        : {
            forwardSteps: 3,
            backwardSteps: 2,
            oppositeSteps: 0,
            neutralRadius: 1,
          },
    );

    const uniqueFrames = new Set<number>([anchorFrame]);
    for (const offset of directionalOffsets) {
      const frame = anchorFrame + offset;
      if (frame >= window.startFrame && frame < window.endFrame) {
        uniqueFrames.add(frame);
      }
    }

    return [...uniqueFrames];
  }, [isVariableSpeedTransitionWindow]);

  const prewarmTransitionFrameStrip = useCallback(async (
    renderer: CompositionRenderer,
    window: ResolvedTransitionWindow<TimelineItem>,
    anchorFrame: number,
    direction: -1 | 0 | 1,
  ) => {
    if (!('prewarmFrames' in renderer) || !isVariableSpeedTransitionWindow(window)) return;
    const frames = getTransitionWarmFrames(window, anchorFrame, direction);
    if (frames.length <= 1) return;
    await renderer.prewarmFrames(frames);
  }, [getTransitionWarmFrames, isVariableSpeedTransitionWindow]);

  const preseekTransitionSources = useCallback((
    window: ResolvedTransitionWindow<TimelineItem>,
    frames: number[],
  ) => {
    if (frames.length === 0) return;
    const timestampsBySource = new Map<string, number[]>();
    for (const clip of [window.leftClip, window.rightClip]) {
      if (clip.type !== 'video' || !('src' in clip) || !clip.src || !clip.sourceFps) continue;
      const sourceStart = clip.sourceStart ?? clip.trimStart ?? 0;
      const clipSpeed = clip.speed ?? 1;
      const timestamps = frames.map((frame) => (
        (sourceStart / clip.sourceFps) + ((frame - clip.from) / fps) * clipSpeed
      ));
      const existing = timestampsBySource.get(clip.src);
      if (existing) existing.push(...timestamps);
      else timestampsBySource.set(clip.src, timestamps);
    }

    for (const [src, timestamps] of timestampsBySource) {
      void workerBackgroundBatchPreseek(src, timestamps);
    }
  }, [fps]);

  const primePlaybackStartRunway = useCallback((frame: number) => {
    lastPlayStartWarmFrameRef.current = frame;

    const runwayFrames = Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 0.75));
    const runwayEndFrame = frame + runwayFrames;
    const timestampsBySource = new Map<string, number[]>();

    const queuePreseekFrame = (item: TimelineItem, targetFrame: number) => {
      if (item.type !== 'video' || !('src' in item) || !item.src || !item.sourceFps) return;
      if (targetFrame < item.from || targetFrame >= item.from + item.durationInFrames) return;

      const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
      const speed = item.speed ?? 1;
      const sourceTime = (sourceStart / item.sourceFps) + ((targetFrame - item.from) / fps) * speed;
      const existing = timestampsBySource.get(item.src);
      if (existing) {
        existing.push(sourceTime);
      } else {
        timestampsBySource.set(item.src, [sourceTime]);
      }
    };

    for (const track of combinedTracks) {
      for (const item of track.items) {
        if (item.type !== 'video') continue;
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;
        if (itemEnd <= frame || itemStart > runwayEndFrame) continue;

        const primeFrame = Math.max(frame, itemStart);
        const sampleFrames = new Set<number>([Math.min(itemEnd - 1, primeFrame)]);
        if (frame >= itemStart && frame < itemEnd) {
          sampleFrames.add(Math.min(itemEnd - 1, frame + Math.min(2, runwayFrames)));
          sampleFrames.add(Math.min(itemEnd - 1, frame + Math.min(runwayFrames, Math.max(4, Math.round(fps * 0.25)))));
        } else {
          sampleFrames.add(itemStart);
          sampleFrames.add(Math.min(itemEnd - 1, itemStart + Math.min(4, runwayFrames)));
        }

        if (Math.abs((item.speed ?? 1) - 1) >= 0.01) {
          sampleFrames.add(Math.min(itemEnd - 1, primeFrame + Math.min(runwayFrames, Math.max(6, Math.round(fps * 0.4)))));
        }

        for (const sampleFrame of sampleFrames) {
          queuePreseekFrame(item, sampleFrame);
        }
      }
    }

    for (const [src, timestamps] of timestampsBySource) {
      const uniqueTimestamps = [...new Set(timestamps)].sort((a, b) => a - b);
      void workerBackgroundBatchPreseek(src, uniqueTimestamps);
    }

    const activeTransitionWindow = getActiveTransitionWindowForFrame(frame);
    if (activeTransitionWindow) {
      preseekTransitionSources(
        activeTransitionWindow,
        getTransitionWarmFrames(activeTransitionWindow, frame, 1),
      );
      return;
    }

    const upcomingTransitionWindow = playbackTransitionWindows.find((window) => (
      window.startFrame >= frame
      && window.startFrame <= runwayEndFrame
    ));
    if (upcomingTransitionWindow) {
      preseekTransitionSources(
        upcomingTransitionWindow,
        getTransitionWarmFrames(upcomingTransitionWindow, upcomingTransitionWindow.startFrame, 1),
      );
    }
  }, [
    combinedTracks,
    fps,
    getActiveTransitionWindowForFrame,
    getTransitionWarmFrames,
    playbackTransitionLookaheadFrames,
    playbackTransitionWindows,
    preseekTransitionSources,
  ]);

  const playbackTransitionOverlayWindows = useMemo(
    () => playbackTransitionWindows.map((window) => ({
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      cooldownFrames: getTransitionCooldownForWindow(window),
    })),
    [getTransitionCooldownForWindow, playbackTransitionWindows],
  );
  const shouldPreserveHighFidelityBackwardPreview = useCallback((frame: number | null) => {
    if (frame === null) return false;
    if (getTransitionWindowForFrame(frame) !== null) {
      return true;
    }
    return shouldForceContinuousPreviewOverlay(previewRendererItems, transitions.length, frame);
  }, [previewRendererItems, getTransitionWindowForFrame, transitions.length]);

  useEffect(() => {
    return usePlaybackStore.subscribe((state, prev) => {
      const now = performance.now();

      if (state.isPlaying && !prev.isPlaying) {
        playStartWarmUntilRef.current = now + 180;
        lastPlayStartWarmFrameRef.current = null;
        primePlaybackStartRunway(state.previewFrame ?? state.currentFrame);
        return;
      }

      if (!state.isPlaying && prev.isPlaying) {
        playStartWarmUntilRef.current = 0;
        lastPlayStartWarmFrameRef.current = null;
        return;
      }

      if (
        state.isPlaying
        && state.currentFrame !== prev.currentFrame
        && now <= playStartWarmUntilRef.current
        && lastPlayStartWarmFrameRef.current !== state.currentFrame
      ) {
        primePlaybackStartRunway(state.currentFrame);
      }
    });
  }, [primePlaybackStartRunway]);

  const clearRetainedTransitionExitBuffer = useCallback(() => {
    retainedTransitionExitWindowRef.current = null;
    retainedTransitionExitBufferedFramesRef.current.clear();
  }, []);

  const clearTransitionPlaybackSession = useCallback((options?: { retainHotExitFrames?: boolean }) => {
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
        backend: activeTrace.backend,
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
        backend: activeTrace.backend,
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

    const tw = transitionSessionWindowRef.current;
    transitionSessionWindowRef.current = null;
    const shouldRetainHotExitFrames = (
      options?.retainHotExitFrames !== false
      && tw !== null
      && isVariableSpeedTransitionWindow(tw)
      && transitionSessionBufferedFramesRef.current.size > 0
    );
    if (shouldRetainHotExitFrames) {
      retainedTransitionExitWindowRef.current = tw;
      retainedTransitionExitBufferedFramesRef.current = new Map(
        [...transitionSessionBufferedFramesRef.current.entries()]
          .filter(([frame]) => frame >= tw.startFrame && frame < tw.endFrame),
      );
    } else {
      clearRetainedTransitionExitBuffer();
    }
    transitionSessionBufferedFramesRef.current.clear();
    transitionPrewarmPromiseRef.current = null;
  }, [clearRetainedTransitionExitBuffer, isVariableSpeedTransitionWindow, pushTransitionTrace]);

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
    const backend = 'renderer' as const;
    const complex = true;
    transitionTelemetryRef.current.sessionCount += 1;
    transitionSessionTraceRef.current = {
      opId,
      event,
      startedAtMs: performance.now(),
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      backend,
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
      backend,
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
    transitionSessionBufferedFramesRef.current.clear();
    const retainedWindow = retainedTransitionExitWindowRef.current;
    if (
      retainedWindow
      && retainedWindow.transition.id === window.transition.id
      && retainedWindow.startFrame === window.startFrame
    ) {
      transitionSessionBufferedFramesRef.current = new Map(retainedTransitionExitBufferedFramesRef.current);
      clearRetainedTransitionExitBuffer();
    } else if (retainedWindow) {
      clearRetainedTransitionExitBuffer();
    }
    return window;
  }, [
    clearRetainedTransitionExitBuffer,
    clearTransitionPlaybackSession,
    pushTransitionTrace,
  ]);

  const restoreRetainedTransitionExitBufferForFrame = useCallback((frame: number) => {
    const retainedWindow = retainedTransitionExitWindowRef.current;
    if (
      !retainedWindow
      || frame < retainedWindow.startFrame
      || frame >= retainedWindow.endFrame
      || !retainedTransitionExitBufferedFramesRef.current.has(frame)
    ) {
      return false;
    }

    const activeWindow = getActiveTransitionWindowForFrame(frame);
    if (
      !activeWindow
      || activeWindow.transition.id !== retainedWindow.transition.id
      || activeWindow.startFrame !== retainedWindow.startFrame
    ) {
      return false;
    }

    pinTransitionPlaybackSession(activeWindow);
    return transitionSessionBufferedFramesRef.current.has(frame);
  }, [getActiveTransitionWindowForFrame, pinTransitionPlaybackSession]);

  const getPreparedTransitionBufferedFrame = useCallback((frame: number) => {
    const liveBuffer = transitionSessionBufferedFramesRef.current.get(frame);
    if (liveBuffer) {
      return liveBuffer;
    }
    if (restoreRetainedTransitionExitBufferForFrame(frame)) {
      return transitionSessionBufferedFramesRef.current.get(frame) ?? null;
    }
    return retainedTransitionExitBufferedFramesRef.current.get(frame) ?? null;
  }, [restoreRetainedTransitionExitBufferForFrame]);
  const getUpcomingTransitionStartFrame = useCallback((
    frame: number,
    maxLookaheadFrames: number,
  ) => {
    const nextWindow = playbackTransitionWindows.find((window) => {
      return frame <= window.startFrame;
    });
    if (!nextWindow) return null;
    if ((nextWindow.startFrame - frame) > maxLookaheadFrames) {
      return null;
    }
    return nextWindow.startFrame;
  }, [playbackTransitionWindows]);

  const getPausedTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, pausedTransitionPrearmFrames);
  }, [getUpcomingTransitionStartFrame, pausedTransitionPrearmFrames]);

  // Prearm covering ALL transitions, not just complex ones. With the renderer
  // owning presentation, every transition type now needs decoded runway.
  const getPlayingAnyTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, playingComplexTransitionPrearmFrames);
  }, [getUpcomingTransitionStartFrame, playingComplexTransitionPrearmFrames]);

  // The renderer owns visual presentation. The Player stays mounted for
  // transport, audio, and media-element lifecycle only.
  const rendererOwnsPresentation = PREVIEW_RENDERER_ENABLED;

  /**
   * Returns true when the overlay should be shown for a paused-on-transition frame.
   * Uses the ACTIVE span only (no cooldown) so overlays and live-preview invalidators
   * don't mis-handle post-transition cooldown frames.
   */
  const isPausedTransitionOverlayActive = useCallback((frame: number, playbackState: { isPlaying: boolean; previewFrame: number | null }) => {
    return (
      !playbackState.isPlaying
      && playbackState.previewFrame === null
      && getActiveTransitionWindowForFrame(frame) !== null
    );
  }, [getActiveTransitionWindowForFrame]);

  // Keep the on-screen scrub canvas at project resolution so quality toggles
  // only change offscreen sampling, not display buffer geometry.
  useLayoutEffect(() => {
    const canvas = scrubCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== playerRenderSize.width) canvas.width = playerRenderSize.width;
    if (canvas.height !== playerRenderSize.height) canvas.height = playerRenderSize.height;
  }, [playerRenderSize.width, playerRenderSize.height]);

  const disposePreviewRenderer = useCallback(() => {
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
    clearTransitionPlaybackSession({ retainHotExitFrames: false });
    clearRetainedTransitionExitBuffer();
    captureCanvasSourceInFlightRef.current = null;
    previewPerfRef.current.previewRendererPrewarmedSources = 0;

    if (scrubRendererRef.current) {
      try {
        scrubRendererRef.current.dispose();
      } catch (error) {
        logger.warn('Failed to dispose renderer:', error);
      }
      scrubRendererRef.current = null;
    }
    scrubRendererStructureKeyRef.current = null;

    scrubOffscreenCanvasRef.current = null;
    scrubOffscreenCtxRef.current = null;

    if (bgTransitionRendererRef.current) {
      try { bgTransitionRendererRef.current.dispose(); } catch { /* */ }
      bgTransitionRendererRef.current = null;
    }
    bgTransitionRendererStructureKeyRef.current = null;
    bgTransitionInitPromiseRef.current = null;
    bgTransitionRenderInFlightRef.current = false;
  }, [clearRetainedTransitionExitBuffer, clearTransitionPlaybackSession]);

  // Background transition renderer — independent instance for pre-rendering
  // transition frames without conflicting with the main rAF pump renderer.
  const ensureBgTransitionRenderer = useCallback(async (): Promise<CompositionRenderer | null> => {
    if (!PREVIEW_RENDERER_ENABLED || typeof OffscreenCanvas === 'undefined' || isResolving) return null;
    if (
      bgTransitionRendererRef.current
      && bgTransitionRendererStructureKeyRef.current !== previewRendererStructureKey
    ) {
      disposePreviewRenderer();
    }
    if (bgTransitionRendererRef.current) return bgTransitionRendererRef.current;
    if (bgTransitionInitPromiseRef.current) return bgTransitionInitPromiseRef.current;

    bgTransitionInitPromiseRef.current = (async () => {
      try {
        const canvas = new OffscreenCanvas(renderSize.width, renderSize.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const renderer = await createCompositionRenderer(previewRendererInputProps, canvas, ctx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
        });
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }
        bgTransitionRendererRef.current = renderer;
        bgTransitionRendererStructureKeyRef.current = previewRendererStructureKey;
        return renderer;
      } catch {
        return null;
      } finally {
        bgTransitionInitPromiseRef.current = null;
      }
    })();
    return bgTransitionInitPromiseRef.current;
  }, [
    disposePreviewRenderer,
    previewRendererInputProps,
    previewRendererStructureKey,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    getPreviewTransformOverride,
    isResolving,
    renderSize.width,
    renderSize.height,
  ]);

  const ensurePreviewRenderer = useCallback(async (): Promise<CompositionRenderer | null> => {
    if (!PREVIEW_RENDERER_ENABLED) return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (isResolving) return null;
    if (
      scrubRendererRef.current
      && scrubRendererStructureKeyRef.current !== previewRendererStructureKey
    ) {
      disposePreviewRenderer();
    }
    if (scrubRendererRef.current) return scrubRendererRef.current;
    if (scrubInitPromiseRef.current) return scrubInitPromiseRef.current;

    scrubInitPromiseRef.current = (async () => {
      try {
        const offscreen = new OffscreenCanvas(renderSize.width, renderSize.height);
        const offscreenCtx = offscreen.getContext('2d');
        if (!offscreenCtx) return null;

        const renderer = await createCompositionRenderer(previewRendererInputProps, offscreen, offscreenCtx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
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
            setTimeout(resolve, PREVIEW_RENDERER_PRELOAD_BUDGET_MS);
          }),
        ]);

        scrubOffscreenCanvasRef.current = offscreen;
        scrubOffscreenCtxRef.current = offscreenCtx;
        scrubOffscreenRenderedFrameRef.current = null;
        scrubRendererRef.current = renderer;
        scrubRendererStructureKeyRef.current = previewRendererStructureKey;
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
  }, [
    disposePreviewRenderer,
    previewRendererInputProps,
    previewRendererStructureKey,
    fps,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    isResolving,
    renderSize.height,
    renderSize.width,
  ]);

  const renderOffscreenFrame = useCallback(async (targetFrame: number): Promise<OffscreenCanvas | null> => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (offscreen && scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return offscreen;
    }

    const renderer = await ensurePreviewRenderer();
    const nextOffscreen = scrubOffscreenCanvasRef.current;
    if (!renderer || !nextOffscreen) return null;

    if (scrubOffscreenRenderedFrameRef.current !== targetFrame) {
      await renderer.renderFrame(targetFrame);
      scrubOffscreenRenderedFrameRef.current = targetFrame;
    }

    return nextOffscreen;
  }, [ensurePreviewRenderer]);

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
    const isPlaybackPrepare = usePlaybackStore.getState().isPlaying && rendererOwnsPresentation;
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
            backend: trace.backend,
            complex: trace.complex,
          });
        }
        const renderer = await ensurePreviewRenderer();
        if (!renderer || !scrubMountedRef.current) return false;

        await renderer.renderFrame(targetFrame);
        cacheTransitionSessionFrame(targetFrame);
        for (let offset = 1; offset < playbackTransitionPrerenderRunwayFrames; offset += 1) {
          const runwayFrame = targetFrame + offset;
          if (rendererOwnsPresentation) {
            await renderer.renderFrame(runwayFrame);
            cacheTransitionSessionFrame(runwayFrame);
          } else {
            await renderer.prewarmFrame(runwayFrame);
          }
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
    ensurePreviewRenderer,
    getTransitionWindowByStartFrame,
    pinTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    rendererOwnsPresentation,
    playbackTransitionPrerenderRunwayFrames,
    pushTransitionTrace,
  ]);

  // Dispose/recreate the preview renderer when composition inputs change.
  useEffect(() => {
    disposePreviewRenderer();
  }, [disposePreviewRenderer, previewRendererStructureKey, renderSize.height, renderSize.width]);

  // Visual-only edits should keep the warm renderer alive. Invalidate cached
  // frames and ask the renderer surface to repaint instead of rebuilding
  // GPU/decoder state.
  useEffect(() => {
    const previousVisualState = previousPreviewRendererVisualStateRef.current;
    previousPreviewRendererVisualStateRef.current = {
      tracks: previewRendererScaledTracks,
      keyframes: previewRendererScaledKeyframes,
    };

    const visualInvalidationRanges = collectVisualInvalidationRanges({
      previousTracks: previousVisualState.tracks,
      nextTracks: previewRendererScaledTracks,
      previousKeyframes: previousVisualState.keyframes,
      nextKeyframes: previewRendererScaledKeyframes,
    });
    if (visualInvalidationRanges.length === 0) {
      return;
    }

    const scrubRenderer = scrubRendererRef.current;
    const bgRenderer = bgTransitionRendererRef.current;
    const scrubRendererMatchesStructure = (
      scrubRendererStructureKeyRef.current === previewRendererStructureKey
    );
    const bgRendererMatchesStructure = (
      bgTransitionRendererStructureKeyRef.current === previewRendererStructureKey
    );

    if (!scrubRendererMatchesStructure && !bgRendererMatchesStructure) {
      return;
    }

    const invalidationRequest = { ranges: visualInvalidationRanges };
    if (scrubRenderer && scrubRendererMatchesStructure) {
      scrubRenderer.invalidateFrameCache(invalidationRequest);
    }
    if (bgRenderer && bgRendererMatchesStructure) {
      bgRenderer.invalidateFrameCache(invalidationRequest);
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    const currentFrameInvalidated = isFrameInRanges(targetFrame, visualInvalidationRanges);

    if (
      scrubOffscreenRenderedFrameRef.current !== null
      && isFrameInRanges(scrubOffscreenRenderedFrameRef.current, visualInvalidationRanges)
    ) {
      scrubOffscreenRenderedFrameRef.current = null;
    }

    let removedBufferedFrame = false;
    for (const frame of [...transitionSessionBufferedFramesRef.current.keys()]) {
      if (!isFrameInRanges(frame, visualInvalidationRanges)) continue;
      transitionSessionBufferedFramesRef.current.delete(frame);
      removedBufferedFrame = true;
    }
    for (const frame of [...retainedTransitionExitBufferedFramesRef.current.keys()]) {
      if (!isFrameInRanges(frame, visualInvalidationRanges)) continue;
      retainedTransitionExitBufferedFramesRef.current.delete(frame);
      removedBufferedFrame = true;
    }
    if (retainedTransitionExitBufferedFramesRef.current.size === 0) {
      retainedTransitionExitWindowRef.current = null;
    }
    if (removedBufferedFrame) {
      lastPausedPrearmTargetRef.current = null;
    }

    if (
      scrubRenderer
      && scrubRendererMatchesStructure
      && currentFrameInvalidated
      && (
        playbackState.previewFrame !== null
        || readPresenterState().isRenderedOverlayVisible
      )
    ) {
      scrubRequestedFrameRef.current = targetFrame;
      void resumeScrubLoopRef.current();
    }
  }, [
    previewRendererInputProps,
    previewRendererScaledKeyframes,
    previewRendererScaledTracks,
    previewRendererStructureKey,
    rendererOwnsPresentation,
    readPresenterState,
  ]);

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
      captureInFlightRef.current = null;
      captureImageDataInFlightRef.current = null;
      captureScaleCanvasRef.current = null;
    };
  }, [captureCurrentFrame, captureCurrentFrameImageData, captureCanvasSource, setCaptureFrame, setCaptureFrameImageData, setCaptureCanvasSource]);

  // Eager GPU warm-up on mount — request the WebGPU device BEFORE media
  // finishes resolving. This is the most expensive single cold-start cost
  // (~50-100ms for device request, plus ~100-400ms for shader compilation).
  // The device is cached globally so the renderer reuses it instead of
  // requesting a second one.
  useEffect(() => {
    if (!PREVIEW_RENDERER_ENABLED) return;
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
  }, []);

  // Background warm-up of full renderer once media URLs are resolved.
  useEffect(() => {
    if (!PREVIEW_RENDERER_ENABLED || isResolving) return;
    if (scrubRendererRef.current || scrubInitPromiseRef.current) return;

    let cancelled = false;
    const warmup = () => {
      if (cancelled || scrubRendererRef.current || scrubInitPromiseRef.current) return;
      void ensurePreviewRenderer();
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
  }, [ensurePreviewRenderer, isResolving]);

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
      publishDisplayedFrame(renderedFrame);
    };

    const drawToDisplay = (renderedFrame: number) => {
      const offscreen = scrubOffscreenCanvasRef.current;
      if (!offscreen) return;
      drawSourceToDisplay(offscreen, renderedFrame);
    };

    const getPlaybackTransitionStateForFrame = (frame: number) => (
      resolvePlaybackTransitionOverlayState(
        playbackTransitionOverlayWindows,
        frame,
        playbackTransitionLookaheadFrames,
        playbackTransitionCooldownFrames,
      )
    );

    const hasPreparedPlaybackTransitionFrame = (frame: number) => (
      transitionSessionBufferedFramesRef.current.has(frame)
      || retainedTransitionExitBufferedFramesRef.current.has(frame)
      || scrubOffscreenRenderedFrameRef.current === frame
    );

    const tryShowPreparedPlaybackTransitionOverlay = (frame: number) => {
      const bufferedFrame = getPreparedTransitionBufferedFrame(frame);
      if (bufferedFrame) {
        const trace = transitionSessionTraceRef.current;
        if (trace && trace.enteredAtMs === null) {
          trace.enteredAtMs = performance.now();
          pushTransitionTrace('entry_show', {
            opId: trace.opId,
            frame,
            via: 'buffer',
            bufferedFrames: transitionSessionBufferedFramesRef.current.size
              || retainedTransitionExitBufferedFramesRef.current.size,
          });
        }
        drawSourceToDisplay(bufferedFrame, frame);
        showTransitionOverlaySurface();
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
          bufferedFrames: transitionSessionBufferedFramesRef.current.size
            || retainedTransitionExitBufferedFramesRef.current.size,
        });
      }
      drawToDisplay(frame);
      showTransitionOverlaySurface();
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
      // Fast bail-out: check if this pump has been superseded by a newer
      // seek/play cycle. Checked after every await to abandon stale work
      // as early as possible, freeing GPU/decoder resources for the new frame.
      const isStale = () => scrubRenderGenerationRef.current !== generation;

      try {
        const enqueuePrewarmFrame = (frame: number) => {
          if (frame < 0) return;
          if (scrubPrewarmQueuedSetRef.current.has(frame)) return;
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return;
          scrubPrewarmQueuedSetRef.current.add(frame);
          scrubPrewarmQueueRef.current.push(frame);
          while (scrubPrewarmQueueRef.current.length > PREVIEW_RENDERER_PREWARM_QUEUE_MAX) {
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

          if (scrubPrewarmedFramesRef.current.length > PREVIEW_RENDERER_MAX_PREWARM_FRAMES) {
            const dropped = scrubPrewarmedFramesRef.current.shift();
            if (dropped !== undefined) {
              scrubPrewarmedFrameSetRef.current.delete(dropped);
            }
          }
        };

        const enqueueBoundaryPrewarm = (targetFrame: number) => {
          if (previewRendererBoundaryFrames.length === 0) return;

          const windowFrames = Math.max(
            4,
            Math.round(fps * PREVIEW_RENDERER_BOUNDARY_PREWARM_WINDOW_SECONDS)
          );
          const minFrame = targetFrame - windowFrames;
          const maxFrame = targetFrame + windowFrames;
          const direction = scrubDirectionRef.current;
          const directionalCandidates: number[] = [];
          const fallbackCandidates: number[] = [];

          for (const boundary of previewRendererBoundaryFrames) {
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
            .slice(0, PREVIEW_RENDERER_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME);

          for (const boundary of selectedBoundaries) {
            enqueuePrewarmFrame(Math.max(0, boundary - 1));
            enqueuePrewarmFrame(boundary);
            enqueuePrewarmFrame(boundary + 1);
          }
        };

        const enqueueBoundarySourcePrewarm = (targetFrame: number) => {
          if (previewRendererBoundarySources.length === 0) return;

          const pool = getGlobalVideoSourcePool();
          const touchFrameMap = scrubPrewarmedSourceTouchFrameRef.current;
          const markBoundarySourcePrewarmed = (src: string, currentFrame: number): boolean => {
            const lastTouchedFrame = touchFrameMap.get(src);
            if (
              lastTouchedFrame !== undefined
              && Math.abs(currentFrame - lastTouchedFrame) < PREVIEW_RENDERER_SOURCE_TOUCH_COOLDOWN_FRAMES
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

            while (prewarmedOrder.length > PREVIEW_RENDERER_MAX_PREWARM_SOURCES) {
              const evicted = prewarmedOrder.shift();
              if (evicted === undefined) break;
              if (prewarmedSet.delete(evicted)) {
                touchFrameMap.delete(evicted);
                previewPerfRef.current.previewRendererPrewarmSourceEvictions += 1;
              }
            }

            previewPerfRef.current.previewRendererPrewarmedSources = prewarmedSet.size;
            return true;
          };
          const windowFrames = Math.max(
            8,
            Math.round(fps * PREVIEW_RENDERER_SOURCE_PREWARM_WINDOW_SECONDS)
          );
          const minFrame = targetFrame - windowFrames;
          const maxFrame = targetFrame + windowFrames;
          const direction = scrubDirectionRef.current;
          const directionalEntries: PreviewRendererBoundarySource[] = [];
          const fallbackEntries: PreviewRendererBoundarySource[] = [];

          for (const entry of previewRendererBoundarySources) {
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
            .slice(0, PREVIEW_RENDERER_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME);
          let sourcesBudget = PREVIEW_RENDERER_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME;

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
            forwardSteps: PREVIEW_RENDERER_DIRECTIONAL_PREWARM_FORWARD_STEPS,
            backwardSteps: PREVIEW_RENDERER_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
            oppositeSteps: PREVIEW_RENDERER_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
            neutralRadius: PREVIEW_RENDERER_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
          });
          for (const offset of offsets) {
            enqueuePrewarmFrame(targetFrame + offset);
          }
        };

        let prewarmBudgetStart = 0;
        while (scrubMountedRef.current) {
          const targetFrame = scrubRequestedFrameRef.current;
          const renderLoopDecision = resolvePreviewPresenterRenderLoopDecision({
            targetFrame,
            nextPrewarmFrame: scrubPrewarmQueueRef.current[0] ?? null,
            suppressBackgroundPrewarm: suppressScrubBackgroundPrewarmRef.current,
            isPlaying: usePlaybackStore.getState().isPlaying,
            prewarmBudgetStart,
            nowMs: performance.now(),
            prewarmBudgetMs: PREVIEW_RENDERER_PREWARM_RENDER_BUDGET_MS,
          });
          if (renderLoopDecision.kind === 'stop' || renderLoopDecision.kind === 'yield') {
            break;
          }

          const isPriorityFrame = renderLoopDecision.kind === 'render_priority';
          const frameToRender = renderLoopDecision.frameToRender;
          if (isPriorityFrame) {
            scrubRequestedFrameRef.current = null;
            prewarmBudgetStart = 0; // Reset budget for prewarm after this priority frame
          } else {
            scrubPrewarmQueueRef.current.shift();
            scrubPrewarmQueuedSetRef.current.delete(frameToRender);
            if (renderLoopDecision.kind === 'skip_prewarm') {
              continue;
            }
          }

          const renderer = await ensurePreviewRenderer();
          if (!renderer || !scrubMountedRef.current) {
            showRendererSurface();
            break;
          }
          // For background prewarm frames, bail if a newer scrub target arrived.
          // Priority frames proceed regardless — their rendered content is always useful.
          if (!isPriorityFrame && isStale()) break;

          const playbackNow = usePlaybackStore.getState();
          if (playbackNow.isPlaying) {
            // Only pin/clear the transition session when the rendered frame is
            // actually inside a transition window. Passing null for pre-transition
            // frames would destroy sessions that the prearm subscription just
            // pinned, causing churn and leaving the entry runway cold.
            const windowForFrame = getTransitionWindowForFrame(frameToRender);
            if (windowForFrame) {
              const prevSession = transitionSessionWindowRef.current;
              const isNewSession = !prevSession || prevSession.transition.id !== windowForFrame.transition.id;
              pinTransitionPlaybackSession(windowForFrame);
              // Await the prearm prewarm so mediabunny decoders are positioned
              // at the correct source time before rendering. The prearm fires
              // ~2s ahead so this resolves near-instantly in the common case.
              // Without this, decoders may be at a stale position from a prior
              // playback, causing 100-300ms backward keyframe seeks per frame.
              if (transitionPrewarmPromiseRef.current) {
                await transitionPrewarmPromiseRef.current;
                transitionPrewarmPromiseRef.current = null;
              }
              // When entering a transition mid-playback (no prearm happened),
              // await the prewarm synchronously to position decoders.
              if (isNewSession && 'prewarmItems' in renderer) {
                await renderer.prewarmItems(
                  [windowForFrame.leftClip.id, windowForFrame.rightClip.id],
                  frameToRender,
                );
              }
            }
          }

          if (isPriorityFrame) {
            // Visible scrub targets still use full composition rendering.
            const renderStartMs = performance.now();
            await renderer.renderFrame(frameToRender);
            // Don't check isStale() here — the priority frame is fully rendered
            // and should always be displayed. Discarding it wastes the decode work
            // and reduces scrub hit rate.
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
            // Background scrub prewarm: collect eligible frames into a batch
            // for samplesAtTimestamps() optimized pipeline, then dispatch.
            const prewarmBatch: number[] = [frameToRender];
            // Drain more frames from the queue while within budget and not stale
            while (scrubPrewarmQueueRef.current.length > 0) {
              if (scrubRequestedFrameRef.current !== null) break;
              if (suppressScrubBackgroundPrewarmRef.current) break;
              if (usePlaybackStore.getState().isPlaying) break;
              if (prewarmBudgetStart > 0 && performance.now() - prewarmBudgetStart > PREVIEW_RENDERER_PREWARM_RENDER_BUDGET_MS) break;
              const next = scrubPrewarmQueueRef.current.shift()!;
              scrubPrewarmQueuedSetRef.current.delete(next);
              prewarmBatch.push(next);
            }
            // Batch prewarm via samplesAtTimestamps — each packet decoded at most
            // once across the batch. Falls back to sequential drawFrame internally
            // for sources where batch mode has been disabled.
            await renderer.prewarmFrames(prewarmBatch);
            for (const f of prewarmBatch) {
              markPrewarmed(f);
            }
          }
          if (!scrubMountedRef.current || isStale()) break;

          if (isPriorityFrame) {

            const playbackState = usePlaybackStore.getState();
            const playbackTransitionState = getPlaybackTransitionStateForFrame(frameToRender);
            const shouldShowPlaybackTransitionOverlay = (
              playbackState.isPlaying
              && playbackState.previewFrame === null
              && (playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay)
            );
            const isPausedOnTransitionFrame = (
              frameToRender === playbackState.currentFrame
              && isPausedTransitionOverlayActive(frameToRender, playbackState)
            );

            drawToDisplay(frameToRender);
            if (shouldShowPlaybackTransitionOverlay || isPausedOnTransitionFrame) {
              showTransitionOverlaySurface();
            } else {
              showRendererSurface();
            }
            if (
              !shouldShowPlaybackTransitionOverlay
              && !isPausedOnTransitionFrame
              && !suppressScrubBackgroundPrewarmRef.current
            ) {
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
        hideRenderedOverlays();
        disposePreviewRenderer();
      } finally {
        if (scrubRenderGenerationRef.current === generation) {
          // Current generation — this pump owns the lock. Release normally.
          scrubRenderInFlightRef.current = false;
          const deferredPrepareFrame = deferredPlaybackTransitionPrepareFrameRef.current;
          if (deferredPrepareFrame !== null) {
            scheduleOpportunisticTransitionPrepare();
          }
          if (scrubRequestedFrameRef.current !== null) {
            void pumpRenderLoop();
          }
        }
        // Stale generation — a newer seek/play bumped the generation while
        // we were in-flight. DON'T release the lock here; the playback-start
        // force-clear or the new pump's finally handles it. Releasing would
        // allow a concurrent pump to start and share mutable canvas state.
      }
    };

    resumeScrubLoopRef.current = () => {
      void pumpRenderLoop();
    };

    const recordTransitionEntryMiss = (frame: number) => {
      const trace = transitionSessionTraceRef.current;
      if (!trace || trace.lastEntryMissFrame === frame) {
        return;
      }
      trace.entryMisses += 1;
      trace.lastEntryMissFrame = frame;
      pushTransitionTrace('entry_miss', {
        opId: trace.opId,
        frame,
        bufferedFrames: transitionSessionBufferedFramesRef.current.size,
      });
    };

    const applyTransitionPlaybackOverlayDecision = (
      frame: number,
      decision: PreviewPresenterTransitionPlaybackDecision,
    ) => {
      if (decision.kind === 'show_prepared_transition_overlay') {
        tryShowPreparedPlaybackTransitionOverlay(frame);
        return;
      }

      if (decision.kind === 'render_transition_overlay') {
        if (decision.shouldRecordEntryMiss) {
          recordTransitionEntryMiss(frame);
        }
        scrubRequestedFrameRef.current = frame;
        void pumpRenderLoop();
        return;
      }

      if (decision.shouldClearTransitionSession) {
        clearTransitionPlaybackSession();
      }
      showRendererSurface();
    };

    // rAF-driven render pump for playback — fires at display vsync (60Hz+),
    // catching frames the Zustand subscription misses due to event loop
    // contention from React renders, GC pauses, etc. This reduces the ~9%
    // frame drop rate during playback to near zero.
    let playbackRafId: number | null = null;
    let lastRafRenderedFrame = -1;
    let playbackPrewarmInFlight = false;
    const pausePrewarmedItemIds = new Set<string>();

    let lastRafPresentedFrame = -1;

    const playbackRafPump = () => {
      playbackRafId = null;
      if (!scrubMountedRef.current) return;
      const playbackState = usePlaybackStore.getState();
      if (!playbackState.isPlaying || !rendererOwnsPresentation) return;
      const currentFrame = playbackState.currentFrame;

      if (currentFrame !== lastRafRenderedFrame) {
        lastRafRenderedFrame = currentFrame;
        // Check if this frame was pre-rendered by the transition prepare.
        // If so, present it immediately (0ms) instead of going through the
        // async pumpRenderLoop (which would take 180-240ms for the first
        // transition frame due to mediabunny decode).
        const buffered = getPreparedTransitionBufferedFrame(currentFrame);
        if (buffered) {
          drawSourceToDisplay(buffered, currentFrame);
          scrubOffscreenRenderedFrameRef.current = currentFrame;
          lastRafPresentedFrame = currentFrame;
          // Pre-start the render loop for the next uncached frame so the
          // GPU + decode pipeline is already warm when the buffer runs out.
          // Without this, the first post-cache frame stalls 100-200ms.
          const nextFrame = currentFrame + 1;
          if (!getPreparedTransitionBufferedFrame(nextFrame)
            && !scrubRenderInFlightRef.current) {
            scrubRequestedFrameRef.current = nextFrame;
            void pumpRenderLoop();
          }
        } else {
          scrubRequestedFrameRef.current = currentFrame;
          if (!scrubRenderInFlightRef.current) {
            void pumpRenderLoop();
          }
        }
      } else if (
        lastRafPresentedFrame !== currentFrame
        && scrubOffscreenRenderedFrameRef.current === currentFrame
      ) {
        // Frame hasn't advanced but the async render completed since the
        // last vsync. Present it now synchronously to eliminate 3:2 pulldown
        // judder (50ms/16ms alternating intervals on 30fps@60Hz displays).
        drawToDisplay(currentFrame);
        lastRafPresentedFrame = currentFrame;
      }

      playbackRafId = requestAnimationFrame(playbackRafPump);
    };

    // Threshold for triggering background worker preseek on large jumps.
    // Below this threshold, mediabunny sequential advance is fast (~1ms).
    // Above it, a keyframe seek is needed (300-600ms) — the worker does it off-thread.
    const JUMP_PRESEEK_THRESHOLD_FRAMES = Math.round(fps * 3);

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      // Background preseek on large timeline jumps — fire off-thread decoder
      // seek for all visible video clips at the new position so the first
      // renderFrame after the jump uses the cached bitmap (~0ms) instead of
      // blocking on mediabunny keyframe seek (~300-600ms).
      if (
        state.currentFrame !== prev.currentFrame
        && Math.abs(state.currentFrame - prev.currentFrame) >= JUMP_PRESEEK_THRESHOLD_FRAMES
        && !state.isPlaying
      ) {
        // Group timestamps by source URL for batch preseek — mediabunny's
        // samplesAtTimestamps() shares decoder state across the batch,
        // decoding each packet at most once.
        const frame = state.currentFrame;
        const bySource = new Map<string, number[]>();
        for (const track of combinedTracks) {
          for (const item of track.items) {
            if (item.type !== 'video' || !('src' in item) || !item.src) continue;
            if (frame < item.from || frame >= item.from + item.durationInFrames) continue;
            // Skip if sourceFps isn't populated yet (metadata still loading) —
            // sourceStart is in source-native FPS, so wrong fps produces wrong timestamps.
            if (!item.sourceFps) continue;
            const localFrame = frame - item.from;
            const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
            const speed = item.speed ?? 1;
            const sourceTime = (sourceStart / item.sourceFps) + (localFrame / fps) * speed;
            const existing = bySource.get(item.src);
            if (existing) {
              existing.push(sourceTime);
            } else {
              bySource.set(item.src, [sourceTime]);
            }
          }
        }
        for (const [src, timestamps] of bySource) {
          void workerBackgroundBatchPreseek(src, timestamps);
        }
      }

      if (state.isPlaying && !prev.isPlaying) {
        const activeTransitionWindow = getTransitionWindowForFrame(state.currentFrame);
        if (activeTransitionWindow) {
          pinTransitionPlaybackSession(activeTransitionWindow);
        }
      }

      // Start/stop rAF render pump on play state transitions
      if (state.isPlaying && rendererOwnsPresentation && !prev.isPlaying) {
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
              const renderer = await ensurePreviewRenderer();
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
        // Clear transition session on stop so the prearm guard doesn't
        // block prearming on the next play. Without this, a session pinned
        // during the previous playback stays alive and prevents the
        // prearm from firing for the next transition.
        lastPlayingPrearmTargetRef.current = null;
        clearTransitionPlaybackSession();
      }

      if (state.isPlaying && rendererOwnsPresentation) {
        // With the renderer presenting playback, ALL transition types need
        // their decoded runway warmed. Previously only complex transitions
        // were prearmed here, leaving simple transitions without a prepared
        // render path at entry.
        // First check if we're already inside a transition — pin that session
        // and prewarm the decoders for both clips so the first rendered frame
        // doesn't stall.
        const activeTransitionWindow = getTransitionWindowForFrame(state.currentFrame);
        if (activeTransitionWindow) {
          const existingSession = transitionSessionWindowRef.current;
          const isSamePinnedSession = (
            existingSession?.transition.id === activeTransitionWindow.transition.id
            && existingSession.startFrame === activeTransitionWindow.startFrame
          );
          pinTransitionPlaybackSession(activeTransitionWindow);
          if (!isSamePinnedSession) {
            lastPlayingPrearmTargetRef.current = activeTransitionWindow.startFrame;
            // Pre-seek decoders for both transition clips at the current frame.
            const renderer = scrubRendererRef.current;
            if (renderer && 'prewarmItems' in renderer) {
              void renderer.prewarmItems(
                [activeTransitionWindow.leftClip.id, activeTransitionWindow.rightClip.id],
                state.currentFrame,
              );
              void prewarmTransitionFrameStrip(
                renderer,
                activeTransitionWindow,
                state.currentFrame,
                1,
              );
            }
            {
              const currentFrames = isVariableSpeedTransitionWindow(activeTransitionWindow)
                ? getTransitionWarmFrames(activeTransitionWindow, state.currentFrame, 1)
                : [state.currentFrame];
              preseekTransitionSources(activeTransitionWindow, currentFrames);
            }
          }
        }

        // Only prearm an upcoming transition if no active session is pinned.
        // Prearming while inside a transition would evict the active session.
        const prearmStartFrame = (!activeTransitionWindow && !transitionSessionWindowRef.current)
          ? getPlayingAnyTransitionPrewarmStartFrame(state.currentFrame)
          : null;
        if (prearmStartFrame !== null) {
          const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame);
          if (transitionWindow) {
            pinTransitionPlaybackSession(transitionWindow);
          }
          if (lastPlayingPrearmTargetRef.current !== prearmStartFrame) {
            lastPlayingPrearmTargetRef.current = prearmStartFrame;
            if (transitionWindow) {
              const renderer = scrubRendererRef.current;
              if (renderer && 'prewarmItems' in renderer) {
                transitionPrewarmPromiseRef.current = (async () => {
                  await renderer.prewarmItems(
                    [transitionWindow.leftClip.id, transitionWindow.rightClip.id],
                    transitionWindow.startFrame,
                  );
                  await prewarmTransitionFrameStrip(
                    renderer,
                    transitionWindow,
                    transitionWindow.startFrame,
                    1,
                  );
                })();
              }
              // Fire background worker batch preseek for the first several
              // transition frames per clip. Pre-decoding a batch gives the
              // render loop cached bitmaps as fallback — reduces the 100-300ms
              // cold decode stall at transition entry.
              {
                const preseekCount = Math.min(
                  isVariableSpeedTransitionWindow(transitionWindow) ? 16 : 8,
                  transitionWindow.endFrame - transitionWindow.startFrame,
                );
                const frames = Array.from(
                  { length: preseekCount },
                  (_, index) => transitionWindow.startFrame + index,
                );
                preseekTransitionSources(transitionWindow, frames);
              }
            }
            pushTransitionTrace('playing_prearm', {
              targetFrame: prearmStartFrame,
            });
          }
        } else if (!activeTransitionWindow) {
          lastPlayingPrearmTargetRef.current = null;
          const prevActiveWindow = transitionSessionWindowRef.current;
          if (prevActiveWindow && state.currentFrame >= prevActiveWindow.endFrame) {
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
        // Check both: upcoming transitions AND the transition we're currently
        // inside.  getPausedTransitionPrewarmStartFrame only looks forward,
        // so pausing/seeking inside a transition left no session pinned —
        // causing the render loop to fall back to mediabunny for both clips.
        const pausedActiveWindow = getTransitionWindowForFrame(state.currentFrame);
        const pausedPrewarmStartFrame = pausedActiveWindow?.startFrame
          ?? getPausedTransitionPrewarmStartFrame(state.currentFrame);
        const pausedTransitionDecision = resolvePreviewPresenterPausedTransitionDecision({
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          prevCurrentFrame: prev.currentFrame,
          prevIsPlaying: prev.isPlaying,
          pausedActiveWindowStartFrame: pausedActiveWindow?.startFrame ?? null,
          pausedPrewarmStartFrame,
        });
        if (pausedTransitionDecision.kind === 'prewarm_transition_entry') {
          const tw = pausedActiveWindow ?? getTransitionWindowByStartFrame(pausedTransitionDecision.targetStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            if (lastPausedPrearmTargetRef.current !== pausedTransitionDecision.targetStartFrame) {
              void (async () => {
                const mainRenderer = await ensurePreviewRenderer();
                if (mainRenderer && 'prewarmItems' in mainRenderer) {
                  await mainRenderer.prewarmItems(
                    [tw.leftClip.id, tw.rightClip.id],
                    tw.startFrame,
                  );
                  await prewarmTransitionFrameStrip(
                    mainRenderer,
                    tw,
                    tw.startFrame,
                    1,
                  );
                }
                // Pre-seed worker bitmap cache for transition clips (same as
                // playing prearm). Positions the worker decoder so cached
                // bitmaps are ready as a fallback if DOM video / mediabunny
                // can't deliver the first transition frame fast enough.
                const warmFrames = isVariableSpeedTransitionWindow(tw)
                  ? getTransitionWarmFrames(tw, tw.startFrame, 1)
                  : [tw.startFrame];
                if (warmFrames.length === 1) {
                  for (const clip of [tw.leftClip, tw.rightClip]) {
                    if (clip.type === 'video' && 'src' in clip && clip.src && clip.sourceFps) {
                      const localFrame = tw.startFrame - clip.from;
                      const sourceStart = clip.sourceStart ?? clip.trimStart ?? 0;
                      const clipSpeed = clip.speed ?? 1;
                      const sourceTime = (sourceStart / clip.sourceFps) + (localFrame / fps) * clipSpeed;
                      void workerBackgroundPreseek(clip.src, sourceTime);
                    }
                  }
                } else {
                  preseekTransitionSources(tw, warmFrames);
                }
                // Pre-render the first few transition frames using the MAIN
                // renderer (whose decoders are already at tw.startFrame from
                // the prewarmItems call above).  The previous approach created
                // a separate bg renderer which required its own GPU pipeline
                // init + cold mediabunny decode — taking 1-2s and rarely
                // completing before playback started.  Using the main renderer
                // is fast because everything is already warm.  Pre-rendering
                // multiple frames gives the render loop a head start so the
                // first cold-rendered transition frame isn't frame 1.
                if (!usePlaybackStore.getState().isPlaying && mainRenderer) {
                  const preRenderCount = Math.min(playbackTransitionPrerenderRunwayFrames, tw.endFrame - tw.startFrame);
                  for (let fi = 0; fi < preRenderCount; fi++) {
                    if (usePlaybackStore.getState().isPlaying) break;
                    const frame = tw.startFrame + fi;
                    try {
                      await mainRenderer.renderFrame(frame);
                      if ('getCanvas' in mainRenderer) {
                        const srcCanvas = (mainRenderer as { getCanvas: () => OffscreenCanvas }).getCanvas();
                        const snapshot = new OffscreenCanvas(srcCanvas.width, srcCanvas.height);
                        const snapshotCtx = snapshot.getContext('2d');
                        if (snapshotCtx) {
                          snapshotCtx.drawImage(srcCanvas, 0, 0);
                          transitionSessionBufferedFramesRef.current.set(frame, snapshot);
                        }
                      }
                    } catch { break; }
                  }
                }
                // After pre-render, trigger a fresh render. Wait for React
                // to mount premounted transition participants first.
                await new Promise<void>((r) => setTimeout(r, 1000));
                if (!usePlaybackStore.getState().isPlaying) {
                  await mainRenderer.renderFrame(state.currentFrame);
                  if ('getCanvas' in mainRenderer) {
                    const srcCanvas = (mainRenderer as { getCanvas: () => OffscreenCanvas }).getCanvas();
                    const snapshot = new OffscreenCanvas(srcCanvas.width, srcCanvas.height);
                    const snapshotCtx = snapshot.getContext('2d');
                    if (snapshotCtx) {
                      snapshotCtx.drawImage(srcCanvas, 0, 0);
                      transitionSessionBufferedFramesRef.current.set(state.currentFrame, snapshot);
                    }
                  }
                  scrubRequestedFrameRef.current = state.currentFrame;
                  scrubFrameDirtyRef.current = true;
                  void pumpRenderLoop();
                }
              })();
            }
          }
        } else if (pausedTransitionDecision.kind === 'show_transition_overlay') {
          // Paused inside a transition. Pin the session and render the current
          // frame so the composed transition stays visible on the renderer.
          const tw = pausedActiveWindow;
          if (tw) {
            pinTransitionPlaybackSession(tw);
            scrubRequestedFrameRef.current = state.currentFrame;
            void pumpRenderLoop();
          }
        } else if (pausedTransitionDecision.kind === 'schedule_prepare') {
          schedulePlaybackTransitionPrepare(pausedTransitionDecision.targetStartFrame);
        } else if (pausedTransitionDecision.kind === 'clear') {
          // No nearby transition while paused — clean up.
          lastPausedPrearmTargetRef.current = null;
          schedulePlaybackTransitionPrepare(null);
          clearTransitionPlaybackSession();
        }
        if (
          pausedTransitionDecision.kind !== 'ignore'
          && pausedTransitionDecision.kind !== 'clear'
          && lastPausedPrearmTargetRef.current !== pausedTransitionDecision.targetStartFrame
        ) {
          lastPausedPrearmTargetRef.current = pausedTransitionDecision.targetStartFrame;
          pushTransitionTrace('paused_prearm', {
            targetFrame: pausedTransitionDecision.targetStartFrame,
          });
        }
      }

      if (!state.isPlaying && state.previewFrame !== null) {
        const scrubTransitionWindow = getTransitionWindowForFrame(state.previewFrame);
        if (scrubTransitionWindow) {
          pinTransitionPlaybackSession(scrubTransitionWindow);
          const isNewScrubTransitionWindow = (
            lastScrubTransitionWarmStartRef.current !== scrubTransitionWindow.startFrame
          );
          const shouldWarmVariableSpeedStrip = (
            isVariableSpeedTransitionWindow(scrubTransitionWindow)
            && (
              lastScrubTransitionWarmFrameRef.current === null
              || Math.abs(lastScrubTransitionWarmFrameRef.current - state.previewFrame) >= 4
            )
          );
          if (isNewScrubTransitionWindow) {
            lastScrubTransitionWarmStartRef.current = scrubTransitionWindow.startFrame;
            lastScrubTransitionWarmFrameRef.current = null;
          }
          if (isNewScrubTransitionWindow || shouldWarmVariableSpeedStrip) {
            void (async () => {
              const renderer = await ensurePreviewRenderer();
              if (!renderer || !('prewarmItems' in renderer)) return;
              const playback = usePlaybackStore.getState();
              const livePreviewFrame = playback.previewFrame;
              if (playback.isPlaying || livePreviewFrame === null) return;
              const liveWindow = getTransitionWindowForFrame(livePreviewFrame);
              if (!liveWindow || liveWindow.startFrame !== scrubTransitionWindow.startFrame) return;
              await renderer.prewarmItems(
                [scrubTransitionWindow.leftClip.id, scrubTransitionWindow.rightClip.id],
                livePreviewFrame,
              );
              const shouldWarmStrip = (
                isVariableSpeedTransitionWindow(liveWindow)
                && (
                  lastScrubTransitionWarmFrameRef.current === null
                  || Math.abs(lastScrubTransitionWarmFrameRef.current - livePreviewFrame) >= 4
                )
              );
              if (shouldWarmStrip) {
                lastScrubTransitionWarmFrameRef.current = livePreviewFrame;
                await prewarmTransitionFrameStrip(
                  renderer,
                  liveWindow,
                  livePreviewFrame,
                  scrubDirectionRef.current,
                );
                preseekTransitionSources(
                  liveWindow,
                  getTransitionWarmFrames(liveWindow, livePreviewFrame, scrubDirectionRef.current),
                );
              }
            })();
          }
        } else {
          lastScrubTransitionWarmStartRef.current = null;
          lastScrubTransitionWarmFrameRef.current = null;
          clearTransitionPlaybackSession();
        }
      }

      const playbackTransitionState = state.isPlaying
        ? getPlaybackTransitionStateForFrame(state.currentFrame)
        : null;
      const presenterSyncPlan = resolvePreviewPresenterStoreSyncPlan({
        state: {
          isPlaying: state.isPlaying,
          currentFrame: state.currentFrame,
          previewFrame: state.previewFrame,
        },
        prev: {
          isPlaying: prev.isPlaying,
          currentFrame: prev.currentFrame,
          previewFrame: prev.previewFrame,
        },
        playbackTransitionState,
        hasPreparedTransitionFrame: hasPreparedPlaybackTransitionFrame(state.currentFrame),
        shouldPreserveHighFidelityBackwardPreview,
        lastBackwardRequestedFrame: lastBackwardRequestedFrameRef.current,
        lastBackwardRenderAtMs: lastBackwardScrubRenderAtRef.current,
        nowMs: performance.now(),
        config: {
          disableBackgroundPrewarmOnBackward: PREVIEW_RENDERER_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD,
          backwardRenderQuantizeFrames: PREVIEW_RENDERER_BACKWARD_RENDER_QUANTIZE_FRAMES,
          backwardRenderThrottleMs: PREVIEW_RENDERER_BACKWARD_RENDER_THROTTLE_MS,
          backwardForceJumpFrames: PREVIEW_RENDERER_BACKWARD_FORCE_JUMP_FRAMES,
        },
      });

      if (presenterSyncPlan.kind === 'playing') {
        resetTransientScrubState();
        if (presenterSyncPlan.shouldEnsurePreviewRenderer) {
          void ensurePreviewRenderer();
          if (presenterSyncPlan.transitionPrepareStartFrame !== null) {
            schedulePlaybackTransitionPrepare(presenterSyncPlan.transitionPrepareStartFrame);
          }
        }
        applyTransitionPlaybackOverlayDecision(
          state.currentFrame,
          presenterSyncPlan.overlayDecision,
        );
        return;
      }

      if (presenterSyncPlan.kind === 'unchanged') return;

      scrubDirectionRef.current = presenterSyncPlan.scrubDirection;
      previewPerfRef.current.scrubUpdates += presenterSyncPlan.scrubUpdates;
      previewPerfRef.current.scrubDroppedFrames += presenterSyncPlan.scrubDroppedFrames;

      // Update cache eviction hint so Tier 1/3 prefer evicting frames in the
      // opposite scrub direction — preserves frames the user is moving toward.
      if (
        presenterSyncPlan.targetFrame !== null
        && scrubRendererRef.current
        && 'getScrubbingCache' in scrubRendererRef.current
      ) {
        scrubRendererRef.current.getScrubbingCache()?.setEvictionHint(
          presenterSyncPlan.targetFrame,
          scrubDirectionRef.current,
        );
      }

      if (presenterSyncPlan.nextSuppressBackgroundPrewarm !== suppressScrubBackgroundPrewarmRef.current) {
        suppressScrubBackgroundPrewarmRef.current = presenterSyncPlan.nextSuppressBackgroundPrewarm;
        scrubPrewarmQueueRef.current = [];
        scrubPrewarmQueuedSetRef.current.clear();
      }

      if (scrubRequestedFrameRef.current === presenterSyncPlan.targetFrame) {
        return;
      }

      lastBackwardScrubRenderAtRef.current = presenterSyncPlan.nextBackwardRenderAtMs;
      lastBackwardRequestedFrameRef.current = presenterSyncPlan.nextBackwardRequestedFrame;
      if (presenterSyncPlan.kind === 'skip_frame_request') {
        return;
      }

      // Clear stale prewarm queue so the pump processes the new target
      // instead of old prewarm frames. Don't bump generation or clear the
      // lock here — the pump's single-mutex design handles scrub correctly:
      // the in-flight pump picks up the new target on its next iteration.
      scrubPrewarmQueueRef.current = [];
      scrubPrewarmQueuedSetRef.current.clear();
      scrubRequestedFrameRef.current = presenterSyncPlan.requestedFrame;
      // During playback with rAF pump active or prewarm in flight, let
      // rAF drive the render loop to avoid contention and first-frame stalls.
      if (playbackRafId === null && !playbackPrewarmInFlight) {
        void pumpRenderLoop();
      }
    });

    // During gizmo drags or live preview changes, trigger re-renders even when
    // the frame is unchanged so the renderer does not reuse a stale cached
    // bitmap for the current frame.
    const unsubscribeGizmo = useGizmoStore.subscribe((state, prev) => {
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
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] });
      }

      scrubRequestedFrameRef.current = currentFrame;
      void pumpRenderLoop();
    });

    // During corner pin drag, re-render with the live preview values so the
    // renderer reflects the warp in real-time instead of waiting for commit.
    const unsubscribeCornerPin = useCornerPinStore.subscribe((state, prev) => {
      if (state.previewCornerPin === prev.previewCornerPin) return;
      const playbackState = usePlaybackStore.getState();

      const currentFrame = playbackState.currentFrame;
      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] });
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

      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [targetFrame] });
      }
      scrubRequestedFrameRef.current = targetFrame;
      void pumpRenderLoop();
    });

    const initialPlaybackState = usePlaybackStore.getState();
    if (initialPlaybackState.isPlaying) {
      primePlaybackStartRunway(initialPlaybackState.previewFrame ?? initialPlaybackState.currentFrame);
    }
    if (initialPlaybackState.isPlaying && rendererOwnsPresentation) {
      // Check if playback starts inside an active transition — pin that
      // session immediately so the render pump has warm decoded sources.
      const activeWindow = getTransitionWindowForFrame(initialPlaybackState.currentFrame);
      if (activeWindow) {
        pinTransitionPlaybackSession(activeWindow);
        lastPlayingPrearmTargetRef.current = activeWindow.startFrame;
      } else {
        const prearmStartFrame = getPlayingAnyTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
        if (prearmStartFrame !== null) {
          lastPlayingPrearmTargetRef.current = prearmStartFrame;
          const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame);
          if (transitionWindow) {
            pinTransitionPlaybackSession(transitionWindow);
          }
        }
      }
    }
    if (!initialPlaybackState.isPlaying && initialPlaybackState.previewFrame === null) {
      const initialPausedActiveWindow = getTransitionWindowForFrame(initialPlaybackState.currentFrame);
      const pausedPrewarmStartFrame = initialPausedActiveWindow?.startFrame
        ?? getPausedTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
      const initialPausedTransitionDecision = resolvePreviewPresenterPausedTransitionDecision({
        isPlaying: initialPlaybackState.isPlaying,
        previewFrame: initialPlaybackState.previewFrame,
        currentFrame: initialPlaybackState.currentFrame,
        pausedActiveWindowStartFrame: initialPausedActiveWindow?.startFrame ?? null,
        pausedPrewarmStartFrame,
      });
      if (
        initialPausedTransitionDecision.kind !== 'ignore'
        && initialPausedTransitionDecision.kind !== 'clear'
      ) {
        lastPausedPrearmTargetRef.current = initialPausedTransitionDecision.targetStartFrame;
        if (initialPausedTransitionDecision.kind === 'prewarm_transition_entry') {
          // Pre-render the transition start frame using a DEDICATED background
          // renderer (separate canvas + decoders). This doesn't hold
          // scrubRenderInFlightRef and doesn't conflict with the rAF pump.
          // The rAF pump checks transitionSessionBufferedFramesRef and presents
          // the pre-rendered frame instantly (0ms vs 180-240ms first-frame stall).
          const tw = getTransitionWindowByStartFrame(initialPausedTransitionDecision.targetStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            void (async () => {
              // Warm main renderer's decoders
              const mainRenderer = await ensurePreviewRenderer();
              if (mainRenderer && 'prewarmItems' in mainRenderer) {
                await mainRenderer.prewarmItems(
                  [tw.leftClip.id, tw.rightClip.id],
                  tw.startFrame,
                );
              }
              // Pre-render via background renderer (separate instance)
              if (bgTransitionRenderInFlightRef.current) return;
              bgTransitionRenderInFlightRef.current = true;
              try {
                const bgRenderer = await ensureBgTransitionRenderer();
                if (bgRenderer && !usePlaybackStore.getState().isPlaying) {
                  await bgRenderer.renderFrame(tw.startFrame);
                  cacheTransitionSessionFrame(tw.startFrame);
                  pushTransitionTrace('bg_prerender', { frame: tw.startFrame });
                }
              } catch (error) {
                logger.debug('Background transition pre-render failed:', error);
              } finally {
                bgTransitionRenderInFlightRef.current = false;
              }
            })();
          }
        } else if (initialPausedTransitionDecision.kind === 'show_transition_overlay') {
          // Paused inside a transition on initial mount. Pin the session so
          // the renderer can present the composed transition immediately.
          if (initialPausedActiveWindow) {
            pinTransitionPlaybackSession(initialPausedActiveWindow);
          }
        } else if (initialPausedTransitionDecision.kind === 'schedule_prepare') {
          schedulePlaybackTransitionPrepare(initialPausedTransitionDecision.targetStartFrame);
        }
        pushTransitionTrace('paused_prearm', {
          targetFrame: initialPausedTransitionDecision.targetStartFrame,
        });
      }
    }

    // Paused inside a transition on initial mount — trigger a render so
    // the GPU transition is visible from the renderer-owned surface.
    if (isPausedTransitionOverlayActive(initialPlaybackState.currentFrame, initialPlaybackState)) {
      scrubRequestedFrameRef.current = initialPlaybackState.currentFrame;
      void pumpRenderLoop();
    }

    const initialBootstrapDecision = resolvePreviewPresenterBootstrapDecision({
      isPlaying: initialPlaybackState.isPlaying,
      currentFrame: initialPlaybackState.currentFrame,
      previewFrame: initialPlaybackState.previewFrame,
    });

    const initialTargetFrame = initialBootstrapDecision.targetFrame;
    const initialTargetTransitionState = getPlaybackTransitionStateForFrame(initialTargetFrame);
    if (
      initialTargetTransitionState.shouldPrewarm
      && !initialTargetTransitionState.hasActiveTransition
      && initialTargetTransitionState.nextTransitionStartFrame !== null
    ) {
      schedulePlaybackTransitionPrepare(initialTargetTransitionState.nextTransitionStartFrame);
    }
    scrubRequestedFrameRef.current = initialTargetFrame;
    void pumpRenderLoop();
    if (initialBootstrapDecision.shouldStartPlaybackRaf && playbackRafId === null) {
      playbackRafId = requestAnimationFrame(playbackRafPump);
    }

    return () => {
      scrubMountedRef.current = false;
      suppressScrubBackgroundPrewarmRef.current = false;
      lastBackwardScrubRenderAtRef.current = 0;
      lastBackwardRequestedFrameRef.current = null;
      playStartWarmUntilRef.current = 0;
      lastPlayStartWarmFrameRef.current = null;
      clearScheduledTransitionPrepare();
      clearTransitionPlaybackSession();
      showRendererSurface();
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
    disposePreviewRenderer,
    ensurePreviewRenderer,
    previewRendererBoundaryFrames,
    previewRendererBoundarySources,
    rendererOwnsPresentation,
    fps,
    clearTransitionPlaybackSession,
    getPausedTransitionPrewarmStartFrame,
    getTransitionWindowForFrame,
    hideRenderedOverlays,
    isPausedTransitionOverlayActive,
    pinTransitionPlaybackSession,
    primePlaybackStartRunway,
    preparePlaybackTransitionFrame,
    showRendererSurface,
    showTransitionOverlaySurface,
    playbackTransitionCooldownFrames,
    playbackTransitionLookaheadFrames,
    playbackTransitionWindows,
    pushTransitionTrace,
    readPresenterState,
    resetTransientScrubState,
    publishDisplayedFrame,
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
      if (mediaScheduleIndex.entries.length === 0) return;
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
      const preloadScan = scanPreloadMediaPriorities({
        index: mediaScheduleIndex,
        unresolvedMediaIds: unresolvedSet,
        anchorFrame,
        preloadStartFrame,
        preloadEndFrame,
        scrubDirection,
        now,
        getResolveRetryAt,
        costPenaltyFrames,
        scrubDirectionBiasFrames,
        scanCursor: {
          trackIndex: preloadScanTrackCursorRef.current,
          itemIndex: preloadScanItemCursorRef.current,
        },
        scanStartTimeMs: scanStartTime,
        scanTimeBudgetMs: PRELOAD_SCAN_TIME_BUDGET_MS,
        readTimeMs: () => performance.now(),
        useDirectionalScan: interactionMode === 'scrubbing',
      });
      const {
        mediaToPreloadScores,
        maxActiveWindowCost,
        directionPenaltyCount,
        reachedScanTimeBudget,
        nextCursor,
      } = preloadScan;
      preloadScanTrackCursorRef.current = nextCursor.trackIndex;
      preloadScanItemCursorRef.current = nextCursor.itemIndex;

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
    getResolveRetryAt,
    markResolveFailures,
    kickResolvePass,
    mediaScheduleIndex,
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
      disposePreviewRenderer();
    };
  }, [disposePreviewRenderer, resetResolveRetryState]);

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
    resolvePendingSeekLatency,
  ]);

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
            >
              <MainComposition {...inputProps} />
            </Player>

            {PREVIEW_RENDERER_ENABLED && (
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

            {import.meta.env.DEV && showPerfPanel && perfPanelSnapshot && (() => {
              const p = perfPanelSnapshot;
              const srcLabel = p.renderSource === 'transition_overlay' ? 'Transition' : 'Renderer';
              const srcColor = p.renderSource === 'renderer' ? '#4ade80' : '#60a5fa';
              const seekOk = p.seekLatencyAvgMs < 50;
              const qualOk = p.effectivePreviewQuality >= p.userPreviewQuality;
              const frameOk = p.frameTimeEmaMs <= p.frameTimeBudgetMs * 1.2;
              const trActive = p.transitionSessionActive;
              const trMode = p.transitionSessionBackend === 'none' ? null : 'Renderer';
              const lastSw = latestRenderSourceSwitch;
              const fmtSrc = (s: string) => s === 'transition_overlay' ? 'Transition' : 'Renderer';
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
                    {p.staleRendererFrameDrops > 0 && (
                      <span style={{ color: '#f87171' }}> {p.staleRendererFrameDrops} stale</span>
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

                  {/* Preseek worker */}
                  {(p.preseekRequests > 0 || p.preseekCachedBitmaps > 0) && (
                    <div style={{ color: '#a1a1aa' }}>
                      Preseek {p.preseekCacheHits + p.preseekInflightReuses}/{p.preseekRequests} hit
                      {' '}post {p.preseekWorkerSuccesses}/{p.preseekWorkerPosts}
                      {' '}cache {p.preseekCachedBitmaps}
                      {p.preseekWaitMatches > 0 && (
                        <span>
                          {' '}wait {p.preseekWaitResolved}/{p.preseekWaitMatches}
                        </span>
                      )}
                      {p.preseekWorkerFailures > 0 && (
                        <span style={{ color: '#fbbf24' }}> {p.preseekWorkerFailures} fail</span>
                      )}
                      {p.preseekWaitTimeouts > 0 && (
                        <span style={{ color: '#fbbf24' }}> {p.preseekWaitTimeouts} timeout</span>
                      )}
                    </div>
                  )}

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
