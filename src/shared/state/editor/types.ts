export interface EditorState {
  activePanel: 'media' | 'effects' | 'properties' | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  activeTab: 'media' | 'text' | 'shapes' | 'effects' | 'transitions';
  sidebarWidth: number;
  rightSidebarWidth: number;
  timelineHeight: number;
  sourcePreviewMediaId: string | null;
}

export interface EditorActions {
  setActivePanel: (panel: 'media' | 'effects' | 'properties' | null) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setActiveTab: (tab: 'media' | 'text' | 'shapes' | 'effects' | 'transitions') => void;
  setSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setTimelineHeight: (height: number) => void;
  setSourcePreviewMediaId: (mediaId: string | null) => void;
}
