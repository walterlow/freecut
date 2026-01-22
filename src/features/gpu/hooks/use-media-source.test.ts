/**
 * useMediaSource Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMediaSource, disposeGlobalMediaManager } from './use-media-source';

// Mock the media module
vi.mock('../media', () => ({
  createMediaSourceManager: vi.fn(() => ({
    createSource: vi.fn(async (url: string, options?: { id?: string }) => ({
      id: options?.id ?? url,
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
      getVideoFrame: vi.fn(async () => ({
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: new Uint8Array(1920 * 1080 * 4),
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      })),
      getVideoFrameByNumber: vi.fn(async (frameNumber: number) => ({
        frameNumber,
        timestampMs: frameNumber * 33.33,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: new Uint8Array(1920 * 1080 * 4),
        durationMs: 33.33,
        isKeyframe: frameNumber % 30 === 0,
        source: 'webcodecs',
      })),
      close: vi.fn(),
    })),
    closeSource: vi.fn(),
    getSourceCount: vi.fn(() => 1),
    dispose: vi.fn(),
  })),
}));

describe('useMediaSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disposeGlobalMediaManager();
  });

  afterEach(() => {
    disposeGlobalMediaManager();
  });

  it('should return null source when URL is null', () => {
    const { result } = renderHook(() => useMediaSource(null));

    expect(result.current.source).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should load source when URL is provided', async () => {
    const { result } = renderHook(() => useMediaSource('test-video.mp4'));

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // Wait for load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.source).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should provide probe result after loading', async () => {
    const { result } = renderHook(() => useMediaSource('test-video.mp4'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.probeResult).toMatchObject({
      video: {
        width: 1920,
        height: 1080,
        fps: 30,
      },
    });
  });

  it('should provide getVideoFrame function', async () => {
    const { result } = renderHook(() => useMediaSource('test-video.mp4'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const frame = await result.current.getVideoFrame(1000);

    expect(frame).toBeDefined();
    expect(frame?.width).toBe(1920);
    expect(frame?.height).toBe(1080);
  });

  it('should provide getVideoFrameByNumber function', async () => {
    const { result } = renderHook(() => useMediaSource('test-video.mp4'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const frame = await result.current.getVideoFrameByNumber(30);

    expect(frame).toBeDefined();
    expect(frame?.frameNumber).toBe(30);
  });

  it('should reload source when URL changes', async () => {
    const { result, rerender } = renderHook(
      ({ url }) => useMediaSource(url),
      { initialProps: { url: 'video1.mp4' } }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstSource = result.current.source;

    // Change URL
    rerender({ url: 'video2.mp4' });

    await waitFor(() => {
      expect(result.current.source).not.toBe(firstSource);
    });
  });

  it('should provide reload function', async () => {
    const { result } = renderHook(() => useMediaSource('test-video.mp4'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Trigger reload
    act(() => {
      result.current.reload();
    });

    // Should start loading again
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.source).not.toBeNull();
  });

  it('should use custom source ID when provided', async () => {
    const { result } = renderHook(() =>
      useMediaSource('test-video.mp4', { id: 'custom-id' })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.source?.id).toBe('custom-id');
  });
});
