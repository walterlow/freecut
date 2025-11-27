import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Project } from '@/types/project';
import type {
  MediaMetadata,
  ThumbnailData,
  ContentRecord,
  ProjectMediaAssociation,
  FilmstripData,
  WaveformData,
} from '@/types/storage';

// Database schema
interface VideoEditorDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: {
      name: string;
      updatedAt: number;
      createdAt: number;
    };
  };
  media: {
    key: string;
    value: MediaMetadata;
    indexes: {
      fileName: string;
      mimeType: string;
      createdAt: number;
      contentHash: string; // NEW: for deduplication lookup
      tags: string;
    };
  };
  thumbnails: {
    key: string;
    value: ThumbnailData;
    indexes: {
      mediaId: string;
    };
  };
  // NEW: Content store for reference counting
  content: {
    key: string; // contentHash
    value: ContentRecord;
    indexes: {
      referenceCount: number;
    };
  };
  // NEW: Project-media associations for per-project isolation
  projectMedia: {
    key: [string, string]; // [projectId, mediaId] compound key
    value: ProjectMediaAssociation;
    indexes: {
      projectId: string;
      mediaId: string;
    };
  };
  // v4: Filmstrip thumbnails for timeline video clips
  filmstrips: {
    key: string; // Format: `${mediaId}:${density}`
    value: FilmstripData;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
  // v4: Waveform data for timeline audio clips
  waveforms: {
    key: string; // mediaId
    value: WaveformData;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
}

const DB_NAME = 'video-editor-db';
const DB_VERSION = 5; // v5: Ensure filmstrip/waveform stores exist (fixes v4 upgrade issue)

let dbPromise: Promise<IDBPDatabase<VideoEditorDB>> | null = null;

/**
 * Initialize and get the IndexedDB database instance
 */
export async function getDB(): Promise<IDBPDatabase<VideoEditorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VideoEditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Create projects object store (v1)
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', {
            keyPath: 'id',
          });

          // Create indexes for efficient queries
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          projectStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Create media object store (v2)
        if (oldVersion < 2 && !db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', {
            keyPath: 'id',
          });

          // Create indexes for efficient queries
          mediaStore.createIndex('fileName', 'fileName', { unique: false });
          mediaStore.createIndex('mimeType', 'mimeType', { unique: false });
          mediaStore.createIndex('createdAt', 'createdAt', { unique: false });
          mediaStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }

        // Create thumbnails object store (v2)
        if (oldVersion < 2 && !db.objectStoreNames.contains('thumbnails')) {
          const thumbnailStore = db.createObjectStore('thumbnails', {
            keyPath: 'id',
          });

          // Create index for finding thumbnails by media ID
          thumbnailStore.createIndex('mediaId', 'mediaId', { unique: false });
        }

        // v3: Content-addressable storage with project-media associations
        if (oldVersion < 3) {
          // Add contentHash index to media store (if media store exists)
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
        // Note: Using < 5 to ensure stores are created even if v4 upgrade failed
        if (oldVersion < 5) {
          // Create filmstrips store for video clip thumbnails
          if (!db.objectStoreNames.contains('filmstrips')) {
            const filmstripStore = db.createObjectStore('filmstrips', {
              keyPath: 'id',
            });
            filmstripStore.createIndex('mediaId', 'mediaId', { unique: false });
            filmstripStore.createIndex('createdAt', 'createdAt', {
              unique: false,
            });
          }

          // Create waveforms store for audio clip visualization
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
      },
      blocked() {
        console.warn(
          'Database upgrade blocked. Close other tabs with this app open.'
        );
      },
      blocking() {
        console.warn(
          'This connection is blocking a database upgrade in another tab.'
        );
      },
    });
  }

  return dbPromise;
}

/**
 * Close the database connection and clear the cached promise.
 * This allows the database to be reopened and triggers upgrade if version changed.
 */
