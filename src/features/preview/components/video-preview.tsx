import { useMemo, useCallback, useEffect, useRef, memo } from 'react';
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
import {
  useGpuEffectsOverlay,
} from '../hooks/use-gpu-effects-overlay';
import {
  usePreviewCompositionBaseModel,
  usePreviewCompositionModel,
} from '../hooks/use-preview-composition-model';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { usePreviewDiagnostics } from '../hooks/use-preview-diagnostics';
import { usePreviewMediaResolution } from '../hooks/use-preview-media-resolution';
import { usePreviewMediaPreload } from '../hooks/use-preview-media-preload';
import { usePreviewOverlayController } from '../hooks/use-preview-overlay-controller';
import { usePreviewPerfPanel } from '../hooks/use-preview-perf-panel';
import { usePreviewPerfPublisher } from '../hooks/use-preview-perf-publisher';
import { usePreviewPlaybackController } from '../hooks/use-preview-playback-controller';
import { usePreviewRenderPump } from '../hooks/use-preview-render-pump-controller';
import { usePreviewRendererController } from '../hooks/use-preview-renderer-controller';
import { usePreviewRuntimeRefs } from '../hooks/use-preview-runtime-refs';
import { usePreviewSourceWarm } from '../hooks/use-preview-source-warm';
import { usePreviewTransitionModel } from '../hooks/use-preview-transition-model';
import { usePreviewViewModel } from '../hooks/use-preview-view-model';
import { usePreviewTransitionSessionController } from '../hooks/use-preview-transition-session-controller';
import { useStreamingPlaybackController } from '../hooks/use-streaming-playback-controller';
import { hasVisibleVideoAtFrame } from '../utils/visible-video-ownership';
import { shouldShowRenderedPreviewCanvas } from '../utils/rendered-preview-canvas-visibility';
import { useCompositionsStore } from '../deps/timeline-contract';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';

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
  const previewRuntimeRefs = usePreviewRuntimeRefs();
  const {
    playerRef,
    scrubCanvasRef,
    gpuEffectsCanvasRef,
    scrubFrameDirtyRef,
    bypassPreviewSeekRef,
    isGizmoInteractingRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
    scrubOffscreenCanvasRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
    transitionSessionBufferedFramesRef,
  } = previewRuntimeRefs;
  const {
    showPerfPanel,
    perfPanelSnapshot,
    latestRenderSourceSwitch,
  } = usePreviewPerfPanel();
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
    busAudioEq,
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
  const compositionById = useCompositionsStore((s) => s.compositionById);
  const showGpuEffectsOverlay = useGpuEffectsOverlay(
    gpuEffectsCanvasRef,
    playerContainerRef,
    scrubOffscreenCanvasRef,
    scrubFrameDirtyRef,
  );
  const shouldPreferPlayerForPreview = useCallback((previewFrame: number | null) => {
    return (
      previewRuntimeRefs.preferPlayerForTextGizmoRef.current
      || (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
    );
  }, [preferPlayerForStyledTextScrubRef, previewRuntimeRefs.preferPlayerForTextGizmoRef]);

  const setCaptureFrame = usePreviewBridgeStore((s) => s.setCaptureFrame);
  const setCaptureFrameImageData = usePreviewBridgeStore((s) => s.setCaptureFrameImageData);
  const setDisplayedFrame = usePreviewBridgeStore((s) => s.setDisplayedFrame);
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame);
  const setVisualPlaybackMode = usePreviewBridgeStore((s) => s.setVisualPlaybackMode);
  const setStreamingAudioProvider = usePreviewBridgeStore((s) => s.setStreamingAudioProvider);
  const visualPlaybackModeRef = useRef<PreviewVisualPlaybackMode>('player');

  const {
    isRenderedOverlayVisible,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  } = usePreviewOverlayController({
    bypassPreviewSeekRef,
  });

  const {
    previewPerfRef,
    pushTransitionTrace,
    recordRenderFrameJitter,
  } = usePreviewDiagnostics({
    renderSourceRef,
    visualPlaybackModeRef,
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
    visualPlaybackModeRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
  });

  const { ignorePlayerUpdatesRef, playerSeekTargetRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
    visualPlaybackModeRef,
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
    busAudioEq,
    proxyReadyCount,
    blobUrlVersion,
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

  const {
    forceCanvasOverlay: streamingPlaybackActive,
    streamingFrameProviderRef,
    streamingAudioProvider,
  } = useStreamingPlaybackController({
    fps,
    combinedTracks,
  });
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  // Keep the rendered preview path active whenever the paused target frame owns
  // visible video. That includes preview-frame scrubs, so ruler hover/click
  // stays on the decoded canvas path instead of bouncing back through DOM video.
  const shouldUseRenderedPausedVideoPreview = useMemo(() => {
    if (isPlaying) return false;
    const pausedTargetFrame = previewFrame ?? currentFrame;
    return hasVisibleVideoAtFrame(combinedTracks, pausedTargetFrame, { compositionById, fps });
  }, [combinedTracks, compositionById, currentFrame, fps, isPlaying, previewFrame]);
  const forceFastScrubOverlay = showGpuEffectsOverlay || streamingPlaybackActive || shouldUseRenderedPausedVideoPreview;
  const renderedPreviewFrame = previewFrame ?? displayedFrame ?? currentFrame;
  const renderedPreviewOwnsVisibleVideo = hasVisibleVideoAtFrame(combinedTracks, renderedPreviewFrame, { compositionById, fps });
  const visualPlaybackMode: PreviewVisualPlaybackMode = isPlaying
    ? 'streaming'
    : ((forceFastScrubOverlay && renderedPreviewOwnsVisibleVideo)
      || (isRenderedOverlayVisible && renderedPreviewOwnsVisibleVideo))
      ? 'rendered_preview'
      : 'player';
  const shouldShowRenderedCanvas = shouldShowRenderedPreviewCanvas({
    visualPlaybackMode,
    isRenderedOverlayVisible,
    displayedFrame,
    previewFrame,
    currentFrame,
  });
  visualPlaybackModeRef.current = visualPlaybackMode;

  useEffect(() => {
    setVisualPlaybackMode(visualPlaybackMode);
    return () => {
      setVisualPlaybackMode('player');
    };
  }, [setVisualPlaybackMode, visualPlaybackMode]);

  useEffect(() => {
    setStreamingAudioProvider(
      visualPlaybackMode === 'streaming' ? streamingAudioProvider : null,
    );
    return () => {
      setStreamingAudioProvider(null);
    };
  }, [setStreamingAudioProvider, streamingAudioProvider, visualPlaybackMode]);

  useEffect(() => {
    if (!shouldShowRenderedCanvas) {
      setDisplayedFrame(null);
    }
  }, [setDisplayedFrame, shouldShowRenderedCanvas]);

  const {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  } = usePreviewTransitionSessionController({
    forceFastScrubOverlay,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionWindows,
    playbackTransitionComplexStartFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionCooldownFrames,
    getTransitionWindowByStartFrame,
    getActiveTransitionWindowForFrame,
    pushTransitionTrace,
    streamingFrameProviderRef,
    ...previewRuntimeRefs.transitionSessionControllerRefs,
  });
  const {
    handleFrameChange,
    handlePlayStateChange,
  } = usePreviewPlaybackController({
    fps,
    combinedTracks,
    keyframes,
    activeGizmoItemType,
    isGizmoInteracting,
    isPlaying,
    forceFastScrubOverlay,
    previewPerfRef,
    isGizmoInteractingRef,
    preferPlayerForTextGizmoRef: previewRuntimeRefs.preferPlayerForTextGizmoRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef: previewRuntimeRefs.adaptiveFrameSampleRef,
    ignorePlayerUpdatesRef,
    playerSeekTargetRef,
    resolvePendingSeekLatency,
    visualPlaybackModeRef,
  });

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
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    previewPerfRef,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
    clearTransitionPlaybackSession,
    resetResolveRetryState,
    setCaptureFrame,
    setCaptureFrameImageData,
    setCaptureCanvasSource,
    setDisplayedFrame,
    ...previewRuntimeRefs.rendererControllerRefs,
  });
  usePreviewRenderPump({
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
    showFastScrubOverlayRef,
    setDisplayedFrame,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
    shouldPreferPlayerForPreview,
    shouldPreserveHighFidelityBackwardPreview,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    getPausedTransitionPrewarmStartFrame,
    pinTransitionPlaybackSession,
    clearTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
    pushTransitionTrace,
    isPausedTransitionOverlayActive,
    recordRenderFrameJitter,
    streamingFrameProviderRef,
    ...previewRuntimeRefs.renderPumpRefs,
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
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    ...previewRuntimeRefs.mediaPreloadRefs,
  });
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
      shouldShowRenderedCanvas={shouldShowRenderedCanvas}
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
