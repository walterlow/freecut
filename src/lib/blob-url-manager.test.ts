import { describe, expect, it, beforeEach, vi } from 'vitest';
import { blobUrlManager } from './blob-url-manager';

// Mock URL.createObjectURL / revokeObjectURL
let blobUrlCounter = 0;
const revokedUrls = new Set<string>();

beforeEach(() => {
  blobUrlManager.releaseAll();
  blobUrlCounter = 0;
  revokedUrls.clear();

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:mock-${++blobUrlCounter}`,
    revokeObjectURL: (url: string) => {
      revokedUrls.add(url);
    },
  });
});

describe('BlobUrlManager', () => {
  describe('acquire', () => {
    it('creates a new blob URL for a new mediaId', () => {
      const url = blobUrlManager.acquire('media-1', new Blob(['data']));
      expect(url).toBe('blob:mock-1');
      expect(blobUrlManager.size).toBe(1);
    });

    it('returns the same URL for duplicate acquires', () => {
      const url1 = blobUrlManager.acquire('media-1', new Blob(['data']));
      const url2 = blobUrlManager.acquire('media-1', new Blob(['other']));
      expect(url1).toBe(url2);
      expect(blobUrlManager.size).toBe(1);
    });

    it('increments ref count on duplicate acquire', () => {
      blobUrlManager.acquire('media-1', new Blob(['data']));
      blobUrlManager.acquire('media-1', new Blob(['data']));
      // Release once — should not revoke (refCount still > 0)
      blobUrlManager.release('media-1');
      expect(blobUrlManager.has('media-1')).toBe(true);
      // Release again — refCount hits 0, should revoke
      blobUrlManager.release('media-1');
      expect(blobUrlManager.has('media-1')).toBe(false);
    });
  });

  describe('get', () => {
    it('returns null for unknown mediaId', () => {
      expect(blobUrlManager.get('unknown')).toBeNull();
    });

    it('returns cached URL', () => {
      const url = blobUrlManager.acquire('media-1', new Blob(['data']));
      expect(blobUrlManager.get('media-1')).toBe(url);
    });
  });

  describe('invalidate', () => {
    it('removes and revokes the blob URL regardless of ref count', () => {
      const url = blobUrlManager.acquire('media-1', new Blob(['data']));
      // Acquire again to bump refCount to 2
      blobUrlManager.acquire('media-1', new Blob(['data']));

      blobUrlManager.invalidate('media-1');

      expect(blobUrlManager.has('media-1')).toBe(false);
      expect(blobUrlManager.get('media-1')).toBeNull();
      expect(blobUrlManager.size).toBe(0);
      expect(revokedUrls.has(url)).toBe(true);
    });

    it('is a no-op for unknown mediaId', () => {
      blobUrlManager.invalidate('unknown');
      expect(blobUrlManager.size).toBe(0);
    });

    it('allows re-acquiring after invalidation', () => {
      blobUrlManager.acquire('media-1', new Blob(['old']));
      blobUrlManager.invalidate('media-1');

      const newUrl = blobUrlManager.acquire('media-1', new Blob(['new']));
      expect(newUrl).toBe('blob:mock-2'); // new URL, not the old one
      expect(blobUrlManager.get('media-1')).toBe(newUrl);
    });
  });

  describe('release', () => {
    it('revokes URL when refCount reaches zero', () => {
      const url = blobUrlManager.acquire('media-1', new Blob(['data']));
      blobUrlManager.release('media-1');
      expect(blobUrlManager.has('media-1')).toBe(false);
      expect(revokedUrls.has(url)).toBe(true);
    });

    it('is a no-op for unknown mediaId', () => {
      blobUrlManager.release('unknown');
      expect(blobUrlManager.size).toBe(0);
    });
  });

  describe('releaseAll', () => {
    it('revokes all URLs and clears entries', () => {
      const url1 = blobUrlManager.acquire('media-1', new Blob(['a']));
      const url2 = blobUrlManager.acquire('media-2', new Blob(['b']));

      blobUrlManager.releaseAll();

      expect(blobUrlManager.size).toBe(0);
      expect(revokedUrls.has(url1)).toBe(true);
      expect(revokedUrls.has(url2)).toBe(true);
    });
  });
});
