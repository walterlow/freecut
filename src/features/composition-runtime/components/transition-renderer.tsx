/**
 * Effects-Based Transition Renderer
 *
 * Renders transitions between adjacent clips using per-frame style calculations.
 * Uses a single outer Sequence for visibility and frame context, with direct
 * DOM style manipulation for GPU-accelerated animation without React re-renders.
 *
 * Architecture:
 *   Sequence (from=transitionStart, duration=transitionDuration)
 *     â””â”€ AbsoluteFill (z-index above both clips)
 *         â”œâ”€ TransitionOverlay (incoming, z:1) â€” applies incoming styles
 *         â”‚   â””â”€ ClipContent (rightClip)
 *         â””â”€ TransitionOverlay (outgoing, z:2) â€” applies outgoing styles
 *             â””â”€ ClipContent (leftClip, offset to show last N frames)
 *
 * The outer Sequence provides:
 *   - Visibility control (only renders during transition window)
 *   - localFrame 0..durationInFrames used by TransitionOverlay for progress
 *
 * TransitionOverlay applies transition styles (opacity, transform, clipPath,
 * mask) directly to its container div via useLayoutEffect, avoiding post-paint
 * boundary flicker in preview playback.
 */

import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { AbsoluteFill, Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { useVideoSourcePool } from '@/features/composition-runtime/deps/player';
import type { VideoItem, ImageItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { resolveTransform, toTransformStyle, getSourceDimensions } from '../utils/transform-resolver';
import { calculateEasingCurve, calculateTransitionStyles } from '@/domain/timeline/transitions/engine';
import { resolveTransitionWindows, type ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import { useCompositionSpace } from '../contexts/composition-space-context';

// ============================================================================
// Types
// ============================================================================

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
}

// ============================================================================
// Native Video Component â€” uses VideoSourcePool for pre-loaded playback
// ============================================================================

interface NativeTransitionVideoProps {
  /** Unique ID for pool acquisition (e.g., `t-${transitionId}-left`) */
  poolItemId: string;
  src: string;
  sourceStart: number;
  sourceFps: number;
  playbackRate: number;
  fps: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Detect requestVideoFrameCallback support once.
 */
const supportsRVFC = typeof HTMLVideoElement !== 'undefined'
  && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

const NativeTransitionVideo: React.FC<NativeTransitionVideoProps> = ({
  poolItemId,
  src,
  sourceStart,
  sourceFps,
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

  // Stable refs for rVFC callback (avoids stale closures)
  const sourceStartRef = useRef(sourceStart);
  const sourceFpsRef = useRef(sourceFps);
  const playbackRateRef = useRef(playbackRate);
  const fpsRef = useRef(fps);
  sourceStartRef.current = sourceStart;
  sourceFpsRef.current = sourceFps;
  playbackRateRef.current = playbackRate;
  fpsRef.current = fps;

  // Transition clips should advance continuously across the overlap window.
  const advancingFrame = Math.max(0, frame);
  const targetTime = (sourceStart / sourceFps) + (advancingFrame * playbackRate / fps);

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
    const initialTime = sourceStart / sourceFps;
    const clampedTime = Math.min(initialTime, (element.duration || Infinity) - 0.05);
    element.currentTime = Math.max(0, clampedTime);

    // Force a frame render — some browsers need play/pause after seek
    let forceFrameTimer: ReturnType<typeof setTimeout> | null = null;
    const forceFrameRender = () => {
      if (elementRef.current !== element) return;
      if (element.paused && element.readyState >= 2) {
        element.play().then(() => {
          if (elementRef.current === element) {
            element.pause();
          }
        }).catch(() => {
          // Autoplay blocked — fine for muted transition video
        });
      }
    };
    forceFrameTimer = setTimeout(forceFrameRender, 100);

    return () => {
      if (forceFrameTimer !== null) {
        clearTimeout(forceFrameTimer);
        forceFrameTimer = null;
      }
      element.pause();
      if (element.parentElement) {
        element.parentElement.removeChild(element);
      }
      pool.releaseClip(poolItemId);
      elementRef.current = null;
    };
    // Only re-acquire when identity changes, not on every frame
  }, [poolItemId, src, pool, containerRef]);

  // Layout-phase sync: immediate seeks before paint to avoid stale frames
  // at transition boundaries. Matches NativePreviewVideo's approach.
  useLayoutEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    video.playbackRate = playbackRate;

    const canSeek = video.readyState >= 1;
    const videoDuration = video.duration || Infinity;
    const clampedTargetTime = Math.min(Math.max(0, targetTime), videoDuration - 0.05);

    if (!canSeek) return;

    // During premount (frame < 0), seek to target and stay paused.
    if (frame < 0) {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - clampedTargetTime) > 0.016) {
        video.currentTime = clampedTargetTime;
      }
      return;
    }

    // Immediate seek on initial sync or scrub (before paint)
    const mustHardSync = needsInitialSyncRef.current;
    if (mustHardSync || (!isPlaying && Math.abs(video.currentTime - clampedTargetTime) > 0.016)) {
      try {
        video.currentTime = clampedTargetTime;
        lastSyncTimeRef.current = Date.now();
        if (mustHardSync) {
          needsInitialSyncRef.current = false;
        }
      } catch {
        // Seek failed
      }
    }
  }, [frame, playbackRate, targetTime, isPlaying]);

  // Runtime sync: playback control + drift correction
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    video.playbackRate = playbackRate;

    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    const canSeek = video.readyState >= 1;
    const videoDuration = video.duration || Infinity;
    const clampedTargetTime = Math.min(Math.max(0, targetTime), videoDuration - 0.05);

    // During premount, stay paused
    if (frame < 0) {
      if (!video.paused) video.pause();
      return;
    }

    if (isPlaying) {
      // Initial sync always needed
      if (needsInitialSyncRef.current && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
          lastSyncTimeRef.current = Date.now();
          needsInitialSyncRef.current = false;
        } catch {
          // Seek failed
        }
      }

      // React-based drift correction (fallback when rVFC unavailable)
      if (!supportsRVFC) {
        const drift = video.currentTime - clampedTargetTime;
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTimeRef.current;

        const videoBehind = drift < -0.1;
        const videoFarAhead = drift > 0.3;
        if ((videoFarAhead || (videoBehind && timeSinceLastSync > 80)) && canSeek) {
          try {
            video.currentTime = clampedTargetTime;
            lastSyncTimeRef.current = now;
          } catch {
            // Seek failed
          }
        }
      }

      // Play if paused and decoder has buffered ahead (HAVE_FUTURE_DATA)
      if (video.paused && video.readyState >= 3) {
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
        if (Math.abs(video.currentTime - clampedTargetTime) > 0.016) {
          try {
            video.currentTime = clampedTargetTime;
          } catch {
            // Seek failed
          }
        }
      }
    }
  }, [frame, playbackRate, targetTime, sourceStart, sourceFps, fps, isPlaying]);

  // requestVideoFrameCallback-based drift correction.
  // Runs outside React's render cycle — the browser calls us exactly when a
  // video frame is presented, so we can nudge currentTime with minimal overhead.
  useEffect(() => {
    const video = elementRef.current;
    if (!video || !isPlaying || !supportsRVFC) return;

    let handle: number;
    const onVideoFrame = () => {
      const v = elementRef.current;
      if (!v) return;

      const now = Date.now();
      const timeSinceLastSync = now - lastSyncTimeRef.current;
      const sr = sourceStartRef.current;
      const sf = sourceFpsRef.current;
      const pr = playbackRateRef.current;
      const fp = fpsRef.current;

      // Approximate current local frame from the video's currentTime
      const currentVideoTime = v.currentTime;
      const expectedTime = (sr / sf) + (Math.max(0, lastFrameRef.current) * pr / fp);

      const drift = currentVideoTime - expectedTime;
      const videoBehind = drift < -0.1;
      const videoFarAhead = drift > 0.3;

      if ((videoFarAhead || (videoBehind && timeSinceLastSync > 80)) && v.readyState >= 1) {
        try {
          v.currentTime = expectedTime;
          lastSyncTimeRef.current = now;
        } catch {
          // Seek failed
        }
      }

      handle = v.requestVideoFrameCallback(onVideoFrame);
    };

    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      video.cancelVideoFrameCallback(handle);
    };
  }, [isPlaying]);

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
  /** Override the clip's playback rate for this transition rendering.
   *  Used for the incoming clip to match the regular clip's position at
   *  the transition end, preventing a visible rewind/jump. */
  transitionPlaybackRate?: number;
  canvasWidth: number;
  canvasHeight: number;
  projectWidth: number;
  projectHeight: number;
  renderScaleX: number;
  renderScaleY: number;
  renderScale: number;
  fps: number;
}

