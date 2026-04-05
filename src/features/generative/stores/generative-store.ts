import { create } from 'zustand';

export type BridgeMode = 'realtime' | 'interpolation';
export type RenderStatus = 'idle' | 'loading-pipeline' | 'rendering' | 'complete' | 'error';

export interface GenerativeState {
  startImage: Blob | null;
  endImage: Blob | null;
  bridgeMode: BridgeMode;
  renderStatus: RenderStatus;
  renderProgress: number;
  renderError: string | null;
  pipelineReady: boolean;
  /** Configurable audio delay in ms to compensate for generative round-trip latency. */
  audioDelayMs: number;
}

export interface GenerativeActions {
  setStartImage: (blob: Blob | null) => void;
  setEndImage: (blob: Blob | null) => void;
  setBridgeMode: (mode: BridgeMode) => void;
  setRenderStatus: (status: RenderStatus) => void;
  setRenderProgress: (progress: number) => void;
  setRenderError: (error: string | null) => void;
  setPipelineReady: (ready: boolean) => void;
  setAudioDelayMs: (delay: number) => void;
  reset: () => void;
}

const INITIAL_STATE: GenerativeState = {
  startImage: null,
  endImage: null,
  bridgeMode: 'realtime',
  renderStatus: 'idle',
  renderProgress: 0,
  renderError: null,
  pipelineReady: false,
  audioDelayMs: 200,
};

export const useGenerativeStore = create<GenerativeState & GenerativeActions>()((set) => ({
  ...INITIAL_STATE,

  setStartImage: (blob) => set({ startImage: blob }),
  setEndImage: (blob) => set({ endImage: blob }),
  setBridgeMode: (mode) => set({ bridgeMode: mode }),
  setRenderStatus: (status) => set({ renderStatus: status }),
  setRenderProgress: (progress) => set({ renderProgress: progress }),
  setRenderError: (error) => set({ renderError: error }),
  setPipelineReady: (ready) => set({ pipelineReady: ready }),
  setAudioDelayMs: (delay) => set({ audioDelayMs: delay }),
  reset: () => set(INITIAL_STATE),
}));
