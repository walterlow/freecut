import { useProjectStore } from '../stores/project-store'
import { useCallback } from 'react'
import type { ProjectFormData } from '../utils/validation'

/**
 * Hook for project CRUD actions
 */
export const useProjectActions = () => {
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const loadProject = useProjectStore((s) => s.loadProject)
  const createProject = useProjectStore((s) => s.createProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const duplicateProject = useProjectStore((s) => s.duplicateProject)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const clearError = useProjectStore((s) => s.clearError)

  return {
    loadProjects,
    loadProject,
    createProject,
    updateProject,
    deleteProject,
    duplicateProject,
    setCurrentProject,
    clearError,
  }
}

/**
 * Hook for search and filter actions
 */
export const useProjectFilters = () => {
  const setSearchQuery = useProjectStore((s) => s.setSearchQuery)
  const setSortField = useProjectStore((s) => s.setSortField)
  const setSortDirection = useProjectStore((s) => s.setSortDirection)
  const setFilterResolution = useProjectStore((s) => s.setFilterResolution)
  const setFilterFps = useProjectStore((s) => s.setFilterFps)
  const clearFilters = useProjectStore((s) => s.clearFilters)

  return {
    setSearchQuery,
    setSortField,
    setSortDirection,
    setFilterResolution,
    setFilterFps,
    clearFilters,
  }
}

/**
 * Hook for creating a project with error handling
 */
export const useCreateProject = () => {
  const createProject = useProjectStore((s) => s.createProject)

  return useCallback(
    async (data: ProjectFormData) => {
      try {
        const project = await createProject(data)
        return { success: true, project, error: null }
      } catch (error) {
        return {
          success: false,
          project: null,
          error: error instanceof Error ? error.message : 'Failed to create project',
        }
      }
    },
    [createProject],
  )
}

/**
 * Hook for deleting a project
 */
export const useDeleteProject = () => {
  const deleteProject = useProjectStore((s) => s.deleteProject)

  return useCallback(
    async (id: string, clearLocalFiles?: boolean) => {
      try {
        const result = await deleteProject(id, clearLocalFiles)
        return {
          success: true,
          error: null,
          localFilesDeleted: result.localFilesDeleted,
          trashed: result.trashed,
          deletedAt: result.deletedAt,
          originalName: result.originalName,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete project',
          localFilesDeleted: false,
          trashed: false as const,
          deletedAt: 0,
          originalName: '',
        }
      }
    },
    [deleteProject],
  )
}

/**
 * Hook for restoring a soft-deleted project. Pair with `useDeleteProject`
 * to expose an Undo affordance (e.g. via a sonner toast action button).
 */
export const useRestoreProject = () => {
  const restoreProject = useProjectStore((s) => s.restoreProject)

  return useCallback(
    async (id: string) => {
      try {
        await restoreProject(id)
        return { success: true, error: null }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to restore project',
        }
      }
    },
    [restoreProject],
  )
}

/**
 * Hook for permanently deleting a trashed project. Cleans up media
 * references and wipes the project directory from disk. Cannot be
 * undone — callers should confirm with the user first.
 */
export const usePermanentlyDeleteProject = () => {
  const permanentlyDeleteProject = useProjectStore((s) => s.permanentlyDeleteProject)

  return useCallback(
    async (id: string) => {
      try {
        await permanentlyDeleteProject(id)
        return { success: true, error: null }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete project',
        }
      }
    },
    [permanentlyDeleteProject],
  )
}

/**
 * Hook for duplicating a project
 */
export const useDuplicateProject = () => {
  const duplicateProject = useProjectStore((s) => s.duplicateProject)

  return useCallback(
    async (id: string) => {
      try {
        const project = await duplicateProject(id)
        return { success: true, project, error: null }
      } catch (error) {
        return {
          success: false,
          project: null,
          error: error instanceof Error ? error.message : 'Failed to duplicate project',
        }
      }
    },
    [duplicateProject],
  )
}
