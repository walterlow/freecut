import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { Columns2 } from 'lucide-react';
import {
  VideoPreview,
  PlaybackControls,
  TimecodeDisplay,
  PreviewZoomControls,
  SourceMonitor,
  ColorScopesMonitor,
} from '@/features/editor/deps/preview';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useProjectStore } from '@/features/editor/deps/projects';
import { useSettingsStore } from '@/features/editor/deps/settings';
import { useMaskEditorStore } from '@/features/editor/deps/preview';
import { useEditorStore } from '@/shared/state/editor';
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/shared/ui/editor-layout';
import { InteractionLockRegion } from './interaction-lock-region';

interface PreviewAreaProps {
  project: {
    width: number;
    height: number;
    fps: number;
  };
}

const DEFAULT_EMPTY_TIMELINE_SECONDS = 10;
const PREVIEW_RESIZE_MIN_UPDATE_MS = 33;
const SPLIT_DRAG_MIN_UPDATE_MS = 33;
const PREVIEW_SOURCE_SPLIT_DEFAULT_PERCENT = 50;
const PREVIEW_SCOPES_SPLIT_DEFAULT_PERCENT = 32;
const PREVIEW_SIDE_PANEL_MIN_PERCENT = 22;
const PREVIEW_SIDE_PANEL_MAX_PERCENT = 55;
const PREVIEW_PROGRAM_MIN_PERCENT = 30;

function clampSidePanelPercent(nextPercent: number, oppositePercent: number): number {
  const maxPercent = Math.max(
    0,
    Math.min(
      PREVIEW_SIDE_PANEL_MAX_PERCENT,
      100 - PREVIEW_PROGRAM_MIN_PERCENT - oppositePercent
    )
  );
  const minPercent = Math.min(PREVIEW_SIDE_PANEL_MIN_PERCENT, maxPercent);
  return Math.min(maxPercent, Math.max(minPercent, nextPercent));
}

