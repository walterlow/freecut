/**
 * useGPUVideoFrame Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGPUVideoFrame } from './use-gpu-video-frame';
import type { RenderBackend, BackendCapabilities } from '../backend/types';
import type { ManagedMediaSource, DecodedVideoFrame } from '../media';

// Mock texture importer
vi.mock('../media', async () => {
  const actual = await vi.importActual('../media');
  return {
    ...actual,
    createTextureImporter: vi.fn(() => ({
      setBackend: vi.fn(),
      import: vi.fn((frame: DecodedVideoFrame) => ({
        handle: {
          id: `tex_${frame.frameNumber}`,
          width: frame.width,
          height: frame.height,
          format: 'rgba8unorm',
        },
        frameNumber: frame.frameNumber,
        timestampMs: frame.timestampMs,
        owned: true,
      })),
      release: vi.fn(),
      getStats: vi.fn(() => ({
        totalImports: 1,
        pooledTextures: 0,
        pooledInUse: 0,
      })),
      clearPool: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

// Create mock backend
function createMockBackend(): RenderBackend {
  const capabilities: BackendCapabilities = {
    maxTextureSize: 8192,
    supportsFloat16: true,
    supportsComputeShaders: true,
    supportsExternalTextures: true,
    maxColorAttachments: 8,
  };

  return {
    name: 'webgpu',
    capabilities,
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    createTexture: vi.fn(),
    uploadPixels: vi.fn(),
    importVideoFrame: vi.fn(),
    importImageBitmap: vi.fn(),
    beginFrame: vi.fn(),
    endFrame: vi.fn(),
    renderToScreen: vi.fn(),
    renderToTexture: vi.fn(),
    readPixels: vi.fn().mockResolvedValue(new Uint8Array(4)),
  } as unknown as RenderBackend;
}

// Create mock media source
function createMockSource(): ManagedMediaSource {
  return {
    id: 'test-source',
    state: 'ready',
    probeResult: {
      video: {
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 60,
        codec: 'h264',
      },
      audio: null,
    },
    getVideoFrame: vi.fn(async (timeMs: number) => ({
      frameNumber: Math.floor(timeMs / 33.33),
      timestampMs: timeMs,
      width: 1920,
      height: 1080,
      format: 'rgba' as const,
      data: new Uint8Array(1920 * 1080 * 4),
      durationMs: 33.33,
      isKeyframe: true,
      source: 'webcodecs' as const,
    })),
    getVideoFrameByNumber: vi.fn(async (frameNumber: number) => ({
      frameNumber,
      timestampMs: frameNumber * 33.33,
      width: 1920,
      height: 1080,
      format: 'rgba' as const,
      data: new Uint8Array(1920 * 1080 * 4),
      durationMs: 33.33,
      isKeyframe: frameNumber % 30 === 0,
      source: 'webcodecs' as const,
    })),
    getAudioSamples: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as ManagedMediaSource;
}

describe('useGPUVideoFrame', () => {
  let backend: RenderBackend;
  let source: ManagedMediaSource;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createMockBackend();
    source = createMockSource();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return null texture when source is null', () => {
    const { result } = renderHook(() =>
      useGPUVideoFrame(null, 0, { backend, fps: 30 })
    );

    expect(result.current.texture).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return null texture when backend is null', () => {
    const { result } = renderHook(() =>
      useGPUVideoFrame(source, 0, { backend: null, fps: 30 })
    );

    expect(result.current.texture).toBeNull();
  });

  it('should load texture when source and backend are available', async () => {
    const { result } = renderHook(() =>
      useGPUVideoFrame(source, 0, { backend, fps: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.texture).not.toBeNull();
    expect(result.current.texture?.frameNumber).toBe(0);
  });

  it('should update texture when frame changes', async () => {
    const { result, rerender } = renderHook(
      ({ frame }) => useGPUVideoFrame(source, frame, { backend, fps: 30 }),
      { initialProps: { frame: 0 } }
    );

    await waitFor(() => {
      expect(result.current.texture?.frameNumber).toBe(0);
    });

    // Change frame
    rerender({ frame: 10 });

    await waitFor(() => {
      expect(result.current.texture?.frameNumber).toBe(10);
    });
  });

  it('should provide stats', async () => {
    const { result } = renderHook(() =>
      useGPUVideoFrame(source, 0, { backend, fps: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toMatchObject({
      totalImports: expect.any(Number),
      pooledTextures: expect.any(Number),
      pooledInUse: expect.any(Number),
    });
  });

  it('should provide releaseTexture function', async () => {
    const { result } = renderHook(() =>
      useGPUVideoFrame(source, 0, { backend, fps: 30 })
    );

    await waitFor(() => {
      expect(result.current.texture).not.toBeNull();
    });

    // Release texture
    act(() => {
      result.current.releaseTexture();
    });

    expect(result.current.texture).toBeNull();
  });

  it('should provide requestFrame function for manual requests', async () => {
    const { result, rerender } = renderHook(
      ({ frame }) => useGPUVideoFrame(source, frame, { backend, fps: 30 }),
      { initialProps: { frame: 0 } }
    );

    await waitFor(() => {
      expect(result.current.texture?.frameNumber).toBe(0);
    });

    // Request specific frame by changing the input
    rerender({ frame: 50 });

    await waitFor(() => {
      expect(result.current.texture?.frameNumber).toBe(50);
    });
  });

  it('should handle decode errors gracefully', async () => {
    // Make source throw error
    const errorSource = {
      ...source,
      getVideoFrameByNumber: vi.fn().mockRejectedValue(new Error('Decode failed')),
    } as unknown as ManagedMediaSource;

    const { result } = renderHook(() =>
      useGPUVideoFrame(errorSource, 0, { backend, fps: 30 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Decode failed');
    expect(result.current.texture).toBeNull();
  });

  it('should skip redundant requests for same frame', async () => {
    const { result, rerender } = renderHook(
      ({ frame }) => useGPUVideoFrame(source, frame, { backend, fps: 30 }),
      { initialProps: { frame: 0 } }
    );

    await waitFor(() => {
      expect(result.current.texture?.frameNumber).toBe(0);
    });

    const callCount = (source.getVideoFrameByNumber as any).mock.calls.length;

    // Rerender with same frame
    rerender({ frame: 0 });

    // Should not make additional call
    expect((source.getVideoFrameByNumber as any).mock.calls.length).toBe(callCount);
  });
});
