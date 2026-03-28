import { create } from 'zustand';
import type { EditorState, EditorActions } from './types';
import {
  clampEditorSidebarWidth,
  EDITOR_LAYOUT,
  type EditorLayout,
} from '@/shared/ui/editor-layout';

const LEGACY_SIDEBAR_DEFAULT_WIDTH = 320;

function normalizeSidebarWidth(
  width: number,
  fallback: number,
  layout: Pick<EditorLayout, 'sidebarMinWidth' | 'sidebarMaxWidth'>
): number {
  if (!Number.isFinite(width)) return fallback;
  const nextWidth = (
    width === LEGACY_SIDEBAR_DEFAULT_WIDTH
    && fallback !== LEGACY_SIDEBAR_DEFAULT_WIDTH
  )
    ? fallback
    : width;
  return clampEditorSidebarWidth(nextWidth, layout);
}

function loadSidebarWidth(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const parsedWidth = Number(v);
      return Number.isFinite(parsedWidth) ? parsedWidth : fallback;
    }
  } catch { /* noop */ }
  return fallback;
}

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  // State
  activePanel: null,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  activeTab: 'media',
  clipInspectorTab: 'transform',
  sidebarWidth: loadSidebarWidth('editor:sidebarWidth', EDITOR_LAYOUT.sidebarDefaultWidth),
  rightSidebarWidth: loadSidebarWidth('editor:rightSidebarWidth', EDITOR_LAYOUT.sidebarDefaultWidth),
  timelineHeight: 250,
  sourcePreviewMediaId: null,
  colorScopesOpen: false,

  // Actions
  setActivePanel: (panel) => set({ activePanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setClipInspectorTab: (tab) => set({ clipInspectorTab: tab }),
  setSidebarWidth: (width) => {
    try { localStorage.setItem('editor:sidebarWidth', String(width)); } catch { /* noop */ }
    set({ sidebarWidth: width });
  },
  setRightSidebarWidth: (width) => {
    try { localStorage.setItem('editor:rightSidebarWidth', String(width)); } catch { /* noop */ }
    set({ rightSidebarWidth: width });
  },
  syncSidebarLayout: (layout) => set((currentState) => ({
    sidebarWidth: normalizeSidebarWidth(
      currentState.sidebarWidth,
      layout.sidebarDefaultWidth,
      layout
    ),
    rightSidebarWidth: normalizeSidebarWidth(
      currentState.rightSidebarWidth,
      layout.sidebarDefaultWidth,
      layout
    ),
  })),
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setSourcePreviewMediaId: (mediaId) => set({ sourcePreviewMediaId: mediaId }),
  setColorScopesOpen: (open) => set({ colorScopesOpen: open }),
  toggleColorScopesOpen: () => set((state) => ({ colorScopesOpen: !state.colorScopesOpen })),
}));
