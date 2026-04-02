import { create } from 'zustand';
import type { EditorState, EditorActions } from './types';
import {
  EDITOR_LAYOUT,
  getLeftEditorSidebarBounds,
  getRightEditorSidebarBounds,
} from '@/shared/ui/editor-layout';

const LEGACY_SIDEBAR_DEFAULT_WIDTH = 320;

function normalizeSidebarWidth(
  width: number,
  fallback: number,
  bounds: { minWidth: number; maxWidth: number }
): number {
  if (!Number.isFinite(width)) return fallback;
  const nextWidth = (
    width === LEGACY_SIDEBAR_DEFAULT_WIDTH
    && fallback !== LEGACY_SIDEBAR_DEFAULT_WIDTH
  )
    ? fallback
    : width;
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, nextWidth));
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
  keyframeEditorOpen: false,
  activeTab: 'media',
  clipInspectorTab: 'video',
  sidebarWidth: loadSidebarWidth('editor:sidebarWidth', EDITOR_LAYOUT.leftSidebarDefaultWidth),
  rightSidebarWidth: loadSidebarWidth('editor:rightSidebarWidth', EDITOR_LAYOUT.rightSidebarDefaultWidth),
  timelineHeight: 250,
  sourcePreviewMediaId: null,
  mediaSkimPreviewMediaId: null,
  mediaSkimPreviewFrame: null,
  compoundClipSkimPreviewCompositionId: null,
  compoundClipSkimPreviewFrame: null,
  sourcePatchVideoEnabled: true,
  sourcePatchAudioEnabled: true,
  linkedSelectionEnabled: true,
  colorScopesOpen: false,
  mixerFloating: (() => {
    try { return localStorage.getItem('editor:mixerFloating') === 'true'; } catch { return false; }
  })(),

  // Actions
  setActivePanel: (panel) => set({ activePanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  setKeyframeEditorOpen: (open) => set((state) => ({
    keyframeEditorOpen: open,
    leftSidebarOpen: open ? true : state.leftSidebarOpen,
  })),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
  toggleKeyframeEditorOpen: () => set((state) => {
    const nextOpen = !state.keyframeEditorOpen;
    return {
      keyframeEditorOpen: nextOpen,
      leftSidebarOpen: nextOpen ? true : state.leftSidebarOpen,
    };
  }),
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
      layout.leftSidebarDefaultWidth,
      getLeftEditorSidebarBounds(layout)
    ),
    rightSidebarWidth: normalizeSidebarWidth(
      currentState.rightSidebarWidth,
      layout.rightSidebarDefaultWidth,
      getRightEditorSidebarBounds(layout)
    ),
  })),
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setSourcePreviewMediaId: (mediaId) => set({
    sourcePreviewMediaId: mediaId,
    mediaSkimPreviewMediaId: null,
    mediaSkimPreviewFrame: null,
    compoundClipSkimPreviewCompositionId: null,
    compoundClipSkimPreviewFrame: null,
  }),
  setMediaSkimPreview: (mediaId, frame = null) => set((state) => {
    const nextFrame = mediaId ? frame : null;
    if (
      state.mediaSkimPreviewMediaId === mediaId
      && state.mediaSkimPreviewFrame === nextFrame
      && state.compoundClipSkimPreviewCompositionId === null
      && state.compoundClipSkimPreviewFrame === null
    ) {
      return state;
    }

    return {
      mediaSkimPreviewMediaId: mediaId,
      mediaSkimPreviewFrame: nextFrame,
      compoundClipSkimPreviewCompositionId: null,
      compoundClipSkimPreviewFrame: null,
    };
  }),
  clearMediaSkimPreview: () => set((state) => {
    if (state.mediaSkimPreviewMediaId === null && state.mediaSkimPreviewFrame === null) {
      return state;
    }

    return {
      mediaSkimPreviewMediaId: null,
      mediaSkimPreviewFrame: null,
    };
  }),
  setCompoundClipSkimPreview: (compositionId, frame = null) => set((state) => {
    const nextFrame = compositionId ? frame : null;
    if (
      state.compoundClipSkimPreviewCompositionId === compositionId
      && state.compoundClipSkimPreviewFrame === nextFrame
      && state.mediaSkimPreviewMediaId === null
      && state.mediaSkimPreviewFrame === null
    ) {
      return state;
    }

    return {
      compoundClipSkimPreviewCompositionId: compositionId,
      compoundClipSkimPreviewFrame: nextFrame,
      mediaSkimPreviewMediaId: null,
      mediaSkimPreviewFrame: null,
    };
  }),
  clearCompoundClipSkimPreview: () => set((state) => {
    if (
      state.compoundClipSkimPreviewCompositionId === null
      && state.compoundClipSkimPreviewFrame === null
    ) {
      return state;
    }

    return {
      compoundClipSkimPreviewCompositionId: null,
      compoundClipSkimPreviewFrame: null,
    };
  }),
  setSourcePatchVideoEnabled: (enabled) => set({ sourcePatchVideoEnabled: enabled }),
  setSourcePatchAudioEnabled: (enabled) => set({ sourcePatchAudioEnabled: enabled }),
  toggleSourcePatchVideoEnabled: () => set((state) => ({ sourcePatchVideoEnabled: !state.sourcePatchVideoEnabled })),
  toggleSourcePatchAudioEnabled: () => set((state) => ({ sourcePatchAudioEnabled: !state.sourcePatchAudioEnabled })),
  setLinkedSelectionEnabled: (enabled) => set({ linkedSelectionEnabled: enabled }),
  toggleLinkedSelectionEnabled: () => set((state) => ({ linkedSelectionEnabled: !state.linkedSelectionEnabled })),
  setColorScopesOpen: (open) => set({ colorScopesOpen: open }),
  toggleColorScopesOpen: () => set((state) => ({ colorScopesOpen: !state.colorScopesOpen })),
  setMixerFloating: (floating) => {
    try { localStorage.setItem('editor:mixerFloating', String(floating)); } catch { /* noop */ }
    set({ mixerFloating: floating });
  },
  toggleMixerFloating: () => set((state) => {
    const next = !state.mixerFloating;
    try { localStorage.setItem('editor:mixerFloating', String(next)); } catch { /* noop */ }
    return { mixerFloating: next };
  }),
}));
