import { apiClient } from './client';
import { getServerConfig } from '@/lib/config';
import type { RemotionInputProps, ExportSettings } from '@/types/export';

export interface StartRenderRequest {
  jobId?: string;
  composition: RemotionInputProps;
  settings: ExportSettings;
  mediaFiles: string[];
}

export interface StartRenderResponse {
  success: boolean;
  jobId: string;
  status: string;
}

export interface RenderStatus {
  jobId: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  renderedFrames?: number;
  totalFrames?: number;
  outputUrl?: string;
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface RenderStatusResponse {
  success: boolean;
  job: RenderStatus;
}

export async function startRender(request: StartRenderRequest): Promise<StartRenderResponse> {
  const response = await apiClient.post<StartRenderResponse>('/render', request);
  return response;
}

export async function getRenderStatus(jobId: string): Promise<RenderStatus> {
  const response = await apiClient.get<RenderStatusResponse>(`/render/${jobId}/status`);
  return response.job;
}

export async function cancelRender(jobId: string): Promise<void> {
  await apiClient.delete(`/render/${jobId}`);
}

export async function downloadRender(jobId: string): Promise<void> {
  const { baseUrl } = getServerConfig();
  const url = `${baseUrl}/render/${jobId}/download`;

  // Create a hidden link and click it to trigger download
  const link = document.createElement('a');
  link.href = url;
  link.download = `${jobId}.mp4`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function uploadMediaFiles(
  jobId: string,
  files: { mediaId: string; blob: Blob; filename: string }[]
): Promise<void> {
  await apiClient.uploadMedia(jobId, files);
}

/**
 * Invalidate the server's cached Remotion bundle.
 * Call this when Remotion composition code changes during development.
 * The bundle will be rebuilt on the next render.
 */
export async function invalidateBundle(): Promise<void> {
  await apiClient.post('/render/invalidate-bundle', {});
}