function PreviewSplitHandle({
  onMouseDown,
  onReset,
  showReset,
  resetLabel,
  resetTooltip,
}: {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onReset: () => void;
  showReset: boolean;
  resetLabel: string;
  resetTooltip: string;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary/70 bg-border transition-colors flex-shrink-0 relative group"
    >
      {showReset && (
        <button
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onReset}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-primary hover:border-primary hover:[&>svg]:text-primary-foreground"
          aria-label={resetLabel}
          data-tooltip={resetTooltip}
        >
          <Columns2 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

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
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);
  const isPenModeActive = useMaskEditorStore((s) => s.penMode);

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
      const nextWidth = Math.max(0, Math.floor(rect.width - editorLayout.previewPadding));
      const nextHeight = Math.max(0, Math.floor(rect.height - editorLayout.previewPadding));

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

    updateSize();

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [editorLayout.previewPadding]);

  const liveProject = useMemo(
    () => ({ width, height, fps, backgroundColor }),
    [width, height, fps, backgroundColor]
  );

  const sourcePreviewMediaId = useEditorStore((s) => s.sourcePreviewMediaId);
  const colorScopesOpen = useEditorStore((s) => s.colorScopesOpen);

  const [sourceSplitPercent, setSourceSplitPercent] = useState(PREVIEW_SOURCE_SPLIT_DEFAULT_PERCENT);
  const [scopesSplitPercent, setScopesSplitPercent] = useState(PREVIEW_SCOPES_SPLIT_DEFAULT_PERCENT);
  const [isPanelDragging, setIsPanelDragging] = useState(false);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSourceSplitRef = useRef(false);
  const pendingSourceSplitPercentRef = useRef<number | null>(null);
  const sourceSplitDragRafRef = useRef<number | null>(null);
  const lastSourceSplitDragUpdateTsRef = useRef(0);
  const sourceSplitDragCleanupRef = useRef<(() => void) | null>(null);
  const isDraggingScopesSplitRef = useRef(false);
  const pendingScopesSplitPercentRef = useRef<number | null>(null);
  const scopesSplitDragRafRef = useRef<number | null>(null);
  const lastScopesSplitDragUpdateTsRef = useRef(0);
  const scopesSplitDragCleanupRef = useRef<(() => void) | null>(null);

  const handleCloseSourceMonitor = useCallback(() => {
    useEditorStore.getState().setSourcePreviewMediaId(null);
  }, []);

  const handleCloseColorScopes = useCallback(() => {
    useEditorStore.getState().setColorScopesOpen(false);
  }, []);

  const displayedSourceSplitPercent = sourcePreviewMediaId
    ? clampSidePanelPercent(sourceSplitPercent, colorScopesOpen ? scopesSplitPercent : 0)
    : 0;
  const displayedScopesSplitPercent = colorScopesOpen
    ? clampSidePanelPercent(scopesSplitPercent, sourcePreviewMediaId ? displayedSourceSplitPercent : 0)
    : 0;
  const sourceResetPercent = sourcePreviewMediaId
    ? clampSidePanelPercent(
      PREVIEW_SOURCE_SPLIT_DEFAULT_PERCENT,
      colorScopesOpen ? displayedScopesSplitPercent : 0
    )
    : PREVIEW_SOURCE_SPLIT_DEFAULT_PERCENT;
  const scopesResetPercent = colorScopesOpen
    ? clampSidePanelPercent(
      PREVIEW_SCOPES_SPLIT_DEFAULT_PERCENT,
      sourcePreviewMediaId ? displayedSourceSplitPercent : 0
    )
    : PREVIEW_SCOPES_SPLIT_DEFAULT_PERCENT;

  useEffect(() => {
    if (sourcePreviewMediaId) {
      setSourceSplitPercent((prev) => {
        const next = clampSidePanelPercent(prev, colorScopesOpen ? scopesSplitPercent : 0);
        return prev === next ? prev : next;
      });
    }

    if (colorScopesOpen) {
      setScopesSplitPercent((prev) => {
        const next = clampSidePanelPercent(prev, sourcePreviewMediaId ? sourceSplitPercent : 0);
        return prev === next ? prev : next;
      });
    }
  }, [colorScopesOpen, scopesSplitPercent, sourcePreviewMediaId, sourceSplitPercent]);

  const handleResetSourceSplit = useCallback(() => {
    setSourceSplitPercent(sourceResetPercent);
  }, [sourceResetPercent]);

  const handleResetScopesSplit = useCallback(() => {
    setScopesSplitPercent(scopesResetPercent);
  }, [scopesResetPercent]);

  const handleSourceSplitDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDraggingSourceSplitRef.current = true;
    setIsPanelDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      if (!isDraggingSourceSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      pendingSourceSplitPercentRef.current = ((mouseEvent.clientX - rect.left) / rect.width) * 100;

      if (sourceSplitDragRafRef.current !== null) return;
      sourceSplitDragRafRef.current = requestAnimationFrame(() => {
        sourceSplitDragRafRef.current = null;
        const now = performance.now();
        if (now - lastSourceSplitDragUpdateTsRef.current < SPLIT_DRAG_MIN_UPDATE_MS) {
          return;
        }
        lastSourceSplitDragUpdateTsRef.current = now;
        const pendingPercent = pendingSourceSplitPercentRef.current;
        if (pendingPercent !== null) {
          setSourceSplitPercent(
            clampSidePanelPercent(
              pendingPercent,
              colorScopesOpen ? displayedScopesSplitPercent : 0
            )
          );
        }
      });
    };

    const cleanup = () => {
      const pendingPercent = pendingSourceSplitPercentRef.current;
      if (pendingPercent !== null) {
        setSourceSplitPercent(
          clampSidePanelPercent(
            pendingPercent,
            colorScopesOpen ? displayedScopesSplitPercent : 0
          )
        );
      }
      if (sourceSplitDragRafRef.current !== null) {
        cancelAnimationFrame(sourceSplitDragRafRef.current);
        sourceSplitDragRafRef.current = null;
      }
      isDraggingSourceSplitRef.current = false;
      pendingSourceSplitPercentRef.current = null;
      setIsPanelDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      sourceSplitDragCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      cleanup();
    };

    sourceSplitDragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [colorScopesOpen, displayedScopesSplitPercent]);

  const handleScopesSplitDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDraggingScopesSplitRef.current = true;
    setIsPanelDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      if (!isDraggingScopesSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      pendingScopesSplitPercentRef.current = ((rect.right - mouseEvent.clientX) / rect.width) * 100;

      if (scopesSplitDragRafRef.current !== null) return;
      scopesSplitDragRafRef.current = requestAnimationFrame(() => {
        scopesSplitDragRafRef.current = null;
        const now = performance.now();
        if (now - lastScopesSplitDragUpdateTsRef.current < SPLIT_DRAG_MIN_UPDATE_MS) {
          return;
        }
        lastScopesSplitDragUpdateTsRef.current = now;
        const pendingPercent = pendingScopesSplitPercentRef.current;
        if (pendingPercent !== null) {
          setScopesSplitPercent(
            clampSidePanelPercent(
              pendingPercent,
              sourcePreviewMediaId ? displayedSourceSplitPercent : 0
            )
          );
        }
      });
    };

    const cleanup = () => {
      const pendingPercent = pendingScopesSplitPercentRef.current;
      if (pendingPercent !== null) {
        setScopesSplitPercent(
          clampSidePanelPercent(
            pendingPercent,
            sourcePreviewMediaId ? displayedSourceSplitPercent : 0
          )
        );
      }
      if (scopesSplitDragRafRef.current !== null) {
        cancelAnimationFrame(scopesSplitDragRafRef.current);
        scopesSplitDragRafRef.current = null;
      }
      isDraggingScopesSplitRef.current = false;
      pendingScopesSplitPercentRef.current = null;
      setIsPanelDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      scopesSplitDragCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      cleanup();
    };

    scopesSplitDragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [displayedSourceSplitPercent, sourcePreviewMediaId]);

  useEffect(() => {
    return () => {
      sourceSplitDragCleanupRef.current?.();
      scopesSplitDragCleanupRef.current?.();
    };
  }, []);

  const hasSidePanels = !!sourcePreviewMediaId || colorScopesOpen;
  const programPanelPercent = Math.max(
    0,
    100 - displayedSourceSplitPercent - displayedScopesSplitPercent
  );

  return (
    <div ref={splitContainerRef} className="flex-1 flex min-h-0 min-w-0 relative">
      {sourcePreviewMediaId && (
        <>
          <InteractionLockRegion
            locked={isPenModeActive}
            className="h-full"
            overlayClassName="rounded-none"
            style={{ width: `${displayedSourceSplitPercent}%` }}
          >
            <div className="flex h-full flex-col min-w-0">
              <SourceMonitor
                key={sourcePreviewMediaId}
                mediaId={sourcePreviewMediaId}
                onClose={handleCloseSourceMonitor}
              />
            </div>
          </InteractionLockRegion>
          <InteractionLockRegion locked={isPenModeActive} overlayClassName="rounded-none">
            <PreviewSplitHandle
              onMouseDown={handleSourceSplitDragStart}
              onReset={handleResetSourceSplit}
              showReset={Math.abs(displayedSourceSplitPercent - sourceResetPercent) > 0.5}
              resetLabel="Reset source monitor width"
              resetTooltip="Reset Source Monitor Width"
            />
          </InteractionLockRegion>
        </>
      )}

      <div
        className={`flex flex-col min-w-0 min-h-0 ${hasSidePanels ? '' : 'flex-1'}`}
        style={hasSidePanels ? { width: `${programPanelPercent}%` } : undefined}
      >
        {hasSidePanels && (
          <div
            className="border-b border-border flex items-center px-3 flex-shrink-0"
            style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewSplitHeaderHeight }}
          >
            <span className="text-xs text-muted-foreground">Program</span>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div ref={previewContainerRef} className="flex-1 min-h-0 relative overflow-hidden">
            <VideoPreview
              project={liveProject}
              containerSize={containerSize}
              suspendOverlay={isPanelDragging}
            />
          </div>

          <InteractionLockRegion locked={isPenModeActive} overlayClassName="rounded-none">
            <div
              className="border-t border-border panel-header flex items-center px-3 flex-shrink-0 gap-2.5 overflow-hidden"
              style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewControlsHeight }}
            >
              <div className="flex-shrink-0">
                <TimecodeDisplay fps={fps} totalFrames={totalFrames} />
              </div>
              <div className="flex-1 min-w-0" />
              <PlaybackControls totalFrames={totalFrames} fps={fps} />
              <div className="flex-1 min-w-0" />
              <div className="flex items-center gap-2 flex-shrink-0">
                <PreviewZoomControls />
              </div>
            </div>
          </InteractionLockRegion>
        </div>
      </div>

      {colorScopesOpen && (
        <>
          <InteractionLockRegion locked={isPenModeActive} overlayClassName="rounded-none">
            <PreviewSplitHandle
              onMouseDown={handleScopesSplitDragStart}
              onReset={handleResetScopesSplit}
              showReset={Math.abs(displayedScopesSplitPercent - scopesResetPercent) > 0.5}
              resetLabel="Reset color scopes width"
              resetTooltip="Reset Color Scopes Width"
            />
          </InteractionLockRegion>
          <InteractionLockRegion
            locked={isPenModeActive}
            className="h-full"
            overlayClassName="rounded-none"
            style={{ width: `${displayedScopesSplitPercent}%` }}
          >
            <div className="flex h-full flex-col min-w-0">
              <ColorScopesMonitor onClose={handleCloseColorScopes} />
            </div>
          </InteractionLockRegion>
        </>
      )}
    </div>
  );
});
