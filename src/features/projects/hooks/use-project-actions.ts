import { useProjectStore } from '../stores/project-store';
import { useCallback } from 'react';
import type { ProjectFormData } from '../utils/validation';

/**
 * Hook for project CRUD actions
 */
export const useProjectActions = () => {
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadProject = useProjectStore((s) => s.loadProject);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const duplicateProject = useProjectStore((s) => s.duplicateProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const clearError = useProjectStore((s) => s.clearError);

  return {
    loadProjects,
    loadProject,
    createProject,
    updateProject,
    deleteProject,
    duplicateProject,
    setCurrentProject,
    clearError,
  };
};

/**
 * Hook for search and filter actions
 */
export const useProjectFilters = () => {
  const setSearchQuery = useProjectStore((s) => s.setSearchQuery);
  const setSortField = useProjectStore((s) => s.setSortField);
  const setSortDirection = useProjectStore((s) => s.setSortDirection);
  const setFilterResolution = useProjectStore((s) => s.setFilterResolution);
  const setFilterFps = useProjectStore((s) => s.setFilterFps);
  const clearFilters = useProjectStore((s) => s.clearFilters);

  return {
    setSearchQuery,
    setSortField,
    setSortDirection,
    setFilterResolution,
    setFilterFps,
    clearFilters,
  };
};

/**
 * Hook for creating a project with error handling
 */
export const useCreateProject = () => {
  const createProject = useProjectStore((s) => s.createProject);

  return useCallback(
    async (data: ProjectFormData) => {
      try {
        const project = await createProject(data);
        return { success: true, project, error: null };
      } catch (error) {
        return {
          success: false,
          project: null,
          error: error instanceof Error ? error.message : 'Failed to create project',
        };
      }
    },
    [createProject]
  );
};

/**
 * Hook for deleting a project
 */
export const useDeleteProject = () => {
  const deleteProject = useProjectStore((s) => s.deleteProject);

  return useCallback(
    async (id: string) => {
      try {
        await deleteProject(id);
        return { success: true, error: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete project',
        };
      }
    },
    [deleteProject]
  );
};

/**
 * Hook for duplicating a project
 */
export const useDuplicateProject = () => {
  const duplicateProject = useProjectStore((s) => s.duplicateProject);

  return useCallback(
    async (id: string) => {
      try {
        const project = await duplicateProject(id);
        return { success: true, project, error: null };
      } catch (error) {
        return {
          success: false,
          project: null,
          error: error instanceof Error ? error.message : 'Failed to duplicate project',
        };
      }
    },
    [duplicateProject]
  );
};
