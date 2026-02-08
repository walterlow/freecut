/**
 * AbsoluteFill.tsx - Full container positioning component
 *
 * A simple component that fills its parent container absolutely.
 * Replacement for Composition's AbsoluteFill.
 */

import React, { memo, forwardRef } from 'react';

interface AbsoluteFillProps {
  /** Children to render */
  children?: React.ReactNode;
  /** Custom styles (merged with absolute fill styles) */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

/**
 * Base style for absolute fill
 */
const absoluteFillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

/**
 * AbsoluteFill Component
 *
 * Fills its parent container with absolute positioning.
 * Useful as a container for compositing layers.
 */
export const AbsoluteFill = memo(
  forwardRef<HTMLDivElement, AbsoluteFillProps>(
    ({ children, style, className }, ref) => {
      // Merge styles
      const mergedStyle = style
        ? { ...absoluteFillStyle, ...style }
        : absoluteFillStyle;

      return (
        <div ref={ref} className={className} style={mergedStyle}>
          {children}
        </div>
      );
    }
  )
);

AbsoluteFill.displayName = 'AbsoluteFill';
