/**
 * useRenderBackend Hook
 *
 * React hook for managing GPU render backend lifecycle.
 */

import { useState, useEffect, useRef } from 'react';
import type { RenderBackend, BackendOptions } from '../backend/types';
import { createBackend } from '../backend/create-backend';

interface UseRenderBackendResult {
  backend: RenderBackend | null;
  isLoading: boolean;
  error: string | null;
  reinitialize: () => void;
}

export function useRenderBackend(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: BackendOptions = {}
): UseRenderBackendResult {
  const [backend, setBackend] = useState<RenderBackend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializingRef = useRef(false);
  const mountedRef = useRef(true);

  const initialize = async () => {
    const canvas = canvasRef.current;
    if (!canvas || initializingRef.current) return;

    initializingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      if (backend) {
        backend.destroy();
      }

      const newBackend = await createBackend(canvas, options);

      if (mountedRef.current) {
        setBackend(newBackend);
        setIsLoading(false);
      } else {
        newBackend.destroy();
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setIsLoading(false);
      }
    } finally {
      initializingRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    if (canvasRef.current) {
      initialize();
    }

    return () => {
      mountedRef.current = false;
      if (backend) {
        backend.destroy();
      }
    };
  }, [canvasRef.current]);

  const reinitialize = () => {
    if (backend) {
      backend.destroy();
      setBackend(null);
    }
    initialize();
  };

  return { backend, isLoading, error, reinitialize };
}
