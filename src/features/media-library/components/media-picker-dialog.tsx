import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Video, FileAudio, Image as ImageIcon, Search, Loader2 } from 'lucide-react';
import type { MediaMetadata } from '@/types/storage';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { mediaLibraryService } from '../services/media-library-service';
import { getMediaType, formatDuration } from '../utils/validation';

interface MediaPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (mediaId: string) => void;
  filterType?: 'video' | 'audio' | 'image';
  title?: string;
}

const typeIcons: Record<string, typeof Video> = {
  video: Video,
  audio: FileAudio,
  image: ImageIcon,
  unknown: Video, // Fallback
};

function MediaPickerItem({
  media,
  onSelect,
}: {
  media: MediaMetadata;
  onSelect: () => void;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const mediaType = getMediaType(media.mimeType);
  const IconComponent = typeIcons[mediaType] || Video;

  useEffect(() => {
    let mounted = true;

    const loadThumbnail = async () => {
      const url = await mediaLibraryService.getThumbnailBlobUrl(media.id);
      if (mounted) {
        setThumbnailUrl(url);
      }
    };

    loadThumbnail();

    return () => {
      mounted = false;
    };
  }, [media.id]);

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-secondary/50"
    >
      {/* Thumbnail */}
      <div className="relative w-12 h-12 rounded overflow-hidden bg-secondary flex-shrink-0">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={media.fileName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <IconComponent className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug break-words">{media.fileName}</p>
        <p className="text-xs text-muted-foreground">
          {mediaType === 'audio' || mediaType === 'video'
            ? formatDuration(media.duration)
            : `${media.width}x${media.height}`}
        </p>
      </div>

      {/* Type icon */}
      <IconComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

export function MediaPickerDialog({
  open,
  onClose,
  onSelect,
  filterType,
  title = 'Select Media',
}: MediaPickerDialogProps) {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const isLoading = useMediaLibraryStore((s) => s.isLoading);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery('');
    }
  }, [open]);

  // Filter media items
  const filteredItems = useMemo(() => {
    let items = mediaItems;

    // Filter by type if specified
    if (filterType) {
      const mimePrefix = `${filterType}/`;
      items = items.filter((m) => m.mimeType.startsWith(mimePrefix));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter((m) => m.fileName.toLowerCase().includes(query));
    }

    return items;
  }, [mediaItems, filterType, searchQuery]);

  const handleSelect = (mediaId: string) => {
    onSelect(mediaId);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[70vh] w-[min(92vw,960px)] max-w-[960px]">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug break-words">{title}</DialogTitle>
          <DialogDescription>
            Choose a {filterType || 'media'} file from your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search media..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Media list */}
          <div className="max-h-[400px] overflow-y-auto space-y-1 pr-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery
                  ? 'No media found matching your search.'
                  : filterType
                  ? `No ${filterType} files in library.`
                  : 'No media in library.'}
              </div>
            ) : (
              filteredItems.map((media) => (
                <MediaPickerItem
                  key={media.id}
                  media={media}
                  onSelect={() => handleSelect(media.id)}
                />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
