/**
 * Tiny dedicated IndexedDB for FileSystemHandle storage.
 *
 * The ONLY IndexedDB the app still uses after the workspace-fs refactor.
 * It exists because FileSystem*Handle can't serialize to disk files and
 * must live somewhere browser-native to survive reloads.
 *
 * Single store: `handles`, keyed by a compound id `{kind}:{id}`.
 * - Workspace root handle: kind='workspace', id='current'
 * - Media file handles (for storageType='handle' media): kind='media', id=mediaId
 *
 * Schema is v1 forever. Any future evolution creates a parallel DB, not
 * a version bump on this one — avoids the HMR corruption class entirely.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('HandlesDB');

export const HANDLES_DB_NAME = 'freecut-handles-db';
export const HANDLES_DB_VERSION = 1;
export const HANDLES_STORE = 'handles';

export type HandleKind = 'workspace' | 'media' | 'project-folder';

export interface HandleRecord {
  /** Compound id: `${kind}:${id}`. */
  key: string;
  kind: HandleKind;
  id: string;
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  name: string;
  pickedAt: number;
  /** For media handles only — drives the "missing file" re-link UX. */
  lastSeenPath?: string;
  lastSeenSize?: number;
  lastSeenMtime?: number;
}

interface HandlesDBSchema extends DBSchema {
  handles: {
    key: string;
    value: HandleRecord;
    indexes: { kind: HandleKind };
  };
}

export type HandlesDBInstance = IDBPDatabase<HandlesDBSchema>;

let dbPromise: Promise<HandlesDBInstance> | null = null;

function getHandlesDB(): Promise<HandlesDBInstance> {
  if (!dbPromise) {
    dbPromise = openDB<HandlesDBSchema>(HANDLES_DB_NAME, HANDLES_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(HANDLES_STORE)) {
          const store = db.createObjectStore(HANDLES_STORE, { keyPath: 'key' });
          store.createIndex('kind', 'kind', { unique: false });
        }
      },
      blocked() {
        logger.warn('Handles DB upgrade blocked — close other tabs.');
      },
      blocking() {
        logger.warn('This connection is blocking a handles DB upgrade.');
      },
    });
  }
  return dbPromise;
}

function compoundKey(kind: HandleKind, id: string): string {
  return `${kind}:${id}`;
}

export async function getHandle(
  kind: HandleKind,
  id: string,
): Promise<HandleRecord | null> {
  try {
    const db = await getHandlesDB();
    const record = await db.get(HANDLES_STORE, compoundKey(kind, id));
    return record ?? null;
  } catch (error) {
    logger.error(`getHandle(${kind}, ${id}) failed`, error);
    return null;
  }
}

export async function saveHandle(record: Omit<HandleRecord, 'key'>): Promise<void> {
  const db = await getHandlesDB();
  const full: HandleRecord = {
    ...record,
    key: compoundKey(record.kind, record.id),
  };
  await db.put(HANDLES_STORE, full);
}

export async function deleteHandle(kind: HandleKind, id: string): Promise<void> {
  const db = await getHandlesDB();
  await db.delete(HANDLES_STORE, compoundKey(kind, id));
}

export async function listHandlesByKind(kind: HandleKind): Promise<HandleRecord[]> {
  const db = await getHandlesDB();
  return db.getAllFromIndex(HANDLES_STORE, 'kind', kind);
}

/* ───────────────────────────── Workspace shortcut ─────────────────────── */

const WORKSPACE_ID = 'current';

export async function getWorkspaceHandleRecord(): Promise<HandleRecord | null> {
  return getHandle('workspace', WORKSPACE_ID);
}

export async function saveWorkspaceHandleRecord(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await saveHandle({
    kind: 'workspace',
    id: WORKSPACE_ID,
    handle,
    name: handle.name,
    pickedAt: Date.now(),
  });
}

export async function clearWorkspaceHandleRecord(): Promise<void> {
  await deleteHandle('workspace', WORKSPACE_ID);
}

/* ───────────────────────────── Permission helpers ─────────────────────── */

export type HandlePermissionState = 'granted' | 'prompt' | 'denied';

export async function queryHandlePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<HandlePermissionState> {
  try {
    const state = await (handle as FileSystemDirectoryHandle).queryPermission({ mode });
    return state as HandlePermissionState;
  } catch (error) {
    logger.warn('queryPermission failed', error);
    return 'denied';
  }
}

export async function requestHandlePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<HandlePermissionState> {
  try {
    const state = await (handle as FileSystemDirectoryHandle).requestPermission({ mode });
    return state as HandlePermissionState;
  } catch (error) {
    logger.warn('requestPermission failed', error);
    return 'denied';
  }
}

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
  );
}
