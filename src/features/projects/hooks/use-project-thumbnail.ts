import { useState, useEffect } from 'react';
import { getThumbnail } from '@/infrastructure/storage/indexeddb';
import type { Project } from '@/types/project';

/**
 * Hook to load project thumbnail from IndexedDB Blob storage.
 * Falls back to deprecated base64 thumbnail for backward compatibility.
 *
 * @param project - The project to get thumbnail for
 * @returns Object URL for the thumbnail, or undefined if not available
 */
export function useProjectThumbnail(project: Project): string | undefined {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    async function loadThumbnail() {
      // Try to load from thumbnailId first (new Blob-based storage)
      if (project.thumbnailId) {
        try {
          const thumbnailData = await getThumbnail(project.thumbnailId);
          if (thumbnailData && !cancelled) {
            objectUrl = URL.createObjectURL(thumbnailData.blob);
            setThumbnailUrl(objectUrl);
            return;
          }
        } catch (error) {
          console.warn('Failed to load thumbnail from IndexedDB:', error);
        }
      }

      // Fall back to deprecated base64 thumbnail
      if (project.thumbnail && !cancelled) {
        setThumbnailUrl(project.thumbnail);
      }
    }

    loadThumbnail();

    // Cleanup object URL on unmount or when project changes
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [project.thumbnailId, project.thumbnail, project.updatedAt]);

  return thumbnailUrl;
}

