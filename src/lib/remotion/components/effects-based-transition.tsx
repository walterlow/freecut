import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, Sequence, OffthreadVideo, Img, interpolate, useVideoConfig } from 'remotion';
import type { VideoItem, ImageItem } from '@/types/timeline';
import type { Transition, WipeDirection, SlideDirection, FlipDirection } from '@/types/transition';
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
import type { GlitchEffect } from '@/types/effects';

/**
 * Enriched visual item with track metadata (same as main-composition)
 */
type EnrichedVisualItem = (VideoItem | ImageItem) & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

interface EffectsBasedTransitionProps {
  /** Transition configuration */
  transition: Transition;
  /** Left clip (outgoing) */
  leftClip: EnrichedVisualItem;
  /** Right clip (incoming) */
  rightClip: EnrichedVisualItem;
}

/**
 * Calculate opacity for fade presentation using equal-power crossfade
 */
function getFadeOpacity(progress: number, isOutgoing: boolean): number {
  if (isOutgoing) {
    return Math.cos(progress * Math.PI / 2);
  } else {
    return Math.sin(progress * Math.PI / 2);
  }
}

/**
 * Calculate clip-path for wipe presentation
 */
function getWipeClipPath(progress: number, direction: WipeDirection, isOutgoing: boolean): string {
  const effectiveProgress = isOutgoing ? progress : 1 - progress;

  // inset(top right bottom left) - clips inward from each edge
  // "from-left" means wipe edge moves left→right, so clip the LEFT side of outgoing
  switch (direction) {
    case 'from-left':
      // Wipe from left: outgoing clips from left, incoming reveals from left
      return isOutgoing
        ? `inset(0 0 0 ${effectiveProgress * 100}%)`
        : `inset(0 ${effectiveProgress * 100}% 0 0)`;
    case 'from-right':
      // Wipe from right: outgoing clips from right, incoming reveals from right
      return isOutgoing
        ? `inset(0 ${effectiveProgress * 100}% 0 0)`
        : `inset(0 0 0 ${effectiveProgress * 100}%)`;
    case 'from-top':
      // Wipe from top: outgoing clips from top, incoming reveals from top
      return isOutgoing
        ? `inset(${effectiveProgress * 100}% 0 0 0)`
        : `inset(0 0 ${effectiveProgress * 100}% 0)`;
    case 'from-bottom':
      // Wipe from bottom: outgoing clips from bottom, incoming reveals from bottom
      return isOutgoing
        ? `inset(0 0 ${effectiveProgress * 100}% 0)`
        : `inset(${effectiveProgress * 100}% 0 0 0)`;
    default:
      return 'none';
  }
}

/**
 * Calculate transform for slide presentation
 * Uses canvas pixel dimensions to ensure slides align with actual canvas boundaries
 */
function getSlideTransform(
  progress: number,
  direction: SlideDirection,
  isOutgoing: boolean,
  canvasWidth: number,
  canvasHeight: number
): string {
  const slideProgress = isOutgoing ? progress : progress - 1;

  switch (direction) {
    case 'from-left':
      return `translateX(${slideProgress * canvasWidth}px)`;
    case 'from-right':
      return `translateX(${-slideProgress * canvasWidth}px)`;
    case 'from-top':
      return `translateY(${slideProgress * canvasHeight}px)`;
    case 'from-bottom':
      return `translateY(${-slideProgress * canvasHeight}px)`;
    default:
      return 'none';
  }
}

/**
 * Calculate transform for flip presentation
 */
function getFlipTransform(progress: number, direction: FlipDirection, isOutgoing: boolean): string {
  const flipDegrees = isOutgoing
    ? interpolate(progress, [0, 1], [0, 90])
    : interpolate(progress, [0, 1], [-90, 0]);

  const axis = (direction === 'from-left' || direction === 'from-right') ? 'Y' : 'X';
  const sign = (direction === 'from-right' || direction === 'from-bottom') ? -1 : 1;

  return `perspective(1000px) rotate${axis}(${sign * flipDegrees}deg)`;
}

/**
 * Calculate conic-gradient mask for clock wipe presentation
 * Creates a sweeping reveal like a clock hand moving clockwise from 12 o'clock
 */
function getClockWipeMask(progress: number, isOutgoing: boolean): string {
  // Clock wipe sweeps clockwise from 12 o'clock (top)
  // For outgoing: transparent area expands clockwise, hiding the clip
  const degrees = progress * 360;

  // In CSS conic-gradient:
  // - from 0deg = 12 o'clock (top)
  // - gradient goes clockwise by default
  // Transparent part expands clockwise from 12 o'clock
  // At progress=0: all black (fully visible)
  // At progress=1: all transparent (fully hidden)
  return `conic-gradient(from 0deg, transparent ${degrees}deg, black ${degrees}deg)`;
}

