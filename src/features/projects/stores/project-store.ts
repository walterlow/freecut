import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { Project } from '@/types/project';
import type { ProjectFormData } from '../utils/validation';
import { useSettingsStore } from '@/features/projects/deps/settings-contract';
import {
  getAllProjects,
  getProject,
  createProject as createProjectDB,
  updateProject as updateProjectDB,
  deleteProject as deleteProjectDB,
  getProjectMediaIds,
  associateMediaWithProject,
  softDeleteProject,
  restoreProject as restoreProjectDB,
  getTrashedProjectMediaIds,
} from '@/infrastructure/storage';
import { createProjectObject, duplicateProject } from '../utils/project-helpers';
// v3: Import media service for cascade operations
import { mediaLibraryService } from '@/features/projects/deps/media-library-contract';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('ProjectStore');

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
  /**
   * Soft-delete: moves the project to the workspace trash (marker file;
   * content preserved). Returns the trash state so the caller can surface
   * an "Undo" toast. External-folder cleanup (`clearLocalFiles`) runs
   * immediately and has no undo — the user explicitly opted in to
   * destroying those files.
   */
  deleteProject: (id: string, clearLocalFiles?: boolean) => Promise<{
    localFilesDeleted: boolean;
    trashed: true;
    deletedAt: number;
    originalName: string;
  }>;
  /** Un-trash a project and add it back to the visible list. */
  restoreProject: (id: string) => Promise<void>;
  /**
   * Permanently remove a trashed project: runs media cleanup for any
   * media exclusive to this project, then wipes the project directory.
   * No-op for live projects.
   */
  permanentlyDeleteProject: (id: string) => Promise<void>;
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

        // Load all projects from workspace storage
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
          set({ error: null });

          const newProject = createProjectObject(data);

          // Optimistic update - add to state immediately
          const previousProjects = get().projects;
          set({ projects: [...previousProjects, newProject] });

          try {
            await createProjectDB(newProject);
            set({ currentProject: newProject });
            return newProject;
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to create project';
            set({ error: errorMessage });
            throw error;
          }
        },

        // Update an existing project with optimistic update
        updateProject: async (id: string, data: Partial<ProjectFormData>) => {
          set({ error: null });

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
            set({ error: `Project not found: ${id}` });
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
            set({ error: errorMessage });
            throw error;
          }
        },

        // Delete a project with optimistic update
        // v3: Also deletes media associations (with reference counting)
        deleteProject: async (id: string, clearLocalFiles?: boolean) => {
          set({ error: null });

          const previousProjects = get().projects;
          const projectToDelete = previousProjects.find((p) => p.id === id);
          let localFilesDeleted = false;
          let partialLocalDeletion = false;

          // If user wants to clear local files, check/request permission FIRST
          // (before any async ops) to preserve user activation for the permission prompt
          let fsPermissionGranted = false;
          const handle = clearLocalFiles ? projectToDelete?.rootFolderHandle : undefined;
          if (handle) {
            let permission = await handle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
              permission = await handle.requestPermission({ mode: 'readwrite' });
            }
            fsPermissionGranted = permission === 'granted';
            if (!fsPermissionGranted) {
              logger.warn(`Permission denied to clear local files for project ${id}`);
              throw new Error('Filesystem permission denied — project was not deleted. Please grant access and try again.');
            }
          }

          // Optimistic update - remove from state immediately
          const optimisticProjects = previousProjects.filter((p) => p.id !== id);
          set({ projects: optimisticProjects });

          // Clear current project if it's the one being deleted
          const previousCurrentProject = get().currentProject;
          if (previousCurrentProject?.id === id) {
            set({ currentProject: null });
          }

          try {
            // Delete local files before removing the DB record so the user can
            // retry if filesystem cleanup fails while the project still exists
            if (handle && fsPermissionGranted) {
              try {
                // Use non-standard .remove() (Chromium) to delete the folder itself
                // Falls back to clearing contents if not available
                const handleWithRemove = handle as FileSystemDirectoryHandle & {
                  remove?: (options?: { recursive?: boolean }) => Promise<void>;
                };
                if (typeof handleWithRemove.remove === 'function') {
                  await handleWithRemove.remove({ recursive: true });
                  localFilesDeleted = true;
                } else {
                  // Fallback: clear entries individually so one failure doesn't stop the rest
                  let allRemoved = true;
                  let anyRemoved = false;
                  for await (const entry of handle.values()) {
                    try {
                      await handle.removeEntry(entry.name, { recursive: true });
                      anyRemoved = true;
                    } catch (entryError) {
                      allRemoved = false;
                      logger.error(`Failed to remove entry "${entry.name}" in project ${id}:`, entryError);
                    }
                  }
                  localFilesDeleted = allRemoved;
                  // Track partial deletion so rollback logic knows files were touched
                  if (anyRemoved && !allRemoved) {
                    partialLocalDeletion = true;
                  }
                }
              } catch (fsError) {
                logger.error(`Failed to clear local files for project ${id}:`, fsError);
              }
            }

            // Soft-delete: move to workspace trash. Media cleanup is
            // deferred to `permanentlyDeleteProject` — the media files
            // stay intact so `restoreProject` restores a complete
            // project. An auto-purge sweep (see `sweepTrashOlderThan`
            // on bootstrap) runs media cleanup on trashed projects past
            // their TTL.
            const marker = await softDeleteProject(id);

            return {
              localFilesDeleted,
              trashed: true as const,
              deletedAt: marker.deletedAt,
              originalName: marker.originalName,
            };
          } catch (error) {
            if (localFilesDeleted || partialLocalDeletion) {
              // Local files already deleted (fully or partially) — rolling back the UI would be misleading
              const scope = localFilesDeleted ? 'All local files deleted' : 'Some local files deleted';
              const errorMessage = `${scope} but soft-delete failed — project may be inconsistent`;
              logger.error(errorMessage, error);
              set({ error: errorMessage });
              throw new Error(errorMessage, { cause: error });
            }
            // Rollback on error (safe — no local files were touched)
            set({ projects: previousProjects, currentProject: previousCurrentProject });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to delete project';
            set({ error: errorMessage });
            throw error;
          }
        },

        restoreProject: async (id: string) => {
          set({ error: null });
          try {
            await restoreProjectDB(id);
            // Refresh the visible list so the restored project reappears.
            const projects = await getAllProjects();
            set({ projects });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Failed to restore project';
            logger.error(`restoreProject(${id}) failed`, error);
            set({ error: errorMessage });
            throw error;
          }
        },

        permanentlyDeleteProject: async (id: string) => {
          try {
            // Read the trashed project's media links so we can clean up
            // any media that becomes fully-dereferenced once this project
            // is gone. (deleteAllMediaFromProject reads media-links via
            // `getProjectMediaIds`, which works for trashed projects too
            // because media-links.json lives alongside the marker.)
            const mediaIds = await getTrashedProjectMediaIds(id);
            for (const mediaId of mediaIds) {
              try {
                await mediaLibraryService.deleteMediaFromProject(id, mediaId);
              } catch (mediaError) {
                logger.warn(
                  `permanentlyDeleteProject(${id}): media cleanup for ${mediaId} failed`,
                  mediaError,
                );
              }
            }
            // Wipe the project directory. This also drops the trashed
            // marker along with the rest of the directory.
            await deleteProjectDB(id);
          } catch (error) {
            logger.error(`permanentlyDeleteProject(${id}) failed`, error);
            throw error;
          }
        },

        // Duplicate an existing project
        duplicateProject: async (id: string) => {
          set({ error: null });

          const originalProject = get().projects.find((p) => p.id === id);

          if (!originalProject) {
            set({ error: `Project not found: ${id}` });
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

            return newProject;
          } catch (error) {
            // Rollback on error
            set({ projects: previousProjects });

            const errorMessage =
              error instanceof Error ? error.message : 'Failed to duplicate project';
            set({ error: errorMessage });
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
        // Zundo options — no static limit; trimmed dynamically via subscription below
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

// Enforce undo history cap on every save (zundo's static `limit` was removed).
useProjectStore.temporal.getState().setOnSave(() => {
  const max = useSettingsStore.getState().maxUndoHistory;
  const { pastStates, futureStates } = useProjectStore.temporal.getState();
  if (pastStates.length > max || futureStates.length > max) {
    useProjectStore.temporal.setState({
      pastStates: pastStates.slice(-max),
      futureStates: futureStates.slice(-max),
    });
  }
});

// When maxUndoHistory changes, immediately trim both stacks.
useSettingsStore.subscribe((state, prevState) => {
  if (state.maxUndoHistory !== prevState.maxUndoHistory) {
    const { pastStates, futureStates } = useProjectStore.temporal.getState();
    if (pastStates.length > state.maxUndoHistory || futureStates.length > state.maxUndoHistory) {
      useProjectStore.temporal.setState({
        pastStates: pastStates.slice(-state.maxUndoHistory),
        futureStates: futureStates.slice(-state.maxUndoHistory),
      });
    }
  }
});
