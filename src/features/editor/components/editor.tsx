import { useEffect, useState, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { createLogger } from '@/lib/logger';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toolbar } from './toolbar';
import { MediaSidebar } from './media-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { PreviewArea } from './preview-area';
import { ProjectDebugPanel } from './project-debug-panel';
import { Timeline } from '@/features/timeline/components/timeline';
import { ClearKeyframesDialog } from './clear-keyframes-dialog';
import { BentoLayoutDialog } from '@/features/timeline/components/bento-layout-dialog';
import { toast } from 'sonner';
import { useEditorHotkeys } from '@/features/editor/hooks/use-editor-hotkeys';
import { useAutoSave } from '../hooks/use-auto-save';
import { useTimelineShortcuts } from '@/features/timeline/hooks/use-timeline-shortcuts';
import { useTransitionBreakageNotifications } from '@/features/timeline/hooks/use-transition-breakage-notifications';
import { initTransitionChainSubscription } from '@/features/timeline/stores/transition-chain-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { cleanupBlobUrls } from '@/features/preview/utils/media-resolver';
import { clearPreviewAudioCache } from '@/lib/composition-runtime/utils/audio-decode-cache';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { useProjectStore } from '@/features/projects/stores/project-store';

const logger = createLogger('Editor');
const LazyExportDialog = lazy(() =>
  import('@/features/export/components/export-dialog').then((module) => ({
    default: module.ExportDialog,
  }))
);
const LazyBundleExportDialog = lazy(() =>
  import('@/features/project-bundle/components/bundle-export-dialog').then((module) => ({
    default: module.BundleExportDialog,
  }))
);

function preloadExportDialog() {
  return import('@/features/export/components/export-dialog');
}

function preloadBundleExportDialog() {
  return import('@/features/project-bundle/components/bundle-export-dialog');
}

/** Project metadata passed from route loader (timeline loaded separately via loadTimeline) */
interface EditorProps {
  projectId: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    backgroundColor?: string;
  };
}

/**
 * Video Editor Component
 * Memoized to prevent re-renders from route changes cascading to all children.
 */
/** Extra percentage to add to timeline panel when graph editor is open */
const GRAPH_PANEL_SIZE_INCREASE = 12; // ~12% extra height

