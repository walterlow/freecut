/**
 * LoRA dict: path or identifier -> weight (scale).
 * Daydream Cloud API uses this for SD/SDXL/SD1.5 LoRAs.
 */
export type LoraDict = Record<string, number> | null;

/**
 * Params for creating a Daydream stream (MVP: streamdiffusion).
 * See Daydream API / stream create body.
 */
/** IP adapter config for FaceID (SDXL Turbo). Hot-swappable, no pipeline reload. */
export interface IpAdapterConfig {
  type: 'faceid';
  scale: number;
  enabled: boolean;
}

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
    /** SD1.5-specific: number of inference steps. */
    num_inference_steps?: number;
    /** SD1.5-specific: timestep index list for StreamDiffusion. */
    t_index_list?: number[];
    /** SD1.5-specific: enable LCM LoRA acceleration. */
    use_lcm_lora?: boolean;
    /** SD1.5-specific: HuggingFace id for LCM LoRA. */
    lcm_lora_id?: string;
    /** SDXL FaceID: IP adapter configuration. */
    ip_adapter?: IpAdapterConfig;
    /** SDXL FaceID: reference face image URL. */
    ip_adapter_style_image_url?: string;
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
