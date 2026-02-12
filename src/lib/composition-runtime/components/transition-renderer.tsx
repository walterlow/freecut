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
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
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
import { resolveTransitionWindows, type ResolvedTransitionWindow } from '@/lib/transitions/transition-planner';

// ============================================================================
// Types
// ============================================================================

interface AdjustmentLayerWithTrackOrder {
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
  window: ResolvedTransitionWindow;
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
}

const NativeTransitionVideo: React.FC<NativeTransitionVideoProps> = ({
  poolItemId,
  src,
  sourceStart,
  playbackRate,
  fps,
  containerRef,
}) => {
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const pool = useVideoSourcePool();
  const isPlaying = useIsPlaying();
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);

  // Transition clips should advance continuously across the overlap window.
  const advancingFrame = Math.max(0, frame);
  const targetTime = (sourceStart / fps) + (advancingFrame * playbackRate / fps);

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

    // During premount (frame < 0), seek to target and stay paused.
    if (frame < 0) {
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
      const needsSync = needsInitialSyncRef.current
        || (videoBehind && timeSinceLastSync > 500);

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
  }, [frame, playbackRate, targetTime, sourceStart, fps, isPlaying]);

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
    const playbackRate = clip.speed ?? 1;
    const sourceFrameOffset = Math.round(sourceStartOffset * playbackRate);
    const sourceStart = Math.max(0, baseSourceStart + sourceFrameOffset);

    mediaContent = (
      <div ref={videoContainerRef} style={{ ...transformStyle, overflow: 'hidden', position: 'relative' }}>
        <NativeTransitionVideo
          poolItemId={poolItemId}
          src={clip.src}
          sourceStart={sourceStart}
          playbackRate={playbackRate}
          fps={fps}
          containerRef={videoContainerRef}
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
  durationInFrames: number;
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
  durationInFrames,
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
        durationInFrames,
        bezierPoints: transition.bezierPoints,
      }),
    [transition.timing, fps, durationInFrames, transition.bezierPoints]
  );

  // Apply styles directly to DOM each frame (bypasses React for performance)
  useEffect(() => {
    if (!containerRef.current || frame < 0) return;

    // localFrame can be fractional if a transition window starts on a non-integer frame.
    // Easing arrays are integer-indexed, so quantize before indexing.
    const frameIndex = Math.floor(Number.isFinite(frame) ? frame : 0);
    const index = Math.max(0, Math.min(frameIndex, easingCurve.length - 1));
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
      el.style.setProperty('-webkit-clip-path', styles.clipPath);
    } else {
      el.style.clipPath = '';
      el.style.setProperty('-webkit-clip-path', '');
    }

    // Mask image (for clock wipe, iris, heart, star, diamond, etc.)
    if (styles.maskImage !== undefined) {
      el.style.maskImage = styles.maskImage;
      el.style.webkitMaskImage = styles.maskImage;
      el.style.maskSize = '100% 100%';
      el.style.setProperty('-webkit-mask-size', '100% 100%');
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
// Transition Background (for flip etc. — only visible during active frames)
// ============================================================================

const transitionBgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundColor: '#000',
  zIndex: 0,
};

/**
 * Solid background behind transitions where clips don't cover the full frame
 * mid-transition (e.g. flip). Only renders when localFrame >= 0 so it stays
 * hidden during the premount window and doesn't black out clips before the
 * transition starts.
 */
const TransitionBackground: React.FC = () => {
  const ctx = useSequenceContext();
  if (!ctx || ctx.localFrame < 0) return null;
  return <div style={transitionBgStyle} />;
};

// ============================================================================
// Main Transition Renderer
// ============================================================================

const OptimizedEffectsBasedTransitionRenderer = React.memo<OptimizedTransitionProps>(
  function OptimizedEffectsBasedTransitionRenderer({
    window,
    leftClip,
    rightClip,
    adjustmentLayers,
  }) {
    const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig();

    const premountFrames = Math.round(fps * 2);
    const effectsZIndex = Math.max(leftClip.zIndex, rightClip.zIndex) + 200;

    // Flip transitions scale clips to edge-on mid-transition, exposing uncovered
    // area. A solid background prevents the underlying regular clips from bleeding
    // through, matching the canvas-based export where the composition background
    // is visible behind the flipping clip. Rendered as a child (not on the
    // AbsoluteFill) so it's hidden during premount when frame < 0.
    const needsBackground = window.transition.presentation === 'flip';

    // Global frame offsets for ClipContent's adjustment layer calculations
    // Both use startFrame since localFrame + startFrame = actual global frame
    const leftClipGlobalFrom = window.startFrame;
    const rightClipGlobalFrom = window.startFrame;

    return (
      <Sequence
        from={window.startFrame}
        durationInFrames={window.durationInFrames}
        premountFor={premountFrames}
      >
        <AbsoluteFill
          style={{
            zIndex: effectsZIndex,
            visibility: leftClip.trackVisible && rightClip.trackVisible ? 'visible' : 'hidden',
          }}
        >
          {needsBackground && <TransitionBackground />}
          {/* Incoming clip (below outgoing) */}
          <TransitionOverlay
            transition={window.transition}
            durationInFrames={window.durationInFrames}
            isOutgoing={false}
            zIndex={1}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            fps={fps}
          >
            <ClipContent
              clip={rightClip}
              poolItemId={`t-${window.transition.id}-right`}
              sourceStartOffset={window.startFrame - rightClip.from}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              fps={fps}
              adjustmentLayers={adjustmentLayers}
              clipGlobalFrom={rightClipGlobalFrom}
            />
          </TransitionOverlay>

          {/* Outgoing clip (above incoming, gets faded/wiped/slid away) */}
          {/* Both overlap clips are aligned to timeline chronology at window.startFrame. */}
          <TransitionOverlay
            transition={window.transition}
            durationInFrames={window.durationInFrames}
            isOutgoing={true}
            zIndex={2}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            fps={fps}
          >
            <ClipContent
              clip={leftClip}
              poolItemId={`t-${window.transition.id}-left`}
              sourceStartOffset={window.startFrame - leftClip.from}
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

  const resolvedWindows = useMemo(() => {
    return resolveTransitionWindows(transitions, itemsById);
  }, [transitions, itemsById]);

  return (
    <>
      {resolvedWindows.map((window) => {
        const leftClip = itemsById.get(window.transition.leftClipId);
        const rightClip = itemsById.get(window.transition.rightClipId);

        if (!leftClip || !rightClip) return null;

        return (
          <OptimizedEffectsBasedTransitionRenderer
            key={window.transition.id}
            window={window}
            leftClip={leftClip}
            rightClip={rightClip}
            adjustmentLayers={adjustmentLayers}
          />
        );
      })}
    </>
  );
});

