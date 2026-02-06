/**
 * Transition Preview Component
 * 
 * Real-time preview of transitions using CSS animations instead of per-frame JS calculations.
 * 
 * Performance optimizations:
 * - CSS animations are GPU-accelerated
 * - Pre-calculated keyframes eliminate JS overhead during playback
 * - No React re-renders during animation
 * - Uses CSS custom properties for dynamic values
 */

import React, { useMemo, useRef, useEffect } from 'react';
import type { Transition } from '@/types/transition';
import type { VideoItem, ImageItem } from '@/types/timeline';
import { calculateEasingCurve, calculateTransitionStyles } from './engine';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type TransitionPreviewItem = (VideoItem | ImageItem) & {
  src: string;
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
}

export interface TransitionPreviewProps {
  transition: Transition;
  leftClip: TransitionPreviewItem;
  rightClip: TransitionPreviewItem;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  /** Whether to auto-play the preview animation */
  autoPlay?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Additional CSS class */
  className?: string;
}

// ============================================================================
// Keyframe Generation
// ============================================================================

interface KeyframeStyles {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  maskImage?: string;
  webkitClipPath?: string;
  webkitMaskImage?: string;
}

interface GeneratedKeyframes {
  outgoing: KeyframeStyles[];
  incoming: KeyframeStyles[];
}

/**
 * Generate CSS keyframes for a transition.
 * Creates arrays of style objects that can be used with Web Animations API
 * or converted to CSS @keyframes.
 */
function generateTransitionKeyframes(
  transition: Transition,
  canvasWidth: number,
  canvasHeight: number,
  fps: number
): GeneratedKeyframes {
  const { durationInFrames, timing } = transition;
  
  // Get easing curve for all frames
  const easingCurve = calculateEasingCurve({
    timing,
    fps,
    durationInFrames,
  });
  
  const outgoing: KeyframeStyles[] = [];
  const incoming: KeyframeStyles[] = [];
  
  for (let i = 0; i < easingCurve.length; i++) {
    const progress = easingCurve[i]!;
    
    const outgoingStyles = calculateTransitionStyles(
      transition,
      progress,
      true,
      canvasWidth,
      canvasHeight
    );
    
    const incomingStyles = calculateTransitionStyles(
      transition,
      progress,
      false,
      canvasWidth,
      canvasHeight
    );
    
    // Convert to serializable keyframe objects
    outgoing.push({
      opacity: outgoingStyles.opacity,
      transform: outgoingStyles.transform,
      clipPath: outgoingStyles.clipPath ?? outgoingStyles.webkitClipPath,
      maskImage: outgoingStyles.maskImage ?? outgoingStyles.webkitMaskImage,
    });
    
    incoming.push({
      opacity: incomingStyles.opacity,
      transform: incomingStyles.transform,
      clipPath: incomingStyles.clipPath ?? incomingStyles.webkitClipPath,
      maskImage: incomingStyles.maskImage ?? incomingStyles.webkitMaskImage,
    });
  }
  
  return { outgoing, incoming };
}

/**
 * Convert keyframes array to CSS @keyframes string.
 */
function keyframesToCSS(
  name: string,
  keyframes: KeyframeStyles[]
): string {
  if (keyframes.length === 0) return '';
  
  const percentageStep = 100 / (keyframes.length - 1);
  
  const rules = keyframes.map((frame, index) => {
    const percentage = Math.round(index * percentageStep);
    const styles: string[] = [];
    
    if (frame.opacity !== undefined) {
      styles.push(`opacity: ${frame.opacity}`);
    }
    if (frame.transform !== undefined && frame.transform !== 'none') {
      styles.push(`transform: ${frame.transform}`);
    }
    if (frame.clipPath !== undefined && frame.clipPath !== 'none') {
      styles.push(`clip-path: ${frame.clipPath}`);
      styles.push(`-webkit-clip-path: ${frame.clipPath}`);
    }
    if (frame.maskImage !== undefined) {
      styles.push(`mask-image: ${frame.maskImage}`);
      styles.push(`-webkit-mask-image: ${frame.maskImage}`);
      styles.push(`mask-size: 100% 100%`);
      styles.push(`-webkit-mask-size: 100% 100%`);
    }
    
    return `${percentage}% { ${styles.join('; ')} }`;
  });
  
  return `@keyframes ${name} { ${rules.join(' ')} }`;
}

