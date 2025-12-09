import { Activity } from 'react';
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
export function PropertiesSidebar() {
  // Use granular selectors - Zustand v5 best practice
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useEditorStore((s) => s.toggleRightSidebar);
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);

  const hasClipSelection = selectedItemIds.length > 0;

  return (
    <>
      {/* Right Sidebar */}
      <div
        className={`panel-bg border-l border-border transition-all duration-200 flex-shrink-0 ${
          rightSidebarOpen ? 'w-[340px]' : 'w-0'
        }`}
      >
        {/* Use Activity for React 19 performance optimization */}
        <Activity mode={rightSidebarOpen ? 'visible' : 'hidden'}>
          <div className="h-full flex flex-col w-[340px]">
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
}
