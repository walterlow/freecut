/**
 * Effects-Based Transition Renderer
 *
 * Renders transitions between adjacent clips using per-frame style calculations.
 * Uses a single outer Sequence for visibility and frame context, with direct
 * DOM style manipulation for GPU-accelerated animation without React re-renders.
 *
 * Architecture:
 *   Sequence (from=transitionStart, duration=transitionDuration)
 *     └─ AbsoluteFill (z-index above both clips)
 *         ├─ TransitionOverlay (incoming, z:1) — applies incoming styles
 *         │   └─ ClipContent (rightClip)
 *         └─ TransitionOverlay (outgoing, z:2) — applies outgoing styles
 *             └─ ClipContent (leftClip, offset to show last N frames)
 *
 * The outer Sequence provides:
 *   - Visibility control (only renders during transition window)
 *   - localFrame 0..durationInFrames used by TransitionOverlay for progress
 *
 * TransitionOverlay applies transition styles (opacity, transform, clipPath,
 * mask) directly to its container div via useEffect, avoiding React re-renders.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { AbsoluteFill, Sequence, useSequenceContext } from '@/features/player/composition';
import { useVideoConfig, useIsPlaying } from '../hooks/use-remotion-compat';
import { useVideoSourcePool } from '@/features/player/video/VideoSourcePoolContext';
import type { VideoItem, ImageItem, AdjustmentItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { resolveTransform, toTransformStyle, getSourceDimensions } from '../utils/transform-resolver';
import {
  effectsToCSSFilter,
  getVignetteEffect,
  getVignetteStyle,
  getHalftoneEffect,
  getHalftoneStyles,
  getGlitchEffects,
} from '@/features/effects/utils/effect-to-css';
import { getGlitchFilterString, getScanlinesStyle } from '@/features/effects/utils/glitch-algorithms';
import type { GlitchEffect, ItemEffect } from '@/types/effects';
import { calculateEasingCurve, calculateTransitionStyles } from '@/lib/transitions/engine';

// ============================================================================
// Types
// ============================================================================

export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

type EnrichedVisualItem = (VideoItem | ImageItem) & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

interface OptimizedTransitionProps {
  transition: Transition;
  leftClip: EnrichedVisualItem;
  rightClip: EnrichedVisualItem;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
}

// ============================================================================
// Native Video Component — uses VideoSourcePool for pre-loaded playback
// ============================================================================

interface NativeTransitionVideoProps {
  /** Unique ID for pool acquisition (e.g., `t-${transitionId}-left`) */
  poolItemId: string;
  src: string;
  sourceStart: number;
  playbackRate: number;
  fps: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Frames to delay before source starts advancing (incoming clip waits leftPortion frames) */
  frameOffset?: number;
}

