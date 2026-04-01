import { create } from 'zustand';

export interface ProjectMediaMatchCandidate {
  fileName: string;
  width: number;
  height: number;
  fps: number;
}

export type ProjectMediaMatchChoice =
  | 'match-both'
  | 'fps-only'
  | 'size-only'
  | 'keep-current';

interface ProjectMediaMatchDialogState {
  isOpen: boolean;
  projectId: string | null;
  candidate: ProjectMediaMatchCandidate | null;
  handledProjectIds: string[];
  resolver: ((choice: ProjectMediaMatchChoice) => void) | null;
  requestProjectMediaMatch: (
    projectId: string,
    candidate: ProjectMediaMatchCandidate
  ) => Promise<ProjectMediaMatchChoice>;
  resolveProjectMediaMatch: (choice: ProjectMediaMatchChoice) => void;
  markProjectMediaMatchHandled: (projectId: string) => void;
  hasHandledProjectMediaMatch: (projectId: string) => boolean;
  resetProjectMediaMatchDialog: () => void;
}

function addHandledProjectId(existing: string[], projectId: string): string[] {
  return existing.includes(projectId) ? existing : [...existing, projectId];
}

export const useProjectMediaMatchDialogStore = create<ProjectMediaMatchDialogState>((set, get) => ({
  isOpen: false,
  projectId: null,
  candidate: null,
  handledProjectIds: [],
  resolver: null,

  requestProjectMediaMatch: (projectId, candidate) => {
    if (!projectId || get().handledProjectIds.includes(projectId)) {
      return Promise.resolve('keep-current');
    }

    const previousResolver = get().resolver;
    if (previousResolver) {
      previousResolver('keep-current');
    }

    return new Promise<ProjectMediaMatchChoice>((resolve) => {
      set({
        isOpen: true,
        projectId,
        candidate,
        resolver: resolve,
      });
    });
  },

  resolveProjectMediaMatch: (choice) => {
    const { resolver, projectId, handledProjectIds } = get();
    resolver?.(choice);

    set({
      isOpen: false,
      projectId: null,
      candidate: null,
      resolver: null,
      handledProjectIds: projectId
        ? addHandledProjectId(handledProjectIds, projectId)
        : handledProjectIds,
    });
  },

  markProjectMediaMatchHandled: (projectId) => {
    if (!projectId) {
      return;
    }

    set((state) => ({
      handledProjectIds: addHandledProjectId(state.handledProjectIds, projectId),
    }));
  },

  hasHandledProjectMediaMatch: (projectId) => {
    return get().handledProjectIds.includes(projectId);
  },

  resetProjectMediaMatchDialog: () => {
    const { resolver } = get();
    resolver?.('keep-current');
    set({
      isOpen: false,
      projectId: null,
      candidate: null,
      resolver: null,
      handledProjectIds: [],
    });
  },
}));
