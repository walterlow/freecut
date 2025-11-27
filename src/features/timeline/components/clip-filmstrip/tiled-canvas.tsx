import { useRef, useEffect, memo, useCallback } from 'react';

// Safe canvas width under browser limits
const TILE_WIDTH = 2000;

export interface TiledCanvasProps {
  /** Total width of the content in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Render function for each tile */
  renderTile: (
    ctx: CanvasRenderingContext2D,
    tileIndex: number,
    tileOffset: number,
    tileWidth: number
  ) => void;
  /** Class name for the container */
  className?: string;
  /** Version number - increment to force re-render */
  version?: number;
}

/**
 * Tiled Canvas Component
 *
 * Renders content across multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 2000px wide. Only creates canvases when needed.
 */
export const TiledCanvas = memo(function TiledCanvas({
  width,
  height,
  renderTile,
  className = '',
  version = 0,
}: TiledCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasPoolRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTileRef = useRef(renderTile);

  // Keep renderTile ref updated
  useEffect(() => {
    renderTileRef.current = renderTile;
  }, [renderTile]);

  // Calculate number of tiles needed
  const tileCount = Math.ceil(width / TILE_WIDTH);

  // Render tiles effect - now also depends on version for progressive updates
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvasPool = canvasPoolRef.current;
    const dpr = window.devicePixelRatio || 1;

    // Create or update tiles
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      let canvas = canvasPool.get(tileIndex);

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.pointerEvents = 'none';
        canvasPool.set(tileIndex, canvas);
        container.appendChild(canvas);
      }

      // Calculate tile dimensions
      const tileOffset = tileIndex * TILE_WIDTH;
      const actualTileWidth = Math.min(TILE_WIDTH, width - tileOffset);

      // Position tile
      canvas.style.left = `${tileOffset}px`;

      // Set canvas size with DPI scaling
      canvas.width = Math.ceil(actualTileWidth * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${actualTileWidth}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, actualTileWidth, height);

        // Call render function
        renderTileRef.current(ctx, tileIndex, tileOffset, actualTileWidth);
      }
    }

    // Remove extra tiles that are no longer needed
    for (const [index, canvas] of canvasPool) {
      if (index >= tileCount) {
        canvas.remove();
        canvasPool.delete(index);
      }
    }
  }, [width, height, tileCount, version]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const canvasPool = canvasPoolRef.current;
      for (const canvas of canvasPool.values()) {
        canvas.remove();
      }
      canvasPool.clear();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${className}`}
      style={{
        pointerEvents: 'none',
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
});

/**
 * Hook to create a stable render function for tiled canvas
 * that updates when dependencies change without causing re-renders
 */
export function useTiledCanvasRenderer(
  render: (
    ctx: CanvasRenderingContext2D,
    tileIndex: number,
    tileOffset: number,
    tileWidth: number
  ) => void,
  deps: React.DependencyList
): (
  ctx: CanvasRenderingContext2D,
  tileIndex: number,
  tileOffset: number,
  tileWidth: number
) => void {
  const renderRef = useRef(render);

  useEffect(() => {
    renderRef.current = render;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return useCallback(
    (ctx: CanvasRenderingContext2D, tileIndex: number, tileOffset: number, tileWidth: number) => {
      renderRef.current(ctx, tileIndex, tileOffset, tileWidth);
    },
    []
  );
}
