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
  /** True while broadcast is live (used for 5-minute billing). */
  streamActive: boolean;
  /** Current stream id (Daydream/Livepeer) when streamActive. */
  streamId: string | null;
  /** Set when a billing tick fails; UI shows top-up or re-authorize. */
  billingError: 'insufficient_balance' | 'session_limit_exceeded' | 'rpc_or_unknown' | null;
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
  setStreamActive: (active: boolean) => void;
  setStreamId: (id: string | null) => void;
  setBillingError: (error: LiveSessionState['billingError']) => void;
}

const DEFAULT_POSITION = { x: 0, y: 0 };

export const useLiveSessionStore = create<LiveSessionState & LiveSessionActions>()((set) => ({
  isOpen: false,
  isRecording: false,
  includeTimelineAudio: false,
  permissionsGranted: false,
  recordedTakes: [],
  popoverPosition: DEFAULT_POSITION,
  streamActive: false,
  streamId: null,
  billingError: null,

  setOpen: (open) => set({ isOpen: open }),
  setRecording: (recording) => set({ isRecording: recording }),
  setIncludeTimelineAudio: (include) => set({ includeTimelineAudio: include }),
  setPermissionsGranted: (granted) => set({ permissionsGranted: granted }),
  addRecordedTake: (take) =>
    set((state) => ({ recordedTakes: [...state.recordedTakes, take] })),
  clearRecordedTakes: () => set({ recordedTakes: [] }),
  setPopoverPosition: (position) => set({ popoverPosition: position }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setStreamActive: (active) => set({ streamActive: active }),
  setStreamId: (id) => set({ streamId: id }),
  setBillingError: (error) => set({ billingError: error }),
}));