export async function closeDB(): Promise<void> {
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
 * Force database reconnection - closes and reopens to trigger upgrades
 */
export async function reconnectDB(): Promise<IDBPDatabase<VideoEditorDB>> {
  await closeDB();
  return getDB();
}

/**
 * Check if database has required stores (for detecting outdated schema)
 */
export async function hasRequiredStores(): Promise<boolean> {
  try {
    const db = await getDB();
    const requiredStores = ['projects', 'media', 'thumbnails', 'content', 'projectMedia', 'filmstrips', 'waveforms'] as const;
    return requiredStores.every(store => db.objectStoreNames.contains(store));
  } catch {
    return false;
  }
}

/**
 * Check storage quota and usage
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
 * Check if there's enough storage space for a given size
 */
export async function hasEnoughSpace(requiredBytes: number): Promise<boolean> {
  const { available } = await checkStorageQuota();
  return available >= requiredBytes;
}

/**
 * Get all projects from IndexedDB
 */
export async function getAllProjects(): Promise<Project[]> {
  try {
    const db = await getDB();
    return await db.getAll('projects');
  } catch (error) {
    console.error('Failed to get all projects:', error);
    throw new Error('Failed to load projects from database');
  }
}

/**
 * Get a single project by ID
 */
export async function getProject(id: string): Promise<Project | undefined> {
  try {
    const db = await getDB();
    return await db.get('projects', id);
  } catch (error) {
    console.error(`Failed to get project ${id}:`, error);
    throw new Error(`Failed to load project: ${id}`);
  }
}

/**
 * Create a new project in IndexedDB
 */
export async function createProject(project: Project): Promise<Project> {
  try {
    // Check if we have enough storage
    const projectSize = new Blob([JSON.stringify(project)]).size;
    const hasSpace = await hasEnoughSpace(projectSize);

    if (!hasSpace) {
      const { percentUsed } = await checkStorageQuota();
      throw new Error(
        `Insufficient storage space. ${percentUsed.toFixed(1)}% of quota used.`
      );
    }

    const db = await getDB();
    await db.add('projects', project);
    return project;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      throw new Error(
        'Storage quota exceeded. Please delete some projects to free up space.'
      );
    }
    console.error('Failed to create project:', error);
    throw error;
  }
}

/**
 * Update an existing project in IndexedDB
 */
export async function updateProject(
  id: string,
  updates: Partial<Project>
): Promise<Project> {
  try {
    const db = await getDB();
    const existing = await db.get('projects', id);

    if (!existing) {
      throw new Error(`Project not found: ${id}`);
    }

    const updated: Project = {
      ...existing,
      ...updates,
      id, // Ensure ID doesn't change
      updatedAt: Date.now(), // Update timestamp
    };

    await db.put('projects', updated);
    return updated;
  } catch (error) {
    console.error(`Failed to update project ${id}:`, error);
    throw error;
  }
}

/**
 * Delete a project from IndexedDB
 */
export async function deleteProject(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('projects', id);
  } catch (error) {
    console.error(`Failed to delete project ${id}:`, error);
    throw new Error(`Failed to delete project: ${id}`);
  }
}

/**
 * Search projects by name (case-insensitive)
 */
export async function searchProjects(query: string): Promise<Project[]> {
  try {
    const db = await getDB();
    const allProjects = await db.getAll('projects');

    const lowerQuery = query.toLowerCase();
    return allProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(lowerQuery) ||
        project.description?.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    console.error('Failed to search projects:', error);
    throw new Error('Failed to search projects');
  }
}

/**
 * Get projects sorted by a specific field
 */
export async function getProjectsSorted(
  field: 'name' | 'updatedAt' | 'createdAt',
  direction: 'asc' | 'desc' = 'desc'
): Promise<Project[]> {
  try {
    const db = await getDB();
    const tx = db.transaction('projects', 'readonly');
    const index = tx.store.index(field);

    const projects =
      direction === 'asc'
        ? await index.getAll()
        : await index.getAll(undefined, undefined);

    if (direction === 'desc') {
      projects.reverse();
    }

    return projects;
  } catch (error) {
    console.error('Failed to get sorted projects:', error);
    throw new Error('Failed to load sorted projects');
  }
}

/**
 * Clear all projects (useful for testing or reset)
 */
export async function clearAllProjects(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear('projects');
  } catch (error) {
    console.error('Failed to clear projects:', error);
    throw new Error('Failed to clear all projects');
  }
}

/**
 * Get database statistics
 */
