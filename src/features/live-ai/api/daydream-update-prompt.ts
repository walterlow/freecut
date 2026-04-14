/**
 * Daydream API: update the AI prompt on an existing stream (real-time style change).
 * Uses PATCH /v1/streams/:id (streams.update) per Daydream docs; /beta/streams/:id/prompts returns 404.
 */

import type { LoraDict, IpAdapterConfig } from '../types';

const DAYDREAM_API_BASE = 'https://api.daydream.live/v1';

function getApiKey(): string | undefined {
  return import.meta.env.VITE_DAYDREAM_API_KEY as string | undefined;
}

export interface UpdatePromptParams {
  prompt: string;
  negative_prompt?: string;
  model_id?: string;
  guidance_scale?: number;
  /** LoRA path/id -> weight. Updating triggers pipeline reload (~30s). */
  lora_dict?: LoraDict;
  /** SDXL FaceID: IP adapter configuration. Hot-swappable, no pipeline reload. */
  ip_adapter?: IpAdapterConfig;
  /** SDXL FaceID: reference face image URL. */
  ip_adapter_style_image_url?: string;
}

/**
 * Apply a new prompt to an existing Daydream stream. Style updates in real time without reloading the pipeline.
 * Hot-swappable: prompt, negativePrompt, guidanceScale, seed, etc. (see Daydream docs).
 */
export async function updateDaydreamPrompt(
  streamId: string,
  params: UpdatePromptParams
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey?.trim()) {
    throw new Error('Daydream API key is not configured.');
  }

  // Only send params we're updating (per Daydream: "only include parameters you want to change").
  const paramsPayload: Record<string, unknown> = {};
  if (params.prompt !== undefined) paramsPayload.prompt = params.prompt;
  if (params.negative_prompt !== undefined) paramsPayload.negative_prompt = params.negative_prompt;
  if (params.model_id !== undefined) paramsPayload.model_id = params.model_id;
  if (params.guidance_scale != null) paramsPayload.guidance_scale = params.guidance_scale;
  if (params.lora_dict !== undefined) paramsPayload.lora_dict = params.lora_dict;
  if (params.ip_adapter !== undefined) paramsPayload.ip_adapter = params.ip_adapter;
  if (params.ip_adapter_style_image_url !== undefined)
    paramsPayload.ip_adapter_style_image_url = params.ip_adapter_style_image_url;

  const body = {
    pipeline: 'streamdiffusion',
    params: paramsPayload,
  };

  const response = await fetch(`${DAYDREAM_API_BASE}/streams/${streamId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `Daydream prompt update failed (${response.status})`;
    try {
      const json = JSON.parse(text) as {
        message?: string;
        error?: string;
        details?: unknown;
      };
      const serverMessage = json.error ?? json.message;
      if (serverMessage) message = serverMessage;
      if (response.status === 500 && message === 'Daydream prompt update failed (500)') {
        message = 'Daydream server error (500). Try again in a moment or create a new stream.';
      }
      if (json.details != null) {
        const detailsStr =
          typeof json.details === 'string' ? json.details : JSON.stringify(json.details);
        message = `${message}${detailsStr ? ` — ${detailsStr}` : ''}`;
      }
    } catch {
      if (text) message = `${message}: ${text}`;
    }
    throw new Error(message);
  }
}
