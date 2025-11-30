import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Layers,
  Type,
  Shapes,
} from 'lucide-react';
import { useEditorStore } from '../stores/editor-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '../stores/selection-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { MediaLibrary } from '@/features/media-library/components/media-library';
import { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils';
import type { TextItem } from '@/types/timeline';

export function MediaSidebar() {
  // Use granular selectors - Zustand v5 best practice
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  // Timeline and playback stores for adding elements
  // Don't subscribe to currentFrame - read from store in callbacks to avoid re-renders during playback
  const addItem = useTimelineStore((s) => s.addItem);
  const tracks = useTimelineStore((s) => s.tracks);
  const items = useTimelineStore((s) => s.items);
  const fps = useTimelineStore((s) => s.fps);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Add text item to timeline at the best available position
  const handleAddText = useCallback(() => {
    // Use active track if available and not locked, otherwise find first available
    let targetTrack = activeTrackId
      ? tracks.find((t) => t.id === activeTrackId && t.visible !== false && !t.locked)
      : null;

    // Fallback to first available visible/unlocked track
    if (!targetTrack) {
      targetTrack = tracks.find((t) => t.visible !== false && !t.locked);
    }

    if (!targetTrack) {
      console.warn('No available track for text item');
      return;
    }

    // Default duration: 5 seconds
    const durationInFrames = fps * 5;

    // Find the best position: start at playhead, find nearest available space
    // Read currentFrame from store directly to avoid subscription
    const proposedPosition = usePlaybackStore.getState().currentFrame;
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      targetTrack.id,
      items
    ) ?? proposedPosition; // Fallback to proposed if no space found

    // Get canvas dimensions for initial transform
    const canvasWidth = currentProject?.metadata.width ?? 1920;
    const canvasHeight = currentProject?.metadata.height ?? 1080;

    // Create a new text item
    const textItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      label: 'Text',
      text: 'Your Text Here',
      fontSize: 60,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      color: '#ffffff',
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      // Center the text on canvas
      transform: {
        x: 0,
        y: 0,
        width: canvasWidth * 0.8,
        height: canvasHeight * 0.3,
        rotation: 0,
        opacity: 1,
      },
    };

    addItem(textItem);
    // Select the new item
    selectItems([textItem.id]);
  }, [tracks, items, fps, currentProject, addItem, selectItems, activeTrackId]);

  return (
    <>
      {/* Left Sidebar */}
      <div
        className={`panel-bg border-r border-border transition-all duration-200 flex-shrink-0 ${
          leftSidebarOpen ? 'w-72' : 'w-0'
        }`}
      >
        <div className={`h-full flex flex-col w-72 ${leftSidebarOpen ? 'block' : 'hidden'}`}>
          {/* Sidebar Header */}
          <div className="h-11 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-1">
              <Button
                variant={activeTab === 'media' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setActiveTab('media')}
              >
                <Film className="w-3 h-3 mr-1" />
                Media
              </Button>
              <Button
                variant={activeTab === 'elements' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setActiveTab('elements')}
              >
                <Shapes className="w-3 h-3 mr-1" />
                Elements
              </Button>
              <Button
                variant={activeTab === 'effects' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setActiveTab('effects')}
              >
                <Layers className="w-3 h-3 mr-1" />
                Effects
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleLeftSidebar}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>

          {/* Media Tab - Full Media Library */}
          <div className={`flex-1 overflow-hidden ${activeTab === 'media' ? 'block' : 'hidden'}`}>
            <MediaLibrary />
          </div>

          {/* Elements Tab - Text and Shapes */}
          <div className={`flex-1 overflow-y-auto p-3 ${activeTab === 'elements' ? 'block' : 'hidden'}`}>
            <div className="space-y-4">
              {/* Text Section */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Text
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleAddText}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-md bg-timeline-text/20 border border-timeline-text/50 flex items-center justify-center group-hover:bg-timeline-text/30">
                      <Type className="w-5 h-5 text-timeline-text" />
                    </div>
                    <span className="text-xs text-muted-foreground group-hover:text-foreground">
                      Add Text
                    </span>
                  </button>
                </div>
              </div>

              {/* Shapes Section - Placeholder */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Shapes
                </h3>
                <div className="text-center py-6 text-muted-foreground text-xs">
                  Coming soon
                </div>
              </div>
            </div>
          </div>

          {/* Effects Tab */}
          <div className={`flex-1 overflow-y-auto p-3 ${activeTab === 'effects' ? 'block' : 'hidden'}`}>
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-50" />
              Effects library coming soon
            </div>
          </div>
        </div>
      </div>

      {/* Left Sidebar Toggle */}
      {!leftSidebarOpen && (
        <button
          onClick={toggleLeftSidebar}
          className="absolute left-0 top-3 z-10 w-6 h-20 bg-secondary/50 hover:bg-secondary border border-border rounded-r-md flex items-center justify-center transition-all hover:w-7"
          data-tooltip="Show Media Panel"
          data-tooltip-side="right"
        >
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </button>
      )}
    </>
  );
}
