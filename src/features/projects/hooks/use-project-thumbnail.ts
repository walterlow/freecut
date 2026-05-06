import { useState, useEffect } from 'react'
import { loadProjectThumbnail } from '@/infrastructure/storage'
import type { Project } from '@/types/project'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ProjectThumbnail')

/**
 * Hook to load a project thumbnail from workspace-backed blob storage.
 * Falls back to the deprecated base64 thumbnail for backward compatibility.
 *
 * @param project - The project to get thumbnail for
 * @returns Object URL for the thumbnail, or undefined if not available
 */
export function useProjectThumbnail(project: Project): string | undefined {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    let objectUrl: string | undefined
    let cancelled = false

    async function loadThumbnail() {
      // Try to load the workspace-backed project thumbnail blob.
      if (project.thumbnailId) {
        try {
          const blob = await loadProjectThumbnail(project.id)
          if (blob && !cancelled) {
            objectUrl = URL.createObjectURL(blob)
            setThumbnailUrl(objectUrl)
            return
          }
        } catch (error) {
          logger.warn('Failed to load thumbnail from workspace storage:', error)
        }
      }

      // Fall back to deprecated base64 thumbnail
      if (project.thumbnail && !cancelled) {
        setThumbnailUrl(project.thumbnail)
      }
    }

    loadThumbnail()

    // Cleanup object URL on unmount or when project changes
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [project.id, project.thumbnailId, project.thumbnail, project.updatedAt])

  return thumbnailUrl
}