const ClipContent: React.FC<ClipContentProps> = React.memo(function ClipContent({
  clip,
  poolItemId,
  sourceStartOffset = 0,
  transitionPlaybackRate,
  canvasWidth,
  canvasHeight,
  projectWidth,
  projectHeight,
  renderScaleX,
  renderScaleY,
  renderScale,
  fps,
}) {
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // During premount (frame < 0), we still render video elements so they can
  // acquire from the pool and seek to the correct position BEFORE the
  // transition becomes visible. Without this, the video element is only
  // acquired at frame 0, causing a flash while it loads/decodes.
  const isPremounted = frame < 0;

  const logicalCanvas = { width: projectWidth, height: projectHeight, fps };
  const renderCanvas = { width: canvasWidth, height: canvasHeight, fps };
  const sourceDimensions = getSourceDimensions(clip);
  const resolved = resolveTransform(clip, logicalCanvas, sourceDimensions);
  const scaledResolved = {
    ...resolved,
    x: resolved.x * renderScaleX,
    y: resolved.y * renderScaleY,
    width: resolved.width * renderScaleX,
    height: resolved.height * renderScaleY,
    cornerRadius: resolved.cornerRadius * renderScale,
  };
  const transformStyle = toTransformStyle(scaledResolved, renderCanvas);

  // Render media content
  let mediaContent: React.ReactNode = null;

  if (clip.type === 'video') {
    if (!clip.src) return null;

    const baseSourceStart = clip.sourceStart ?? clip.trimStart ?? clip.offset ?? 0;
    const sourceFps = clip.sourceFps ?? fps;
    const playbackRate = transitionPlaybackRate ?? (clip.speed ?? 1);
    // Use unrounded offset to match the regular clip's continuous
    // targetTime = trimBefore/fps + localFrame * speed / fps formula.
    const sourceFrameOffset = sourceStartOffset * playbackRate * (sourceFps / fps);
    const sourceStart = baseSourceStart + sourceFrameOffset;

    mediaContent = (
      <div ref={videoContainerRef} data-item-id={clip.id} style={{ ...transformStyle, overflow: 'hidden', position: 'relative' }}>
        <NativeTransitionVideo
          poolItemId={poolItemId}
          src={clip.src}
          sourceStart={sourceStart}
          sourceFps={sourceFps}
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
        // Hidden during premount â€” video elements still mount and pre-seek
        visibility: isPremounted ? 'hidden' : undefined,
      }}
    >
      {mediaContent}
    </div>
  );
});

