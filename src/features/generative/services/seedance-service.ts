import { createLogger } from '@/shared/logging/logger';
import { evolinkPost, evolinkGet } from './evolink-client';
import type {
  SeedanceRequest,
  SeedanceResponse,
  SeedanceSpeed,
  SeedanceQuality,
  SeedanceAspectRatio,
  EvolinkTaskDetail,
} from '../types';
import { seedanceModelId } from '../types';

const log = createLogger('SeedanceService');

export interface GenerateVideoParams {
  prompt: string;
  /** Publicly accessible image URLs. 1 = first frame, 2 = first + last frame. */
  imageUrls: string[];
  speed?: SeedanceSpeed;
  duration?: number;
  quality?: SeedanceQuality;
  aspectRatio?: SeedanceAspectRatio;
  generateAudio?: boolean;
}

/**
 * Submit a Seedance 2.0 image-to-video generation task.
 * Returns the initial task response (status will be 'pending').
 */
export async function submitVideoGeneration(
  params: GenerateVideoParams,
  signal?: AbortSignal,
): Promise<SeedanceResponse> {
  const {
    prompt,
    imageUrls,
    speed = 'standard',
    duration = 5,
    quality = '720p',
    aspectRatio = 'adaptive',
    generateAudio = true,
  } = params;

  if (imageUrls.length === 0 || imageUrls.length > 2) {
    throw new Error('Seedance image-to-video requires 1 or 2 image URLs.');
  }

  const body: SeedanceRequest = {
    model: seedanceModelId(speed),
    prompt,
    image_urls: imageUrls,
    duration,
    quality,
    aspect_ratio: aspectRatio,
    generate_audio: generateAudio,
  };

  log.info('Submitting video generation', { model: body.model, duration, imageCount: imageUrls.length });
  return evolinkPost<SeedanceResponse>('/videos/generations', body, signal);
}

/**
 * Fetch the current status of a video generation task.
 */
export async function getVideoTaskDetail(
  taskId: string,
  signal?: AbortSignal,
): Promise<EvolinkTaskDetail> {
  return evolinkGet<EvolinkTaskDetail>(`/tasks/${taskId}`, signal);
}
