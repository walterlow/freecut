import React, { useRef, useEffect, memo } from 'react';

interface GifCanvasProps {
  /** The ImageBitmap frame to render */
  frame: ImageBitmap | null;
  /** How to fit the frame within the container */
  fit: 'cover' | 'contain' | 'fill';
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * Canvas component for rendering GIF frames
 *
 * Uses canvas.drawImage for efficient ImageBitmap rendering
 * Handles different fit modes (cover, contain, fill)
 */
export const GifCanvas = memo(function GifCanvas({ frame, fit, style }: GifCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !frame) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use offsetWidth/offsetHeight — these return layout dimensions BEFORE
    // CSS transforms (rotation/scale).  getBoundingClientRect() returns the
    // axis-aligned bounding box AFTER transforms, which distorts the canvas
    // pixel buffer when the item is rotated via the gizmo.
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    // Skip drawing when container is hidden or detached (zero dimensions)
    if (containerWidth === 0 || containerHeight === 0) return;

    // Set canvas size to match container
    if (canvas.width !== containerWidth || canvas.height !== containerHeight) {
      canvas.width = containerWidth;
      canvas.height = containerHeight;
    }

    // Clear previous frame
    ctx.clearRect(0, 0, containerWidth, containerHeight);

    // Calculate draw dimensions based on fit mode
    let dx = 0;
    let dy = 0;
    let dw = containerWidth;
    let dh = containerHeight;

    if (fit === 'contain' || fit === 'cover') {
      const scaleX = containerWidth / frame.width;
      const scaleY = containerHeight / frame.height;
      const scale = fit === 'cover'
        ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY);

      dw = frame.width * scale;
      dh = frame.height * scale;
      dx = (containerWidth - dw) / 2;
      dy = (containerHeight - dh) / 2;
    }

    // Guard against detached ImageBitmaps (can happen when the cache
    // evicts entries or the user clears caches while frames are displayed).
    try {
      ctx.drawImage(frame, dx, dy, dw, dh);
    } catch {
      // ImageBitmap was closed/detached — ignore, next frame update will fix it
    }
  }, [frame, fit]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
});