// ============================================================================
// Clip Content Component
// ============================================================================

interface ClipContentProps {
  clip: TransitionPreviewItem;
  className?: string;
}

/**
 * Renders a clip's content (video or image).
 * Memoized to prevent re-renders during animation.
 */
const ClipContent = React.memo<ClipContentProps>(function ClipContent({
  clip,
  className,
}) {
  if (clip.type === 'video') {
    if (!clip.src) return null;
    
    return (
      <div className={cn('w-full h-full overflow-hidden', className)}>
        <video
          src={clip.src}
          preload="auto"
          muted
          playsInline
          className="w-full h-full object-contain"
        />
      </div>
    );
  } else if (clip.type === 'image') {
    if (!clip.src) return null;
    
    return (
      <div className={cn('w-full h-full overflow-hidden', className)}>
        <img
          src={clip.src}
          alt=""
          className="w-full h-full object-contain"
        />
      </div>
    );
  }
  
  return null;
});

// ============================================================================
// Main Preview Component
// ============================================================================

/**
 * Transition Preview using CSS animations.
 * 
 * This component pre-calculates all animation keyframes and applies them
 * using CSS animations, avoiding per-frame JavaScript calculations.
 */
export const TransitionPreview = React.memo<TransitionPreviewProps>(
  function TransitionPreview({
    transition,
    leftClip,
    rightClip,
    canvasWidth,
    canvasHeight,
    fps,
    autoPlay = true,
    onComplete,
    className,
  }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const outgoingRef = useRef<HTMLDivElement>(null);
    const incomingRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<Animation[]>([]);
    
    // Generate keyframes once
    const keyframes = useMemo(() => {
      return generateTransitionKeyframes(
        transition,
        canvasWidth,
        canvasHeight,
        fps
      );
    }, [transition, canvasWidth, canvasHeight, fps]);
    
    // Generate unique animation names
    const animationNames = useMemo(() => {
      const base = `transition-${transition.id.slice(0, 8)}`;
      return {
        outgoing: `${base}-outgoing`,
        incoming: `${base}-incoming`,
      };
    }, [transition.id]);
    
    // Generate CSS for keyframes
    const cssKeyframes = useMemo(() => {
      return [
        keyframesToCSS(animationNames.outgoing, keyframes.outgoing),
        keyframesToCSS(animationNames.incoming, keyframes.incoming),
      ].join('\n');
    }, [keyframes, animationNames]);
    
    // Start animations
    useEffect(() => {
      if (!autoPlay || !outgoingRef.current || !incomingRef.current) return;
      
      // Cancel any existing animations
      animationRef.current.forEach(anim => anim.cancel());
      animationRef.current = [];
      
      const duration = (transition.durationInFrames / fps) * 1000; // Convert to ms
      const easing = transition.timing === 'spring' ? 'ease-out' : 'linear';
      
      // Create Web Animations API animations
      // These are more performant than CSS classes and give us better control
      const outgoingAnimation = outgoingRef.current.animate(
        keyframes.outgoing as Keyframe[],
        {
          duration,
          easing,
          fill: 'forwards',
        }
      );
      
      const incomingAnimation = incomingRef.current.animate(
        keyframes.incoming as Keyframe[],
        {
          duration,
          easing,
          fill: 'forwards',
        }
      );
      
      animationRef.current = [outgoingAnimation, incomingAnimation];
      
      // Handle completion
      if (onComplete) {
        outgoingAnimation.onfinish = onComplete;
      }
      
      return () => {
        animationRef.current.forEach(anim => anim.cancel());
      };
    }, [keyframes, transition.durationInFrames, transition.timing, fps, autoPlay, onComplete]);
    
    if (!leftClip.trackVisible || !rightClip.trackVisible) {
      return null;
    }
    
    return (
      <div
        ref={containerRef}
        className={cn('relative w-full h-full overflow-hidden', className)}
        style={{
          width: canvasWidth,
          height: canvasHeight,
        }}
      >
        {/* Inject keyframes CSS */}
        <style>{cssKeyframes}</style>
        
        {/* Incoming clip (right) - sits at bottom */}
        <div
          ref={incomingRef}
          className="absolute inset-0"
          style={{
            zIndex: 1,
            willChange: 'transform, opacity, clip-path',
          }}
        >
          <ClipContent clip={rightClip} />
        </div>
        
        {/* Outgoing clip (left) - sits on top */}
        <div
          ref={outgoingRef}
          className="absolute inset-0"
          style={{
            zIndex: 2,
            willChange: 'transform, opacity, clip-path',
          }}
        >
          <ClipContent clip={leftClip} />
        </div>
      </div>
    );
  }
);