/**
 * Calculate radial-gradient mask for iris presentation
 * Creates a circular hole expanding from center, revealing the clip underneath
 */
function getIrisMask(progress: number, isOutgoing: boolean): string {
  // Iris: hole expands from center outward
  // For radial-gradient with 'circle', percentage is relative to the smaller dimension
  // To cover corners of a 16:9 frame, we need ~118% (sqrt(1 + (16/9)^2) / 2 ≈ 1.18)
  // Use 120% to ensure full coverage on any aspect ratio
  const maxRadius = 120;

  // For outgoing clip: hole (transparent) expands from center
  // At progress=0: no hole (fully visible)
  // At progress=1: full hole (fully hidden, corners included)
  const radius = progress * maxRadius;

  // Transparent in center (hole), black at edges (visible)
  return `radial-gradient(circle, transparent ${radius}%, black ${radius}%)`;
}

/**
 * Render a clip's video/image content using Remotion's proper playback
 * This component plays video continuously rather than seeking per frame
 * Applies the clip's transform AND ALL effects to match normal rendering:
 * - CSS filter effects (brightness, contrast, saturation, etc.)
 * - Glitch effects (color shift filter + scanlines overlay)
 * - Halftone effect (pattern overlay)
 * - Vignette effect (radial gradient overlay)
 */
const ClipContent: React.FC<{
  clip: EnrichedVisualItem;
  /** Optional offset to apply to sourceStart (in frames) */
  sourceStartOffset?: number;
  /** Canvas dimensions for transform calculation */
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}> = ({ clip, sourceStartOffset = 0, canvasWidth, canvasHeight, fps }) => {
  const frame = useCurrentFrame();

  // Resolve the clip's transform to match normal rendering
  const canvas = { width: canvasWidth, height: canvasHeight, fps };
  const sourceDimensions = getSourceDimensions(clip);
  const resolved = resolveTransform(clip, canvas, sourceDimensions);
  const transformStyle = toTransformStyle(resolved, canvas);

  // Compute all effect types from clip's effects
  const effects = clip.effects ?? [];

  // CSS filter effects (brightness, contrast, etc.)
  const cssFilterString = useMemo(() => {
    if (effects.length === 0) return '';
    return effectsToCSSFilter(effects);
  }, [effects]);

  // Glitch effects (for color shift filter + scanlines)
  const glitchEffects = useMemo(() => {
    if (effects.length === 0) return [];
    return getGlitchEffects(effects) as Array<GlitchEffect & { id: string }>;
  }, [effects]);

  // Glitch filter string (color glitch adds hue-rotate)
  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, frame);
  }, [glitchEffects, frame]);

  // Combined CSS filter
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Scanlines effect (overlay)
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // Halftone effect (pattern overlay)
  const halftoneEffect = useMemo(() => {
    if (effects.length === 0) return null;
    return getHalftoneEffect(effects);
  }, [effects]);

  const halftoneStyles = useMemo(() => {
    if (!halftoneEffect) return null;
    return getHalftoneStyles(halftoneEffect);
  }, [halftoneEffect]);

  // Merge halftone container filter with other filters
  const finalFilter = halftoneStyles
    ? [combinedFilter, halftoneStyles.containerStyle.filter].filter(Boolean).join(' ')
    : combinedFilter;

  // Vignette effect (radial gradient overlay)
  const vignetteEffect = useMemo(() => {
    if (effects.length === 0) return null;
    return getVignetteEffect(effects);
  }, [effects]);

  const vignetteStyle = useMemo(() => {
    if (!vignetteEffect) return null;
    return getVignetteStyle(vignetteEffect);
  }, [vignetteEffect]);

  // Check if any overlay effects are active
  const hasOverlays = scanlinesEffect || halftoneStyles || vignetteStyle;

  // Render the media content (video or image)
  let mediaContent: React.ReactNode = null;

  if (clip.type === 'video') {
    const videoClip = clip as VideoItem;

    // Guard against missing src - can happen during clip loading/removal
    if (!videoClip.src) {
      return null;
    }

    const baseSourceStart = videoClip.sourceStart ?? videoClip.trimStart ?? videoClip.offset ?? 0;
    const rawAdjustedStart = baseSourceStart + sourceStartOffset;

    // When we can't go earlier than source start (rawAdjustedStart < 0),
    // use CSS mirror effect like CapCut does for smooth visual transition
    const needsMirror = rawAdjustedStart < 0;
    const sourceStart = Math.max(0, rawAdjustedStart);
    const playbackRate = videoClip.speed ?? 1;

    // Combine transform style with mirror if needed
    const combinedTransform = needsMirror
      ? `${transformStyle.transform || ''} scaleX(-1)`.trim()
      : transformStyle.transform;

    mediaContent = (
      <div
        style={{
          ...transformStyle,
          transform: combinedTransform || undefined,
          overflow: 'hidden',
        }}
      >
        <OffthreadVideo
          src={videoClip.src}
          startFrom={sourceStart}
          playbackRate={playbackRate}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          // Ensure no audio from effects layer - audio is handled separately
          muted={true}
          volume={0}
        />
      </div>
    );
  } else if (clip.type === 'image') {
    const imageClip = clip as ImageItem;

    // Guard against missing src
    if (!imageClip.src) {
      return null;
    }

    mediaContent = (
      <div style={{ ...transformStyle, overflow: 'hidden' }}>
        <Img
          src={imageClip.src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>
    );
  }

  if (!mediaContent) return null;

  // Wrap media content with effects layer
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

      {/* Overlay effects container */}
      {hasOverlays && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {/* Scanlines overlay */}
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

          {/* Halftone pattern overlay */}
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

          {/* Vignette overlay - renders on top */}
          {vignetteStyle && <div style={vignetteStyle} />}
        </div>
      )}
    </div>
  );
};

