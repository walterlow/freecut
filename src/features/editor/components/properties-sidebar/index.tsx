import { Activity, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Settings2 } from 'lucide-react';
import { useItemsStore } from '@/features/editor/deps/timeline-store';
import { useEditorStore } from '@/app/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import type { TimelineItem } from '@/types/timeline';
import { CanvasPanel } from './canvas-panel';
import { ClipPanel } from './clip-panel';
import { MarkerPanel } from './marker-panel';
import { TransitionPanel } from './transition-panel';
import { useSettingsStore } from '@/features/editor/deps/settings';
import {
  EDITOR_LAYOUT_CSS_VALUES,
  clampRightEditorSidebarWidth,
  getEditorLayout,
} from '@/app/editor-layout';

type HeaderItem = Pick<TimelineItem, 'id' | 'label' | 'linkedGroupId' | 'type'>;

function buildClipHeaderGroups(items: HeaderItem[]) {
  const groups = new Map<string, { displayLabel: string | null; labels: string[]; audioOnly: boolean }>();

  for (const item of items) {
    const key = item.linkedGroupId ?? item.id;
    const label = item.label.trim() || null;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        displayLabel: label,
        labels: label ? [label] : [],
        audioOnly: item.type === 'audio',
      });
      continue;
    }

    if (label) {
      existing.labels.push(label);
      if (!existing.displayLabel || (existing.audioOnly && item.type !== 'audio')) {
        existing.displayLabel = label;
      }
    }

    if (item.type !== 'audio') {
      existing.audioOnly = false;
    }
  }

  return Array.from(groups.values(), (group) => ({
    displayLabel: group.displayLabel,
    title: group.labels.filter((label, index, labels) => labels.indexOf(label) === index).join(', '),
  }));
}

function getClipHeader(items: HeaderItem[]) {
  const groups = buildClipHeaderGroups(items);
  const logicalCount = groups.length;

  if (logicalCount === 0) return null;

  if (logicalCount === 1 && groups[0]?.displayLabel) {
    return {
      text: groups[0].displayLabel,
      title: groups[0].title || groups[0].displayLabel,
    };
  }

  const fallbackLabel = `${logicalCount} clip${logicalCount === 1 ? '' : 's'} selected`;

  return {
    text: fallbackLabel,
    title: groups.map((group) => group.title || group.displayLabel).filter(Boolean).join(', ') || fallbackLabel,
  };
}

/**
 * Properties sidebar - right panel for editing properties.
 * Shows TransitionPanel when a transition is selected, MarkerPanel when a marker
 * is selected, ClipPanel when clips are selected, CanvasPanel otherwise.
 */
export const PropertiesSidebar = memo(function PropertiesSidebar() {
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);
  // Use granular selectors - Zustand v5 best practice
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useEditorStore((s) => s.toggleRightSidebar);
  const rightSidebarWidth = useEditorStore((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useEditorStore((s) => s.setRightSidebarWidth);
  const propertiesFullColumn = useEditorStore((s) => s.propertiesFullColumn);
  const togglePropertiesFullColumn = useEditorStore((s) => s.togglePropertiesFullColumn);
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const selectedItems = useItemsStore(
    useShallow(
      useCallback((s) => {
        const items: HeaderItem[] = [];

        for (const itemId of selectedItemIds) {
          const item = s.itemById[itemId];
          if (item) {
            items.push(item);
          }
        }

        return items;
      }, [selectedItemIds])
    )
  );

  const hasClipSelection = selectedItemIds.length > 0;
  const clipHeader = useMemo(
    () => getClipHeader(selectedItems),
    [selectedItems]
  );
  const activeClipHeader = !selectedTransitionId && !selectedMarkerId ? clipHeader : null;

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
      const newWidth = clampRightEditorSidebarWidth(startWidthRef.current + delta, editorLayout);
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
  }, [editorLayout, setRightSidebarWidth]);

  return (
    <>
      {/* Right Sidebar */}
      <div
        className={`panel-bg border-l border-border shrink-0 relative h-full ${
          rightSidebarOpen ? '' : 'w-0'
        }`}
        style={rightSidebarOpen ? { width: rightSidebarWidth, transition: isResizingRef.current ? 'none' : 'width 200ms' } : { transition: 'width 200ms' }}
      >
        {/* Use Activity for React 19 performance optimization */}
        <Activity mode={rightSidebarOpen ? 'visible' : 'hidden'}>
          <div className="h-full flex flex-col" style={{ width: rightSidebarWidth }}>
            {/* Sidebar Header */}
            <div
              className="flex items-center justify-between px-3 border-b border-border flex-shrink-0"
              style={{ height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderHeight }}
            >
              <div className="min-w-0 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  style={{ width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize }}
                  onClick={togglePropertiesFullColumn}
                  data-tooltip={propertiesFullColumn ? 'Dock to preview' : 'Expand full column'}
                  data-tooltip-side="bottom"
                >
                  {propertiesFullColumn ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </Button>
                <Settings2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                <h2 className="min-w-0 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span className="shrink-0 uppercase tracking-wide">Properties</span>
                  {activeClipHeader && (
                    <>
                      <span className="shrink-0">-</span>
                      <span className="truncate normal-case tracking-normal" title={activeClipHeader.title}>
                        {activeClipHeader.text}
                      </span>
                    </>
                  )}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                style={{ width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize }}
                onClick={toggleRightSidebar}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Properties Panel */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]">
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
          className="absolute right-0 top-3 z-10 w-6 bg-secondary/50 hover:bg-secondary border border-border rounded-l-md flex items-center justify-center transition-all hover:w-7"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.sidebarRevealToggleHeight }}
          data-tooltip="Show Properties Panel"
          data-tooltip-side="left"
        >
          <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        </button>
      )}
    </>
  );
});
