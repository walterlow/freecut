import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { blobUrlManager, useBlobUrlVersion } from '@/lib/blob-url-manager';

interface UseMediaBlobUrlResult {
  blobUrl: string | null;
  setBlobUrl: (nextUrl: string | null) => void;
  hasStartedLoadingRef: MutableRefObject<boolean>;
  blobUrlVersion: number;
}

/**
 * Shared blob URL state used by timeline media components.
 *
 * Handles:
 * - initialization from BlobUrlManager
 * - mediaId change resets
 * - blob URL invalidation sync keyed on manager version
 */
export function useMediaBlobUrl(mediaId: string): UseMediaBlobUrlResult {
  const initialBlobUrl = blobUrlManager.get(mediaId);
  const [blobUrlState, setBlobUrlState] = useState<string | null>(initialBlobUrl);
  const hasStartedLoadingRef = useRef(false);
  const lastMediaIdRef = useRef<string | null>(null);
  const lastBlobUrlRef = useRef<string | null>(initialBlobUrl);
  const blobUrlVersion = useBlobUrlVersion();

  const setBlobUrl = useCallback((nextUrl: string | null) => {
    lastBlobUrlRef.current = nextUrl;
    setBlobUrlState(nextUrl);
  }, []);

  // Reset loading state when mediaId changes (e.g., after relinking/orphan repair).
  useEffect(() => {
    if (lastMediaIdRef.current !== null && lastMediaIdRef.current !== mediaId) {
      hasStartedLoadingRef.current = false;
      const nextUrl = blobUrlManager.get(mediaId);
      lastBlobUrlRef.current = nextUrl;
      setBlobUrlState(nextUrl);
    }
    lastMediaIdRef.current = mediaId;
  }, [mediaId]);

  // Keep local state aligned with centralized blob URL invalidations.
  useEffect(() => {
    const cached = blobUrlManager.get(mediaId);
    if (cached !== lastBlobUrlRef.current) {
      lastBlobUrlRef.current = cached;
      setBlobUrlState(cached);
    }
    if (cached === null) {
      hasStartedLoadingRef.current = false;
    }
  }, [mediaId, blobUrlVersion]);

  return {
    blobUrl: blobUrlState,
    setBlobUrl,
    hasStartedLoadingRef,
    blobUrlVersion,
  };
}

