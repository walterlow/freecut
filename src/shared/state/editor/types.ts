export type ClipInspectorTab = 'transform' | 'effects' | 'media';

export type PreviewMode = 'program' | 'flow-stage';

export interface EditorState {
  activePanel: 'media' | 'effects' | 'properties' | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  activeTab: 'media' | 'text' | 'shapes' | 'effects' | 'transitions' | 'live-ai';
  clipInspectorTab: ClipInspectorTab;
  sidebarWidth: number;
  rightSidebarWidth: number;
  timelineHeight: number;
  sourcePreviewMediaId: string | null;
  colorScopesOpen: boolean;
  /** Controls whether the center canvas shows the NLE program monitor or the Flow Stage. */
  previewMode: PreviewMode;
}

export interface EditorActions {
  setActivePanel: (panel: 'media' | 'effects' | 'properties' | null) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setActiveTab: (tab: 'media' | 'text' | 'shapes' | 'effects' | 'transitions' | 'live-ai') => void;
  setClipInspectorTab: (tab: ClipInspectorTab) => void;
  setSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  syncSidebarLayout: (layout: {
    sidebarDefaultWidth: number;
    sidebarMinWidth: number;
    sidebarMaxWidth: number;
  }) => void;
  setTimelineHeight: (height: number) => void;
  setSourcePreviewMediaId: (mediaId: string | null) => void;
  setColorScopesOpen: (open: boolean) => void;
  toggleColorScopesOpen: () => void;
  setPreviewMode: (mode: PreviewMode) => void;
  togglePreviewMode: () => void;
}