export async function getDBStats(): Promise<{
  projectCount: number;
  storageUsed: number;
  storageQuota: number;
}> {
  try {
    const db = await getDB();
    const projectCount = await db.count('projects');
    const { usage, quota } = await checkStorageQuota();

    return {
      projectCount,
      storageUsed: usage,
      storageQuota: quota,
    };
  } catch (error) {
    console.error('Failed to get DB stats:', error);
    return {
      projectCount: 0,
      storageUsed: 0,
      storageQuota: 0,
    };
  }
}

// ============================================
// Media Library CRUD Operations
// ============================================

/**
 * Get all media items from IndexedDB
 */
export async function getAllMedia(): Promise<MediaMetadata[]> {
  try {
    const db = await getDB();
    return await db.getAll('media');
  } catch (error) {
    console.error('Failed to get all media:', error);
    throw new Error('Failed to load media from database');
  }
}

/**
 * Get a single media item by ID
 */
export async function getMedia(id: string): Promise<MediaMetadata | undefined> {
  try {
    const db = await getDB();
    return await db.get('media', id);
  } catch (error) {
    console.error(`Failed to get media ${id}:`, error);
    throw new Error(`Failed to load media: ${id}`);
  }
}

/**
 * Create a new media item in IndexedDB
 */
export async function createMedia(media: MediaMetadata): Promise<MediaMetadata> {
  try {
    const db = await getDB();
    await db.add('media', media);
    return media;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      throw new Error(
        'Storage quota exceeded. Please delete some media to free up space.'
      );
    }
    console.error('Failed to create media:', error);
    throw error;
  }
}

/**
 * Update an existing media item in IndexedDB
 */
export async function updateMedia(
  id: string,
  updates: Partial<MediaMetadata>
): Promise<MediaMetadata> {
  try {
    const db = await getDB();
    const existing = await db.get('media', id);

    if (!existing) {
      throw new Error(`Media not found: ${id}`);
    }

    const updated: MediaMetadata = {
      ...existing,
      ...updates,
      id, // Ensure ID doesn't change
      updatedAt: Date.now(), // Update timestamp
    };

    await db.put('media', updated);
    return updated;
  } catch (error) {
    console.error(`Failed to update media ${id}:`, error);
    throw error;
  }
}

/**
 * Delete a media item from IndexedDB
 */
export async function deleteMedia(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('media', id);
  } catch (error) {
    console.error(`Failed to delete media ${id}:`, error);
    throw new Error(`Failed to delete media: ${id}`);
  }
}

/**
 * Search media by filename (case-insensitive)
 */
export async function searchMedia(query: string): Promise<MediaMetadata[]> {
  try {
    const db = await getDB();
    const allMedia = await db.getAll('media');

    const lowerQuery = query.toLowerCase();
    return allMedia.filter((media) =>
      media.fileName.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    console.error('Failed to search media:', error);
    throw new Error('Failed to search media');
  }
}

/**
 * Get media items by type
 */
export async function getMediaByType(
  mimeTypePrefix: string
): Promise<MediaMetadata[]> {
  try {
    const db = await getDB();
    const allMedia = await db.getAll('media');

    return allMedia.filter((media) =>
      media.mimeType.startsWith(mimeTypePrefix)
    );
  } catch (error) {
    console.error('Failed to get media by type:', error);
    throw new Error('Failed to load media by type');
  }
}

/**
 * Batch delete multiple media items
 */
export async function batchDeleteMedia(ids: string[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('media', 'readwrite');

    for (const id of ids) {
      await tx.store.delete(id);
    }

    await tx.done;
  } catch (error) {
    console.error('Failed to batch delete media:', error);
    throw new Error('Failed to delete media items');
  }
}

// ============================================
// Thumbnail CRUD Operations
// ============================================

/**
 * Save a thumbnail to IndexedDB
 */
export async function saveThumbnail(thumbnail: ThumbnailData): Promise<void> {
  try {
    const db = await getDB();
    await db.put('thumbnails', thumbnail);
  } catch (error) {
    console.error('Failed to save thumbnail:', error);
    throw new Error('Failed to save thumbnail');
  }
}

/**
 * Get a thumbnail by ID
 */
export async function getThumbnail(
  id: string
): Promise<ThumbnailData | undefined> {
  try {
    const db = await getDB();
    return await db.get('thumbnails', id);
  } catch (error) {
    console.error(`Failed to get thumbnail ${id}:`, error);
    throw new Error(`Failed to load thumbnail: ${id}`);
  }
}

/**
 * Get a thumbnail by media ID
 */
export async function getThumbnailByMediaId(
  mediaId: string
): Promise<ThumbnailData | undefined> {
  try {
    const db = await getDB();
    const tx = db.transaction('thumbnails', 'readonly');
    const index = tx.store.index('mediaId');
    const thumbnails = await index.getAll(mediaId);

    return thumbnails[0]; // Return first thumbnail for this media
  } catch (error) {
    console.error(`Failed to get thumbnail for media ${mediaId}:`, error);
    return undefined;
  }
}

/**
 * Delete a thumbnail from IndexedDB
 */
export async function deleteThumbnail(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('thumbnails', id);
  } catch (error) {
    console.error(`Failed to delete thumbnail ${id}:`, error);
    throw new Error(`Failed to delete thumbnail: ${id}`);
  }
}

