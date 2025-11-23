import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Toolbar } from './toolbar';
import { MediaSidebar } from './media-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { PreviewArea } from './preview-area';
import { Timeline } from '@/features/timeline/components/timeline';
import { ExportDialog } from '@/features/export/components/export-dialog';
import { useTimelineShortcuts } from '@/features/timeline/hooks/use-timeline-shortcuts';
import { useEditorHotkeys } from '@/hooks/use-editor-hotkeys';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from '@/features/timeline/stores/zoom-store';
import type { ProjectTimeline } from '@/types/project';

export interface EditorProps {
  projectId: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    timeline?: ProjectTimeline;
  };
}

/**
 * Video Editor Component
 *
 * Modular architecture following CLAUDE.md guidelines:
 * - Uses Zustand stores with granular selectors (not local useState)
 * - Composed of specialized components (toolbar, sidebars, preview, timeline)
 * - React 19 optimizations with Activity components in sidebars
 * - Zundo temporal middleware for undo/redo in timeline
 * - Comprehensive keyboard shortcuts
 */
export function Editor({ projectId, project }: EditorProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Initialize timeline from project data (or create default tracks for new projects)
  useEffect(() => {
    const { setTracks } = useTimelineStore.getState();
    const { setCurrentFrame } = usePlaybackStore.getState();
    const { setZoomLevel } = useZoomStore.getState();

    if (project.timeline) {
      // Load timeline from project data (router already loaded it)
      const tracksWithItems = project.timeline.tracks.map(track => ({
        ...track,
        items: [], // Items are stored separately in the store
      }));

      // Set both tracks and items from project data
      useTimelineStore.setState({
        tracks: tracksWithItems,
        items: project.timeline.items as any, // Type assertion needed for serialization
      });

      // Restore playback and view state
      if (project.timeline.currentFrame !== undefined) {
        setCurrentFrame(project.timeline.currentFrame);
      } else {
        setCurrentFrame(0);
      }

      if (project.timeline.zoomLevel !== undefined) {
        setZoomLevel(project.timeline.zoomLevel);
      } else {
        setZoomLevel(1);
      }
    } else {
      // Initialize with default tracks for new projects
      setTracks([
        {
          id: 'track-1',
          name: 'Track 1',
          height: 64,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
        {
          id: 'track-2',
          name: 'Track 2',
          height: 64,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [],
        },
        {
          id: 'track-3',
          name: 'Track 3',
          height: 56,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 2,
          items: [],
        },
      ]);

      // Reset playback and view state for new projects
      setCurrentFrame(0);
      setZoomLevel(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project.timeline]); // Re-initialize when projectId or timeline data changes

  // Save timeline to project
  const handleSave = async () => {
    const { saveTimeline } = useTimelineStore.getState();
    try {
      await saveTimeline(projectId);
      console.log('Project saved successfully');
      // TODO: Show success toast notification
    } catch (error) {
      console.error('Failed to save project:', error);
      // TODO: Show error toast notification
    }
  };

  const handleExport = () => {
    setExportDialogOpen(true);
  };

  // Enable keyboard shortcuts
  useEditorHotkeys({
    onSave: handleSave,
    onExport: handleExport,
  });

  useTimelineShortcuts({
    onPlay: () => console.log('Playing'),
    onPause: () => console.log('Paused'),
    onSplit: () => console.log('Split item'),
    onDelete: () => console.log('Delete items'),
    onUndo: () => console.log('Undo'),
    onRedo: () => console.log('Redo'),
  });

  // TODO: Get actual timeline duration from project/timeline store
  const timelineDuration = 30; // 30 seconds placeholder

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <Toolbar
          projectId={projectId}
          project={project}
          onSave={handleSave}
          onExport={handleExport}
        />

        {/* Resizable Layout: Main Content + Timeline */}
        <ResizablePanelGroup direction="vertical" className="flex-1">
          {/* Main Content Area */}
          <ResizablePanel defaultSize={70} minSize={50} maxSize={85}>
            <div className="h-full flex overflow-hidden">
              {/* Left Sidebar - Media Library */}
              <MediaSidebar />

              {/* Center - Preview */}
              <PreviewArea project={project} />

              {/* Right Sidebar - Properties */}
              <PropertiesSidebar />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Bottom - Timeline */}
          <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
            <Timeline duration={timelineDuration} />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Export Dialog */}
        <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
      </div>
    </TooltipProvider>
  );
}
