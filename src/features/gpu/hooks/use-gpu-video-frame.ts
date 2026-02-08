/**
 * useGPUVideoFrame Hook
 *
 * React hook that decodes video frames and imports them to GPU textures.
 * Combines media decoding with GPU texture import for efficient rendering.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { RenderBackend } from '../backend/types';
import type { ManagedMediaSource } from '../media';
import {
  createTextureImporter,
  type TextureImporter,
  type ImportedTexture,
} from '../media';

interface UseGPUVideoFrameOptions {
  /** Render backend for texture import */
  backend: RenderBackend | null;
  /** FPS for frame number calculation */
  fps: number;
  /** Whether to enable prefetching */
  enablePrefetch?: boolean;
  /** Frames to prefetch ahead */
  prefetchAhead?: number;
  /** Frames to keep cached behind */
  prefetchBehind?: number;
}

interface UseGPUVideoFrameResult {
  /** Current GPU texture (null if not ready) */
  texture: ImportedTexture | null;
  /** Whether the frame is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Request a specific frame (updates texture) */
  requestFrame: (frameNumber: number) => void;
  /** Release current texture back to pool */
  releaseTexture: () => void;
  /** Import statistics */
  stats: {
    totalImports: number;
    pooledTextures: number;
    pooledInUse: number;
  };
}

/**
 * Hook to get GPU textures from video frames
 *
 * @param source - Media source (from useMediaSource)
 * @param currentFrame - Current frame number
 * @param options - Configuration options
 */
export function useGPUVideoFrame(
  source: ManagedMediaSource | null,
  currentFrame: number,
  options: UseGPUVideoFrameOptions
): UseGPUVideoFrameResult {
  const { backend } = options;

  const [texture, setTexture] = useState<ImportedTexture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importerRef = useRef<TextureImporter | null>(null);
  const currentTextureRef = useRef<ImportedTexture | null>(null);
  const lastRequestedFrameRef = useRef<number>(-1);
  const mountedRef = useRef(true);

  // Create/update importer when backend changes
  useEffect(() => {
    if (!backend) {
      if (importerRef.current) {
        importerRef.current.dispose();
        importerRef.current = null;
      }
      return;
    }

    if (!importerRef.current) {
      importerRef.current = createTextureImporter({
        maxPooledPerSize: 4,
        cleanupIntervalMs: 5000,
        maxIdleMs: 10000,
        preferZeroCopy: true,
      });
    }

    importerRef.current.setBackend(backend);

    return () => {
      // Don't dispose on backend change, just on unmount
    };
  }, [backend]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Release current texture
      if (currentTextureRef.current && importerRef.current) {
        importerRef.current.release(currentTextureRef.current);
        currentTextureRef.current = null;
      }

      // Dispose importer
      if (importerRef.current) {
        importerRef.current.dispose();
        importerRef.current = null;
      }
    };
  }, []);

  // Request and import a frame
  const requestFrame = useCallback(
    async (frameNumber: number) => {
      if (!source || !importerRef.current || !backend) {
        return;
      }

      // Skip if same frame
      if (frameNumber === lastRequestedFrameRef.current && texture) {
        return;
      }

      lastRequestedFrameRef.current = frameNumber;
      setIsLoading(true);
      setError(null);

      try {
        // Get decoded frame from source
        const decodedFrame = await source.getVideoFrameByNumber(frameNumber);

        if (!mountedRef.current || frameNumber !== lastRequestedFrameRef.current) {
          return;
        }

        if (!decodedFrame) {
          setError('Failed to decode frame');
          setIsLoading(false);
          return;
        }

        // Release previous texture
        if (currentTextureRef.current) {
          importerRef.current!.release(currentTextureRef.current);
          currentTextureRef.current = null;
        }

        // Import to GPU
        const imported = importerRef.current!.import(decodedFrame);
        currentTextureRef.current = imported;

        if (mountedRef.current && frameNumber === lastRequestedFrameRef.current) {
          setTexture(imported);
          setIsLoading(false);
        }
      } catch (err) {
        if (mountedRef.current && frameNumber === lastRequestedFrameRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to import frame';
          setError(message);
          setIsLoading(false);
        }
      }
    },
    [source, backend, texture]
  );

  // Auto-request frame when currentFrame changes
  useEffect(() => {
    if (source && backend && currentFrame !== lastRequestedFrameRef.current) {
      requestFrame(currentFrame);
    }
  }, [currentFrame, source, backend, requestFrame]);

  // Release texture function
  const releaseTexture = useCallback(() => {
    if (currentTextureRef.current && importerRef.current) {
      importerRef.current.release(currentTextureRef.current);
      currentTextureRef.current = null;
      setTexture(null);
    }
  }, []);

  // Get stats
  const stats = useMemo(() => {
    if (!importerRef.current) {
      return { totalImports: 0, pooledTextures: 0, pooledInUse: 0 };
    }
    return importerRef.current.getStats();
  }, [texture]); // Update when texture changes

  return {
    texture,
    isLoading,
    error,
    requestFrame,
    releaseTexture,
    stats,
  };
}
