import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { Columns2 } from 'lucide-react';
import {
  VideoPreview,
  PlaybackControls,
  TimecodeDisplay,
  PreviewZoomControls,
  SourceMonitor,
} from '@/features/editor/deps/preview';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useProjectStore } from '@/features/editor/deps/projects';
import { useEditorStore } from '@/shared/state/editor';

interface PreviewAreaProps {
  project: {
    width: number;
    height: number;
    fps: number;
  };
}

const PREVIEW_PADDING_PX = 48;
const DEFAULT_EMPTY_TIMELINE_SECONDS = 10;
const PREVIEW_RESIZE_MIN_UPDATE_MS = 33;
const SPLIT_DRAG_MIN_UPDATE_MS = 33;

/**
 * Preview Area Component
 *
 * Modular composition of preview-related components:
 * - VideoPreview: Canvas with grid, rulers, frame counter
 * - PlaybackControls: Transport controls with React 19 patterns
 * - TimecodeDisplay: Current time display
 * - PreviewZoomControls: Fit-to-panel zoom control
 *
 * Uses granular Zustand selectors in child components
 */
export const PreviewArea = memo(function PreviewArea({ project }: PreviewAreaProps) {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Read current project from store for live updates (e.g., dimension swaps)
  // Use granular selectors to avoid re-renders when unrelated properties change
  const projectWidth = useProjectStore((s) => s.currentProject?.metadata.width);
  const projectHeight = useProjectStore((s) => s.currentProject?.metadata.height);
  const projectFps = useProjectStore((s) => s.currentProject?.metadata.fps);
  const projectBgColor = useProjectStore((s) => s.currentProject?.metadata.backgroundColor);

  const width = projectWidth ?? project.width;
  const height = projectHeight ?? project.height;
  const fps = projectFps ?? project.fps;
  const backgroundColor = projectBgColor ?? '#000000';

  // Derive timeline end frame directly from store state to avoid recreating selector functions.
  const timelineEndFrame = useTimelineStore((s) => {
    if (s.items.length === 0) return null;
    let maxFrame = 0;
    for (const item of s.items) {
      const itemEnd = item.from + item.durationInFrames;
      if (itemEnd > maxFrame) {
        maxFrame = itemEnd;
      }
    }
    return maxFrame;
  });

  const totalFrames = timelineEndFrame ?? fps * DEFAULT_EMPTY_TIMELINE_SECONDS;

  // Measure preview container size for zoom calculations
  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) return;
    let rafId: number | null = null;
    let lastUpdateTs = 0;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextWidth = Math.max(0, Math.floor(rect.width - PREVIEW_PADDING_PX));
      const nextHeight = Math.max(0, Math.floor(rect.height - PREVIEW_PADDING_PX));

      // Bail out when dimensions are unchanged to avoid redundant re-renders.
      setContainerSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        const now = performance.now();
        if (now - lastUpdateTs < PREVIEW_RESIZE_MIN_UPDATE_MS) {
          // Re-schedule for next frame instead of dropping the update
          rafId = requestAnimationFrame(() => {
            rafId = null;
            lastUpdateTs = performance.now();
            updateSize();
          });
          return;
        }
        rafId = null;
        lastUpdateTs = now;
        updateSize();
      });
    };

    // Initial measurement
    updateSize();

    // Use ResizeObserver to detect panel resizing
    const resizeObserver = new ResizeObserver(scheduleUpdate);

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  // Build project object with live values from store
  // Memoize to prevent VideoPreview re-renders when reference changes
  const liveProject = useMemo(
    () => ({ width, height, fps, backgroundColor }),
    [width, height, fps, backgroundColor]
  );

  const sourcePreviewMediaId = useEditorStore((s) => s.sourcePreviewMediaId);

  // Split ratio for source/program monitors (percentage for left panel)
  const [splitPercent, setSplitPercent] = useState(50);
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplitRef = useRef(false);
  const pendingSplitPercentRef = useRef<number | null>(null);
  const splitDragRafRef = useRef<number | null>(null);
  const lastSplitDragUpdateTsRef = useRef(0);

  const splitDragCleanupRef = useRef<(() => void) | null>(null);

  const handleCloseSourceMonitor = useCallback(() => {
    useEditorStore.getState().setSourcePreviewMediaId(null);
  }, []);

  const handleResetSplit = useCallback(() => {
    setSplitPercent(50);
  }, []);

  const handleSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    setIsSplitDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      pendingSplitPercentRef.current = pct;

      if (splitDragRafRef.current !== null) return;
      splitDragRafRef.current = requestAnimationFrame(() => {
        splitDragRafRef.current = null;
        const now = performance.now();
        if (now - lastSplitDragUpdateTsRef.current < SPLIT_DRAG_MIN_UPDATE_MS) {
          return;
        }
        lastSplitDragUpdateTsRef.current = now;
        const next = pendingSplitPercentRef.current;
        if (next !== null) {
          setSplitPercent(Math.min(75, Math.max(25, next)));
        }
      });
    };

    const cleanup = () => {
      // Flush pending value before cancelling RAF
      const pending = pendingSplitPercentRef.current;
      if (pending !== null) {
        setSplitPercent(Math.min(75, Math.max(25, pending)));
      }
      if (splitDragRafRef.current !== null) {
        cancelAnimationFrame(splitDragRafRef.current);
        splitDragRafRef.current = null;
      }
      isDraggingSplitRef.current = false;
      pendingSplitPercentRef.current = null;
      setIsSplitDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      splitDragCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      cleanup();
    };

    splitDragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Clean up split-drag listeners on unmount
  useEffect(() => {
    return () => {
      splitDragCleanupRef.current?.();
    };
  }, []);

  const isSplit = !!sourcePreviewMediaId;

  return (
    <div ref={splitContainerRef} className="flex-1 flex min-h-0 min-w-0 relative">
      {/* Source Monitor - left (only when split) */}
      {sourcePreviewMediaId && (
        <>
          <div className="flex flex-col min-w-0" style={{ width: `${splitPercent}%` }}>
            <SourceMonitor
              key={sourcePreviewMediaId}
              mediaId={sourcePreviewMediaId}
              onClose={handleCloseSourceMonitor}
            />
          </div>

          {/* Resizable divider with reset button */}
          <div
            onMouseDown={handleSplitDragStart}
            className="w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary/70 bg-border transition-colors flex-shrink-0 relative group"
          >
            {splitPercent !== 50 && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleResetSplit}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-primary hover:border-primary hover:[&>svg]:text-primary-foreground"
                aria-label="Reset split to 50/50"
                data-tooltip="Reset Split View"
              >
                <Columns2 className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </>
      )}

      {/* Program Monitor — always in the same tree position */}
      <div
        className={`flex flex-col min-w-0 min-h-0 ${isSplit ? '' : 'flex-1'}`}
        style={isSplit ? { width: `${100 - splitPercent}%` } : undefined}
      >
        {/* Header — only shown in split mode */}
        {isSplit && (
          <div className="h-9 border-b border-border flex items-center px-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground">Program</span>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Video Preview Canvas */}
          <div ref={previewContainerRef} className="flex-1 min-h-0 relative overflow-hidden">
            <VideoPreview
              project={liveProject}
              containerSize={containerSize}
              suspendOverlay={isSplitDragging}
            />
          </div>

          {/* Playback Controls */}
          <div className="h-16 border-t border-border panel-header flex items-center px-3 flex-shrink-0 gap-3 overflow-hidden">
            <div className="flex-shrink-0">
              <TimecodeDisplay fps={fps} totalFrames={totalFrames} />
            </div>
            <div className="flex-1 min-w-0" />
            <PlaybackControls totalFrames={totalFrames} />
            <div className="flex-1 min-w-0" />
            <div className="flex-shrink-0">
              <PreviewZoomControls />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
});

