import { openDB } from 'idb';
import {
  VideoEditorDB,
  VideoEditorDBInstance,
  DB_NAME,
  DB_VERSION,
} from './schema';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Connection');

let dbPromise: Promise<VideoEditorDBInstance> | null = null;

/**
 * Initialize and get the IndexedDB database instance.
 * Creates stores and indexes on first run or schema upgrade.
 */
export async function getDB(): Promise<VideoEditorDBInstance> {
  if (!dbPromise) {
    dbPromise = openDB<VideoEditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // v1: Create projects object store
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', {
            keyPath: 'id',
          });
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          projectStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // v2: Create media object store
        if (oldVersion < 2 && !db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', {
            keyPath: 'id',
          });
          mediaStore.createIndex('fileName', 'fileName', { unique: false });
          mediaStore.createIndex('mimeType', 'mimeType', { unique: false });
          mediaStore.createIndex('createdAt', 'createdAt', { unique: false });
          mediaStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }

        // v2: Create thumbnails object store
        if (oldVersion < 2 && !db.objectStoreNames.contains('thumbnails')) {
          const thumbnailStore = db.createObjectStore('thumbnails', {
            keyPath: 'id',
          });
          thumbnailStore.createIndex('mediaId', 'mediaId', { unique: false });
        }

        // v3: Content-addressable storage with project-media associations
        if (oldVersion < 3) {
          // Add contentHash index to media store
          if (db.objectStoreNames.contains('media')) {
            const mediaStore = transaction.objectStore('media');
            if (!mediaStore.indexNames.contains('contentHash')) {
              mediaStore.createIndex('contentHash', 'contentHash', {
                unique: false,
              });
            }
          }

          // Create content store for reference counting
          if (!db.objectStoreNames.contains('content')) {
            const contentStore = db.createObjectStore('content', {
              keyPath: 'hash',
            });
            contentStore.createIndex('referenceCount', 'referenceCount', {
              unique: false,
            });
          }

          // Create projectMedia store for per-project media associations
          if (!db.objectStoreNames.contains('projectMedia')) {
            const projectMediaStore = db.createObjectStore('projectMedia', {
              keyPath: ['projectId', 'mediaId'],
            });
            projectMediaStore.createIndex('projectId', 'projectId', {
              unique: false,
            });
            projectMediaStore.createIndex('mediaId', 'mediaId', {
              unique: false,
            });
          }
        }

        // v4/v5: Filmstrip thumbnails and waveforms for timeline clips
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains('filmstrips')) {
            const filmstripStore = db.createObjectStore('filmstrips', {
              keyPath: 'id',
            });
            filmstripStore.createIndex('mediaId', 'mediaId', { unique: false });
            filmstripStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }

          if (!db.objectStoreNames.contains('waveforms')) {
            const waveformStore = db.createObjectStore('waveforms', {
              keyPath: 'id',
            });
            waveformStore.createIndex('mediaId', 'mediaId', { unique: false });
            waveformStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }
        }

        // v6: GIF frames store for pre-extracted animation frames
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains('gifFrames')) {
            const gifFrameStore = db.createObjectStore('gifFrames', {
              keyPath: 'id',
            });
            gifFrameStore.createIndex('mediaId', 'mediaId', { unique: false });
            gifFrameStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }
        }

        // v7: Add storageType index for file handle support (local-first)
        if (oldVersion < 7) {
          if (db.objectStoreNames.contains('media')) {
            const mediaStore = transaction.objectStore('media');
            if (!mediaStore.indexNames.contains('storageType')) {
              mediaStore.createIndex('storageType', 'storageType', {
                unique: false,
              });
            }
          }
        }

        // v8: Decoded preview audio store for AC-3/E-AC-3 persistence
        if (oldVersion < 8) {
          if (!db.objectStoreNames.contains('decodedPreviewAudio')) {
            const decodedAudioStore = db.createObjectStore('decodedPreviewAudio', {
              keyPath: 'id',
            });
            decodedAudioStore.createIndex('mediaId', 'mediaId', { unique: false });
            decodedAudioStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }
        }

        // v9: Reset decoded preview audio cache for binned storage rollout.
        // Older records can be incomplete/corrupt and should be re-decoded.
        if (oldVersion < 9) {
          if (db.objectStoreNames.contains('decodedPreviewAudio')) {
            const decodedAudioStore = transaction.objectStore('decodedPreviewAudio');
            decodedAudioStore.clear();
          } else {
            const decodedAudioStore = db.createObjectStore('decodedPreviewAudio', {
              keyPath: 'id',
            });
            decodedAudioStore.createIndex('mediaId', 'mediaId', { unique: false });
            decodedAudioStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }
        }
      },
      blocked() {
        logger.warn(
          'Database upgrade blocked. Close other tabs with this app open.'
        );
      },
      blocking() {
        logger.warn(
          'This connection is blocking a database upgrade in another tab.'
        );
      },
    });
  }

  return dbPromise;
}

/**
 * Close the database connection and clear the cached promise.
 */
async function closeDB(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Ignore errors when closing
    }
    dbPromise = null;
  }
}

/**
 * Force database reconnection - closes and reopens to trigger upgrades.
 */
export async function reconnectDB(): Promise<VideoEditorDBInstance> {
  await closeDB();
  return getDB();
}

/**
 * Check storage quota and usage.
 */
export async function checkStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
  available: number;
}> {
  if (!navigator.storage || !navigator.storage.estimate) {
    throw new Error('Storage estimation API not supported');
  }

  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
  const available = quota - usage;

  return {
    usage,
    quota,
    percentUsed,
    available,
  };
}

/**
 * Check if there's enough storage space for a given size.
 */
export async function hasEnoughSpace(requiredBytes: number): Promise<boolean> {
  const { available } = await checkStorageQuota();
  return available >= requiredBytes;
}
