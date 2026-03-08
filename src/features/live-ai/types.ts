/**
 * LoRA dict: path or identifier -> weight (scale).
 * Daydream Cloud API uses this for SD/SDXL/SD1.5 LoRAs.
 */
export type LoraDict = Record<string, number> | null;

/**
 * Params for creating a Daydream stream (MVP: streamdiffusion).
 * See Daydream API / stream create body.
 */
export interface CreateStreamParams {
  pipeline: 'streamdiffusion';
  params: {
    model_id?: string;
    prompt?: string;
    negative_prompt?: string;
    guidance_scale?: number;
    width?: number;
    height?: number;
    /** LoRA path/id -> weight. Optional; omitted or null = no LoRAs. */
    lora_dict?: LoraDict;
  };
}

/**
 * Response from Daydream API POST /v1/streams (snake_case from API).
 */
export interface CreateStreamResponse {
  id: string;
  whip_url: string;
  output_playback_id: string;
}

/**
 * Normalized stream data for the app (camelCase).
 */
export interface StreamData {
  id: string;
  whipUrl: string;
  outputPlaybackId: string;
}