/**
 * Delete thumbnails by media ID
 */
export async function deleteThumbnailsByMediaId(mediaId: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('thumbnails', 'readwrite');
    const index = tx.store.index('mediaId');
    const thumbnails = await index.getAll(mediaId);

    for (const thumbnail of thumbnails) {
      await tx.store.delete(thumbnail.id);
    }

    await tx.done;
  } catch (error) {
    console.error(`Failed to delete thumbnails for media ${mediaId}:`, error);
    throw new Error('Failed to delete thumbnails');
  }
}

// ============================================
// Content Store CRUD Operations (v3)
// ============================================

/**
 * Get content record by hash
 */
export async function getContentByHash(
  hash: string
): Promise<ContentRecord | undefined> {
  try {
    const db = await getDB();
    return await db.get('content', hash);
  } catch (error) {
    console.error(`Failed to get content ${hash}:`, error);
    throw new Error(`Failed to load content: ${hash}`);
  }
}

/**
 * Create a new content record
 */
export async function createContent(record: ContentRecord): Promise<void> {
  try {
    const db = await getDB();
    await db.add('content', record);
  } catch (error) {
    console.error('Failed to create content record:', error);
    throw error;
  }
}

/**
 * Increment reference count for content
 * Returns the new reference count
 */
export async function incrementContentRef(hash: string): Promise<number> {
  try {
    const db = await getDB();
    const existing = await db.get('content', hash);

    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }

    const updated: ContentRecord = {
      ...existing,
      referenceCount: existing.referenceCount + 1,
    };

    await db.put('content', updated);
    return updated.referenceCount;
  } catch (error) {
    console.error(`Failed to increment content ref ${hash}:`, error);
    throw error;
  }
}

/**
 * Decrement reference count for content
 * Returns the new reference count
 */
export async function decrementContentRef(hash: string): Promise<number> {
  try {
    const db = await getDB();
    const existing = await db.get('content', hash);

    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }

    const updated: ContentRecord = {
      ...existing,
      referenceCount: Math.max(0, existing.referenceCount - 1),
    };

    await db.put('content', updated);
    return updated.referenceCount;
  } catch (error) {
    console.error(`Failed to decrement content ref ${hash}:`, error);
    throw error;
  }
}

/**
 * Delete a content record
 */
export async function deleteContent(hash: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('content', hash);
  } catch (error) {
    console.error(`Failed to delete content ${hash}:`, error);
    throw new Error(`Failed to delete content: ${hash}`);
  }
}

/**
 * Find media by content hash
 */
export async function findMediaByContentHash(
  hash: string
): Promise<MediaMetadata | undefined> {
  try {
    const db = await getDB();
    const tx = db.transaction('media', 'readonly');
    const index = tx.store.index('contentHash');
    const results = await index.getAll(hash);
    return results[0]; // Return first match
  } catch (error) {
    console.error(`Failed to find media by hash ${hash}:`, error);
    return undefined;
  }
}

// ============================================
// Project-Media Association CRUD Operations (v3)
// ============================================

/**
 * Associate media with a project
 */