/**
 * Transition overlay that applies visual effects
 * This component uses useCurrentFrame but only for styling, not for video seeking
 *
 * Performance optimizations:
 * - Uses GPU-accelerated properties (opacity, transform)
 * - Uses will-change hint for better compositing
 * - Avoids layout-triggering properties where possible
 */
const TransitionOverlay: React.FC<{
  transition: Transition;
  isOutgoing: boolean;
  children: React.ReactNode;
  zIndex: number;
  canvasWidth: number;
  canvasHeight: number;
}> = ({ transition, isOutgoing, children, zIndex, canvasWidth, canvasHeight }) => {
  const frame = useCurrentFrame();
  // frame is already local to the parent Sequence (0 to durationInFrames - 1)
  // To get full 0-1 range, divide by (duration - 1) so last frame = 1.0
  const maxFrame = Math.max(1, transition.durationInFrames - 1);
  const progress = Math.max(0, Math.min(1, frame / maxFrame));

  const presentation = transition.presentation;
  const direction = transition.direction;

  // Calculate styles based on presentation type
  // Prioritize GPU-accelerated properties: opacity, transform
  //
  // For reveal-style transitions (wipe, clockWipe, iris):
  // - Only the OUTGOING clip gets the mask effect
  // - The INCOMING clip sits underneath at full opacity, getting revealed
  //
  // For blend-style transitions (fade, slide, flip):
  // - Both clips get animated (opacity or transform)
  const getStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex,
      // GPU acceleration hints
      willChange: 'opacity, transform',
      transform: 'translateZ(0)',
      backfaceVisibility: 'hidden',
    };

    switch (presentation) {
      case 'fade':
        // Both clips fade (crossfade)
        return {
          ...baseStyle,
          opacity: getFadeOpacity(progress, isOutgoing),
        };

      case 'wipe':
        // Reveal-style: only outgoing gets clipped, incoming is full opacity underneath
        if (isOutgoing) {
          return {
            ...baseStyle,
            clipPath: getWipeClipPath(progress, direction as WipeDirection || 'from-left', true),
            WebkitClipPath: getWipeClipPath(progress, direction as WipeDirection || 'from-left', true),
          };
        }
        // Incoming clip: full opacity, sits below outgoing
        return baseStyle;

      case 'slide':
        // Both clips slide - use canvas dimensions for proper alignment
        return {
          ...baseStyle,
          transform: `translateZ(0) ${getSlideTransform(progress, direction as SlideDirection || 'from-left', isOutgoing, canvasWidth, canvasHeight)}`,
        };

      case 'flip':
        // Both clips flip
        return {
          ...baseStyle,
          transform: getFlipTransform(progress, direction as FlipDirection || 'from-left', isOutgoing),
        };

      case 'none':
        // Hard cut at midpoint
        return {
          ...baseStyle,
          opacity: isOutgoing ? (progress < 0.5 ? 1 : 0) : (progress >= 0.5 ? 1 : 0),
        };

      case 'clockWipe':
        // Reveal-style: only outgoing gets masked
        if (isOutgoing) {
          return {
            ...baseStyle,
            maskImage: getClockWipeMask(progress, true),
            WebkitMaskImage: getClockWipeMask(progress, true),
            maskSize: '100% 100%',
            WebkitMaskSize: '100% 100%',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          };
        }
        // Incoming clip: full opacity, sits below outgoing
        return baseStyle;

      case 'iris':
        // Reveal-style: only outgoing gets masked
        if (isOutgoing) {
          return {
            ...baseStyle,
            maskImage: getIrisMask(progress, true),
            WebkitMaskImage: getIrisMask(progress, true),
            maskSize: '100% 100%',
            WebkitMaskSize: '100% 100%',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          };
        }
        // Incoming clip: full opacity, sits below outgoing
        return baseStyle;

      default:
        return {
          ...baseStyle,
          opacity: getFadeOpacity(progress, isOutgoing),
        };
    }
  };

  return <div style={getStyle()}>{children}</div>;
};

