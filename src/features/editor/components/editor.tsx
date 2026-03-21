import { useEffect, useState, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { createLogger } from '@/shared/logging/logger';
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
import { InteractionLockRegion } from './interaction-lock-region';
import { Timeline, BentoLayoutDialog } from '@/features/editor/deps/timeline-ui';
import { ClearKeyframesDialog } from './clear-keyframes-dialog';
import { toast } from 'sonner';
import { useEditorHotkeys } from '@/features/editor/hooks/use-editor-hotkeys';
import { useAutoSave } from '../hooks/use-auto-save';
import { useTimelineShortcuts, useTransitionBreakageNotifications } from '@/features/editor/deps/timeline-hooks';
import { initTransitionChainSubscription } from '@/features/editor/deps/timeline-subscriptions';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { importBundleExportDialog } from '@/features/editor/deps/project-bundle';
import { useMediaLibraryStore } from '@/features/editor/deps/media-library';
import { useSettingsStore } from '@/features/editor/deps/settings';
import { useMaskEditorStore } from '@/features/editor/deps/preview';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/shared/state/editor';
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime';
import { useProjectStore } from '@/features/editor/deps/projects';
import { importExportDialog } from '@/features/editor/deps/export-contract';
import { getEditorLayout, getEditorLayoutCssVars } from '@/shared/ui/editor-layout';

const logger = createLogger('Editor');
const LazyExportDialog = lazy(() =>
  importExportDialog().then((module) => ({
    default: module.ExportDialog,
  }))
);
const LazyBundleExportDialog = lazy(() =>
  importBundleExportDialog().then((module) => ({
    default: module.BundleExportDialog,
  }))
);

function preloadExportDialog() {
  return importExportDialog();
}

function preloadBundleExportDialog() {
  return importBundleExportDialog();
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
export const Editor = memo(function Editor({ projectId, project }: EditorProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [bundleExportDialogOpen, setBundleExportDialogOpen] = useState(false);
  const [bundleFileHandle, setBundleFileHandle] = useState<FileSystemFileHandle | undefined>();
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);
  const editorLayoutCssVars = getEditorLayoutCssVars(editorLayout);
  const syncSidebarLayout = useEditorStore((s) => s.syncSidebarLayout);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);

  // Guard against concurrent saves (e.g., spamming Ctrl+S)
  const isSavingRef = useRef(false);

  // Refs for imperative panel resizing
  const timelinePanelRef = useRef<ImperativePanelHandle>(null);
  const baseTimelineSizeRef = useRef(30); // Store the user's base timeline size

  // Initialize transition chain subscription (pre-computes chains from timeline data)
  // This subscription recomputes chains when items/transitions change â€” deferred to idle
  // time so it doesn't compete with the initial editor render
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const id = requestIdleCallback(() => {
      unsubscribe = initTransitionChainSubscription();
    });
    return () => {
      cancelIdleCallback(id);
      unsubscribe?.();
    };
  }, []);

  // Preload export dialogs during idle time so they open instantly
  useEffect(() => {
    const id = requestIdleCallback(() => {
      preloadExportDialog();
      preloadBundleExportDialog();
    });
    return () => cancelIdleCallback(id);
  }, []);

  // Initialize timeline from project data (or create default tracks for new projects)
  useEffect(() => {
    const { setCurrentProject: setMediaProject } = useMediaLibraryStore.getState();
    const { setCurrentProject } = useProjectStore.getState();
    const playbackStore = usePlaybackStore.getState();

    // Clear stale scrub preview from previous editor sessions.
    // A non-null previewFrame puts preview into "scrubbing" mode, which can
    // defer media URL resolution during project open.
    playbackStore.setPreviewFrame(null);

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
      const cleanupPlaybackStore = usePlaybackStore.getState();
      cleanupPlaybackStore.setPreviewFrame(null);
      useMediaLibraryStore.getState().setCurrentProject(null);
      useProjectStore.getState().setCurrentProject(null);
      cleanupPlaybackStore.pause();
      clearPreviewAudioCache();
    };
  }, [projectId]); // Re-initialize when projectId changes

  // Track unsaved changes
  const isDirty = useTimelineStore((s: { isDirty: boolean }) => s.isDirty);

  useEffect(() => {
    syncSidebarLayout(editorLayout);
  }, [editorLayout, syncSidebarLayout]);

  useEffect(() => {
    if (!isMaskEditingActive) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }, [isMaskEditingActive]);

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
      const safeName = project.name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').substring(0, 100);
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${safeName}.freecut.zip`,
          types: [
            {
              description: 'FreeCut Project Bundle',
              accept: { 'application/zip': ['.freecut.zip'] },
            },
          ],
        });
        setBundleFileHandle(handle);
      } catch {
        // User cancelled the picker â€” don't open the dialog
        return;
      }
    } else {
      setBundleFileHandle(undefined);
    }

    setBundleExportDialogOpen(true);
  }, [project.name]);

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

  const timelineDuration = 30;

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
      const newSize = Math.min(
        editorLayout.timelineMaxSize,
        baseTimelineSizeRef.current + editorLayout.graphPanelSizeIncrease
      );
      panel.resize(newSize);
      isGraphOpenRef.current = true;
    } else if (!isOpen && isGraphOpenRef.current) {
      // Closing: restore to base size
      panel.resize(baseTimelineSizeRef.current);
      isGraphOpenRef.current = false;
    }
  }, [editorLayout.graphPanelSizeIncrease, editorLayout.timelineMaxSize]);

  return (
    <div
      className="h-screen bg-background flex flex-col overflow-hidden"
      style={editorLayoutCssVars as import('react').CSSProperties}
      role="application"
      aria-label="FreeCut Video Editor"
    >
        {/* Top Toolbar */}
        <InteractionLockRegion locked={isMaskEditingActive}>
          <Toolbar
            projectId={projectId}
            project={project}
            isDirty={isDirty}
            onSave={handleSave}
            onExport={handleExport}
            onExportBundle={handleExportBundle}
          />
        </InteractionLockRegion>

        {/* Resizable Layout: Main Content + Timeline */}
        <ResizablePanelGroup direction="vertical" className="flex-1">
          {/* Main Content Area */}
          <ResizablePanel
            defaultSize={100 - editorLayout.timelineDefaultSize}
            minSize={100 - editorLayout.timelineMaxSize}
            maxSize={100 - editorLayout.timelineMinSize}
          >
            <div className="h-full flex overflow-hidden relative">
              {/* Left Sidebar - Media Library */}
              <InteractionLockRegion locked={isMaskEditingActive}>
                <ErrorBoundary level="feature">
                  <MediaSidebar />
                </ErrorBoundary>
              </InteractionLockRegion>

              {/* Center - Preview */}
              <ErrorBoundary level="feature">
                <PreviewArea project={project} />
              </ErrorBoundary>

              {/* Right Sidebar - Properties */}
              <InteractionLockRegion locked={isMaskEditingActive}>
                <ErrorBoundary level="feature">
                  <PropertiesSidebar />
                </ErrorBoundary>
              </InteractionLockRegion>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className={isMaskEditingActive ? 'pointer-events-none opacity-60' : undefined} />

          {/* Bottom - Timeline */}
          <ResizablePanel
            ref={timelinePanelRef}
            defaultSize={editorLayout.timelineDefaultSize}
            minSize={editorLayout.timelineMinSize}
            maxSize={editorLayout.timelineMaxSize}
          >
            <InteractionLockRegion locked={isMaskEditingActive} className="h-full">
              <ErrorBoundary level="feature">
                <Timeline
                  duration={timelineDuration}
                  onGraphPanelOpenChange={handleGraphPanelOpenChange}
                />
              </ErrorBoundary>
            </InteractionLockRegion>
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
      {!isMaskEditingActive ? <ProjectDebugPanel projectId={projectId} /> : null}
    </div>
  );
});
