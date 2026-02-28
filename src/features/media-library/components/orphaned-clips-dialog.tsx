import { useState, useMemo, useCallback, useEffect } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('OrphanedClipsDialog');

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
  Trash2,
  Search,
  Video,
  Music,
  Image,
  Wand2,
} from 'lucide-react';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { MediaPickerDialog } from './media-picker-dialog';
import { autoMatchOrphanedClips } from '@/features/media-library/deps/timeline-utils';
import type { OrphanedClipInfo } from '../types';

const itemTypeIcons = {
  video: Video,
  audio: Music,
  image: Image,
};

export function OrphanedClipsDialog() {
  const showDialog = useMediaLibraryStore((s) => s.showOrphanedClipsDialog);
  const closeDialog = useMediaLibraryStore((s) => s.closeOrphanedClipsDialog);
  const orphanedClips = useMediaLibraryStore((s) => s.orphanedClips);
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const relinkOrphanedClip = useMediaLibraryStore((s) => s.relinkOrphanedClip);
  const removeOrphanedClips = useMediaLibraryStore((s) => s.removeOrphanedClips);

  const [relinking, setRelinking] = useState<string | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);
  const [relinkedIds, setRelinkedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedOrphan, setSelectedOrphan] = useState<OrphanedClipInfo | null>(null);

  const remainingOrphans = useMemo(
    () => orphanedClips.filter((o) => !relinkedIds.has(o.itemId)),
    [orphanedClips, relinkedIds]
  );

  const handleAutoMatch = useCallback(async () => {
    setAutoMatching(true);
    try {
      const matches = autoMatchOrphanedClips(remainingOrphans, mediaItems);

      if (matches.size === 0) {
        logger.info('No auto-matches found');
        return;
      }

      // Relink all matches
      for (const [itemId, mediaId] of matches) {
        setRelinking(itemId);
        const success = await relinkOrphanedClip(itemId, mediaId);
        if (success) {
          setRelinkedIds((prev) => new Set([...prev, itemId]));
        }
      }

      logger.info(`Auto-matched ${matches.size} clip(s)`);
    } catch (error) {
      logger.error('Auto-match failed:', error);
    } finally {
      setAutoMatching(false);
      setRelinking(null);
    }
  }, [remainingOrphans, mediaItems, relinkOrphanedClip]);

  const handleSelectMedia = useCallback((orphan: OrphanedClipInfo) => {
    setSelectedOrphan(orphan);
    setPickerOpen(true);
  }, []);

  const handleMediaSelected = useCallback(async (mediaId: string) => {
    if (!selectedOrphan) return;

    setPickerOpen(false);
    setRelinking(selectedOrphan.itemId);

    try {
      const success = await relinkOrphanedClip(selectedOrphan.itemId, mediaId);
      if (success) {
        setRelinkedIds((prev) => new Set([...prev, selectedOrphan.itemId]));
      }
    } catch (error) {
      logger.error('Relink failed:', error);
    } finally {
      setRelinking(null);
      setSelectedOrphan(null);
    }
  }, [selectedOrphan, relinkOrphanedClip]);

  const handleRemoveSingle = useCallback((itemId: string) => {
    removeOrphanedClips([itemId]);
    setRelinkedIds((prev) => new Set([...prev, itemId]));
  }, [removeOrphanedClips]);

  const handleRemoveAll = useCallback(() => {
    const itemIds = remainingOrphans.map((o) => o.itemId);
    removeOrphanedClips(itemIds);
    setRelinkedIds(new Set());
    closeDialog();
  }, [remainingOrphans, removeOrphanedClips, closeDialog]);

  const handleDismiss = useCallback(() => {
    // Keep clips as broken in timeline, just close the dialog
    setRelinkedIds(new Set());
    closeDialog();
  }, [closeDialog]);

  const handleClose = useCallback(() => {
    setRelinkedIds(new Set());
    closeDialog();
  }, [closeDialog]);

  // Auto-close if no more orphaned clips (using useEffect to avoid setState during render)
  useEffect(() => {
    if (showDialog && remainingOrphans.length === 0) {
      handleClose();
    }
  }, [showDialog, remainingOrphans.length, handleClose]);

  // Don't render if no orphans
  if (!showDialog || remainingOrphans.length === 0) {
    return null;
  }

  return (
    <>
      <Dialog open={showDialog} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2Off className="w-5 h-5 text-destructive" />
              Missing Media References
            </DialogTitle>
            <DialogDescription>
              {remainingOrphans.length} timeline clip
              {remainingOrphans.length !== 1 ? 's' : ''} reference
              {remainingOrphans.length === 1 ? 's' : ''} media that no longer exists.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Auto-match button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleAutoMatch}
              disabled={autoMatching || mediaItems.length === 0}
            >
              {autoMatching ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2" />
              )}
              Auto-match from Library (by filename)
            </Button>

            {/* List of orphaned clips */}
            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
              {remainingOrphans.map((orphan) => {
                const IconComponent = itemTypeIcons[orphan.itemType];
                return (
                  <div
                    key={orphan.itemId}
                    className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg border border-border"
                  >
                    <div className="p-1.5 rounded bg-destructive/20">
                      <IconComponent className="w-4 h-4 text-destructive" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{orphan.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {orphan.itemType} clip â€¢ Media deleted
                      </p>
                    </div>

                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSelectMedia(orphan)}
                        disabled={relinking === orphan.itemId}
                      >
                        {relinking === orphan.itemId ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <Search className="w-3 h-3 mr-1" />
                            Select
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveSingle(orphan.itemId)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="destructive"
              onClick={handleRemoveAll}
              className="order-2 sm:order-1"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove All Clips
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              onClick={handleDismiss}
              className="text-muted-foreground order-1 sm:order-2"
            >
              Keep as Broken
            </Button>
            <Button variant="outline" onClick={handleClose} className="order-3">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media picker for manual selection */}
      <MediaPickerDialog
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setSelectedOrphan(null);
        }}
        onSelect={handleMediaSelected}
        filterType={selectedOrphan?.itemType}
        title={`Select replacement for "${selectedOrphan?.fileName}"`}
      />
    </>
  );
}

