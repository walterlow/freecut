import { useRef, useState, useMemo, useCallback, memo } from 'react';
import { type PlayerRef } from '@/features/preview/deps/player-core';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { GizmoOverlay } from './gizmo-overlay';
import { MaskEditorContainer } from './mask-editor-container';
import { CornerPinContainer } from './corner-pin-container';
import { PreviewPerfPanel } from './preview-perf-panel';
import { PreviewStage } from './preview-stage';
import { RollingEditOverlay } from './rolling-edit-overlay';
import { RippleEditOverlay } from './ripple-edit-overlay';
import { SlipEditOverlay } from './slip-edit-overlay';
import { SlideEditOverlay } from './slide-edit-overlay';
import type { TimelineItem } from '@/types/timeline';
import { type ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import {
  getPreviewRuntimeSnapshotFromPlaybackState,
} from '../utils/preview-state-coordinator';
import {
  createAdaptivePreviewQualityState,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard';
import {
  useGpuEffectsOverlay,
} from '../hooks/use-gpu-effects-overlay';
import {
  usePreviewCompositionBaseModel,
  usePreviewCompositionModel,
} from '../hooks/use-preview-composition-model';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { usePreviewMediaResolution } from '../hooks/use-preview-media-resolution';
import { usePreviewMediaPreload } from '../hooks/use-preview-media-preload';
import { usePreviewOverlayController } from '../hooks/use-preview-overlay-controller';
import { usePreviewPerfPanel } from '../hooks/use-preview-perf-panel';
import { usePreviewPerfPublisher } from '../hooks/use-preview-perf-publisher';
import { usePreviewRenderPump } from '../hooks/use-preview-render-pump-controller';
import {
  usePreviewRendererController,
  type PreviewCompositionRenderer,
} from '../hooks/use-preview-renderer-controller';
import { usePreviewRuntimeGuards } from '../hooks/use-preview-runtime-guards';
import { usePreviewSourceWarm } from '../hooks/use-preview-source-warm';
import { usePreviewTransitionModel } from '../hooks/use-preview-transition-model';
import { usePreviewViewModel } from '../hooks/use-preview-view-model';
import {
  usePreviewTransitionSessionController,
  type TransitionPreviewSessionTrace,
  type TransitionPreviewTelemetry,
} from '../hooks/use-preview-transition-session-controller';

// DEV-only: cached reference loaded via dynamic import so the module
// is excluded from production bundles entirely.
let _devJitterMonitor: import('@/shared/logging/frame-jitter-monitor').FrameJitterMonitor | null = null;
if (import.meta.env.DEV) {
  void import('@/shared/logging/frame-jitter-monitor').then((m) => {
    _devJitterMonitor = m.getFrameJitterMonitor();
  });
}
import {
  ADAPTIVE_PREVIEW_QUALITY_ENABLED,
} from '../utils/preview-constants';

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
  const scrubCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuEffectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrubFrameDirtyRef = useRef(false);
  const bypassPreviewSeekRef = useRef(false);
  const scrubRendererRef = useRef<PreviewCompositionRenderer | null>(null);
  const ensureFastScrubRendererRef = useRef<() => Promise<PreviewCompositionRenderer | null>>(async () => null);
  const scrubInitPromiseRef = useRef<Promise<PreviewCompositionRenderer | null> | null>(null);
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
  const bgTransitionRendererRef = useRef<PreviewCompositionRenderer | null>(null);
  const bgTransitionInitPromiseRef = useRef<Promise<PreviewCompositionRenderer | null> | null>(null);
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
  const transitionSessionPinnedElementsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const transitionExitElementsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const transitionSessionStallCountRef = useRef<Map<string, { ct: number; count: number }>>(new Map());
  const transitionSessionBufferedFramesRef = useRef<Map<number, OffscreenCanvas>>(new Map());
  const transitionPrewarmPromiseRef = useRef<Promise<void> | null>(null);
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
  const resumeScrubLoopRef = useRef<() => void>(() => {});
  const scrubMountedRef = useRef(true);
  const {
    showPerfPanel,
    perfPanelSnapshot,
    latestRenderSourceSwitch,
  } = usePreviewPerfPanel();
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
  const {
    fps,
    tracks,
    keyframes,
    items,
    itemsByTrackId,
    mediaDependencyVersion,
    transitions,
    mediaById,
    brokenMediaCount,
    hasRolling2Up,
    hasRipple2Up,
    hasSlip4Up,
    hasSlide4Up,
    activeGizmoItemType,
    isGizmoInteracting,
    isPlaying,
    zoom,
    useProxy,
    blobUrlVersion,
    proxyReadyCount,
    playerSize,
    needsOverflow,
    playerContainerRef,
    playerContainerRect,
    backgroundRef,
    setPlayerContainerRefCallback,
    handleBackgroundClick,
  } = usePreviewViewModel({
    project,
    containerSize,
    suspendOverlay,
  });
  const showGpuEffectsOverlay = useGpuEffectsOverlay(
    gpuEffectsCanvasRef,
    playerContainerRef,
    scrubOffscreenCanvasRef,
    scrubFrameDirtyRef,
  );
  const isGizmoInteractingRef = useRef(isGizmoInteracting);
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

  const setCaptureFrame = usePreviewBridgeStore((s) => s.setCaptureFrame);
  const setCaptureFrameImageData = usePreviewBridgeStore((s) => s.setCaptureFrameImageData);
  const setDisplayedFrame = usePreviewBridgeStore((s) => s.setDisplayedFrame);

  const {
    isRenderedOverlayVisible,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    pendingFastScrubHandoffFrameRef,
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    beginFastScrubHandoff,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  } = usePreviewOverlayController({
    playerRef,
    bypassPreviewSeekRef,
    shouldPreferPlayerForPreview,
    setDisplayedFrame,
  });

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
  }, [renderSourceRef]);

  const recordRenderFrameJitter = useCallback((
    frame: number,
    renderMs: number,
    inTransition: boolean,
    transitionId: string | null,
    progress: number | null,
  ) => {
    _devJitterMonitor?.recordRenderFrame(frame, renderMs, inTransition, transitionId, progress);
  }, []);

  usePreviewRuntimeGuards({
    isGizmoInteracting,
    isGizmoInteractingRef,
    isPlaying,
    adaptiveQualityCap,
    setAdaptiveQualityCap,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
  });

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

  const { combinedTracks, mediaResolveCostById } = usePreviewCompositionBaseModel({
    tracks,
    itemsByTrackId,
    mediaById,
  });

  const {
    resolvedUrls,
    setResolvedUrls,
    isResolving,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    resetResolveRetryState,
  } = usePreviewMediaResolution({
    fps,
    combinedTracks,
    mediaResolveCostById,
    mediaDependencyVersion,
    blobUrlVersion,
    brokenMediaCount,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        resolveSamples: number;
        resolveTotalMs: number;
        resolveTotalIds: number;
        resolveLastMs: number;
        resolveLastIds: number;
      };
    },
    isGizmoInteractingRef,
  });

  const {
    trackPlayerSeek,
    resolvePendingSeekLatency,
  } = usePreviewPerfPublisher({
    previewPerfRef,
    adaptiveQualityStateRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
    transitionSessionBufferedFramesRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
  });

  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  );

  const {
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
    fastScrubTracksFingerprint,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
  } = usePreviewCompositionModel({
    combinedTracks,
    fps,
    items,
    keyframes,
    transitions,
    resolvedUrls,
    useProxy,
    proxyReadyCount,
    project,
  });

  usePreviewSourceWarm({
    resolvedUrlCount: resolvedUrls.size,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fps,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        sourceWarmTarget: number;
        sourceWarmKeep: number;
        sourceWarmEvictions: number;
        sourcePoolSources: number;
        sourcePoolElements: number;
        sourcePoolActiveClips: number;
      };
    },
    isGizmoInteractingRef,
  });
  const {
    playbackTransitionFingerprint,
    playbackTransitionWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionComplexStartFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getActiveTransitionWindowForFrame,
    playbackTransitionOverlayWindows,
    shouldPreserveHighFidelityBackwardPreview,
  } = usePreviewTransitionModel({
    fps,
    transitions,
    fastScrubScaledTracks,
    fastScrubPreviewItems,
  });

  const fastScrubRendererStructureKey = useMemo(() => (
    [
      fps,
      project.width,
      project.height,
      project.backgroundColor ?? '',
      fastScrubTracksFingerprint,
      playbackTransitionFingerprint,
    ].join('::')
  ), [
    fastScrubTracksFingerprint,
    fps,
    playbackTransitionFingerprint,
    project.backgroundColor,
    project.height,
    project.width,
  ]);

  const forceFastScrubOverlay = showGpuEffectsOverlay;
  const {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPinnedTransitionElementForItem,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  } = usePreviewTransitionSessionController({
    fps,
    forceFastScrubOverlay,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionWindows,
    playbackTransitionComplexStartFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionCooldownFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getActiveTransitionWindowForFrame,
    pushTransitionTrace,
    ensureFastScrubRendererRef,
    scrubMountedRef,
    scrubRenderInFlightRef,
    scrubRequestedFrameRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenRenderedFrameRef,
    resumeScrubLoopRef,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    transitionSessionWindowRef,
    transitionSessionPinnedElementsRef,
    transitionExitElementsRef,
    transitionSessionStallCountRef,
    transitionSessionBufferedFramesRef,
    transitionPrewarmPromiseRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
  });

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

  const setCaptureCanvasSource = usePreviewBridgeStore((s) => s.setCaptureCanvasSource);

  const {
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
  } = usePreviewRendererController({
    fps,
    isResolving,
    forceFastScrubOverlay,
    playerRenderSize,
    renderSize,
    fastScrubInputProps,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubRendererStructureKey,
    isGizmoInteractingRef,
    bypassPreviewSeekRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    scrubCanvasRef,
    scrubRendererRef,
    ensureFastScrubRendererRef,
    scrubInitPromiseRef,
    scrubPreloadPromiseRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenCtxRef,
    scrubRendererStructureKeyRef,
    scrubRenderInFlightRef,
    scrubRequestedFrameRef,
    bgTransitionRendererRef,
    bgTransitionInitPromiseRef,
    bgTransitionRendererStructureKeyRef,
    bgTransitionRenderInFlightRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedSourcesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubOffscreenRenderedFrameRef,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    deferredPlaybackTransitionPrepareFrameRef,
    transitionPrepareTimeoutRef,
    transitionSessionBufferedFramesRef,
    captureCanvasSourceInFlightRef,
    captureInFlightRef,
    captureImageDataInFlightRef,
    captureScaleCanvasRef,
    resumeScrubLoopRef,
    scrubMountedRef,
    lastPausedPrearmTargetRef,
    previewPerfRef,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
    clearPendingFastScrubHandoff,
    clearTransitionPlaybackSession,
    resetResolveRetryState,
    setCaptureFrame,
    setCaptureFrameImageData,
    setCaptureCanvasSource,
    setDisplayedFrame,
  });
  usePreviewRenderPump({
    playerRef,
    fps,
    forceFastScrubOverlay,
    combinedTracks,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    playbackTransitionOverlayWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    playbackTransitionPrerenderRunwayFrames,
    previewPerfRef,
    isGizmoInteractingRef,
    bypassPreviewSeekRef,
    showFastScrubOverlayRef,
    pendingFastScrubHandoffFrameRef,
    scrubCanvasRef,
    scrubRendererRef,
    scrubMountedRef,
    scrubRenderInFlightRef,
    scrubRenderGenerationRef,
    scrubDirectionRef,
    scrubRequestedFrameRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedSourcesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenRenderedFrameRef,
    bgTransitionRenderInFlightRef,
    resumeScrubLoopRef,
    lastBackwardScrubPreloadAtRef,
    lastBackwardScrubRenderAtRef,
    lastBackwardRequestedFrameRef,
    suppressScrubBackgroundPrewarmRef,
    fallbackToPlayerScrubRef,
    lastPausedPrearmTargetRef,
    lastPlayingPrearmTargetRef,
    deferredPlaybackTransitionPrepareFrameRef,
    transitionPrepareTimeoutRef,
    transitionSessionWindowRef,
    transitionSessionPinnedElementsRef,
    transitionSessionStallCountRef,
    transitionSessionBufferedFramesRef,
    transitionPrewarmPromiseRef,
    transitionSessionTraceRef,
    setDisplayedFrame,
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    beginFastScrubHandoff,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
    shouldPreferPlayerForPreview,
    shouldPreserveHighFidelityBackwardPreview,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    pinTransitionPlaybackSession,
    clearTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
    pushTransitionTrace,
    isPausedTransitionOverlayActive,
    trackPlayerSeek,
    recordRenderFrameJitter,
  });
  usePreviewMediaPreload({
    fps,
    combinedTracks,
    mediaResolveCostById,
    previewPerfRef,
    setResolvedUrls,
    isGizmoInteractingRef,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    lastForwardScrubPreloadAtRef,
    lastBackwardScrubPreloadAtRef,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
  });

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
    const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
      playbackState,
      isGizmoInteractingRef.current,
    );
    const interactionMode = runtimeSnapshot.mode;
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
  const perfPanel = import.meta.env.DEV && showPerfPanel && perfPanelSnapshot ? (
    <PreviewPerfPanel
      snapshot={perfPanelSnapshot}
      latestRenderSourceSwitch={latestRenderSourceSwitch}
    />
  ) : null;

  const comparisonOverlay = hasRolling2Up ? (
    <RollingEditOverlay fps={fps} />
  ) : hasRipple2Up ? (
    <RippleEditOverlay fps={fps} />
  ) : hasSlip4Up ? (
    <SlipEditOverlay fps={fps} />
  ) : hasSlide4Up ? (
    <SlideEditOverlay fps={fps} />
  ) : null;

  const overlayControls = !suspendOverlay ? (
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
  ) : null;

  return (
    <PreviewStage
      backgroundRef={backgroundRef}
      playerRef={playerRef}
      scrubCanvasRef={scrubCanvasRef}
      gpuEffectsCanvasRef={gpuEffectsCanvasRef}
      needsOverflow={needsOverflow}
      playerSize={playerSize}
      playerRenderSize={playerRenderSize}
      totalFrames={totalFrames}
      fps={fps}
      isResolving={isResolving}
      isRenderedOverlayVisible={isRenderedOverlayVisible}
      inputProps={inputProps}
      onBackgroundClick={handleBackgroundClick}
      onFrameChange={handleFrameChange}
      onPlayStateChange={handlePlayStateChange}
      setPlayerContainerRefCallback={setPlayerContainerRefCallback}
      perfPanel={perfPanel}
      comparisonOverlay={comparisonOverlay}
      overlayControls={overlayControls}
    />
  );
});