const NativeTransitionVideo: React.FC<NativeTransitionVideoProps> = ({
  poolItemId,
  src,
  sourceStart,
  playbackRate,
  fps,
  containerRef,
  frameOffset = 0,
}) => {
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const pool = useVideoSourcePool();
  const isPlaying = useIsPlaying();
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);

  // effectiveFrame accounts for the delay before the clip starts advancing.
  // Incoming clip waits `leftPortion` frames (freeze at first frame), then advances.
  const effectiveFrame = Math.max(0, frame - frameOffset);
  const targetTime = (sourceStart / fps) + (effectiveFrame * playbackRate / fps);

  // Acquire element from pool on mount
  useEffect(() => {
    if (!poolItemId || !src) return;

    // Pre-load the source
    pool.preloadSource(src).catch(() => {
      // Preload failed — pool will still work, just slower
    });

    // Acquire a video element for this transition clip
    const element = pool.acquireForClip(poolItemId, src);
    if (!element) return;

    element.muted = true;
    element.pause();
    elementRef.current = element;
    needsInitialSyncRef.current = true;

    // Mount into container
    const container = containerRef.current;
    if (container && element.parentElement !== container) {
      element.style.width = '100%';
      element.style.height = '100%';
      element.style.objectFit = 'contain';
      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.top = '0';
      element.style.left = '0';
      container.appendChild(element);
    }

    // Initial seek
    const initialTime = sourceStart / fps;
    const clampedTime = Math.min(initialTime, (element.duration || Infinity) - 0.05);
    element.currentTime = Math.max(0, clampedTime);

    // Force a frame render — some browsers need play/pause after seek
    const forceFrameRender = () => {
      if (element.paused && element.readyState >= 2) {
        element.play().then(() => {
          element.pause();
        }).catch(() => {
          // Autoplay blocked — fine for muted transition video
        });
      }
    };
    setTimeout(forceFrameRender, 100);

    return () => {
      element.pause();
      if (element.parentElement) {
        element.parentElement.removeChild(element);
      }
      pool.releaseClip(poolItemId);
      elementRef.current = null;
    };
    // Only re-acquire when identity changes, not on every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolItemId, src, pool, containerRef]);

  // Sync video with timeline — mirrors NativePreviewVideo's approach:
  // During playback: let video play naturally, only seek to correct drift
  // During scrub: pause and seek frame-by-frame
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    video.playbackRate = playbackRate;

    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    const canSeek = video.readyState >= 1;
    const videoDuration = video.duration || Infinity;
    const clampedTargetTime = Math.min(Math.max(0, targetTime), videoDuration - 0.05);

    // During premount (frame < 0), seek to start position and stay paused
    if (frame < 0) {
      if (!video.paused) video.pause();
      const startTime = sourceStart / fps;
      if (canSeek && Math.abs(video.currentTime - startTime) > 0.1) {
        video.currentTime = Math.max(0, startTime);
      }
      return;
    }

    // During freeze period (incoming clip before cut point), stay paused at sourceStart
    const inFreezePeriod = frameOffset > 0 && frame < frameOffset;

    if (inFreezePeriod) {
      if (!video.paused) video.pause();
      if (canSeek && Math.abs(video.currentTime - clampedTargetTime) > 0.05) {
        video.currentTime = clampedTargetTime;
      }
      return;
    }

    if (isPlaying) {
      // Playing: let video play naturally, only seek to correct drift
      const drift = video.currentTime - clampedTargetTime;
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncTimeRef.current;

      const videoBehind = drift < -0.2;
      const videoAhead = drift > 0.15;
      const needsSync = needsInitialSyncRef.current
        || (videoBehind && timeSinceLastSync > 500)
        || videoAhead;

      if (needsSync && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
          lastSyncTimeRef.current = now;
          needsInitialSyncRef.current = false;
        } catch {
          // Seek failed
        }
      }

      // Play if paused and ready
      if (video.paused && video.readyState >= 2) {
        video.play().catch(() => {
          // Autoplay might be blocked
        });
      }
    } else {
      // Scrubbing: pause and seek on frame change
      if (!video.paused) {
        video.pause();
      }
      if (frameChanged && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
        } catch {
          // Seek failed
        }
      }
    }
  }, [frame, playbackRate, targetTime, sourceStart, fps, isPlaying, frameOffset]);

  // Render nothing — the pool element is mounted directly into the container
  return null;
};

// ============================================================================
// Clip Content with Effects
// ============================================================================

interface ClipContentProps {
  clip: EnrichedVisualItem;
  /** Unique ID for video pool acquisition */
  poolItemId: string;
  sourceStartOffset?: number;
  /** Frames to delay before video starts advancing (for incoming clip sync) */
  videoFrameOffset?: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  clipGlobalFrom: number;
}

