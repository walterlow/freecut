import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  FolderArchive,
  Clock,
  HardDrive,
  FileVideo,
  Download,
} from 'lucide-react';
import type { ExportProgress, ExportResult } from '../types/bundle';
import {
  exportProjectBundle,
  exportProjectBundleStreaming,
  downloadBundle,
} from '../services/bundle-export-service';
import { formatDuration } from '@/utils/time-utils';
import { formatBytes } from '@/utils/format-utils';

export interface BundleExportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onBeforeExport?: () => Promise<void>;
  /** Pre-acquired file handle for streaming export (avoids native picker inside modal) */
  fileHandle?: FileSystemFileHandle;
}

type ExportStatus = 'idle' | 'saving' | 'exporting' | 'completed' | 'failed';

function getStageLabel(stage: ExportProgress['stage']): string {
  switch (stage) {
    case 'collecting':
      return 'Collecting project data...';
    case 'hashing':
      return 'Computing file hashes...';
    case 'packaging':
      return 'Packaging files...';
    case 'complete':
      return 'Complete!';
    default:
      return 'Processing...';
  }
}

export function BundleExportDialog({
  open,
  onClose,
  projectId,
  onBeforeExport,
  fileHandle,
}: BundleExportDialogProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [progress, setProgress] = useState<ExportProgress>({ percent: 0, stage: 'collecting' });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isExporting = status === 'saving' || status === 'exporting';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const preventClose = isExporting || isCompleted;

  // Whether the completed export used streaming (file already on disk)
  const usedStreaming = isCompleted && !!fileHandle;

  // Track elapsed time
  useEffect(() => {
    if (isExporting && !startTime) {
      setStartTime(Date.now());
    }
    if (!isExporting && !isCompleted) {
      setStartTime(null);
      setElapsedSeconds(0);
    }
  }, [isExporting, isCompleted, startTime]);

  useEffect(() => {
    if (!startTime || !isExporting) return;

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isExporting]);

  // Start export when dialog opens
  const startExport = useCallback(async () => {
    setStatus('saving');
    setError(null);
    setResult(null);
    setProgress({ percent: 0, stage: 'collecting' });

    try {
      // Save project first if callback provided
      if (onBeforeExport) {
        await onBeforeExport();
      }

      setStatus('exporting');

      let exportResult: ExportResult;

      if (fileHandle) {
        // Streaming path: write directly to the pre-acquired file handle
        exportResult = await exportProjectBundleStreaming(projectId, fileHandle, (p) => {
          setProgress(p);
        });
      } else {
        // Fallback: in-memory export
        exportResult = await exportProjectBundle(projectId, (p) => {
          setProgress(p);
        });
      }

      setResult(exportResult);
      setStatus('completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setStatus('failed');
    }
  }, [projectId, onBeforeExport, fileHandle]);

  // Auto-start export when dialog opens
  useEffect(() => {
    if (open && status === 'idle') {
      startExport();
    }
  }, [open, status, startExport]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setProgress({ percent: 0, stage: 'collecting' });
      setResult(null);
      setError(null);
      setStartTime(null);
      setElapsedSeconds(0);
    }
  }, [open]);

  // Handle download
  const handleDownload = () => {
    if (result) {
      downloadBundle(result);
    }
  };

  // Prevent closing during export (ref check catches the stale-closure case)
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isExporting && !busyRef.current) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="sm:max-w-[425px] overflow-hidden"
        hideCloseButton={preventClose}
        onPointerDownOutside={(e) => preventClose && e.preventDefault()}
        onEscapeKeyDown={(e) => preventClose && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isExporting && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {isCompleted && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {isFailed && <AlertCircle className="h-5 w-5 text-destructive" />}
            {status === 'idle' && <FolderArchive className="h-5 w-5" />}
            {status === 'saving' && 'Saving project...'}
            {status === 'exporting' && 'Exporting project...'}
            {isCompleted && 'Export complete!'}
            {isFailed && 'Export failed'}
            {status === 'idle' && 'Export Project'}
          </DialogTitle>
          <DialogDescription>
            {isExporting && 'Creating project bundle with all media files'}
            {isCompleted && (usedStreaming ? 'Your project bundle has been saved' : 'Your project bundle is ready to download')}
            {isFailed && 'Something went wrong during export'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-hidden">
          {/* Progress section */}
          {isExporting && (
            <div className="space-y-4 min-w-0">
              {/* Progress bar with percentage */}
              <div className="space-y-2 min-w-0">
                <div className="w-full overflow-hidden">
                  <Progress value={progress.percent} className="h-2 w-full" />
                </div>
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="text-muted-foreground truncate">
                    {status === 'saving' ? 'Saving latest changes...' : getStageLabel(progress.stage)}
                  </span>
                  <span className="font-medium tabular-nums flex-shrink-0">{Math.round(progress.percent)}%</span>
                </div>
              </div>

              {/* Current file */}
              {progress.currentFile && (
                <div className="rounded-md bg-muted/50 px-3 py-2 min-w-0 overflow-hidden">
                  <p className="text-xs text-muted-foreground mb-1">Current file</p>
                  <p className="text-sm truncate" title={progress.currentFile}>
                    {progress.currentFile}
                  </p>
                </div>
              )}

              {/* Elapsed time */}
              {elapsedSeconds > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Elapsed:</span>
                  <span className="font-medium tabular-nums">{formatDuration(elapsedSeconds)}</span>
                </div>
              )}
            </div>
          )}

          {/* Success state */}
          {isCompleted && result && (
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  {usedStreaming
                    ? 'Project bundle saved to disk successfully!'
                    : 'Project bundle created successfully!'}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <FolderArchive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">File:</span>
                  <span className="font-medium truncate">{result.filename}</span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Size:</span>
                    <span className="font-medium">{formatBytes(result.size)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <FileVideo className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Media files:</span>
                    <span className="font-medium">{result.mediaCount}</span>
                  </div>
                  {elapsedSeconds > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Time taken:</span>
                      <span className="font-medium">{formatDuration(elapsedSeconds)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {isFailed && error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {isCompleted && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {!usedStreaming && (
                <Button onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              )}
            </>
          )}

          {isFailed && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
