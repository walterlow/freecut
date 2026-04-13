import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloatingPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingPanelProps {
  /** Content rendered inside the panel body */
  children: ReactNode;
  /** Panel title shown in the drag handle header */
  title?: string;
  /** Extra content rendered in the header (right side) */
  headerExtra?: ReactNode;
  /** Initial / default bounds when no persisted state exists */
  defaultBounds: FloatingPanelBounds;
  /** Minimum width */
  minWidth?: number;
  /** Minimum height */
  minHeight?: number;
  /** localStorage key for persisting position & size */
  storageKey?: string;
  /** Whether the panel can be resized */
  resizable?: boolean;
  /** When true, panel height fits content instead of using a fixed value */
  autoHeight?: boolean;
  /** Called when the panel requests to close / dock */
  onClose?: () => void;
  /** Additional className on the outer container */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDGE_MARGIN = 8;

function clampToViewport(bounds: FloatingPanelBounds): FloatingPanelBounds {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(EDGE_MARGIN, Math.min(vw - bounds.width - EDGE_MARGIN, bounds.x)),
    y: Math.max(EDGE_MARGIN, Math.min(vh - bounds.height - EDGE_MARGIN, bounds.y)),
    width: Math.min(vw - EDGE_MARGIN * 2, bounds.width),
    height: Math.min(vh - EDGE_MARGIN * 2, bounds.height),
  };
}

function loadBounds(key: string, fallback: FloatingPanelBounds): FloatingPanelBounds {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelBounds>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return clampToViewport({ x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height });
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveBounds(key: string, bounds: FloatingPanelBounds): void {
  try {
    localStorage.setItem(key, JSON.stringify(bounds));
  } catch {
    // ignore
  }
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_CURSORS: Record<ResizeEdge, string> = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  sw: 'cursor-nesw-resize',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FloatingPanel = memo(function FloatingPanel({
  children,
  title,
  headerExtra,
  defaultBounds,
  minWidth = 160,
  minHeight = 200,
  storageKey,
  resizable = true,
  autoHeight = false,
  onClose,
  className = '',
}: FloatingPanelProps) {
  const [bounds, setBounds] = useState<FloatingPanelBounds>(() => {
    const initial = storageKey ? loadBounds(storageKey, defaultBounds) : defaultBounds;
    // When autoHeight, use a small placeholder height for initial Y positioning
    // so the panel isn't clamped too far up. Actual height comes from content.
    const heightForLayout = autoHeight ? 100 : initial.height;
    const resolved = {
      ...initial,
      x: initial.x < 0 ? window.innerWidth - initial.width - EDGE_MARGIN * 4 : initial.x,
      y: initial.y < 0 ? window.innerHeight - heightForLayout - EDGE_MARGIN * 4 : initial.y,
    };
    return clampToViewport({
      ...resolved,
      width: Math.max(minWidth, resolved.width),
      height: autoHeight ? heightForLayout : Math.max(minHeight, initial.height),
    });
  });

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const panelRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{
    type: 'move' | 'resize';
    edge?: ResizeEdge;
    startX: number;
    startY: number;
    startBounds: FloatingPanelBounds;
  } | null>(null);

  useEffect(() => {
    if (storageKey) saveBounds(storageKey, bounds);
  }, [bounds, storageKey]);

  useEffect(() => {
    const handleResize = () => {
      setBounds((prev) => {
        const effectiveHeight = autoHeight && panelRef.current
          ? panelRef.current.offsetHeight
          : prev.height;
        return clampToViewport({ ...prev, height: effectiveHeight });
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [autoHeight]);

  useEffect(() => {
    if (!autoHeight || !panelRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!panelRef.current) return;
      const contentHeight = panelRef.current.offsetHeight;
      setBounds((prev) => clampToViewport({
        ...prev,
        height: contentHeight,
      }));
    });
    ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, [autoHeight]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const s = drag.startBounds;

      if (drag.type === 'move') {
        const effectiveHeight = autoHeight && panelRef.current
          ? panelRef.current.offsetHeight
          : s.height;
        setBounds(clampToViewport({ x: s.x + dx, y: s.y + dy, width: s.width, height: effectiveHeight }));
        return;
      }

      let { x, y, width, height } = s;
      const edge = drag.edge!;

      if (edge.includes('e')) width = Math.max(minWidth, s.width + dx);
      if (edge.includes('w')) {
        const newWidth = Math.max(minWidth, s.width - dx);
        x = s.x + (s.width - newWidth);
        width = newWidth;
      }
      if (edge.includes('s')) height = Math.max(minHeight, s.height + dy);
      if (edge.includes('n')) {
        const newHeight = Math.max(minHeight, s.height - dy);
        y = s.y + (s.height - newHeight);
        height = newHeight;
      }

      setBounds(clampToViewport({ x, y, width, height }));
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [minHeight, minWidth]);

  const handleTitlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = {
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startBounds: { ...boundsRef.current },
    };
  }, []);

  const handleResizePointerDown = useCallback((edge: ResizeEdge, e: React.PointerEvent) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type: 'resize',
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startBounds: { ...boundsRef.current },
    };
  }, [resizable]);

  const resizeHandle = (edge: ResizeEdge, positionClass: string) => (
    <div
      key={edge}
      className={`absolute ${positionClass} ${RESIZE_CURSORS[edge]} z-10`}
      onPointerDown={(e) => handleResizePointerDown(edge, e)}
    />
  );

  const panel = (
    <div
      ref={panelRef}
      className={`fixed z-40 flex flex-col rounded-lg border border-border bg-background shadow-2xl shadow-black/50 overflow-hidden ${className}`}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        ...(autoHeight ? {} : { height: bounds.height }),
      }}
    >
      {resizable ? (
        <>
          {resizeHandle('n', 'top-0 left-2 right-2 h-[4px]')}
          {resizeHandle('s', 'bottom-0 left-2 right-2 h-[4px]')}
          {resizeHandle('e', 'right-0 top-2 bottom-2 w-[4px]')}
          {resizeHandle('w', 'left-0 top-2 bottom-2 w-[4px]')}
          {resizeHandle('nw', 'top-0 left-0 w-[8px] h-[8px]')}
          {resizeHandle('ne', 'top-0 right-0 w-[8px] h-[8px]')}
          {resizeHandle('sw', 'bottom-0 left-0 w-[8px] h-[8px]')}
          {resizeHandle('se', 'bottom-0 right-0 w-[8px] h-[8px]')}
        </>
      ) : null}

      <div
        className="flex items-center justify-between gap-2 border-b border-border bg-secondary/30 px-2 py-1.5 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={handleTitlePointerDown}
      >
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {headerExtra}
          {onClose && (
            <button
              type="button"
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
              onClick={onClose}
              aria-label="Dock panel"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className={autoHeight ? 'overflow-hidden' : 'flex-1 min-h-0 overflow-hidden'}>
        {children}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
});
