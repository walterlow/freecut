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

import React, { useMemo, memo } from 'react';
import { useClockFrame } from '../clock';
import { SequenceContext, type SequenceContextValue, useSequenceContext } from './sequence-context';

// ============================================
// Sequence Component
// ============================================

interface SequenceProps {
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
    showLoopTimestamps,
  }) => {
    void showLoopTimestamps;

    // Get the global frame from the clock
    const globalFrame = useClockFrame();

    // Get parent sequence context (for nested sequences like sub-compositions)
    const parentContext = useSequenceContext();
    const parentFrom = parentContext?.from ?? 0;

    // When nested inside another Sequence (e.g. sub-comp items inside a CompositionItem),
    // `from` is relative to the parent. Convert to absolute frame for clock comparison.
    const absoluteFrom = parentFrom + from;
    const endFrame = absoluteFrom + durationInFrames;
    const premountStart = absoluteFrom - premountFor;

    // Calculate visibility using absolute frame positions
    const isVisible = globalFrame >= absoluteFrom && globalFrame < endFrame;
    // Mount content if visible OR within premount range
    const shouldMount = globalFrame >= premountStart && globalFrame < endFrame;

    // Calculate local frame (0-based within this sequence)
    // NOTE: During premount, localFrame can be negative (before the sequence starts).
    // This allows children to detect premount phase and avoid rendering content.
    const localFrame = globalFrame - absoluteFrom;

    // Create context value — expose absoluteFrom so nested children
    // can continue to offset their own `from` correctly.
    const contextValue = useMemo<SequenceContextValue>(
      () => ({
        from: absoluteFrom,
        durationInFrames,
        localFrame,
        parentFrom,
      }),
      [absoluteFrom, durationInFrames, localFrame, parentFrom]
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
