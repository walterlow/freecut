import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { Project } from '@/types/project';
import type { ProjectFormData } from '../utils/validation';
import {
  getAllProjects,
  getProject,
  createProject as createProjectDB,
  updateProject as updateProjectDB,
  deleteProject as deleteProjectDB,
  getProjectMediaIds,
  associateMediaWithProject,
} from '@/lib/storage/indexeddb';
import { createProjectObject, duplicateProject } from '../utils/project-helpers';
// v3: Import media service for cascade operations
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';

interface ProjectState {
  // Data
  projects: Project[];
  currentProject: Project | null;

  // UI State
  isLoading: boolean;
  error: string | null;

  // Search and filter state
  searchQuery: string;
  sortField: 'name' | 'createdAt' | 'updatedAt' | 'resolution';
  sortDirection: 'asc' | 'desc';
  filterResolution?: string;
  filterFps?: number;
}

interface ProjectActions {
  // CRUD Operations
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<Project | null>;
  createProject: (data: ProjectFormData) => Promise<Project>;
  updateProject: (id: string, data: Partial<ProjectFormData>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<Project>;

  // Project folder management
  setProjectRootFolder: (id: string, handle: FileSystemDirectoryHandle) => Promise<void>;
  clearProjectRootFolder: (id: string) => Promise<void>;

  // State management
  setCurrentProject: (project: Project | null) => void;
  setSearchQuery: (query: string) => void;
  setSortField: (field: ProjectState['sortField']) => void;
  setSortDirection: (direction: ProjectState['sortDirection']) => void;
  setFilterResolution: (resolution: string | undefined) => void;
  setFilterFps: (fps: number | undefined) => void;
  clearFilters: () => void;

  // Utility
  clearError: () => void;
}

export const useProjectStore = create<ProjectState & ProjectActions>()(
  devtools(
    temporal(
      (set, get) => ({
        // Initial state
        projects: [],
        currentProject: null,
        isLoading: false,
        error: null,
        searchQuery: '',
        sortField: 'updatedAt',
        sortDirection: 'desc',
        filterResolution: undefined,
        filterFps: undefined,

        // Load all projects from IndexedDB
        loadProjects: async () => {
          set({ isLoading: true, error: null });

          try {
            const projects = await getAllProjects();
            set({ projects, isLoading: false });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Failed to load projects';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Load a single project by ID
        loadProject: async (id: string) => {
          set({ isLoading: true, error: null });

          try {
            const project = await getProject(id);

            if (!project) {
              set({ error: `Project not found: ${id}`, isLoading: false });
              return null;
            }

            set({ currentProject: project, isLoading: false });
            return project;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Failed to load project';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Create a new project with optimistic update
        createProject: async (data: ProjectFormData) => {
          set({ isLoading: true, error: null });

          const newProject = createProjectObject(data);

          // Optimistic update - add to state immediately
          const previousProjects = get().projects;
          set({ projects: [...previousProjects, newProject] });

          try {
            await createProjectDB(newProject);
            set({ isLoading: false, currentProject: newProject });
            return newProject;
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to create project';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Update an existing project with optimistic update
        updateProject: async (id: string, data: Partial<ProjectFormData>) => {
          set({ isLoading: true, error: null });

          const previousProjects = get().projects;
          const currentProject = get().currentProject;
          const projectIndex = previousProjects.findIndex((p) => p.id === id);

          // Find the existing project - either in projects array or currentProject
          let existingProject: Project | null = null;
          if (projectIndex !== -1) {
            existingProject = previousProjects[projectIndex] ?? null;
          } else if (currentProject?.id === id) {
            existingProject = currentProject;
          }

          if (!existingProject) {
            set({ error: `Project not found: ${id}`, isLoading: false });
            throw new Error(`Project not found: ${id}`);
          }

          const updatedProject: Project = {
            ...existingProject,
            name: data.name ?? existingProject.name,
            description: data.description ?? existingProject.description,
            metadata: {
              width: data.width ?? existingProject.metadata.width,
              height: data.height ?? existingProject.metadata.height,
              fps: data.fps ?? existingProject.metadata.fps,
              backgroundColor: data.backgroundColor ?? existingProject.metadata.backgroundColor,
            },
            updatedAt: Date.now(),
          };

          // Optimistic update - update projects array if project is there
          if (projectIndex !== -1) {
            const optimisticProjects = [...previousProjects];
            optimisticProjects[projectIndex] = updatedProject;
            set({ projects: optimisticProjects });
          }

          // Always update currentProject if it matches
          if (currentProject?.id === id) {
            set({ currentProject: updatedProject });
          }

          try {
            const updated = await updateProjectDB(id, updatedProject);

            // Update current project with DB result
            if (get().currentProject?.id === id) {
              set({ currentProject: updated });
            }

            set({ isLoading: false });
            return updated;
          } catch (error) {
            // Rollback on error
            if (projectIndex !== -1) {
              set({ projects: previousProjects });
            }
            if (currentProject?.id === id) {
              set({ currentProject: currentProject });
            }

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to update project';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Delete a project with optimistic update
        // v3: Also deletes media associations (with reference counting)
        deleteProject: async (id: string) => {
          set({ isLoading: true, error: null });

          const previousProjects = get().projects;

          // Optimistic update - remove from state immediately
          const optimisticProjects = previousProjects.filter((p) => p.id !== id);
          set({ projects: optimisticProjects });

          // Clear current project if it's the one being deleted
          if (get().currentProject?.id === id) {
            set({ currentProject: null });
          }

          try {
            // v3: Delete all media associations for this project first
            // This handles reference counting - files are only deleted
            // if no other projects reference them
            await mediaLibraryService.deleteAllMediaFromProject(id);

            // Then delete the project itself
            await deleteProjectDB(id);
            set({ isLoading: false });
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to delete project';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Duplicate an existing project
        duplicateProject: async (id: string) => {
          set({ isLoading: true, error: null });

          const originalProject = get().projects.find((p) => p.id === id);

          if (!originalProject) {
            set({ error: `Project not found: ${id}`, isLoading: false });
            throw new Error(`Project not found: ${id}`);
          }

          const newProject = duplicateProject(originalProject);

          // Optimistic update
          const previousProjects = get().projects;
          set({ projects: [...previousProjects, newProject] });

          try {
            // Create the new project in DB
            await createProjectDB(newProject);

            // Copy media associations from original to new project
            const mediaIds = await getProjectMediaIds(id);
            for (const mediaId of mediaIds) {
              await associateMediaWithProject(newProject.id, mediaId);
            }

            set({ isLoading: false });
            return newProject;
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to duplicate project';
            set({ error: errorMessage, isLoading: false });
            throw error;
          }
        },

        // Project folder management
        setProjectRootFolder: async (id: string, handle: FileSystemDirectoryHandle) => {
          const previousProjects = get().projects;
          const currentProject = get().currentProject;

          // Optimistic update
          const folderName = handle.name;
          const updateProjectInList = (project: Project) => ({
            ...project,
            rootFolderHandle: handle,
            rootFolderName: folderName,
            updatedAt: Date.now(),
          });

          if (currentProject?.id === id) {
            set({ currentProject: updateProjectInList(currentProject) });
          }

          const projectIndex = previousProjects.findIndex((p) => p.id === id);
          if (projectIndex !== -1) {
            const optimisticProjects = [...previousProjects];
            optimisticProjects[projectIndex] = updateProjectInList(previousProjects[projectIndex]!);
            set({ projects: optimisticProjects });
          }

          try {
            await updateProjectDB(id, {
              rootFolderHandle: handle,
              rootFolderName: folderName,
            });
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects, currentProject });
            throw error;
          }
        },

        clearProjectRootFolder: async (id: string) => {
          const previousProjects = get().projects;
          const currentProject = get().currentProject;

          // Optimistic update
          const updateProjectInList = (project: Project) => ({
            ...project,
            rootFolderHandle: undefined,
            rootFolderName: undefined,
            updatedAt: Date.now(),
          });

          if (currentProject?.id === id) {
            set({ currentProject: updateProjectInList(currentProject) });
          }

          const projectIndex = previousProjects.findIndex((p) => p.id === id);
          if (projectIndex !== -1) {
            const optimisticProjects = [...previousProjects];
            optimisticProjects[projectIndex] = updateProjectInList(previousProjects[projectIndex]!);
            set({ projects: optimisticProjects });
          }

          try {
            await updateProjectDB(id, {
              rootFolderHandle: undefined,
              rootFolderName: undefined,
            });
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects, currentProject });
            throw error;
          }
        },

        // State setters
        setCurrentProject: (project) => set({ currentProject: project }),
        setSearchQuery: (query) => set({ searchQuery: query }),
        setSortField: (field) => set({ sortField: field }),
        setSortDirection: (direction) => set({ sortDirection: direction }),
        setFilterResolution: (resolution) => set({ filterResolution: resolution }),
        setFilterFps: (fps) => set({ filterFps: fps }),
        clearFilters: () =>
          set({
            searchQuery: '',
            filterResolution: undefined,
            filterFps: undefined,
          }),
        clearError: () => set({ error: null }),
      }),
      {
        // Zundo options
        limit: 50, // Keep 50 history states
        partialize: (state) => {
          // Only include projects in undo/redo history
          // Exclude UI state like loading, error, filters
          return {
            projects: state.projects,
            currentProject: state.currentProject,
          };
        },
      }
    ),
    {
      // Devtools options
      name: 'ProjectStore',
      enabled: import.meta.env.DEV,
    }
  )
);