/**
 * Effects-Based Transition Renderer
 *
 * Renders a visual transition effect WITHOUT repositioning clips or changing timeline duration.
 * Uses Remotion's Sequence for proper video playback timing instead of manual frame seeking.
 *
 * Transition is centered on the cut point:
 * - First half plays during the end of the left clip's timeline region
 * - Second half plays during the start of the right clip's timeline region
 *
 * Performance optimization:
 * - Videos play continuously within their Sequences (no per-frame seeking)
 * - Only CSS styles update per frame (opacity, clip-path, transforms)
 * - Clips are premounted slightly before transition for smoother playback
 */
export const EffectsBasedTransitionRenderer = React.memo<EffectsBasedTransitionProps>(function EffectsBasedTransitionRenderer({
  transition,
  leftClip,
  rightClip,
}) {
  // Get canvas dimensions for transform calculations
  const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig();

  // Calculate transition timing - transition is centered on cut point (half in, half out)
  const cutPoint = leftClip.from + leftClip.durationInFrames;
  const halfDuration = Math.floor(transition.durationInFrames / 2);
  const transitionStart = cutPoint - halfDuration;

  // Premount buffer for smoother video loading (about 1 second at 30fps)
  const premountFrames = 30;

  // Use higher z-index to ensure effects layer covers normal clips during transition
  const effectsZIndex = Math.max(leftClip.zIndex, rightClip.zIndex) + 2000;

  // Calculate left clip's content offset to show its ending frames during transition
  // We want to show the last `durationInFrames` frames of the left clip
  const leftClipContentOffset = -(leftClip.durationInFrames - transition.durationInFrames);

  // Right clip sourceStart offset to align with normal rendering after transition ends.
  // Without this offset, transition shows frames 0 to (durationInFrames-1), then normal
  // rendering jumps back to frame halfDuration, causing visible frame repetition.
  // With the offset, transition shows frames that lead into where normal rendering continues.
  const rightClipSourceOffset = -halfDuration;

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
        {/* Opaque background to cover underlying normal clip renders */}
        {/* This ensures the transition effect is the only thing visible during transition */}
        <AbsoluteFill style={{ backgroundColor: '#000' }} />

        {/* Incoming clip (right) - sits at bottom, gets revealed */}
        {/* Uses sourceStartOffset so frames align with normal rendering after transition */}
        <TransitionOverlay
          transition={transition}
          isOutgoing={false}
          zIndex={1}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        >
          <Sequence
            from={0}
            durationInFrames={transition.durationInFrames}
          >
            <ClipContent clip={rightClip} sourceStartOffset={rightClipSourceOffset} canvasWidth={canvasWidth} canvasHeight={canvasHeight} fps={fps} />
          </Sequence>
        </TransitionOverlay>

        {/* Outgoing clip (left) - sits on top, gets wiped/faded away */}
        {/* Renders for full transition duration, offset to show left clip's end portion */}
        <TransitionOverlay
          transition={transition}
          isOutgoing={true}
          zIndex={2}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        >
          <Sequence
            from={leftClipContentOffset}
            durationInFrames={transition.durationInFrames + Math.abs(leftClipContentOffset)}
          >
            <ClipContent clip={leftClip} canvasWidth={canvasWidth} canvasHeight={canvasHeight} fps={fps} />
          </Sequence>
        </TransitionOverlay>
      </AbsoluteFill>
    </Sequence>
  );
});

/**
 * Container for all transitions
 * Renders each transition as a visual effect independently
 */
export const EffectsBasedTransitionsLayer = React.memo<{
  transitions: Transition[];
  itemsById: Map<string, EnrichedVisualItem>;
}>(function EffectsBasedTransitionsLayer({ transitions, itemsById }) {
  if (transitions.length === 0) return null;

  return (
    <>
      {transitions.map((transition) => {
        const leftClip = itemsById.get(transition.leftClipId);
        const rightClip = itemsById.get(transition.rightClipId);

        // Skip if either clip is missing
        if (!leftClip || !rightClip) return null;

        return (
          <EffectsBasedTransitionRenderer
            key={transition.id}
            transition={transition}
            leftClip={leftClip}
            rightClip={rightClip}
          />
        );
      })}
    </>
  );
});