const ClipContent: React.FC<ClipContentProps> = React.memo(function ClipContent({
  clip,
  poolItemId,
  sourceStartOffset = 0,
  videoFrameOffset = 0,
  canvasWidth,
  canvasHeight,
  fps,
  adjustmentLayers,
  clipGlobalFrom,
}) {
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Use a safe frame for hook dependency values (hooks must always run)
  const safeFrame = Math.max(0, frame);
  const globalFrame = safeFrame + clipGlobalFrom;

  // Memoized effect calculations — ALL hooks must run before any early return
  const adjustmentEffects = useMemo((): ItemEffect[] => {
    if (adjustmentLayers.length === 0) return [];

    const affectingLayers = adjustmentLayers.filter(({ layer, trackOrder }) => {
      if (clip.trackOrder <= trackOrder) return false;
      return globalFrame >= layer.from && globalFrame < layer.from + layer.durationInFrames;
    });

    if (affectingLayers.length === 0) return [];

    return affectingLayers
      .toSorted((a, b) => a.trackOrder - b.trackOrder)
      .flatMap(({ layer }) => (layer.effects ?? []).filter((e) => e.enabled));
  }, [adjustmentLayers, clip.trackOrder, globalFrame]);

  const allEffects = useMemo(() => {
    const clipEffects = clip.effects ?? [];
    return [...adjustmentEffects, ...clipEffects];
  }, [adjustmentEffects, clip.effects]);

  const cssFilterString = useMemo(() => {
    if (allEffects.length === 0) return '';
    return effectsToCSSFilter(allEffects);
  }, [allEffects]);

  const glitchEffects = useMemo(() => {
    if (allEffects.length === 0) return [];
    return getGlitchEffects(allEffects) as Array<GlitchEffect & { id: string }>;
  }, [allEffects]);

  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, safeFrame);
  }, [glitchEffects, safeFrame]);

  const halftoneEffect = useMemo(() => {
    if (allEffects.length === 0) return null;
    return getHalftoneEffect(allEffects);
  }, [allEffects]);

  const halftoneStyles = useMemo(() => {
    if (!halftoneEffect) return null;
    return getHalftoneStyles(halftoneEffect);
  }, [halftoneEffect]);

  const vignetteEffect = useMemo(() => {
    if (allEffects.length === 0) return null;
    return getVignetteEffect(allEffects);
  }, [allEffects]);

  const vignetteStyle = useMemo(() => {
    if (!vignetteEffect) return null;
    return getVignetteStyle(vignetteEffect);
  }, [vignetteEffect]);

  // --- All hooks are above this line --- early return is safe below ---

  if (frame < 0) {
    return null;
  }

  const canvas = { width: canvasWidth, height: canvasHeight, fps };
  const sourceDimensions = getSourceDimensions(clip);
  const resolved = resolveTransform(clip, canvas, sourceDimensions);
  const transformStyle = toTransformStyle(resolved, canvas);

  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');
  const finalFilter = halftoneStyles
    ? [combinedFilter, halftoneStyles.containerStyle.filter].filter(Boolean).join(' ')
    : combinedFilter;
  const hasOverlays = scanlinesEffect || halftoneStyles || vignetteStyle;

  // Render media content
  let mediaContent: React.ReactNode = null;

  if (clip.type === 'video') {
    if (!clip.src) return null;

    const baseSourceStart = clip.sourceStart ?? clip.trimStart ?? clip.offset ?? 0;
    const sourceStart = Math.max(0, baseSourceStart + sourceStartOffset);
    const playbackRate = clip.speed ?? 1;

    mediaContent = (
      <div ref={videoContainerRef} style={{ ...transformStyle, overflow: 'hidden', position: 'relative' }}>
        <NativeTransitionVideo
          poolItemId={poolItemId}
          src={clip.src}
          sourceStart={sourceStart}
          playbackRate={playbackRate}
          fps={fps}
          containerRef={videoContainerRef}
          frameOffset={videoFrameOffset}
        />
      </div>
    );
  } else if (clip.type === 'image') {
    if (!clip.src) return null;

    mediaContent = (
      <div style={{ ...transformStyle, overflow: 'hidden' }}>
        <img
          src={clip.src}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          alt=""
        />
      </div>
    );
  }

  if (!mediaContent) return null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        filter: finalFilter || undefined,
      }}
    >
      {mediaContent}

      {hasOverlays && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {scanlinesEffect && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                ...getScanlinesStyle(scanlinesEffect.intensity),
              }}
            />
          )}

          {halftoneStyles && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: 'none',
                mixBlendMode: halftoneStyles.patternStyle.mixBlendMode,
                opacity: halftoneStyles.patternStyle.opacity,
              }}
            >
              {halftoneStyles.fadeWrapperStyle ? (
                <div style={halftoneStyles.fadeWrapperStyle}>
                  <div style={{ ...halftoneStyles.patternStyle, mixBlendMode: undefined, opacity: undefined }} />
                </div>
              ) : (
                <div style={{ ...halftoneStyles.patternStyle, mixBlendMode: undefined, opacity: undefined }} />
              )}
            </div>
          )}

          {vignetteStyle && <div style={vignetteStyle} />}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Transition Overlay — applies transition styles to its container
