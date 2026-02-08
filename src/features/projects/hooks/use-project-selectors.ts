import { useProjectStore } from '../stores/project-store';
import { useMemo } from 'react';
import { filterProjects, sortProjects, filterByResolution, filterByFps } from '../utils/project-helpers';
import type { Project } from '@/types/project';

/**
 * Get all projects (raw, unfiltered)
 */
export const useProjects = () => useProjectStore((s) => s.projects);

/**
 * Get filtered and sorted projects based on current filter state
 */
export const useFilteredProjects = (): Project[] => {
  const projects = useProjectStore((s) => s.projects);
  const searchQuery = useProjectStore((s) => s.searchQuery);
  const sortField = useProjectStore((s) => s.sortField);
  const sortDirection = useProjectStore((s) => s.sortDirection);
  const filterResolution = useProjectStore((s) => s.filterResolution);
  const filterFps = useProjectStore((s) => s.filterFps);

  return useMemo(() => {
    let filtered = projects;

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filterProjects(filtered, searchQuery);
    }

    // Apply resolution filter
    if (filterResolution) {
      filtered = filterByResolution(filtered, filterResolution);
    }

    // Apply FPS filter
    if (filterFps) {
      filtered = filterByFps(filtered, filterFps);
    }

    // Apply sorting
    filtered = sortProjects(filtered, sortField, sortDirection);

    return filtered;
  }, [projects, searchQuery, sortField, sortDirection, filterResolution, filterFps]);
};

/**
 * Get loading state
 */
export const useProjectsLoading = () => useProjectStore((s) => s.isLoading);

/**
 * Get error state
 */
export const useProjectsError = () => useProjectStore((s) => s.error);

/**
 * Get search query
 */
export const useSearchQuery = () => useProjectStore((s) => s.searchQuery);

/**
 * Get sort field
 */
export const useSortField = () => useProjectStore((s) => s.sortField);

/**
 * Get sort direction
 */
export const useSortDirection = () => useProjectStore((s) => s.sortDirection);

/**
 * Get resolution filter
 */
export const useFilterResolution = () => useProjectStore((s) => s.filterResolution);

/**
 * Get FPS filter
 */
export const useFilterFps = () => useProjectStore((s) => s.filterFps);

/**
 * Check if any filters are active
 */
export const useHasActiveFilters = (): boolean => {
  const searchQuery = useProjectStore((s) => s.searchQuery);
  const filterResolution = useProjectStore((s) => s.filterResolution);
  const filterFps = useProjectStore((s) => s.filterFps);

  return Boolean(searchQuery.trim() || filterResolution || filterFps);
};
