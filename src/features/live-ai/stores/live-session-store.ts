import { create } from 'zustand';
import type { ScopeSessionData } from '../types';

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

  // Scope local server state
  /** Whether Scope server is reachable on localhost. */
  scopeConnected: boolean;
  /** Active Scope WebRTC session ID. */
  scopeSessionId: string | null;
  /** Currently loaded pipeline on Scope. */
  scopePipeline: string | null;
  /** Hardware info from Scope server (VRAM in GB, Spout availability). */
  scopeHardwareInfo: { vram: number; spout: boolean } | null;
  /** True while a pipeline is loading/swapping on Scope. */
  pipelineLoading: boolean;
  /** Reference to the active Scope session (WebRTC resources). Not serialized. */
  scopeSession: ScopeSessionData | null;
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

  // Scope actions
  setScopeConnected: (connected: boolean) => void;
  setScopeSessionId: (id: string | null) => void;
  setScopePipeline: (pipeline: string | null) => void;
  setScopeHardwareInfo: (info: { vram: number; spout: boolean } | null) => void;
  setPipelineLoading: (loading: boolean) => void;
  setScopeSession: (session: ScopeSessionData | null) => void;
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

  // Scope defaults
  scopeConnected: false,
  scopeSessionId: null,
  scopePipeline: null,
  scopeHardwareInfo: null,
  pipelineLoading: false,
  scopeSession: null,

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

  // Scope actions
  setScopeConnected: (connected) => set({ scopeConnected: connected }),
  setScopeSessionId: (id) => set({ scopeSessionId: id }),
  setScopePipeline: (pipeline) => set({ scopePipeline: pipeline }),
  setScopeHardwareInfo: (info) => set({ scopeHardwareInfo: info }),
  setPipelineLoading: (loading) => set({ pipelineLoading: loading }),
  setScopeSession: (session) => set({ scopeSession: session }),
}));