// ============================================================================

interface TransitionOverlayProps {
  transition: Transition;
  isOutgoing: boolean;
  children: React.ReactNode;
  zIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}

/**
 * Wraps clip content and applies per-frame transition styles directly to the DOM.
 *
 * Reads localFrame from the parent Sequence context (0-based within the
 * transition window), maps it through the easing curve, then calls
 * calculateTransitionStyles to get opacity/transform/clipPath/mask values.
 *
 * Styles are applied via useEffect to bypass React rendering for performance.
 */
const TransitionOverlay: React.FC<TransitionOverlayProps> = React.memo(function TransitionOverlay({
  transition,
  isOutgoing,
  children,
  zIndex,
  canvasWidth,
  canvasHeight,
  fps,
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;

  // Pre-calculate easing curve for this transition (one value per frame)
  const easingCurve = useMemo(
    () =>
      calculateEasingCurve({
        timing: transition.timing,
        fps,
        durationInFrames: transition.durationInFrames,
        bezierPoints: transition.bezierPoints,
      }),
    [transition.timing, fps, transition.durationInFrames, transition.bezierPoints]
  );

  // Apply styles directly to DOM each frame (bypasses React for performance)
  useEffect(() => {
    if (!containerRef.current || frame < 0) return;

    const index = Math.max(0, Math.min(frame, easingCurve.length - 1));
    const progress = easingCurve[index] ?? 0;

    const styles = calculateTransitionStyles(
      transition,
      progress,
      isOutgoing,
      canvasWidth,
      canvasHeight
    );

    const el = containerRef.current;

    // Opacity — default to fully visible if transition doesn't set it
    el.style.opacity = styles.opacity !== undefined ? String(styles.opacity) : '1';

    // Transform — fall back to translateZ(0) for GPU compositing layer
    if (styles.transform !== undefined && styles.transform !== 'none') {
      el.style.transform = styles.transform;
    } else {
      el.style.transform = 'translateZ(0)';
    }

    // Clip-path
    if (styles.clipPath !== undefined && styles.clipPath !== 'none') {
      el.style.clipPath = styles.clipPath;
      (el.style as any).webkitClipPath = styles.clipPath;
    } else {
      el.style.clipPath = '';
      (el.style as any).webkitClipPath = '';
    }

    // Mask image (for clock wipe, iris, heart, star, diamond, etc.)
    if (styles.maskImage !== undefined) {
      el.style.maskImage = styles.maskImage;
      el.style.webkitMaskImage = styles.maskImage;
      el.style.maskSize = '100% 100%';
      (el.style as any).webkitMaskSize = '100% 100%';
    } else {
      el.style.maskImage = '';
      el.style.webkitMaskImage = '';
    }
  }, [frame, easingCurve, transition, isOutgoing, canvasWidth, canvasHeight]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex,
        willChange: 'opacity, transform, clip-path',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
      }}
    >
      {children}
    </div>
  );
});

