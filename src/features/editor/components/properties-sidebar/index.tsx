import { Activity, memo, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editor-store';
import { useSelectionStore } from '../../stores/selection-store';
import { CanvasPanel } from './canvas-panel';
import { ClipPanel } from './clip-panel';
import { MarkerPanel } from './marker-panel';
import { TransitionPanel } from './transition-panel';

/**
 * Properties sidebar - right panel for editing properties.
 * Shows TransitionPanel when a transition is selected, MarkerPanel when a marker
 * is selected, ClipPanel when clips are selected, CanvasPanel otherwise.
 */
export const PropertiesSidebar = memo(function PropertiesSidebar() {
  // Use granular selectors - Zustand v5 best practice
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useEditorStore((s) => s.toggleRightSidebar);
  const rightSidebarWidth = useEditorStore((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useEditorStore((s) => s.setRightSidebarWidth);
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);

  const hasClipSelection = selectedItemIds.length > 0;

  // Resize handle logic
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = rightSidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [rightSidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      // Dragging left increases width for right sidebar
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(500, Math.max(320, startWidthRef.current + delta));
      setRightSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [setRightSidebarWidth]);

  return (
    <>
      {/* Right Sidebar */}
      <div
        className={`panel-bg border-l border-border flex-shrink-0 relative ${
          rightSidebarOpen ? '' : 'w-0'
        }`}
        style={rightSidebarOpen ? { width: rightSidebarWidth, transition: isResizingRef.current ? 'none' : 'width 200ms' } : { transition: 'width 200ms' }}
      >
        {/* Use Activity for React 19 performance optimization */}
        <Activity mode={rightSidebarOpen ? 'visible' : 'hidden'}>
          <div className="h-full flex flex-col" style={{ width: rightSidebarWidth }}>
            {/* Sidebar Header */}
            <div className="h-11 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
              <h2 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
                <Settings2 className="w-3 h-3" />
                Properties
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={toggleRightSidebar}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Properties Panel */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
              {selectedTransitionId ? (
                <TransitionPanel />
              ) : selectedMarkerId ? (
                <MarkerPanel />
              ) : hasClipSelection ? (
                <ClipPanel />
              ) : (
                <CanvasPanel />
              )}
            </div>
          </div>
        </Activity>
        {/* Resize Handle */}
        {rightSidebarOpen && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
          />
        )}
      </div>

      {/* Right Sidebar Toggle */}
      {!rightSidebarOpen && (
        <button
          onClick={toggleRightSidebar}
          className="absolute right-0 top-3 z-10 w-6 h-20 bg-secondary/50 hover:bg-secondary border border-border rounded-l-md flex items-center justify-center transition-all hover:w-7"
          data-tooltip="Show Properties Panel"
          data-tooltip-side="left"
        >
          <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        </button>
      )}
    </>
  );
});