// ============================================================================
// Static Preview (for thumbnails/stills)
// ============================================================================

export interface StaticTransitionPreviewProps {
  transition: Transition;
  leftClip: TransitionPreviewItem;
  rightClip: TransitionPreviewItem;
  canvasWidth: number;
  canvasHeight: number;
  /** Progress value from 0 to 1 for the static frame to show */
  progress: number;
  className?: string;
}

/**
 * Static preview of a transition at a specific progress point.
 * Useful for thumbnails or scrubber previews.
 */
export const StaticTransitionPreview = React.memo<StaticTransitionPreviewProps>(
  function StaticTransitionPreview({
    transition,
    leftClip,
    rightClip,
    canvasWidth,
    canvasHeight,
    progress,
    className,
  }) {
    // Calculate styles for this specific progress point
    const outgoingStyles = useMemo(() => {
      return calculateTransitionStyles(
        transition,
        progress,
        true,
        canvasWidth,
        canvasHeight
      );
    }, [transition, progress, canvasWidth, canvasHeight]);
    
    const incomingStyles = useMemo(() => {
      return calculateTransitionStyles(
        transition,
        progress,
        false,
        canvasWidth,
        canvasHeight
      );
    }, [transition, progress, canvasWidth, canvasHeight]);
    
    if (!leftClip.trackVisible || !rightClip.trackVisible) {
      return null;
    }
    
    return (
      <div
        className={cn('relative w-full h-full overflow-hidden', className)}
        style={{
          width: canvasWidth,
          height: canvasHeight,
        }}
      >
        {/* Incoming clip */}
        <div
          className="absolute inset-0"
          style={{
            zIndex: 1,
            opacity: incomingStyles.opacity,
            transform: incomingStyles.transform,
            clipPath: incomingStyles.clipPath,
            WebkitClipPath: incomingStyles.webkitClipPath,
            maskImage: incomingStyles.maskImage,
            WebkitMaskImage: incomingStyles.webkitMaskImage,
          }}
        >
          <ClipContent clip={rightClip} />
        </div>
        
        {/* Outgoing clip */}
        <div
          className="absolute inset-0"
          style={{
            zIndex: 2,
            opacity: outgoingStyles.opacity,
            transform: outgoingStyles.transform,
            clipPath: outgoingStyles.clipPath,
            WebkitClipPath: outgoingStyles.webkitClipPath,
            maskImage: outgoingStyles.maskImage,
            WebkitMaskImage: outgoingStyles.webkitMaskImage,
          }}
        >
          <ClipContent clip={leftClip} />
        </div>
      </div>
    );
  }
);

export default TransitionPreview;
