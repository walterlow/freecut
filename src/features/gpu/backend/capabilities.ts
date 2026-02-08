/**
 * Backend Capability Detection
 *
 * Detects available rendering backends and their capabilities.
 */

import type { BackendName } from './types';

export async function detectWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

export function detectWebGL2Support(canvas?: HTMLCanvasElement): boolean {
  const testCanvas = canvas ?? document.createElement('canvas');

  try {
    const gl = testCanvas.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

export async function detectBestBackend(canvas?: HTMLCanvasElement): Promise<BackendName> {
  if (await detectWebGPUSupport()) {
    return 'webgpu';
  }

  if (detectWebGL2Support(canvas)) {
    return 'webgl2';
  }

  return 'canvas';
}
