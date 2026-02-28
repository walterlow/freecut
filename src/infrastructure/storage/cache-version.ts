/**
 * Cache Versioning System
 *
 * Provides automatic cache invalidation when format versions change.
 * Each cache type has its own version that can be bumped independently.
 *
 * Usage:
 *   const migration = getCacheMigration('filmstrip', 2);
 *   if (migration.needsMigration) {
 *     await clearCacheData();
 *     migration.markComplete();
 *   }
 */

import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('CacheVersion');

const VERSION_PREFIX = 'cache-version-';

/**
 * Cache version configuration
 * Bump version numbers here when format changes require cache invalidation
 */
const CACHE_VERSIONS = {
  filmstrip: 7,    // OPFS filmstrip frames (v7: 1fps, multi-worker)
  waveform: 2,     // OPFS waveform data
  thumbnail: 1,    // IndexedDB thumbnails
  media: 1,        // OPFS media files
} as const;

type CacheType = keyof typeof CACHE_VERSIONS;

interface CacheMigration {
  needsMigration: boolean;
  oldVersion: number | null;
  newVersion: number;
  markComplete: () => void;
}

/**
 * Check if a cache needs migration and get a helper to mark it complete
 */
export function getCacheMigration(cacheType: CacheType): CacheMigration {
  const key = `${VERSION_PREFIX}${cacheType}`;
  const stored = localStorage.getItem(key);
  const oldVersion = stored ? parseInt(stored, 10) : null;
  const newVersion = CACHE_VERSIONS[cacheType];

  const needsMigration = oldVersion !== newVersion;

  return {
    needsMigration,
    oldVersion,
    newVersion,
    markComplete: () => {
      localStorage.setItem(key, newVersion.toString());
      if (needsMigration) {
        const from = oldVersion ?? 'none';
        logger.debug(`${cacheType} cache migrated: v${from} → v${newVersion}`);
      }
    },
  };
}
