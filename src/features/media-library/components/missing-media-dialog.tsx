import { useState, useMemo, useEffect, useCallback } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MissingMediaDialog');

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Link2Off,
  RefreshCw,
  FolderOpen,
  X,
  AlertTriangle,
  Search,
  Folder,
} from 'lucide-react';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { useProjectStore } from '@/features/media-library/deps/projects';

export function MissingMediaDialog() {
  const showDialog = useMediaLibraryStore((s) => s.showMissingMediaDialog);
  const closeDialog = useMediaLibraryStore((s) => s.closeMissingMediaDialog);
  const brokenMediaInfo = useMediaLibraryStore((s) => s.brokenMediaInfo);
  const relinkMedia = useMediaLibraryStore((s) => s.relinkMedia);
  const relinkMediaBatch = useMediaLibraryStore((s) => s.relinkMediaBatch);
  const markMediaHealthy = useMediaLibraryStore((s) => s.markMediaHealthy);

  // Project folder for smart relinking
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectRootFolderHandle = currentProject?.rootFolderHandle;
  const projectRootFolderName = currentProject?.rootFolderName;

  const [relinking, setRelinking] = useState<string | null>(null);
  const [locatingFolder, setLocatingFolder] = useState(false);
  const [scanningProjectFolder, setScanningProjectFolder] = useState(false);
  const [relinkedIds, setRelinkedIds] = useState<Set<string>>(new Set());
  const [autoScanned, setAutoScanned] = useState(false);

  const brokenItems = useMemo(
    () =>
      Array.from(brokenMediaInfo.values()).filter(
        (item) => !relinkedIds.has(item.mediaId)
      ),
    [brokenMediaInfo, relinkedIds]
  );

  const permissionDenied = brokenItems.filter(
    (b) => b.errorType === 'permission_denied'
  );
  const fileMissing = brokenItems.filter((b) => b.errorType === 'file_missing');

  // Helper to scan a directory for matching files
  const scanDirectoryForMatches = useCallback(async (
    dirHandle: FileSystemDirectoryHandle,
    itemsToMatch: typeof brokenItems
  ): Promise<Array<{ mediaId: string; handle: FileSystemFileHandle }>> => {
    const foundRelinks: Array<{
      mediaId: string;
      handle: FileSystemFileHandle;
    }> = [];

    // Scan directory for matching filenames
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const matchingBroken = itemsToMatch.find(
          (b) => b.fileName.toLowerCase() === entry.name.toLowerCase()
        );
        if (matchingBroken) {
          foundRelinks.push({
            mediaId: matchingBroken.mediaId,
            handle: entry as FileSystemFileHandle,
          });
        }
      }
    }

    return foundRelinks;
  }, []);

  // Auto-scan project folder when dialog opens
  const handleScanProjectFolder = useCallback(async () => {
    if (!projectRootFolderHandle || brokenItems.length === 0) return;

    setScanningProjectFolder(true);
    try {
      // Request permission if needed
      const permission = await projectRootFolderHandle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        const newPermission = await projectRootFolderHandle.requestPermission({ mode: 'read' });
        if (newPermission !== 'granted') {
          logger.warn('Permission denied for project folder');
          return;
        }
      }

      const foundRelinks = await scanDirectoryForMatches(projectRootFolderHandle, brokenItems);

      if (foundRelinks.length > 0) {
        const { success } = await relinkMediaBatch(foundRelinks);
        setRelinkedIds((prev) => new Set([...prev, ...success]));
        logger.info(`Auto-relinked ${success.length} files from project folder`);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Project folder scan failed:', error);
      }
    } finally {
      setScanningProjectFolder(false);
    }
  }, [projectRootFolderHandle, brokenItems, relinkMediaBatch, scanDirectoryForMatches]);

  // Auto-scan project folder when dialog opens (only once per dialog open)
  useEffect(() => {
    if (showDialog && projectRootFolderHandle && brokenItems.length > 0 && !autoScanned) {
      setAutoScanned(true);
      handleScanProjectFolder();
    }
  }, [showDialog, projectRootFolderHandle, brokenItems.length, autoScanned, handleScanProjectFolder]);

  // Reset auto-scan flag when dialog closes
  useEffect(() => {
    if (!showDialog) {
      setAutoScanned(false);
    }
  }, [showDialog]);

  const handleRelinkSingle = async (mediaId: string) => {
    setRelinking(mediaId);
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Media files',
            accept: {
              'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
              'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
              'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
            },
          },
        ],
      });

      const handle = handles[0];
      if (!handle) return;

      const success = await relinkMedia(mediaId, handle);
      if (success) {
        setRelinkedIds((prev) => new Set([...prev, mediaId]));
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Relink failed:', error);
      }
    } finally {
      setRelinking(null);
    }
  };

  const handleLocateFolder = async () => {
    setLocatingFolder(true);
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'read',
      });

      const foundRelinks = await scanDirectoryForMatches(dirHandle, brokenItems);

      if (foundRelinks.length > 0) {
        const { success } = await relinkMediaBatch(foundRelinks);
        setRelinkedIds((prev) => new Set([...prev, ...success]));
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Folder scan failed:', error);
      }
    } finally {
      setLocatingFolder(false);
    }
  };

  const handleDismissAll = () => {
    // Mark all broken media as healthy (dismiss without relinking)
    brokenItems.forEach((item) => markMediaHealthy(item.mediaId));
    setRelinkedIds(new Set());
    closeDialog();
  };

  const handleClose = () => {
    setRelinkedIds(new Set());
    closeDialog();
  };

  // Auto-close if no more broken items
  if (showDialog && brokenItems.length === 0) {
    handleClose();
    return null;
  }

  return (
    <Dialog open={showDialog} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2Off className="w-5 h-5 text-destructive" />
            Missing Media Files
          </DialogTitle>
          <DialogDescription>
            {brokenItems.length} media file
            {brokenItems.length !== 1 ? 's' : ''} could not be located.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary badges */}
          <div className="flex gap-2 text-xs">
            {permissionDenied.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded">
                <AlertTriangle className="w-3 h-3 text-yellow-500" />
                <span>{permissionDenied.length} need permission</span>
              </div>
            )}
            {fileMissing.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-destructive/10 border border-destructive/30 rounded">
                <X className="w-3 h-3 text-destructive" />
                <span>{fileMissing.length} not found</span>
              </div>
            )}
          </div>

          {/* Project folder scan button (if project folder is set) */}
          {projectRootFolderHandle && (
            <Button
              variant="default"
              className="w-full"
              onClick={handleScanProjectFolder}
              disabled={scanningProjectFolder}
            >
              {scanningProjectFolder ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Folder className="w-4 h-4 mr-2" />
              )}
              Scan Project Folder ({projectRootFolderName})
            </Button>
          )}

          {/* Locate Folder button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLocateFolder}
            disabled={locatingFolder}
          >
            {locatingFolder ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FolderOpen className="w-4 h-4 mr-2" />
            )}
            {projectRootFolderHandle ? 'Browse Another Folder...' : 'Locate Folder (auto-match by filename)'}
          </Button>

          {/* List of broken media */}
          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
            {brokenItems.map((item) => (
              <div
                key={item.mediaId}
                className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg border border-border"
              >
                <div
                  className={`p-1.5 rounded ${
                    item.errorType === 'permission_denied'
                      ? 'bg-yellow-500/20'
                      : 'bg-destructive/20'
                  }`}
                >
                  {item.errorType === 'permission_denied' ? (
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <X className="w-4 h-4 text-destructive" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.errorType === 'permission_denied'
                      ? 'Permission expired - relink to restore'
                      : 'File moved or deleted'}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRelinkSingle(item.mediaId)}
                  disabled={relinking === item.mediaId}
                >
                  {relinking === item.mediaId ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Search className="w-3 h-3 mr-1" />
                      Locate
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={handleDismissAll}
            className="text-muted-foreground"
          >
            Work Offline
          </Button>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

