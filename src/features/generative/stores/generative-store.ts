import { create } from 'zustand';
import type {
  ImageSource,
  TaskState,
  SeedanceSpeed,
  SeedanceQuality,
  SeedanceAspectRatio,
  NanobananaSize,
  NanobananaQuality,
} from '../types';
import { IDLE_TASK } from '../types';
import type { ClipBinEntry } from '../components/clip-bin';

export type BridgeMode = 'realtime' | 'interpolation';
export type RenderStatus = 'idle' | 'loading-pipeline' | 'rendering' | 'complete' | 'error';

export interface GenerativeState {
  // Image nodes
  startImage: ImageSource | null;
  endImage: ImageSource | null;

  // Image generation tasks (Nanobanana)
  startImageTask: TaskState;
  endImageTask: TaskState;

  // Video generation (Seedance)
  prompt: string;
  videoTask: TaskState;
  resultVideoUrl: string | null;

  // Seedance settings
  seedanceSpeed: SeedanceSpeed;
  duration: number;
  quality: SeedanceQuality;
  aspectRatio: SeedanceAspectRatio;
  generateAudio: boolean;

  // Nanobanana settings
  imageSize: NanobananaSize;
  imageQuality: NanobananaQuality;

  // Prod bridge/render state
  bridgeMode: BridgeMode;
  renderStatus: RenderStatus;
  renderProgress: number;
  renderError: string | null;
  pipelineReady: boolean;
  /** Configurable audio delay in ms to compensate for generative round-trip latency. */
  audioDelayMs: number;
  /** Rendered AI clips available for drag-to-timeline. */
  clips: ClipBinEntry[];
}

export interface GenerativeActions {
  // Image nodes
  setStartImage: (source: ImageSource | null) => void;
  setEndImage: (source: ImageSource | null) => void;

  // Image generation tasks
  setStartImageTask: (task: Partial<TaskState>) => void;
  setEndImageTask: (task: Partial<TaskState>) => void;

  // Video generation
  setPrompt: (prompt: string) => void;
  setVideoTask: (task: Partial<TaskState>) => void;
  setResultVideoUrl: (url: string | null) => void;

  // Seedance settings
  setSeedanceSpeed: (speed: SeedanceSpeed) => void;
  setDuration: (duration: number) => void;
  setQuality: (quality: SeedanceQuality) => void;
  setAspectRatio: (ratio: SeedanceAspectRatio) => void;
  setGenerateAudio: (generate: boolean) => void;

  // Nanobanana settings
  setImageSize: (size: NanobananaSize) => void;
  setImageQuality: (quality: NanobananaQuality) => void;

  // Prod bridge/render actions
  setBridgeMode: (mode: BridgeMode) => void;
  setRenderStatus: (status: RenderStatus) => void;
  setRenderProgress: (progress: number) => void;
  setRenderError: (error: string | null) => void;
  setPipelineReady: (ready: boolean) => void;
  setAudioDelayMs: (delay: number) => void;
  addClip: (clip: ClipBinEntry) => void;
  removeClip: (id: string) => void;
  /** Look up a clip by ID (for drag-drop retrieval). */
  getClipById: (id: string) => ClipBinEntry | undefined;

  // Utility
  reset: () => void;
}

const INITIAL_STATE: GenerativeState = {
  startImage: null,
  endImage: null,
  startImageTask: { ...IDLE_TASK },
  endImageTask: { ...IDLE_TASK },
  prompt: '',
  videoTask: { ...IDLE_TASK },
  resultVideoUrl: null,
  seedanceSpeed: 'standard',
  duration: 5,
  quality: '720p',
  aspectRatio: 'adaptive',
  generateAudio: true,
  imageSize: 'auto',
  imageQuality: '2K',
  bridgeMode: 'realtime',
  renderStatus: 'idle',
  renderProgress: 0,
  renderError: null,
  pipelineReady: false,
  audioDelayMs: 200,
  clips: [],
};

export const useGenerativeStore = create<GenerativeState & GenerativeActions>()((set, get) => ({
  ...INITIAL_STATE,

  setStartImage: (source) => set({ startImage: source }),
  setEndImage: (source) => set({ endImage: source }),

  setStartImageTask: (task) =>
    set((s) => ({ startImageTask: { ...s.startImageTask, ...task } })),
  setEndImageTask: (task) =>
    set((s) => ({ endImageTask: { ...s.endImageTask, ...task } })),

  setPrompt: (prompt) => set({ prompt }),
  setVideoTask: (task) =>
    set((s) => ({ videoTask: { ...s.videoTask, ...task } })),
  setResultVideoUrl: (url) => set({ resultVideoUrl: url }),

  setSeedanceSpeed: (speed) => set({ seedanceSpeed: speed }),
  setDuration: (duration) => set({ duration }),
  setQuality: (quality) => set({ quality }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setGenerateAudio: (generate) => set({ generateAudio: generate }),

  setImageSize: (size) => set({ imageSize: size }),
  setImageQuality: (quality) => set({ imageQuality: quality }),

  setBridgeMode: (mode) => set({ bridgeMode: mode }),
  setRenderStatus: (status) => set({ renderStatus: status }),
  setRenderProgress: (progress) => set({ renderProgress: progress }),
  setRenderError: (error) => set({ renderError: error }),
  setPipelineReady: (ready) => set({ pipelineReady: ready }),
  setAudioDelayMs: (delay) => set({ audioDelayMs: delay }),
  addClip: (clip) => set((state) => ({ clips: [clip, ...state.clips] })),
  removeClip: (id) => set((state) => ({
    clips: state.clips.filter((c) => {
      if (c.id === id) {
        URL.revokeObjectURL(c.thumbnailUrl);
        return false;
      }
      return true;
    }),
  })),
  getClipById: (id) => get().clips.find((c) => c.id === id),

  reset: () => set(INITIAL_STATE),
}));
