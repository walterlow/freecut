import { describe, it, expect } from 'vitest';
import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
} from './types';

describe('RenderBackend types', () => {
  it('should allow implementing RenderBackend interface', () => {
    const mockBackend: RenderBackend = {
      name: 'webgpu',
      capabilities: {
        maxTextureSize: 8192,
        supportsFloat16: true,
        supportsComputeShaders: true,
        supportsExternalTextures: true,
        maxColorAttachments: 8,
      },
      init: async () => {},
      destroy: () => {},
      createTexture: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      uploadPixels: () => {},
      importVideoFrame: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      importImageBitmap: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      beginFrame: () => {},
      endFrame: () => {},
      renderToScreen: () => {},
      renderToTexture: () => {},
      readPixels: async () => new Uint8Array(0),
    };

    expect(mockBackend.name).toBe('webgpu');
    expect(mockBackend.capabilities.maxTextureSize).toBe(8192);
  });

  it('should support all texture formats', () => {
    const formats: TextureFormat[] = ['rgba8unorm', 'rgba16float', 'rgba32float', 'bgra8unorm'];
    expect(formats).toHaveLength(4);
  });
});
