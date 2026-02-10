import { create } from 'zustand';
import type { EditorState, EditorActions } from '../types';

function loadNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return Number(v);
  } catch { /* noop */ }
  return fallback;
}

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  // State
  activePanel: null,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  activeTab: 'media',
  sidebarWidth: loadNumber('editor:sidebarWidth', 320),
  rightSidebarWidth: loadNumber('editor:rightSidebarWidth', 320),
  timelineHeight: 250,

  // Actions
  setActivePanel: (panel) => set({ activePanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSidebarWidth: (width) => {
    try { localStorage.setItem('editor:sidebarWidth', String(width)); } catch { /* noop */ }
    set({ sidebarWidth: width });
  },
  setRightSidebarWidth: (width) => {
    try { localStorage.setItem('editor:rightSidebarWidth', String(width)); } catch { /* noop */ }
    set({ rightSidebarWidth: width });
  },
  setTimelineHeight: (height) => set({ timelineHeight: height }),
}));
