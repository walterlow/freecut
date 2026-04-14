import { createLogger } from '@/shared/logging/logger';
import { evolinkPost, evolinkGet } from './evolink-client';
import type {
  NanobananaRequest,
  NanobananaResponse,
  NanobananaSize,
  NanobananaQuality,
  NanobananaThinking,
  EvolinkTaskDetail,
} from '../types';

const log = createLogger('NanobananaService');

export interface GenerateImageParams {
  prompt: string;
  size?: NanobananaSize;
  quality?: NanobananaQuality;
  /** Optional reference images for image-to-image / editing. */
  imageUrls?: string[];
  thinkingLevel?: NanobananaThinking;
}

/**
 * Submit a Nanobanana 2 image generation task.
 * Returns the initial task response (status will be 'pending').
 */
export async function submitImageGeneration(
  params: GenerateImageParams,
  signal?: AbortSignal,
): Promise<NanobananaResponse> {
  const {
    prompt,
    size = 'auto',
    quality = '2K',
    imageUrls,
    thinkingLevel,
  } = params;

  const body: NanobananaRequest = {
    model: 'gemini-3.1-flash-image-preview',
    prompt,
    size,
    quality,
  };

  if (imageUrls?.length) {
    body.image_urls = imageUrls;
  }

  if (thinkingLevel) {
    body.model_params = { thinking_level: thinkingLevel };
  }

  log.info('Submitting image generation', { size, quality, hasRef: !!imageUrls?.length });
  return evolinkPost<NanobananaResponse>('/images/generations', body, signal);
}

/**
 * Fetch the current status of an image generation task.
 */
export async function getImageTaskDetail(
  taskId: string,
  signal?: AbortSignal,
): Promise<EvolinkTaskDetail> {
  return evolinkGet<EvolinkTaskDetail>(`/tasks/${taskId}`, signal);
}
