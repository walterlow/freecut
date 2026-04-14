import { create } from 'zustand';

export interface PromptHistoryEntry {
  text: string;
  source: 'scope-snap' | 'manual' | 'imported';
  timestamp: number;
}

export interface PromptState {
  currentPrompt: string;
  promptHistory: PromptHistoryEntry[];
  isGenerating: boolean;
  engineAvailable: boolean;
  autoApply: boolean;
}

export interface PromptActions {
  setPrompt: (text: string) => void;
  setGenerating: (generating: boolean) => void;
  setEngineAvailable: (available: boolean) => void;
  setAutoApply: (auto: boolean) => void;
  addToHistory: (entry: PromptHistoryEntry) => void;
  clearHistory: () => void;
  applyFromSnap: (text: string) => void;
}

const MAX_HISTORY = 50;

export const usePromptStore = create<PromptState & PromptActions>()((set) => ({
  currentPrompt: '',
  promptHistory: [],
  isGenerating: false,
  engineAvailable: false,
  autoApply: true,

  setPrompt: (text) => set({ currentPrompt: text }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  setEngineAvailable: (available) => set({ engineAvailable: available }),
  setAutoApply: (auto) => set({ autoApply: auto }),

  addToHistory: (entry) =>
    set((state) => ({
      promptHistory: [entry, ...state.promptHistory].slice(0, MAX_HISTORY),
    })),

  clearHistory: () => set({ promptHistory: [] }),

  applyFromSnap: (text) =>
    set((state) => ({
      currentPrompt: text,
      isGenerating: false,
      promptHistory: [
        { text, source: 'scope-snap' as const, timestamp: Date.now() },
        ...state.promptHistory,
      ].slice(0, MAX_HISTORY),
    })),
}));
