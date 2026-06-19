import type {
  EditorClipInspectorTab,
  EditorSidebarTab,
  EditorWorkspaceId,
} from '@/config/editor-workspaces'

export type ClipInspectorTab = EditorClipInspectorTab

/** Persisted timeline track-height preset chosen from the track-size flyout. */
export type TrackSizePreset = 'compact' | 'medium' | 'large'

export interface EditorState {
  activePanel: 'media' | 'effects' | 'properties' | null
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  keyframeEditorOpen: boolean
  keyframeEditorShortcutScopeActive: boolean
  workspace: EditorWorkspaceId
  activeTab: EditorSidebarTab
  clipInspectorTab: ClipInspectorTab
  sidebarWidth: number
  rightSidebarWidth: number
  timelineHeight: number
  sourcePreviewMediaId: string | null
  mediaSkimPreviewMediaId: string | null
  mediaSkimPreviewFrame: number | null
  compoundClipSkimPreviewCompositionId: string | null
  compoundClipSkimPreviewFrame: number | null
  transcriptionDialogDepth: number
  sourcePatchVideoEnabled: boolean
  sourcePatchAudioEnabled: boolean
  sourcePatchVideoTrackId: string | null
  sourcePatchAudioTrackId: string | null
  linkedSelectionEnabled: boolean
  colorScopesOpen: boolean
  mixerFloating: boolean
  propertiesFullColumn: boolean
  mediaFullColumn: boolean
  trackSizePreset: TrackSizePreset
}

export interface EditorActions {
  setActivePanel: (panel: 'media' | 'effects' | 'properties' | null) => void
  setLeftSidebarOpen: (open: boolean) => void
  setRightSidebarOpen: (open: boolean) => void
  setKeyframeEditorOpen: (open: boolean) => void
  setKeyframeEditorShortcutScopeActive: (active: boolean) => void
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  toggleKeyframeEditorOpen: () => void
  setWorkspace: (workspace: EditorWorkspaceId) => void
  setActiveTab: (tab: EditorSidebarTab) => void
  setClipInspectorTab: (tab: ClipInspectorTab) => void
  setSidebarWidth: (width: number) => void
  setRightSidebarWidth: (width: number) => void
  syncSidebarLayout: (layout: {
    leftSidebarDefaultWidth: number
    leftSidebarMinWidth: number
    leftSidebarMaxWidth: number
    rightSidebarDefaultWidth: number
    rightSidebarMinWidth: number
    rightSidebarMaxWidth: number
  }) => void
  setTimelineHeight: (height: number) => void
  setSourcePreviewMediaId: (mediaId: string | null) => void
  setMediaSkimPreview: (mediaId: string | null, frame?: number | null) => void
  clearMediaSkimPreview: () => void
  setCompoundClipSkimPreview: (compositionId: string | null, frame?: number | null) => void
  clearCompoundClipSkimPreview: () => void
  beginTranscriptionDialog: () => void
  endTranscriptionDialog: () => void
  setSourcePatchVideoEnabled: (enabled: boolean) => void
  setSourcePatchAudioEnabled: (enabled: boolean) => void
  setSourcePatchVideoTrackId: (trackId: string | null) => void
  setSourcePatchAudioTrackId: (trackId: string | null) => void
  toggleSourcePatchVideoEnabled: () => void
  toggleSourcePatchAudioEnabled: () => void
  setLinkedSelectionEnabled: (enabled: boolean) => void
  toggleLinkedSelectionEnabled: () => void
  setColorScopesOpen: (open: boolean) => void
  toggleColorScopesOpen: () => void
  setMixerFloating: (floating: boolean) => void
  toggleMixerFloating: () => void
  togglePropertiesFullColumn: () => void
  toggleMediaFullColumn: () => void
  setTrackSizePreset: (preset: TrackSizePreset) => void
}
