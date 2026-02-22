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

export interface SelectionState {
  selectedItemIds: string[];
  selectedMarkerId: string | null; // Selected marker ID
  selectedTransitionId: string | null; // Selected transition ID
  selectedTrackId: string | null; // Deprecated: use activeTrackId
  selectedTrackIds: string[]; // Multi-track selection
  activeTrackId: string | null; // Single active track
  selectionType: 'item' | 'track' | 'marker' | 'transition' | null;
  activeTool: 'select' | 'razor' | 'rate-stretch' | 'rolling-edit' | 'ripple-edit' | 'slip' | 'slide'; // Active timeline tool
  // Drag state for visual feedback
  dragState: {
    isDragging: boolean;
    draggedItemIds: string[];
    draggedTrackIds?: string[]; // For track dragging
    offset: { x: number; y: number };
    activeSnapTarget?: { frame: number; type: 'grid' | 'item-start' | 'item-end' | 'playhead'; itemId?: string } | null;
    isAltDrag?: boolean; // Whether Alt key is held (triggers duplication)
  } | null;
  // Keyframe lanes expansion state
  expandedKeyframeLanes: Set<string>; // Set of item IDs with expanded keyframe lanes
}

export interface SelectionActions {
  selectItems: (ids: string[]) => void;
  selectMarker: (id: string | null) => void; // Select a marker
  selectTransition: (id: string | null) => void; // Select a transition
  selectTrack: (id: string | null) => void; // Deprecated: use setActiveTrack
  selectTracks: (ids: string[], append?: boolean) => void;
  setActiveTrack: (id: string | null) => void;
  toggleTrackSelection: (id: string) => void;
  clearSelection: () => void;
  clearItemSelection: () => void; // Clears only items, preserves track selection
  setDragState: (dragState: SelectionState['dragState']) => void;
  setActiveTool: (tool: SelectionState['activeTool']) => void;
  // Keyframe lanes expansion
  toggleKeyframeLanes: (itemId: string) => void;
  setKeyframeLanesExpanded: (itemId: string, expanded: boolean) => void;
}
