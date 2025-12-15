import { useEffect, useState, useRef, useCallback } from 'react';
import { createLogger } from '@/lib/logger';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

const logger = createLogger('Editor');
import { Toolbar } from './toolbar';
import { MediaSidebar } from './media-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { PreviewArea } from './preview-area';
import { ProjectDebugPanel } from './project-debug-panel';
import { Timeline } from '@/features/timeline/components/timeline';
import { ExportDialog } from '@/features/export/components/export-dialog';
import { useEditorHotkeys } from '@/hooks/use-editor-hotkeys';
import { useTimelineShortcuts } from '@/features/timeline/hooks/use-timeline-shortcuts';
import { useTransitionBreakageNotifications } from '@/features/timeline/hooks/use-transition-breakage-notifications';
import { initTransitionChainSubscription } from '@/features/timeline/stores/transition-chain-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from '@/features/timeline/stores/zoom-store';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';
import type { ProjectTimeline } from '@/types/project';

export interface EditorProps {
  projectId: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    backgroundColor?: string;
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

  // Guard against concurrent saves (e.g., spamming Ctrl+S)
  const isSavingRef = useRef(false);

  // Initialize transition chain subscription (pre-computes chains from timeline data)
  // This subscription recomputes chains when items/transitions change
  useEffect(() => {
    const unsubscribe = initTransitionChainSubscription();
    return unsubscribe;
  }, []);

  // Initialize timeline from project data (or create default tracks for new projects)
  useEffect(() => {
    const { setCurrentFrame } = usePlaybackStore.getState();
    const { setZoomLevel } = useZoomStore.getState();
    const { setCurrentProject: setMediaProject } = useMediaLibraryStore.getState();
    const { setCurrentProject } = useProjectStore.getState();

    // Set current project context for media library (v3: project-scoped media)
    setMediaProject(projectId);

    // Set current project in project store for properties panel
    setCurrentProject({
      id: project.id,
      name: project.name,
      description: '',
      duration: 0,
      metadata: {
        width: project.width,
        height: project.height,
        fps: project.fps,
        backgroundColor: project.backgroundColor,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Clear undo/redo history when loading a new project or refreshing
    // History is session-based; the saved state becomes the new ground truth
    useTimelineStore.temporal.getState().clear();

    if (project.timeline) {
      // Load timeline from project data (router already loaded it)
      const tracksWithItems = project.timeline.tracks.map(track => ({
        ...track,
        items: [], // Items are stored separately in the store
      }));

      // Sort tracks by order property to preserve user's track arrangement
      // Use original array index as fallback for tracks without order property
      const sortedTracks = tracksWithItems
        .map((track, index) => ({ track, originalIndex: index }))
        .sort((a, b) => (a.track.order ?? a.originalIndex) - (b.track.order ?? b.originalIndex))
        .map(({ track }) => track);

      // Set both tracks and items from project data
      useTimelineStore.setState({
        tracks: sortedTracks,
        items: project.timeline.items as any, // Type assertion needed for serialization
        inPoint: project.timeline.inPoint ?? null,
        outPoint: project.timeline.outPoint ?? null,
        markers: project.timeline.markers ?? [],
        transitions: (project.timeline.transitions as any) ?? [],
        scrollPosition: project.timeline.scrollPosition ?? 0,
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
      useTimelineStore.setState({
        tracks: [
          {
            id: 'track-1',
            name: 'Track 1',
            height: DEFAULT_TRACK_HEIGHT,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [],
          },
        ],
        items: [],
        inPoint: null,
        outPoint: null,
      });

      // Reset playback and view state for new projects
      setCurrentFrame(0);
      setZoomLevel(1);
    }

    // Cleanup: clear project context and stop playback when leaving editor
    return () => {
      useMediaLibraryStore.getState().setCurrentProject(null);
      useProjectStore.getState().setCurrentProject(null);
      usePlaybackStore.getState().pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project]); // Re-initialize when projectId or project data changes

  // Track unsaved changes
  const isDirty = useTimelineStore((s: { isDirty: boolean }) => s.isDirty);

  // Save timeline to project (with guard against concurrent saves)
  const handleSave = useCallback(async () => {
    // Prevent concurrent saves (e.g., spamming Ctrl+S)
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    const { saveTimeline } = useTimelineStore.getState();

    try {
      await saveTimeline(projectId);
      logger.debug('Project saved successfully');
      // TODO: Show success toast notification
    } catch (error) {
      logger.error('Failed to save project:', error);
      // TODO: Show error toast notification
      throw error; // Re-throw so callers know save failed
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId]);

  const handleExport = () => {
    setExportDialogOpen(true);
  };

  const handleExportBundle = async () => {
    try {
      // Dynamically import to avoid loading bundle service until needed
      const { exportProjectBundle, downloadBundle } = await import(
        '@/features/project-bundle/services/bundle-export-service'
      );

      // Save timeline first to ensure latest changes are included
      await handleSave();

      logger.debug('Exporting project bundle...');
      const result = await exportProjectBundle(projectId, (progress) => {
        logger.debug(`Export progress: ${progress.percent}% - ${progress.stage}`);
      });

      // Trigger download
      downloadBundle(result);
      logger.debug(`Project bundle exported: ${result.filename} (${result.mediaCount} media files)`);
    } catch (error) {
      logger.error('Failed to export project bundle:', error);
      // TODO: Show error toast notification
    }
  };

  // Enable keyboard shortcuts
  useEditorHotkeys({
    onSave: handleSave,
    onExport: handleExport,
  });

  // Enable timeline shortcuts (space, cut tool, rate tool, etc.)
  useTimelineShortcuts();

  // Enable transition breakage notifications
  useTransitionBreakageNotifications();

  // TODO: Get actual timeline duration from project/timeline store
  const timelineDuration = 30; // 30 seconds placeholder

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <Toolbar
          projectId={projectId}
          project={project}
          isDirty={isDirty}
          onSave={handleSave}
          onExport={handleExport}
          onExportBundle={handleExportBundle}
        />

        {/* Resizable Layout: Main Content + Timeline */}
        <ResizablePanelGroup direction="vertical" className="flex-1">
          {/* Main Content Area */}
          <ResizablePanel defaultSize={70} minSize={50} maxSize={85}>
            <div className="h-full flex overflow-hidden relative">
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

      {/* Debug Panel (dev mode only) */}
      <ProjectDebugPanel projectId={projectId} />
    </div>
  );
}