export const Editor = memo(function Editor({ projectId, project }: EditorProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [bundleExportDialogOpen, setBundleExportDialogOpen] = useState(false);
  const [bundleFileHandle, setBundleFileHandle] = useState<FileSystemFileHandle | undefined>();

  // Guard against concurrent saves (e.g., spamming Ctrl+S)
  const isSavingRef = useRef(false);

  // Refs for imperative panel resizing
  const timelinePanelRef = useRef<ImperativePanelHandle>(null);
  const baseTimelineSizeRef = useRef(30); // Store the user's base timeline size

  // Initialize transition chain subscription (pre-computes chains from timeline data)
  // This subscription recomputes chains when items/transitions change
  useEffect(() => {
    const unsubscribe = initTransitionChainSubscription();
    return unsubscribe;
  }, []);

  // Initialize timeline from project data (or create default tracks for new projects)
  useEffect(() => {
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

    // Load timeline from IndexedDB - single source of truth for all timeline state
    const { loadTimeline } = useTimelineStore.getState();
    loadTimeline(projectId).catch((error) => {
      logger.error('Failed to load timeline:', error);
    });

    // Cleanup: clear project context, stop playback, and release blob URLs when leaving editor
    return () => {
      useMediaLibraryStore.getState().setCurrentProject(null);
      useProjectStore.getState().setCurrentProject(null);
      usePlaybackStore.getState().pause();
      cleanupBlobUrls();
      clearPreviewAudioCache();
    };
  }, [projectId]); // Re-initialize when projectId changes

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
      toast.success('Project saved');
    } catch (error) {
      logger.error('Failed to save project:', error);
      toast.error('Failed to save project');
      throw error; // Re-throw so callers know save failed
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId]);

  const handleExport = useCallback(() => {
    // Pause playback when opening export dialog
    usePlaybackStore.getState().pause();
    void preloadExportDialog();
    setExportDialogOpen(true);
  }, []);

  const handleExportBundle = useCallback(async () => {
    void preloadBundleExportDialog();

    // Show native save picker BEFORE opening the modal dialog to avoid
    // focus-loss conflicts between the native picker and Radix Dialog.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'project.freecut.zip',
          types: [
            {
              description: 'FreeCut Project Bundle',
              accept: { 'application/zip': ['.freecut.zip'] },
            },
          ],
        });
        setBundleFileHandle(handle);
      } catch {
        // User cancelled the picker — don't open the dialog
        return;
      }
    } else {
      setBundleFileHandle(undefined);
    }

    setBundleExportDialogOpen(true);
  }, []);

  // Enable keyboard shortcuts
  useEditorHotkeys({
    onSave: handleSave,
    onExport: handleExport,
  });

  // Enable auto-save based on settings interval
  useAutoSave({
    isDirty,
    onSave: handleSave,
  });

  // Enable timeline shortcuts (space, cut tool, rate tool, etc.)
  useTimelineShortcuts();

  // Enable transition breakage notifications
  useTransitionBreakageNotifications();

  // TODO: Get actual timeline duration from project/timeline store
  const timelineDuration = 30; // 30 seconds placeholder

  // Track whether graph panel is currently open to avoid storing expanded size as base
  const isGraphOpenRef = useRef(false);

  // Handle graph panel open/close - resize timeline panel accordingly
  // Note: Resizing the graph panel via drag handle does NOT affect the overall timeline panel size.
  // Only opening/closing the graph panel changes the timeline panel size.
  const handleGraphPanelOpenChange = useCallback((isOpen: boolean) => {
    const panel = timelinePanelRef.current;
    if (!panel) return;

    if (isOpen && !isGraphOpenRef.current) {
      // Opening: store current size before expanding (only if not already open)
      baseTimelineSizeRef.current = panel.getSize();
      // Expand panel to accommodate graph editor
      const newSize = Math.min(50, baseTimelineSizeRef.current + GRAPH_PANEL_SIZE_INCREASE);
      panel.resize(newSize);
      isGraphOpenRef.current = true;
    } else if (!isOpen && isGraphOpenRef.current) {
      // Closing: restore to base size
      panel.resize(baseTimelineSizeRef.current);
      isGraphOpenRef.current = false;
    }
  }, []);

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
              <ErrorBoundary level="feature">
                <MediaSidebar />
              </ErrorBoundary>

              {/* Center - Preview */}
              <ErrorBoundary level="feature">
                <PreviewArea project={project} />
              </ErrorBoundary>

              {/* Right Sidebar - Properties */}
              <ErrorBoundary level="feature">
                <PropertiesSidebar />
              </ErrorBoundary>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Bottom - Timeline */}
          <ResizablePanel
            ref={timelinePanelRef}
            defaultSize={30}
            minSize={15}
            maxSize={50}
          >
            <ErrorBoundary level="feature">
              <Timeline
                duration={timelineDuration}
                onGraphPanelOpenChange={handleGraphPanelOpenChange}
              />
            </ErrorBoundary>
          </ResizablePanel>
        </ResizablePanelGroup>

      <Suspense fallback={null}>
        {/* Export Dialog */}
        {exportDialogOpen && (
          <LazyExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
        )}

        {/* Bundle Export Dialog */}
        {bundleExportDialogOpen && (
          <LazyBundleExportDialog
            open={bundleExportDialogOpen}
            onClose={() => {
              setBundleExportDialogOpen(false);
              setBundleFileHandle(undefined);
            }}
            projectId={projectId}
            onBeforeExport={handleSave}
            fileHandle={bundleFileHandle}
          />
        )}
      </Suspense>

      {/* Clear Keyframes Confirmation Dialog */}
      <ClearKeyframesDialog />

      {/* Bento Layout Preset Dialog */}
      <BentoLayoutDialog />

      {/* Debug Panel (dev mode only) */}
      <ProjectDebugPanel projectId={projectId} />
    </div>
  );
});