export async function associateMediaWithProject(
  projectId: string,
  mediaId: string
): Promise<void> {
  try {
    const db = await getDB();
    const association: ProjectMediaAssociation = {
      projectId,
      mediaId,
      addedAt: Date.now(),
    };
    await db.put('projectMedia', association);
  } catch (error) {
    console.error(
      `Failed to associate media ${mediaId} with project ${projectId}:`,
      error
    );
    throw error;
  }
}

/**
 * Remove media association from a project
 */
export async function removeMediaFromProject(
  projectId: string,
  mediaId: string
): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('projectMedia', [projectId, mediaId]);
  } catch (error) {
    console.error(
      `Failed to remove media ${mediaId} from project ${projectId}:`,
      error
    );
    throw error;
  }
}

/**
 * Get all media IDs associated with a project
 */
export async function getProjectMediaIds(projectId: string): Promise<string[]> {
  try {
    const db = await getDB();
    const tx = db.transaction('projectMedia', 'readonly');
    const index = tx.store.index('projectId');
    const associations = await index.getAll(projectId);
    return associations.map((a) => a.mediaId);
  } catch (error) {
    console.error(`Failed to get media for project ${projectId}:`, error);
    throw new Error(`Failed to get project media: ${projectId}`);
  }
}

/**
 * Get all project IDs that use a specific media item
 */
export async function getProjectsUsingMedia(mediaId: string): Promise<string[]> {
  try {
    const db = await getDB();
    const tx = db.transaction('projectMedia', 'readonly');
    const index = tx.store.index('mediaId');
    const associations = await index.getAll(mediaId);
    return associations.map((a) => a.projectId);
  } catch (error) {
    console.error(`Failed to get projects using media ${mediaId}:`, error);
    throw new Error(`Failed to get projects for media: ${mediaId}`);
  }
}

/**
 * Get all media metadata for a project
 */
export async function getMediaForProject(
  projectId: string
): Promise<MediaMetadata[]> {
  try {
    const mediaIds = await getProjectMediaIds(projectId);
    const db = await getDB();

    const media: MediaMetadata[] = [];
    for (const id of mediaIds) {
      const item = await db.get('media', id);
      if (item) {
        media.push(item);
      }
    }

    return media;
  } catch (error) {
    console.error(`Failed to get media for project ${projectId}:`, error);
    throw new Error(`Failed to load project media: ${projectId}`);
  }
}

/**
 * Remove all media associations for a project
 */
export async function removeAllMediaFromProject(
  projectId: string
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('projectMedia', 'readwrite');
    const index = tx.store.index('projectId');
    const associations = await index.getAll(projectId);

    for (const association of associations) {
      await tx.store.delete([association.projectId, association.mediaId]);
    }

    await tx.done;
  } catch (error) {
    console.error(
      `Failed to remove all media from project ${projectId}:`,
      error
    );
    throw new Error(`Failed to clear project media: ${projectId}`);
  }
}

/**
 * Check if a media item is associated with a project
 */
export async function isMediaInProject(
  projectId: string,
  mediaId: string
): Promise<boolean> {
  try {
    const db = await getDB();
    const association = await db.get('projectMedia', [projectId, mediaId]);
    return !!association;
  } catch (error) {
    console.error(
      `Failed to check media ${mediaId} in project ${projectId}:`,
      error
    );
    return false;
  }
}

// ============================================
// Filmstrip CRUD Operations (v4)
// ============================================

/**
 * Save filmstrip data to IndexedDB
 */
export async function saveFilmstrip(filmstrip: FilmstripData): Promise<void> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('filmstrips')) {
      console.warn('filmstrips store not found, attempting reconnection...');
      db = await reconnectDB();
    }
    await db.put('filmstrips', filmstrip);
  } catch (error) {
    console.error('Failed to save filmstrip:', error);
    throw new Error('Failed to save filmstrip');
  }
}

/**
 * Get filmstrip by ID (mediaId:density)
 */
export async function getFilmstrip(
  id: string
): Promise<FilmstripData | undefined> {
  try {
    const db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('filmstrips')) {
      console.warn('filmstrips store not found, attempting reconnection...');
      const newDb = await reconnectDB();
      if (!newDb.objectStoreNames.contains('filmstrips')) {
        throw new Error('filmstrips store not found after reconnection');
      }
      return await newDb.get('filmstrips', id);
    }
    return await db.get('filmstrips', id);
  } catch (error) {
    console.error(`Failed to get filmstrip ${id}:`, error);
    return undefined;
  }
}

