import { create } from 'zustand';
import type {
  LocalInferenceActions,
  LocalInferenceStateShape,
} from './types';

export const useLocalInferenceStore = create<
  LocalInferenceStateShape & LocalInferenceActions
>((set) => ({
  runtimesById: {},

  registerRuntime: (runtime) => set((state) => ({
    runtimesById: {
      ...state.runtimesById,
      [runtime.id]: runtime,
    },
  })),

  updateRuntime: (id, updates) => set((state) => {
    const existing = state.runtimesById[id];
    if (!existing) {
      return state;
    }

    return {
      runtimesById: {
        ...state.runtimesById,
        [id]: {
          ...existing,
          ...updates,
          lastUsedAt: updates.lastUsedAt ?? Date.now(),
        },
      },
    };
  }),

  unregisterRuntime: (id) => set((state) => {
    if (!(id in state.runtimesById)) {
      return state;
    }

    const runtimesById = { ...state.runtimesById };
    delete runtimesById[id];
    return { runtimesById };
  }),

  clearRuntimes: () => set({ runtimesById: {} }),
}));
