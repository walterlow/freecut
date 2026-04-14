// ---------------------------------------------------------------------------
// Evolink.ai shared types
// ---------------------------------------------------------------------------

/** Task status from evolink.ai async APIs. */
export type EvolinkTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Unified task detail response (videos + images share this shape). */
export interface EvolinkTaskDetail {
  id: string;
  status: EvolinkTaskStatus;
  progress: number;
  model: string;
  /** Present when status === 'completed'. */
  output?: {
    video_url?: string;
    image_url?: string;
    /** Nanobanana may return multiple images. */
    image_urls?: string[];
  };
  /** Present when status === 'failed'. */
  error?: { code: string; message: string; type: string };
  task_info?: {
    can_cancel?: boolean;
    estimated_time?: number;
    video_duration?: number;
  };
  usage?: {
    billing_rule: string;
    credits_reserved: number;
    user_group: string;
  };
}

// ---------------------------------------------------------------------------
// Seedance 2.0 (image-to-video)
// ---------------------------------------------------------------------------

export type SeedanceSpeed = 'standard' | 'fast';

export type SeedanceQuality = '480p' | '720p';

export type SeedanceAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '21:9'
  | 'adaptive';

export interface SeedanceRequest {
  model: string;
  prompt: string;
  image_urls: string[];
  duration?: number;
  quality?: SeedanceQuality;
  aspect_ratio?: SeedanceAspectRatio;
  generate_audio?: boolean;
}

export interface SeedanceResponse {
  id: string;
  model: string;
  status: EvolinkTaskStatus;
  progress: number;
  task_info?: { can_cancel?: boolean; estimated_time?: number; video_duration?: number };
  usage?: { billing_rule: string; credits_reserved: number; user_group: string };
}

/** Maps SeedanceSpeed to the actual API model id. */
export function seedanceModelId(speed: SeedanceSpeed): string {
  return speed === 'fast'
    ? 'seedance-2.0-fast-image-to-video'
    : 'seedance-2.0-image-to-video';
}

// ---------------------------------------------------------------------------
// Nanobanana 2 (image generation)
// ---------------------------------------------------------------------------

export type NanobananaSize =
  | 'auto'
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9';

export type NanobananaQuality = '0.5K' | '1K' | '2K' | '4K';

export type NanobananaThinking = 'auto' | 'min' | 'high';

export interface NanobananaRequest {
  model: 'gemini-3.1-flash-image-preview';
  prompt: string;
  size?: NanobananaSize;
  quality?: NanobananaQuality;
  image_urls?: string[];
  model_params?: {
    web_search?: boolean;
    thinking_level?: NanobananaThinking;
  };
}

export interface NanobananaResponse {
  id: string;
  model: string;
  status: EvolinkTaskStatus;
  progress: number;
  task_info?: { can_cancel?: boolean; estimated_time?: number };
  usage?: { billing_rule: string; credits_reserved: number; user_group: string };
}

// ---------------------------------------------------------------------------
// Generative store types
// ---------------------------------------------------------------------------

/** Discriminated union for image sources in Start/End nodes. */
export type ImageSource =
  | { type: 'file'; blob: Blob; objectUrl: string }
  | { type: 'generated'; url: string; prompt: string };

/** State of an async evolink.ai task. */
export interface TaskState {
  taskId: string | null;
  status: EvolinkTaskStatus | 'idle' | 'cancelled';
  progress: number;
  resultUrl: string | null;
  error: string | null;
}

export const IDLE_TASK: TaskState = {
  taskId: null,
  status: 'idle',
  progress: 0,
  resultUrl: null,
  error: null,
};
