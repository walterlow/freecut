import { create } from 'zustand';
import type { EditorState, EditorActions } from '../types';

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  // State
  activePanel: null,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  activeTab: 'media',
  sidebarWidth: 300,
  rightSidebarWidth: 340,
  timelineHeight: 250,

  // Actions
  setActivePanel: (panel) => set({ activePanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
  setTimelineHeight: (height) => set({ timelineHeight: height }),
}));
