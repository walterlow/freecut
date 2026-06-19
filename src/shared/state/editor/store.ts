import { create } from 'zustand'
import type { EditorState, EditorActions, TrackSizePreset } from './types'
import {
  EDITOR_LAYOUT,
  getLeftEditorSidebarBounds,
  getRightEditorSidebarBounds,
} from '@/config/editor-layout'
import {
  normalizeEditorWorkspaceId,
  normalizeEditorWorkspaceLayout,
  type EditorWorkspaceId,
  type EditorWorkspaceLayout,
} from '@/config/editor-workspaces'

const LEGACY_SIDEBAR_DEFAULT_WIDTH = 320
const WORKSPACE_STORAGE_KEY = 'editor:workspace'
const TRACK_SIZE_PRESET_STORAGE_KEY = 'editor:trackSizePreset'

function loadTrackSizePreset(): TrackSizePreset {
  try {
    const stored = localStorage.getItem(TRACK_SIZE_PRESET_STORAGE_KEY)
    if (stored === 'compact' || stored === 'medium' || stored === 'large') {
      return stored
    }
  } catch {
    /* noop */
  }
  return 'medium'
}

function workspaceLayoutStorageKey(workspace: EditorWorkspaceId): string {
  return `editor:workspaceLayout:${workspace}`
}

function loadEditorWorkspaceId(): EditorWorkspaceId {
  try {
    return normalizeEditorWorkspaceId(localStorage.getItem(WORKSPACE_STORAGE_KEY))
  } catch {
    return normalizeEditorWorkspaceId(null)
  }
}

function loadLegacyPropertiesFullColumn(): boolean {
  try {
    return localStorage.getItem('editor:propertiesFullColumn') === 'true'
  } catch {
    return false
  }
}

/** Saved per-workspace layout (user tweaks), falling back to the workspace preset. */
function loadEditorWorkspaceLayout(workspace: EditorWorkspaceId): EditorWorkspaceLayout {
  let stored: unknown = null
  try {
    const raw = localStorage.getItem(workspaceLayoutStorageKey(workspace))
    stored = raw === null ? null : JSON.parse(raw)
  } catch {
    stored = null
  }

  const layout = normalizeEditorWorkspaceLayout(stored, workspace)
  // The edit workspace inherits the pre-workspaces global preference until
  // the user has a saved snapshot for it.
  const hasStoredFullColumn =
    typeof (stored as { propertiesFullColumn?: unknown } | null)?.propertiesFullColumn === 'boolean'
  if (workspace === 'edit' && !hasStoredFullColumn) {
    return { ...layout, propertiesFullColumn: loadLegacyPropertiesFullColumn() }
  }
  return layout
}

function getEditorWorkspaceLayoutSnapshot(state: EditorState): EditorWorkspaceLayout {
  return {
    colorScopesOpen: state.colorScopesOpen,
    clipInspectorTab: state.clipInspectorTab,
    activeTab: state.activeTab,
    propertiesFullColumn: state.propertiesFullColumn,
  }
}

function saveEditorWorkspaceLayout(
  workspace: EditorWorkspaceId,
  layout: EditorWorkspaceLayout,
): void {
  try {
    localStorage.setItem(workspaceLayoutStorageKey(workspace), JSON.stringify(layout))
  } catch {
    /* noop */
  }
}

const initialWorkspace = loadEditorWorkspaceId()
const initialWorkspaceLayout = loadEditorWorkspaceLayout(initialWorkspace)

function normalizeSidebarWidth(
  width: number,
  fallback: number,
  bounds: { minWidth: number; maxWidth: number },
): number {
  if (!Number.isFinite(width)) return fallback
  const nextWidth =
    width === LEGACY_SIDEBAR_DEFAULT_WIDTH && fallback !== LEGACY_SIDEBAR_DEFAULT_WIDTH
      ? fallback
      : width
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, nextWidth))
}