/**
 * Get filmstrip by media ID and density
 */
export async function getFilmstripByMediaAndDensity(
  mediaId: string,
  density: string
): Promise<FilmstripData | undefined> {
  const id = `${mediaId}:${density}`;
  return getFilmstrip(id);
}

/**
 * Get filmstrip by media ID (returns first/only filmstrip for the media)
 */
export async function getFilmstripByMediaId(
  mediaId: string
): Promise<FilmstripData | undefined> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return undefined;
      }
    }
    const tx = db.transaction('filmstrips', 'readonly');
    const index = tx.store.index('mediaId');
    const results = await index.getAll(mediaId);
    return results[0];
  } catch (error) {
    console.error(`Failed to get filmstrip for media ${mediaId}:`, error);
    return undefined;
  }
}

/**
 * Get all filmstrips for a media item
 */
export async function getFilmstripsByMediaId(
  mediaId: string
): Promise<FilmstripData[]> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('filmstrips')) {
      console.warn('filmstrips store not found, attempting reconnection...');
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return [];
      }
    }
    const tx = db.transaction('filmstrips', 'readonly');
    const index = tx.store.index('mediaId');
    return await index.getAll(mediaId);
  } catch (error) {
    console.error(`Failed to get filmstrips for media ${mediaId}:`, error);
    return [];
  }
}

/**
 * Delete filmstrip by ID
 */
export async function deleteFilmstrip(id: string): Promise<void> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return; // Store doesn't exist, nothing to delete
      }
    }
    await db.delete('filmstrips', id);
  } catch (error) {
    console.error(`Failed to delete filmstrip ${id}:`, error);
    throw new Error(`Failed to delete filmstrip: ${id}`);
  }
}

/**
 * Delete all filmstrips for a media item
 */
export async function deleteFilmstripsByMediaId(mediaId: string): Promise<void> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return; // Store doesn't exist, nothing to delete
      }
    }
    const tx = db.transaction('filmstrips', 'readwrite');
    const index = tx.store.index('mediaId');
    const filmstrips = await index.getAll(mediaId);

    for (const filmstrip of filmstrips) {
      await tx.store.delete(filmstrip.id);
    }

    await tx.done;
  } catch (error) {
    console.error(`Failed to delete filmstrips for media ${mediaId}:`, error);
    throw new Error('Failed to delete filmstrips');
  }
}

// ============================================
// Waveform CRUD Operations (v4)
// ============================================

/**
 * Save waveform data to IndexedDB
 */
export async function saveWaveform(waveform: WaveformData): Promise<void> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('waveforms')) {
      console.warn('waveforms store not found, attempting reconnection...');
      db = await reconnectDB();
    }
    await db.put('waveforms', waveform);
  } catch (error) {
    console.error('Failed to save waveform:', error);
    throw new Error('Failed to save waveform');
  }
}

/**
 * Get waveform by ID (mediaId)
 */
export async function getWaveform(
  id: string
): Promise<WaveformData | undefined> {
  try {
    const db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('waveforms')) {
      console.warn('waveforms store not found, attempting reconnection...');
      const newDb = await reconnectDB();
      if (!newDb.objectStoreNames.contains('waveforms')) {
        throw new Error('waveforms store not found after reconnection');
      }
      return await newDb.get('waveforms', id);
    }
    return await db.get('waveforms', id);
  } catch (error) {
    console.error(`Failed to get waveform ${id}:`, error);
    return undefined;
  }
}

/**
 * Delete waveform by ID
 */
export async function deleteWaveform(id: string): Promise<void> {
  try {
    let db = await getDB();
    // Check if store exists (database might need upgrade)
    if (!db.objectStoreNames.contains('waveforms')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('waveforms')) {
        return; // Store doesn't exist, nothing to delete
      }
    }
    await db.delete('waveforms', id);
  } catch (error) {
    console.error(`Failed to delete waveform ${id}:`, error);
    throw new Error(`Failed to delete waveform: ${id}`);
  }
}
