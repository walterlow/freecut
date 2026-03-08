import { create } from 'zustand';

export interface RecordedTake {
  blob: Blob;
  durationMs: number;
  linkedTimelineStart: number;
}

export interface LiveSessionState {
  isOpen: boolean;
  isRecording: boolean;
  includeTimelineAudio: boolean;
  permissionsGranted: boolean;
  recordedTakes: RecordedTake[];
  popoverPosition: { x: number; y: number };
}

export interface LiveSessionActions {
  setOpen: (open: boolean) => void;
  setRecording: (recording: boolean) => void;
  setIncludeTimelineAudio: (include: boolean) => void;
  setPermissionsGranted: (granted: boolean) => void;
  addRecordedTake: (take: RecordedTake) => void;
  clearRecordedTakes: () => void;
  setPopoverPosition: (position: { x: number; y: number }) => void;
  toggleOpen: () => void;
}

const DEFAULT_POSITION = { x: 0, y: 0 };

export const useLiveSessionStore = create<LiveSessionState & LiveSessionActions>()((set) => ({
  isOpen: false,
  isRecording: false,
  includeTimelineAudio: false,
  permissionsGranted: false,
  recordedTakes: [],
  popoverPosition: DEFAULT_POSITION,

  setOpen: (open) => set({ isOpen: open }),
  setRecording: (recording) => set({ isRecording: recording }),
  setIncludeTimelineAudio: (include) => set({ includeTimelineAudio: include }),
  setPermissionsGranted: (granted) => set({ permissionsGranted: granted }),
  addRecordedTake: (take) =>
    set((state) => ({ recordedTakes: [...state.recordedTakes, take] })),
  clearRecordedTakes: () => set({ recordedTakes: [] }),
  setPopoverPosition: (position) => set({ popoverPosition: position }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
}));
