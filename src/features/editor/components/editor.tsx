import { useEffect, useState, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { createLogger } from '@/shared/logging/logger';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toolbar } from './toolbar';
import { MediaSidebar } from './media-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { PreviewArea } from './preview-area';
import { InteractionLockRegion } from './interaction-lock-region';
import { AudioMeterPanel } from './audio-meter-panel';
import { Timeline, BentoLayoutDialog } from '@/features/editor/deps/timeline-ui';
import { toast } from 'sonner';
import { useEditorHotkeys } from '@/features/editor/hooks/use-editor-hotkeys';
import { useAutoSave } from '../hooks/use-auto-save';
import {
  useTimelineShortcuts,
  useTransitionBreakageNotifications,
} from '@/features/editor/deps/timeline-hooks';
import { initTransitionChainSubscription } from '@/features/editor/deps/timeline-subscriptions';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { importBundleExportDialog } from '@/features/editor/deps/project-bundle';
import { useMediaLibraryStore } from '@/features/editor/deps/media-library';
import { useSettingsStore } from '@/features/editor/deps/settings';
import { useMaskEditorStore } from '@/features/editor/deps/preview';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime';
import { useProjectStore } from '@/features/editor/deps/projects';
import { importExportDialog } from '@/features/editor/deps/export-contract';
import { getEditorLayout, getEditorLayoutCssVars } from '@/app/editor-layout';
import { createProjectUpgradeBackup, formatProjectUpgradeBackupName } from '@/features/editor/deps/projects';
import { ProjectUpgradeDialog } from './project-upgrade-dialog';
import { useClearKeyframesDialogStore } from '@/app/state/clear-keyframes-dialog';
import { useTtsGenerateDialogStore } from '@/app/state/tts-generate-dialog';
import { useProjectMediaMatchDialogStore } from '@/app/state/project-media-match-dialog';
const logger = createLogger('Editor');
const EDITOR_PROJECT_ROUTE_ID = '/editor/$projectId';
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
const LazyClearKeyframesDialog = lazy(() =>
  import('@/features/editor/components/clear-keyframes-dialog').then((module) => ({
    default: module.ClearKeyframesDialog,
  }))
);
const LazyTtsGenerateDialog = lazy(() =>
  import('@/features/editor/components/tts-generate-dialog').then((module) => ({
    default: module.TtsGenerateDialog,
  }))
);
const LazyProjectMediaMatchDialog = lazy(() =>
  import('@/features/editor/components/project-media-match-dialog').then((module) => ({
    default: module.ProjectMediaMatchDialog,
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
  migration: {
    storedSchemaVersion: number;
    currentSchemaVersion: number;
    requiresUpgrade: boolean;
  };
}

/**
 * Video Editor entrypoint.
 * Shows an explicit backup-and-upgrade prompt for legacy projects before loading editor state.
 */
export const Editor = memo(function Editor({ projectId, project, migration }: EditorProps) {
  const navigate = useNavigate();
  const [upgradeApproved, setUpgradeApproved] = useState(!migration.requiresUpgrade);
  const [isPreparingUpgrade, setIsPreparingUpgrade] = useState(false);
  const backupName = formatProjectUpgradeBackupName(
    project.name,
    migration.storedSchemaVersion,
    migration.currentSchemaVersion
  );

  useEffect(() => {
    setUpgradeApproved(!migration.requiresUpgrade);
    setIsPreparingUpgrade(false);
  }, [migration.requiresUpgrade, projectId]);

  const handleCancelUpgrade = useCallback(() => {
    navigate({ to: '/projects' });
  }, [navigate]);

  const handleConfirmUpgrade = useCallback(async () => {
    setIsPreparingUpgrade(true);

    try {
      const backup = await createProjectUpgradeBackup(projectId, {
        fromVersion: migration.storedSchemaVersion,
        toVersion: migration.currentSchemaVersion,
        backupName,
      });
      toast.success('Backup created before upgrade', {
        description: backup.name,
      });
      setUpgradeApproved(true);
    } catch (error) {
      logger.error('Failed to create upgrade backup:', error);
      toast.error('Failed to create backup before upgrade', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsPreparingUpgrade(false);
    }
  }, [
    backupName,
    migration.currentSchemaVersion,
    migration.storedSchemaVersion,
    projectId,
  ]);

  if (!upgradeApproved) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectUpgradeDialog
          open
          projectName={project.name}
          storedSchemaVersion={migration.storedSchemaVersion}
          currentSchemaVersion={migration.currentSchemaVersion}
          backupName={backupName}
          isUpgrading={isPreparingUpgrade}
          onCancel={handleCancelUpgrade}
          onConfirm={handleConfirmUpgrade}
        />
      </div>
    );
  }

  return <LoadedEditor projectId={projectId} project={project} migration={migration} />;
});

const EditorDialogHost = memo(function EditorDialogHost({ projectId }: { projectId: string }) {
  const clearKeyframesDialogOpen = useClearKeyframesDialogStore((s) => s.isOpen);
  const ttsGenerateDialogOpen = useTtsGenerateDialogStore((s) => s.isOpen);
  const projectMediaMatchDialogOpen = useProjectMediaMatchDialogStore(
    (s) => s.isOpen && s.projectId === projectId
  );

  return (
    <>
      {clearKeyframesDialogOpen && (
        <Suspense fallback={null}>
          <LazyClearKeyframesDialog />
        </Suspense>
      )}
      {projectMediaMatchDialogOpen && (
        <Suspense fallback={null}>
          <LazyProjectMediaMatchDialog projectId={projectId} />
        </Suspense>
      )}
      {ttsGenerateDialogOpen && (
        <Suspense fallback={null}>
          <LazyTtsGenerateDialog />
        </Suspense>
      )}
    </>
  );
});

export const LoadedEditor = memo(function LoadedEditor({
  projectId,
  project,
  migration,
}: EditorProps) {
  const router = useRouter();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [bundleExportDialogOpen, setBundleExportDialogOpen] = useState(false);
  const [bundleFileHandle, setBundleFileHandle] = useState<FileSystemFileHandle | undefined>();
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const snapEnabledPreference = useSettingsStore((s) => s.snapEnabled);
  const editorLayout = getEditorLayout(editorDensity);
  const editorLayoutCssVars = getEditorLayoutCssVars(editorLayout);
  const syncSidebarLayout = useEditorStore((s) => s.syncSidebarLayout);
  const propertiesFullColumn = useEditorStore((s) => s.propertiesFullColumn);
  const mediaFullColumn = useEditorStore((s) => s.mediaFullColumn);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);
  const hasRefreshedMigrationStateRef = useRef(false);

  // Guard against concurrent saves (e.g., spamming Ctrl+S)
  const isSavingRef = useRef(false);

  useEffect(() => {
    hasRefreshedMigrationStateRef.current = false;
  }, [projectId]);

  // Initialize transition chain subscription (pre-computes chains from timeline data)
  // This subscription recomputes chains when items/transitions change - deferred to idle
  // time so it doesn't compete with the initial editor render.
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

  // Preload export dialogs during idle time so they open instantly.
  useEffect(() => {
    const id = requestIdleCallback(() => {
      preloadExportDialog();
      preloadBundleExportDialog();
    });
    return () => cancelIdleCallback(id);
  }, []);

  // Initialize timeline from project data (or create default tracks for new projects).
  useEffect(() => {
    const {
      setCurrentProject: setMediaProject,
      loadMediaItems,
    } = useMediaLibraryStore.getState();
    const { setCurrentProject } = useProjectStore.getState();
    const playbackStore = usePlaybackStore.getState();

    // Clear stale scrub preview from previous editor sessions.
    // A non-null previewFrame puts preview into "scrubbing" mode, which can
    // defer media URL resolution during project open.
    playbackStore.setPreviewFrame(null);

    // Set current project context for media library (v3: project-scoped media)
    setMediaProject(projectId);
    void loadMediaItems().catch((error) => {
      logger.error('Failed to load media library:', error);
    });

    // Set current project in project store for properties panel
    setCurrentProject({
      id: project.id,
      name: project.name,
      description: '',
      duration: 0,
      schemaVersion: migration.currentSchemaVersion,
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
    let cancelled = false;

    void (async () => {
      try {
        await loadTimeline(projectId, { allowProjectUpgrade: migration.requiresUpgrade });

        if (cancelled || !migration.requiresUpgrade || hasRefreshedMigrationStateRef.current) {
          return;
        }

        hasRefreshedMigrationStateRef.current = true;

        // Refresh the editor route metadata once the approved legacy project has
        // opened successfully so future reopens do not briefly show the upgrade prompt.
        await router.invalidate({
          filter: (match) =>
            match.routeId === EDITOR_PROJECT_ROUTE_ID &&
            match.params.projectId === projectId,
        });
      } catch (error) {
        logger.error('Failed to load timeline:', error);
      }
    })();

    // Cleanup: clear project context, stop playback, and release blob URLs when leaving editor
    return () => {
      cancelled = true;
      const cleanupPlaybackStore = usePlaybackStore.getState();
      cleanupPlaybackStore.setPreviewFrame(null);
      useMediaLibraryStore.getState().setCurrentProject(null);
      useProjectStore.getState().setCurrentProject(null);
      cleanupPlaybackStore.pause();
      clearPreviewAudioCache();
    };
  }, [
    migration.currentSchemaVersion,
    migration.requiresUpgrade,
    project.backgroundColor,
    project.fps,
    project.height,
    project.id,
    project.name,
    project.width,
    projectId,
    router,
  ]);

  // Track unsaved changes
  const isDirty = useTimelineStore((s: { isDirty: boolean }) => s.isDirty);

  useEffect(() => {
    syncSidebarLayout(editorLayout);
  }, [editorLayout, syncSidebarLayout]);

  useEffect(() => {
    const timelineState = useTimelineStore.getState();
    if (timelineState.snapEnabled !== snapEnabledPreference) {
      timelineState.toggleSnap();
    }
  }, [snapEnabledPreference]);

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
      const safeName = project.name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
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
        // User cancelled the picker - don't open the dialog
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

      {/* Main Layout: Full-height sidebar + vertical split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Media Library (full column mode) */}
        {mediaFullColumn && (
          <InteractionLockRegion locked={isMaskEditingActive}>
            <ErrorBoundary level="feature">
              <MediaSidebar />
            </ErrorBoundary>
          </InteractionLockRegion>
        )}

        {/* Right side: Preview/Properties + Timeline */}
        <ResizablePanelGroup direction="vertical" className="flex-1 min-w-0">
          {/* Top - Preview + Properties (inline mode) */}
          <ResizablePanel
            defaultSize={100 - editorLayout.timelineDefaultSize}
            minSize={100 - editorLayout.timelineMaxSize}
            maxSize={100 - editorLayout.timelineMinSize}
          >
            <div className="h-full flex overflow-hidden relative">
              {/* Left Sidebar - Media Library (inline with preview) */}
              {!mediaFullColumn && (
                <InteractionLockRegion locked={isMaskEditingActive}>
                  <ErrorBoundary level="feature">
                    <MediaSidebar />
                  </ErrorBoundary>
                </InteractionLockRegion>
              )}

              {/* Center - Preview */}
              <ErrorBoundary level="feature">
                <PreviewArea project={project} />
              </ErrorBoundary>

              {/* Right Sidebar - Properties (inline with preview) */}
              {!propertiesFullColumn && (
                <InteractionLockRegion locked={isMaskEditingActive}>
                  <ErrorBoundary level="feature">
                    <PropertiesSidebar />
                  </ErrorBoundary>
                </InteractionLockRegion>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className={isMaskEditingActive ? 'pointer-events-none opacity-60' : undefined}
          />

          {/* Bottom - Timeline */}
          <ResizablePanel
            defaultSize={editorLayout.timelineDefaultSize}
            minSize={editorLayout.timelineMinSize}
            maxSize={editorLayout.timelineMaxSize}
          >
            <InteractionLockRegion locked={isMaskEditingActive} className="h-full">
              <ErrorBoundary level="feature">
                <div className="h-full flex overflow-hidden">
                  <div className="min-w-0 flex-1">
                    <Timeline duration={timelineDuration} />
                  </div>
                  <AudioMeterPanel />
                </div>
              </ErrorBoundary>
            </InteractionLockRegion>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Right Sidebar - Properties (full column mode) */}
        {propertiesFullColumn && (
          <InteractionLockRegion locked={isMaskEditingActive}>
            <ErrorBoundary level="feature">
              <PropertiesSidebar />
            </ErrorBoundary>
          </InteractionLockRegion>
        )}
      </div>

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

      <EditorDialogHost projectId={projectId} />

      {/* Bento Layout Preset Dialog */}
      <BentoLayoutDialog />

    </div>
  );
});
