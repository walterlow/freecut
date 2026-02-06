/**
 * Transition Presets Store
 *
 * Zustand store for browsable, searchable transition presets.
 * Supports built-in presets and user-created custom presets.
 */

import { create } from 'zustand';
import type { TransitionPreset, TransitionCategory } from '@/types/transition';

export interface PresetsState {
  presets: TransitionPreset[];
  selectedPresetId: string | null;
  searchQuery: string;
  filterCategory: TransitionCategory | 'all';
  favorites: Set<string>;
}

export interface PresetsActions {
  // Initialization
  loadPresets: (presets: TransitionPreset[]) => void;

  // CRUD
  addPreset: (preset: TransitionPreset) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, updates: Partial<TransitionPreset>) => void;

  // Selection & filtering
  setSelectedPresetId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterCategory: (category: TransitionCategory | 'all') => void;

  // Favorites
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  // Derived
  getFilteredPresets: () => TransitionPreset[];
  getPresetsByCategory: (category: TransitionCategory) => TransitionPreset[];
  getPresetById: (id: string) => TransitionPreset | undefined;
}

export const usePresetsStore = create<PresetsState & PresetsActions>()(
  (set, get) => ({
    // State
    presets: [],
    selectedPresetId: null,
    searchQuery: '',
    filterCategory: 'all',
    favorites: new Set<string>(),

    // Initialization
    loadPresets: (presets) => set({ presets }),

    // CRUD
    addPreset: (preset) =>
      set((state) => ({ presets: [...state.presets, preset] })),

    removePreset: (id) =>
      set((state) => ({
        presets: state.presets.filter((p) => p.id !== id),
        selectedPresetId: state.selectedPresetId === id ? null : state.selectedPresetId,
      })),

    updatePreset: (id, updates) =>
      set((state) => ({
        presets: state.presets.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      })),

    // Selection & filtering
    setSelectedPresetId: (id) => set({ selectedPresetId: id }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setFilterCategory: (category) => set({ filterCategory: category }),

    // Favorites
    toggleFavorite: (id) =>
      set((state) => {
        const newFavorites = new Set(state.favorites);
        if (newFavorites.has(id)) {
          newFavorites.delete(id);
        } else {
          newFavorites.add(id);
        }
        return { favorites: newFavorites };
      }),

    isFavorite: (id) => get().favorites.has(id),

    // Derived
    getFilteredPresets: () => {
      const { presets, searchQuery, filterCategory } = get();
      let filtered = presets;

      if (filterCategory !== 'all') {
        filtered = filtered.filter((p) => p.category === filterCategory);
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.tags.some((t) => t.toLowerCase().includes(query)) ||
            p.config.presentation.toLowerCase().includes(query)
        );
      }

      return filtered;
    },

    getPresetsByCategory: (category) =>
      get().presets.filter((p) => p.category === category),

    getPresetById: (id) =>
      get().presets.find((p) => p.id === id),
  })
);