// ============================================================================
// Main Transition Renderer
// ============================================================================

export const OptimizedEffectsBasedTransitionRenderer = React.memo<OptimizedTransitionProps>(
  function OptimizedEffectsBasedTransitionRenderer({
    transition,
    leftClip,
    rightClip,
    adjustmentLayers,
  }) {
    const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig();

    // Calculate where the transition sits in the global timeline
    const cutPoint = leftClip.from + leftClip.durationInFrames;
    const alignment = transition.alignment ?? 0.5;
    const leftPortion = Math.floor(transition.durationInFrames * alignment);
    const transitionStart = cutPoint - leftPortion;
    const premountFrames = Math.round(fps * 2);
    const effectsZIndex = Math.max(leftClip.zIndex, rightClip.zIndex) + 200;

    // Global frame offsets for ClipContent's adjustment layer calculations
    // Both use transitionStart since localFrame + transitionStart = actual global frame
    const leftClipGlobalFrom = transitionStart;
    const rightClipGlobalFrom = transitionStart;

    return (
      <Sequence
        from={transitionStart}
        durationInFrames={transition.durationInFrames}
        premountFor={premountFrames}
      >
        <AbsoluteFill
          style={{
            zIndex: effectsZIndex,
            visibility: leftClip.trackVisible && rightClip.trackVisible ? 'visible' : 'hidden',
          }}
        >
          {/* Incoming clip (below outgoing) */}
          {/* frameOffset=leftPortion: freeze at first frame until the cut point,
              then advance in sync with the normal right clip */}
          <TransitionOverlay
            transition={transition}
            isOutgoing={false}
            zIndex={1}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            fps={fps}
          >
            <ClipContent
              clip={rightClip}
              poolItemId={`t-${transition.id}-right`}
              sourceStartOffset={0}
              videoFrameOffset={leftPortion}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              fps={fps}
              adjustmentLayers={adjustmentLayers}
              clipGlobalFrom={rightClipGlobalFrom}
            />
          </TransitionOverlay>

          {/* Outgoing clip (above incoming, gets faded/wiped/slid away) */}
          {/* Offset into source so the outgoing clip plays its last N frames
              across the full transition duration */}
          <TransitionOverlay
            transition={transition}
            isOutgoing={true}
            zIndex={2}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            fps={fps}
          >
            <ClipContent
              clip={leftClip}
              poolItemId={`t-${transition.id}-left`}
              sourceStartOffset={leftClip.durationInFrames - transition.durationInFrames}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              fps={fps}
              adjustmentLayers={adjustmentLayers}
              clipGlobalFrom={leftClipGlobalFrom}
            />
          </TransitionOverlay>
        </AbsoluteFill>
      </Sequence>
    );
  }
);

// ============================================================================
// Container for All Transitions
// ============================================================================

export const OptimizedEffectsBasedTransitionsLayer = React.memo<{
  transitions: Transition[];
  itemsById: Map<string, EnrichedVisualItem>;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
}>(function OptimizedEffectsBasedTransitionsLayer({
  transitions,
  itemsById,
  adjustmentLayers,
}) {
  if (transitions.length === 0) return null;

  return (
    <>
      {transitions.map((transition) => {
        const leftClip = itemsById.get(transition.leftClipId);
        const rightClip = itemsById.get(transition.rightClipId);

        if (!leftClip || !rightClip) return null;

        return (
          <OptimizedEffectsBasedTransitionRenderer
            key={transition.id}
            transition={transition}
            leftClip={leftClip}
            rightClip={rightClip}
            adjustmentLayers={adjustmentLayers}
          />
        );
      })}
    </>
  );
});

// ============================================================================
// Backward Compatibility Exports
// ============================================================================

export const EffectsBasedTransitionRenderer = OptimizedEffectsBasedTransitionRenderer;
export const EffectsBasedTransitionsLayer = OptimizedEffectsBasedTransitionsLayer;