function loadSidebarWidth(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) {
      const parsedWidth = Number(v)
      return Number.isFinite(parsedWidth) ? parsedWidth : fallback
    }
  } catch {
    /* noop */
  }
  return fallback
}

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  // State
  activePanel: null,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  keyframeEditorOpen: false,
  keyframeEditorShortcutScopeActive: false,
  workspace: initialWorkspace,
  activeTab: initialWorkspaceLayout.activeTab,
  clipInspectorTab: initialWorkspaceLayout.clipInspectorTab,
  sidebarWidth: loadSidebarWidth('editor:sidebarWidth', EDITOR_LAYOUT.leftSidebarDefaultWidth),
  rightSidebarWidth: loadSidebarWidth(
    'editor:rightSidebarWidth',
    EDITOR_LAYOUT.rightSidebarDefaultWidth,
  ),
  timelineHeight: 250,
  sourcePreviewMediaId: null,
  mediaSkimPreviewMediaId: null,
  mediaSkimPreviewFrame: null,
  compoundClipSkimPreviewCompositionId: null,
  compoundClipSkimPreviewFrame: null,
  transcriptionDialogDepth: 0,
  sourcePatchVideoEnabled: true,
  sourcePatchAudioEnabled: true,
  sourcePatchVideoTrackId: null,
  sourcePatchAudioTrackId: null,
  linkedSelectionEnabled: true,
  colorScopesOpen: initialWorkspaceLayout.colorScopesOpen,
  mixerFloating: (() => {
    try {
      return localStorage.getItem('editor:mixerFloating') === 'true'
    } catch {
      return false
    }
  })(),
  propertiesFullColumn: initialWorkspaceLayout.propertiesFullColumn,
  mediaFullColumn: (() => {
    try {
      const v = localStorage.getItem('editor:mediaFullColumn')
      return v === null ? true : v === 'true'
    } catch {
      return true
    }
  })(),
  trackSizePreset: loadTrackSizePreset(),

  // Actions
  setActivePanel: (panel) => set({ activePanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  setKeyframeEditorOpen: (open) =>
    set((state) => ({
      keyframeEditorOpen: open,
      keyframeEditorShortcutScopeActive: open ? state.keyframeEditorShortcutScopeActive : false,
      leftSidebarOpen: open ? true : state.leftSidebarOpen,
    })),
  setKeyframeEditorShortcutScopeActive: (active) =>
    set({ keyframeEditorShortcutScopeActive: active }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
  toggleKeyframeEditorOpen: () =>
    set((state) => {
      const nextOpen = !state.keyframeEditorOpen
      return {
        keyframeEditorOpen: nextOpen,
        keyframeEditorShortcutScopeActive: nextOpen
          ? state.keyframeEditorShortcutScopeActive
          : false,
        leftSidebarOpen: nextOpen ? true : state.leftSidebarOpen,
      }
    }),
  setWorkspace: (workspace) =>
    set((state) => {
      if (state.workspace === workspace) return state

      // Remember the outgoing workspace's layout so the user's tweaks
      // survive a round trip; the incoming workspace restores its own
      // saved layout (or the preset on first visit).
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(state))
      try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace)
      } catch {
        /* noop */
      }

      return { workspace, ...loadEditorWorkspaceLayout(workspace) }
    }),
  setActiveTab: (tab) =>
    set((state) => {
      const nextState = { ...state, activeTab: tab }
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(nextState))
      return { activeTab: tab }
    }),
  setClipInspectorTab: (tab) =>
    set((state) => {
      const nextState = { ...state, clipInspectorTab: tab }
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(nextState))
      return { clipInspectorTab: tab }
    }),
  setSidebarWidth: (width) => {
    try {
      localStorage.setItem('editor:sidebarWidth', String(width))
    } catch {
      /* noop */
    }
    set({ sidebarWidth: width })
  },
  setRightSidebarWidth: (width) => {
    try {
      localStorage.setItem('editor:rightSidebarWidth', String(width))
    } catch {
      /* noop */
    }
    set({ rightSidebarWidth: width })
  },
  syncSidebarLayout: (layout) =>
    set((currentState) => ({
      sidebarWidth: normalizeSidebarWidth(
        currentState.sidebarWidth,
        layout.leftSidebarDefaultWidth,
        getLeftEditorSidebarBounds({
          leftSidebarMinWidth: layout.leftSidebarMinWidth,
          leftSidebarMaxWidth: layout.leftSidebarMaxWidth,
        }),
      ),
      rightSidebarWidth: normalizeSidebarWidth(
        currentState.rightSidebarWidth,
        layout.rightSidebarDefaultWidth,
        getRightEditorSidebarBounds({
          rightSidebarMinWidth: layout.rightSidebarMinWidth,
          rightSidebarMaxWidth: layout.rightSidebarMaxWidth,
        }),
      ),
    })),
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setSourcePreviewMediaId: (mediaId) =>
    set({
      sourcePreviewMediaId: mediaId,
      mediaSkimPreviewMediaId: null,
      mediaSkimPreviewFrame: null,
      compoundClipSkimPreviewCompositionId: null,
      compoundClipSkimPreviewFrame: null,
    }),
  setMediaSkimPreview: (mediaId, frame = null) =>
    set((state) => {
      const nextFrame = mediaId ? frame : null
      if (
        state.mediaSkimPreviewMediaId === mediaId &&
        state.mediaSkimPreviewFrame === nextFrame &&
        state.compoundClipSkimPreviewCompositionId === null &&
        state.compoundClipSkimPreviewFrame === null
      ) {
        return state
      }

      return {
        mediaSkimPreviewMediaId: mediaId,
        mediaSkimPreviewFrame: nextFrame,
        compoundClipSkimPreviewCompositionId: null,
        compoundClipSkimPreviewFrame: null,
      }
    }),
  clearMediaSkimPreview: () =>
    set((state) => {
      if (state.mediaSkimPreviewMediaId === null && state.mediaSkimPreviewFrame === null) {
        return state
      }

      return {
        mediaSkimPreviewMediaId: null,
        mediaSkimPreviewFrame: null,
      }
    }),
  setCompoundClipSkimPreview: (compositionId, frame = null) =>
    set((state) => {
      const nextFrame = compositionId ? frame : null
      if (
        state.compoundClipSkimPreviewCompositionId === compositionId &&
        state.compoundClipSkimPreviewFrame === nextFrame &&
        state.mediaSkimPreviewMediaId === null &&
        state.mediaSkimPreviewFrame === null
      ) {
        return state
      }

      return {
        compoundClipSkimPreviewCompositionId: compositionId,
        compoundClipSkimPreviewFrame: nextFrame,
        mediaSkimPreviewMediaId: null,
        mediaSkimPreviewFrame: null,
      }
    }),
  clearCompoundClipSkimPreview: () =>
    set((state) => {
      if (
        state.compoundClipSkimPreviewCompositionId === null &&
        state.compoundClipSkimPreviewFrame === null
      ) {
        return state
      }

      return {
        compoundClipSkimPreviewCompositionId: null,
        compoundClipSkimPreviewFrame: null,
      }
    }),
  beginTranscriptionDialog: () =>
    set((state) => ({
      transcriptionDialogDepth: state.transcriptionDialogDepth + 1,
    })),
  endTranscriptionDialog: () =>
    set((state) => ({
      transcriptionDialogDepth: Math.max(0, state.transcriptionDialogDepth - 1),
    })),
  setSourcePatchVideoEnabled: (enabled) => set({ sourcePatchVideoEnabled: enabled }),
  setSourcePatchAudioEnabled: (enabled) => set({ sourcePatchAudioEnabled: enabled }),
  setSourcePatchVideoTrackId: (trackId) => set({ sourcePatchVideoTrackId: trackId }),
  setSourcePatchAudioTrackId: (trackId) => set({ sourcePatchAudioTrackId: trackId }),
  toggleSourcePatchVideoEnabled: () =>
    set((state) => ({ sourcePatchVideoEnabled: !state.sourcePatchVideoEnabled })),
  toggleSourcePatchAudioEnabled: () =>
    set((state) => ({ sourcePatchAudioEnabled: !state.sourcePatchAudioEnabled })),
  setLinkedSelectionEnabled: (enabled) => set({ linkedSelectionEnabled: enabled }),
  toggleLinkedSelectionEnabled: () =>
    set((state) => ({ linkedSelectionEnabled: !state.linkedSelectionEnabled })),
  setColorScopesOpen: (open) =>
    set((state) => {
      const nextState = { ...state, colorScopesOpen: open }
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(nextState))
      return { colorScopesOpen: open }
    }),
  toggleColorScopesOpen: () =>
    set((state) => {
      const colorScopesOpen = !state.colorScopesOpen
      const nextState = { ...state, colorScopesOpen }
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(nextState))
      return { colorScopesOpen }
    }),
  setMixerFloating: (floating) => {
    try {
      localStorage.setItem('editor:mixerFloating', String(floating))
    } catch {
      /* noop */
    }
    set({ mixerFloating: floating })
  },
  toggleMixerFloating: () =>
    set((state) => {
      const next = !state.mixerFloating
      try {
        localStorage.setItem('editor:mixerFloating', String(next))
      } catch {
        /* noop */
      }
      return { mixerFloating: next }
    }),
  togglePropertiesFullColumn: () =>
    set((state) => {
      const next = !state.propertiesFullColumn
      try {
        localStorage.setItem('editor:propertiesFullColumn', String(next))
      } catch {
        /* noop */
      }
      const nextState = { ...state, propertiesFullColumn: next }
      saveEditorWorkspaceLayout(state.workspace, getEditorWorkspaceLayoutSnapshot(nextState))
      return { propertiesFullColumn: next }
    }),
  toggleMediaFullColumn: () =>
    set((state) => {
      const next = !state.mediaFullColumn
      try {
        localStorage.setItem('editor:mediaFullColumn', String(next))
      } catch {
        /* noop */
      }
      return { mediaFullColumn: next }
    }),
  setTrackSizePreset: (preset) => {
    try {
      localStorage.setItem(TRACK_SIZE_PRESET_STORAGE_KEY, preset)
    } catch {
      /* noop */
    }
    set({ trackSizePreset: preset })
  },
}))
