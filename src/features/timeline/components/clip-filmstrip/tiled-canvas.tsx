import { useRef, useEffect, memo } from 'react';

// Tile width - 1000px for faster individual renders and better cache granularity
const TILE_WIDTH = 1000;

interface TiledCanvasProps {
  /** Total width of the content in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Render function for each tile. tileWidth is always a whole-pixel logical width. */
  renderTile: (
    ctx: CanvasRenderingContext2D,
    tileIndex: number,
    tileOffset: number,
    tileWidth: number
  ) => void;
  /** Class name for the container */
  className?: string;
  /** Version number - increment to force re-render */
  version?: string | number;
}

/**
 * Tiled Canvas Component
 *
 * Renders content across multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 1000px wide. Only creates canvases when needed.
 *
 * Separates layout (CSS positioning — runs on every width change) from content
 * rendering (canvas draw — runs only when version/renderTile changes). This
 * prevents full canvas redraws during zoom gestures where only width changes.
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
  const lastRenderedRef = useRef<{ version: string | number; renderTile: unknown; height: number }>({
    version: -1,
    renderTile: renderTile as unknown,
    height: -1,
  });

  // Calculate number of tiles needed
  const tileCount = Math.ceil(width / TILE_WIDTH);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvasPool = canvasPoolRef.current;
    const dpr = window.devicePixelRatio || 1;
    const last = lastRenderedRef.current;
    const needsContentRedraw =
      version !== last.version ||
      renderTile !== last.renderTile ||
      height !== last.height;

    // Create or update tiles
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      let canvas = canvasPool.get(tileIndex);
      const isNew = !canvas;

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.willChange = 'transform';
        canvasPool.set(tileIndex, canvas);
        container.appendChild(canvas);
      }

      // Calculate tile dimensions
      const tileOffset = tileIndex * TILE_WIDTH;
      const actualTileWidth = Math.max(0, Math.min(TILE_WIDTH, width - tileOffset));
      const renderTileWidth = actualTileWidth > 0 ? Math.max(1, Math.ceil(actualTileWidth)) : 0;

      // Always update layout (cheap CSS — no canvas redraw)
      canvas.style.transform = `translateX(${tileOffset}px)`;
      canvas.style.width = `${actualTileWidth}px`;
      canvas.style.height = `${height}px`;

      // Only redraw canvas content when version/renderTile/height change,
      // or when the tile is brand new. Width-only changes (zoom) skip the
      // expensive canvas draw — tiles CSS-stretch until content catches up.
      if (needsContentRedraw || isNew) {
        canvas.width = Math.ceil(renderTileWidth * dpr);
        canvas.height = Math.ceil(height * dpr);

        const ctx = canvas.getContext('2d');
        if (ctx && renderTileWidth > 0) {
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, renderTileWidth, height);
          renderTile(ctx, tileIndex, tileOffset, renderTileWidth);
        }
      }
    }

    // Remove extra tiles that are no longer needed
    for (const [index, canvas] of canvasPool) {
      if (index >= tileCount) {
        canvas.remove();
        canvasPool.delete(index);
      }
    }

    if (needsContentRedraw) {
      last.version = version;
      last.renderTile = renderTile;
      last.height = height;
    }
  }, [width, height, tileCount, version, renderTile]);

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
      style={{ pointerEvents: 'none' }}
    />
  );
});
