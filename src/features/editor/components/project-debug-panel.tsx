/**
 * Project Debug Panel
 *
 * Floating debug panel for project data operations.
 * Only visible in development mode.
 */

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/shared/ui/cn';
import {
  Bug,
  Download,
  Upload,
  Clipboard,
  ClipboardPaste,
  FileJson,
  Database,
  CheckCircle,
  XCircle,
  ChevronDown,
  X,
  FlaskConical,
  Play,
  Eye,
} from 'lucide-react';
import { useDebugStore } from '@/features/editor/stores/debug-store';
import {
  importJsonExportService,
  importJsonImportService,
  importTestFixtures,
  type FixtureType,
} from '@/features/editor/deps/project-bundle';
import { createProject, getDBStats } from '@/infrastructure/storage/indexeddb';

interface DebugAction {
  label: string;
  icon: React.ReactNode;
  action: () => Promise<void>;
  description: string;
}

interface ProjectDebugPanelProps {
  projectId: string;
}

export function ProjectDebugPanel({ projectId }: ProjectDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [status, setStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });
  const [selectedFixture, setSelectedFixture] = useState<FixtureType>('multi-track');
  const [availableFixtures, setAvailableFixtures] = useState<
    Array<{ type: FixtureType; name: string; description: string }>
  >([]);

  // Debug overlay toggle
  const showVideoDebugOverlay = useDebugStore((s) => s.showVideoDebugOverlay);
  const toggleVideoDebugOverlay = useDebugStore((s) => s.toggleVideoDebugOverlay);

  // Load available fixtures on mount
  useEffect(() => {
    if (import.meta.env.DEV) {
      importTestFixtures().then(({ getAvailableFixtures }) => {
        setAvailableFixtures(getAvailableFixtures());
      });
    }
  }, []);

  // Only show in dev mode, can be disabled with VITE_SHOW_DEBUG_PANEL=false
  if (!import.meta.env.DEV || import.meta.env.VITE_SHOW_DEBUG_PANEL === 'false') {
    return null;
  }

  const showStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus({ type: 'idle' }), 3000);
  };

  const runAction = async (fn: () => Promise<void>, successMsg: string) => {
    setStatus({ type: 'loading' });
    try {
      await fn();
      showStatus('success', successMsg);
    } catch (error) {
      showStatus('error', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleExportJson = useCallback(async () => {
    const { downloadProjectJson } = await importJsonExportService();
    await downloadProjectJson(projectId);
  }, [projectId]);

  const handleCopyToClipboard = useCallback(async () => {
    const { copyProjectToClipboard } = await importJsonExportService();
    await copyProjectToClipboard(projectId);
  }, [projectId]);

  const handleImportFromClipboard = useCallback(async () => {
    const { importProjectFromClipboard } = await importJsonImportService();
    const result = await importProjectFromClipboard();
    // Reload to show new project
    window.location.href = `/editor/${result.project.id}`;
  }, []);

  const handleImportFromFile = useCallback(async () => {
    const { showImportFilePicker } = await importJsonImportService();
    const result = await showImportFilePicker();
    if (result) {
      // Reload to show new project
      window.location.href = `/editor/${result.project.id}`;
    }
  }, []);

  const handleLogSnapshot = useCallback(async () => {
    const { exportProjectJson, getSnapshotStats } = await importJsonExportService();
    const snapshot = await exportProjectJson(projectId);
    const stats = getSnapshotStats(snapshot);
    console.warn('Project snapshot stats:', stats);
  }, [projectId]);

  const handleLogDBStats = useCallback(async () => {
    const stats = await getDBStats();
    console.warn('IndexedDB stats:', stats);
  }, []);

  const handleValidateProject = useCallback(async () => {
    const { exportProjectJson } = await importJsonExportService();
    const { validateSnapshotData } = await importJsonImportService();
    const snapshot = await exportProjectJson(projectId);
    const result = await validateSnapshotData(snapshot);
    if (!result.valid) {
      console.warn('Project validation errors:', result.errors);
    }
    if (result.warnings.length > 0) {
      console.warn('Project validation warnings:', result.warnings);
    }
  }, [projectId]);

  const handleGenerateFixture = useCallback(async () => {
    const { generateFixture } = await importTestFixtures();

    const { project } = generateFixture(selectedFixture);
    await createProject(project);

    // Navigate to the new project
    window.location.href = `/editor/${project.id}`;
  }, [selectedFixture]);

  const handleDownloadFixture = useCallback(async () => {
    const { generateFixture } = await importTestFixtures();
    const { downloadSnapshotJson } = await importJsonExportService();

    const { snapshot } = generateFixture(selectedFixture);
    downloadSnapshotJson(snapshot, `fixture-${selectedFixture}`);
  }, [selectedFixture]);

  const handleLogFixture = useCallback(async () => {
    const { generateFixture, getAvailableFixtures } = await importTestFixtures();

    const { project } = generateFixture(selectedFixture);
    const fixtureInfo = getAvailableFixtures().find((f) => f.type === selectedFixture);

    console.warn('Fixture summary:', {
      fixture: selectedFixture,
      name: fixtureInfo?.name,
      tracks: project.timeline?.tracks.length ?? 0,
      items: project.timeline?.items.length ?? 0,
      transitions: project.timeline?.transitions?.length ?? 0,
      keyframes: project.timeline?.keyframes?.length ?? 0,
      markers: project.timeline?.markers?.length ?? 0,
    });
  }, [selectedFixture]);

  const exportActions: DebugAction[] = [
    {
      label: 'Download JSON',
      icon: <Download className="h-3.5 w-3.5" />,
      action: () => runAction(handleExportJson, 'Downloaded .freecut.json'),
      description: 'Download project as JSON file',
    },
    {
      label: 'Copy to Clipboard',
      icon: <Clipboard className="h-3.5 w-3.5" />,
      action: () => runAction(handleCopyToClipboard, 'Copied to clipboard'),
      description: 'Copy project JSON to clipboard',
    },
  ];

  const importActions: DebugAction[] = [
    {
      label: 'Import from File',
      icon: <Upload className="h-3.5 w-3.5" />,
      action: () => runAction(handleImportFromFile, 'Imported successfully'),
      description: 'Import project from JSON file',
    },
    {
      label: 'Import from Clipboard',
      icon: <ClipboardPaste className="h-3.5 w-3.5" />,
      action: () => runAction(handleImportFromClipboard, 'Imported successfully'),
      description: 'Import project from clipboard',
    },
  ];

  const inspectActions: DebugAction[] = [
    {
      label: 'Log Snapshot',
      icon: <FileJson className="h-3.5 w-3.5" />,
      action: () => runAction(handleLogSnapshot, 'Logged to console'),
      description: 'Log project snapshot to console',
    },
    {
      label: 'Log DB Stats',
      icon: <Database className="h-3.5 w-3.5" />,
      action: () => runAction(handleLogDBStats, 'Logged to console'),
      description: 'Log IndexedDB statistics',
    },
    {
      label: 'Validate Schema',
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      action: () => runAction(handleValidateProject, 'Validation complete'),
      description: 'Validate project against schema',
    },
  ];

  const ActionButton = ({ action }: { action: DebugAction }) => (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 h-8 text-xs"
      onClick={action.action}
      disabled={status.type === 'loading'}
      title={action.description}
    >
      {action.icon}
      {action.label}
    </Button>
  );

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'fixed bottom-4 right-4 z-50 p-2.5 rounded-full shadow-lg transition-all',
          'bg-amber-500 hover:bg-amber-600 text-white',
          'focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2',
          isOpen && 'rotate-180'
        )}
        title="Toggle Debug Panel"
      >
        <Bug className="h-5 w-5" />
      </button>

      {/* Debug Panel */}
      {isOpen && (
        <div
          className={cn(
            'fixed bottom-16 right-4 z-50 w-64',
            'bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl',
            'text-zinc-100 text-sm'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-amber-500" />
              <span className="font-medium">Debug Panel</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-zinc-800 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Status Bar */}
          {status.type !== 'idle' && (
            <div
              className={cn(
                'px-3 py-1.5 text-xs flex items-center gap-2',
                status.type === 'loading' && 'bg-blue-500/20 text-blue-300',
                status.type === 'success' && 'bg-green-500/20 text-green-300',
                status.type === 'error' && 'bg-red-500/20 text-red-300'
              )}
            >
              {status.type === 'loading' && (
                <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              {status.type === 'success' && <CheckCircle className="h-3 w-3" />}
              {status.type === 'error' && <XCircle className="h-3 w-3" />}
              <span className="truncate">{status.message || 'Processing...'}</span>
            </div>
          )}

          {/* Content */}
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <button className="w-full px-3 py-2 flex items-center justify-between hover:bg-zinc-800/50 text-xs text-zinc-400">
                <span>Project: {projectId.slice(0, 8)}...</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    isExpanded && 'rotate-180'
                  )}
                />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="px-2 pb-2 space-y-3">
                {/* Overlays Section */}
                <div>
                  <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Overlays
                  </div>
                  <div className="space-y-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "w-full justify-start gap-2 h-8 text-xs",
                        showVideoDebugOverlay && "bg-amber-500/20 text-amber-300"
                      )}
                      onClick={toggleVideoDebugOverlay}
                      title="Show debug info on video clips"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Video Debug Overlay
                      {showVideoDebugOverlay && (
                        <span className="ml-auto text-[10px] bg-amber-500/30 px-1.5 py-0.5 rounded">ON</span>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Export Section */}
                <div>
                  <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Export
                  </div>
                  <div className="space-y-0.5">
                    {exportActions.map((action) => (
                      <ActionButton key={action.label} action={action} />
                    ))}
                  </div>
                </div>

                {/* Import Section */}
                <div>
                  <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Import
                  </div>
                  <div className="space-y-0.5">
                    {importActions.map((action) => (
                      <ActionButton key={action.label} action={action} />
                    ))}
                  </div>
                </div>

                {/* Inspect Section */}
                <div>
                  <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Inspect
                  </div>
                  <div className="space-y-0.5">
                    {inspectActions.map((action) => (
                      <ActionButton key={action.label} action={action} />
                    ))}
                  </div>
                </div>

                {/* Fixtures Section */}
                <div>
                  <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" />
                    Test Fixtures
                  </div>
                  <div className="space-y-2 px-1">
                    <Select
                      value={selectedFixture}
                      onValueChange={(value) => setSelectedFixture(value as FixtureType)}
                    >
                      <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700">
                        <SelectValue placeholder="Select fixture..." />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {availableFixtures.map((fixture) => (
                          <SelectItem
                            key={fixture.type}
                            value={fixture.type}
                            className="text-xs"
                          >
                            <div className="flex flex-col">
                              <span>{fixture.name}</span>
                              <span className="text-[10px] text-zinc-500">
                                {fixture.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 h-7 text-xs gap-1"
                        onClick={() => runAction(handleGenerateFixture, 'Fixture created')}
                        disabled={status.type === 'loading'}
                        title="Create fixture project and open in editor"
                      >
                        <Play className="h-3 w-3" />
                        Create
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 h-7 text-xs gap-1"
                        onClick={() => runAction(handleDownloadFixture, 'Downloaded')}
                        disabled={status.type === 'loading'}
                        title="Download fixture as JSON"
                      >
                        <Download className="h-3 w-3" />
                        JSON
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => runAction(handleLogFixture, 'Logged')}
                        disabled={status.type === 'loading'}
                        title="Log fixture to console"
                      >
                        <FileJson className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Console Hint */}
                <div className="px-1 pt-2 border-t border-zinc-800">
                  <p className="text-[10px] text-zinc-500">
                    Also available via <code className="bg-zinc-800 px-1 rounded">window.__DEBUG__</code>
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </>
  );
}

