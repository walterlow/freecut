/**
 * Sequence.tsx - Time-bounded visibility component
 *
 * A replacement for Composition's Sequence component that shows/hides
 * children based on the current frame position.
 *
 * Key differences from Composition:
 * - Uses CSS visibility instead of conditional rendering
 *   (keeps DOM stable, prevents video element remounting)
 * - Provides local frame context to children
 * - No dependency on Composition's internals
 */

import React, { createContext, useContext, useMemo, memo } from 'react';
import { useClockFrame } from '../clock';

// ============================================
// Context for local frame within a Sequence
// ============================================

interface SequenceContextValue {
  /** Start frame of this sequence in the global timeline */
  from: number;
  /** Duration of this sequence in frames */
  durationInFrames: number;
  /** Current local frame (0-based within this sequence) */
  localFrame: number;
  /** Parent sequence's from value (for nested sequences) */
  parentFrom: number;
}

const SequenceContext = createContext<SequenceContextValue | null>(null);

/**
 * Hook to get the sequence context
 */
export function useSequenceContext(): SequenceContextValue | null {
  return useContext(SequenceContext);
}

/**
 * Hook to get the local frame within the current sequence
 *
 * Returns 0 if not inside a Sequence.
 */
export function useLocalFrame(): number {
  const context = useContext(SequenceContext);
  return context?.localFrame ?? 0;
}

/**
 * Hook to get the sequence's start frame
 */
export function useSequenceFrom(): number {
  const context = useContext(SequenceContext);
  return context?.from ?? 0;
}

// ============================================
// Sequence Component
// ============================================

export interface SequenceProps {
  /** Children to render */
  children: React.ReactNode;
  /** Start frame (inclusive) */
  from: number;
  /** Duration in frames */
  durationInFrames: number;
  /** Optional name for debugging */
  name?: string;
  /** Whether to use display:none instead of visibility:hidden */
  useDisplayNone?: boolean;
  /** Layout style - absolute fill or inline */
  layout?: 'absolute-fill' | 'none';
  /** Custom style */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
  /**
   * Number of frames to premount the sequence before it becomes visible.
   * Used for preloading content like videos.
   */
  premountFor?: number;
  /**
   * Show loop timestamps for debugging (Composition compat, ignored)
   */
  showLoopTimestamps?: boolean;
}

/**
 * Sequence Component
 *
 * Shows children only when the current frame is within [from, from + durationInFrames).
 * Provides a local frame context to children.
 */
export const Sequence = memo<SequenceProps>(
  ({
    children,
    from,
    durationInFrames,
    name,
    useDisplayNone = false,
    layout = 'absolute-fill',
    style,
    className,
    premountFor = 0,
    showLoopTimestamps: _showLoopTimestamps,
  }) => {
    // Get the global frame from the clock
    const globalFrame = useClockFrame();

    // Get parent sequence context (for nested sequences)
    const parentContext = useSequenceContext();
    const parentFrom = parentContext?.from ?? 0;

    // Calculate visibility (with premount support)
    const endFrame = from + durationInFrames;
    const premountStart = from - premountFor;
    const isVisible = globalFrame >= from && globalFrame < endFrame;
    // Mount content if visible OR within premount range
    const shouldMount = globalFrame >= premountStart && globalFrame < endFrame;

    // Calculate local frame (0-based within this sequence)
    // NOTE: During premount, localFrame can be negative (before the sequence starts).
    // This allows children to detect premount phase and avoid rendering content.
    // Previously this was clamped to 0, but that caused premount content to be visible.
    const localFrame = globalFrame - from;

    // Create context value
    const contextValue = useMemo<SequenceContextValue>(
      () => ({
        from,
        durationInFrames,
        localFrame,
        parentFrom,
      }),
      [from, durationInFrames, localFrame, parentFrom]
    );

    // Build style based on visibility and layout
    const computedStyle = useMemo<React.CSSProperties>(() => {
      const baseStyle: React.CSSProperties = {
        ...style,
      };

      // Apply layout
      if (layout === 'absolute-fill') {
        baseStyle.position = 'absolute';
        baseStyle.top = 0;
        baseStyle.left = 0;
        baseStyle.right = 0;
        baseStyle.bottom = 0;
        baseStyle.width = '100%';
        baseStyle.height = '100%';
      }

      // Apply visibility (hidden during premount phase)
      if (!isVisible) {
        if (useDisplayNone && !shouldMount) {
          // Only use display:none if not premounting
          baseStyle.display = 'none';
        } else {
          baseStyle.visibility = 'hidden';
          // Keep in layout flow but invisible
          baseStyle.pointerEvents = 'none';
        }
      }

      return baseStyle;
    }, [style, layout, isVisible, shouldMount, useDisplayNone]);

    // Don't render anything if not in mount range
    if (!shouldMount) {
      return null;
    }

    return (
      <SequenceContext.Provider value={contextValue}>
        <div
          data-sequence-name={name}
          data-sequence-from={from}
          data-sequence-duration={durationInFrames}
          className={className}
          style={computedStyle}
        >
          {children}
        </div>
      </SequenceContext.Provider>
    );
  }
);

Sequence.displayName = 'Sequence';

// ============================================
// Convenience hook for sequence visibility
// ============================================

/**
 * Hook to check if the current frame is within a given range
 *
 * @param from - Start frame (inclusive)
 * @param durationInFrames - Duration in frames
 * @returns Whether the current frame is in range
 */
export function useIsInRange(from: number, durationInFrames: number): boolean {
  const globalFrame = useClockFrame();
  const endFrame = from + durationInFrames;
  return globalFrame >= from && globalFrame < endFrame;
}

/**
 * Hook to get visibility and local frame for a sequence
 *
 * Useful when you need both values without using the Sequence component.
 */
export function useSequenceVisibility(from: number, durationInFrames: number) {
  const globalFrame = useClockFrame();
  const endFrame = from + durationInFrames;
  const isVisible = globalFrame >= from && globalFrame < endFrame;
  const localFrame = Math.max(0, globalFrame - from);

  return {
    isVisible,
    localFrame,
    progress: durationInFrames > 0 ? localFrame / durationInFrames : 0,
  };
}

export default Sequence;