// ============================================================================
// Transition Overlay â€” applies transition styles to its container
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
 * Styles are applied via useLayoutEffect so transition boundary frames are
 * committed before paint (prevents stale-frame flicker in preview).
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

  // Apply styles directly to DOM each frame before paint.
  // useEffect caused one-frame stale styles at transition boundaries in preview.
  useLayoutEffect(() => {
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

    // Opacity â€” default to fully visible if transition doesn't set it
    el.style.opacity = styles.opacity !== undefined ? String(styles.opacity) : '1';

    // Transform â€” fall back to translateZ(0) for GPU compositing layer
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
// Transition Background (for flip etc. â€” only visible during active frames)
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
  }) {
    const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig();
    const compositionSpace = useCompositionSpace();
    const projectWidth = compositionSpace?.projectWidth ?? canvasWidth;
    const projectHeight = compositionSpace?.projectHeight ?? canvasHeight;
    const renderScaleX = compositionSpace?.scaleX ?? 1;
    const renderScaleY = compositionSpace?.scaleY ?? 1;
    const renderScale = compositionSpace?.scale ?? 1;

    const premountFrames = Math.round(fps * 2);
    const effectsZIndex = Math.max(leftClip.zIndex, rightClip.zIndex) + 200;

    // Flip transitions scale clips to edge-on mid-transition, exposing uncovered
    // area. A solid background prevents the underlying regular clips from bleeding
    // through, matching the canvas-based export where the composition background
    // is visible behind the flipping clip. Rendered as a child (not on the
    // AbsoluteFill) so it's hidden during premount when frame < 0.
    const needsBackground = window.transition.presentation === 'flip';

    // In the overlap model, the right clip physically overlaps the left clip.
    // The transition overlay and regular Sequence both start at the same
    // timeline position, so no playback rate compensation is needed.
    const incomingTransitionRate = rightClip.speed ?? 1;
    // Player preview path guard frame at transition exit.
    // This renderer is only used by MainComposition in the player runtime.
    // Keeps the fully-resolved incoming overlay visible for one extra frame
    // to hide occasional decoder handoff flicker in the underlying base clip.
    const exitGuardFrames = 1;

    return (
      <Sequence
        from={window.startFrame}
        durationInFrames={window.durationInFrames + exitGuardFrames}
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
              sourceStartOffset={0}
              transitionPlaybackRate={incomingTransitionRate}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              projectWidth={projectWidth}
              projectHeight={projectHeight}
              renderScaleX={renderScaleX}
              renderScaleY={renderScaleY}
              renderScale={renderScale}
              fps={fps}
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
              projectWidth={projectWidth}
              projectHeight={projectHeight}
              renderScaleX={renderScaleX}
              renderScaleY={renderScaleY}
              renderScale={renderScale}
              fps={fps}
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
}>(function OptimizedEffectsBasedTransitionsLayer({
  transitions,
  itemsById,
}) {
  const resolvedWindows = useMemo(() => {
    return resolveTransitionWindows(transitions, itemsById);
  }, [transitions, itemsById]);

  if (resolvedWindows.length === 0) return null;

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
          />
        );
      })}
    </>
  );
});


