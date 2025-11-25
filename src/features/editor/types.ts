export interface EditorState {
  activePanel: 'media' | 'effects' | 'properties' | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  activeTab: 'media' | 'effects';
  sidebarWidth: number;
  timelineHeight: number;
}

export interface EditorActions {
  setActivePanel: (panel: 'media' | 'effects' | 'properties' | null) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setActiveTab: (tab: 'media' | 'effects') => void;
  setSidebarWidth: (width: number) => void;
  setTimelineHeight: (height: number) => void;
}

export interface SelectionState {
  selectedItemIds: string[];
  selectedTrackId: string | null; // Deprecated: use activeTrackId
  selectedTrackIds: string[]; // Multi-track selection
  activeTrackId: string | null; // Single active track
  selectionType: 'item' | 'track' | null;
  activeTool: 'select' | 'razor' | 'rate-stretch'; // Active timeline tool
  // Drag state for visual feedback
  dragState: {
    isDragging: boolean;
    draggedItemIds: string[];
    draggedTrackIds?: string[]; // For track dragging
    offset: { x: number; y: number };
    activeSnapTarget?: { frame: number; type: 'grid' | 'item-start' | 'item-end' | 'playhead'; itemId?: string } | null;
  } | null;
}

export interface SelectionActions {
  selectItems: (ids: string[]) => void;
  selectTrack: (id: string | null) => void; // Deprecated: use setActiveTrack
  selectTracks: (ids: string[], append?: boolean) => void;
  setActiveTrack: (id: string | null) => void;
  toggleTrackSelection: (id: string) => void;
  clearSelection: () => void;
  clearItemSelection: () => void; // Clears only items, preserves track selection
  setDragState: (dragState: SelectionState['dragState']) => void;
  setActiveTool: (tool: SelectionState['activeTool']) => void;
}
