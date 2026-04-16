/**
 * WorkspaceGate
 *
 * Blocks the entire app until the user has picked a workspace folder and
 * granted read/write permission. Runs once at startup:
 *
 *   1. Check handles-db for a saved workspace handle
 *   2. If missing → show splash prompting user to pick a folder
 *   3. If present → queryPermission; if granted, set the active root and
 *      render the children. If revoked, show a Reconnect splash.
 *
 * Also listens for permission-lost signals from fs-primitives and flips
 * back to the Reconnect state mid-session.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getWorkspaceHandleRecord,
  isFileSystemAccessSupported,
  queryHandlePermission,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
} from '@/infrastructure/storage/handles-db';
import {
  onPermissionLost,
  setWorkspaceRoot,
} from '@/infrastructure/storage/workspace-fs/root';
import { bootstrapWorkspace } from '@/infrastructure/storage/workspace-fs/bootstrap';
import { createLogger } from '@/shared/logging/logger';
import { WorkspaceGateSplash } from './workspace-gate-splash';

const logger = createLogger('WorkspaceGate');

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'unavailable' } // Non-Chromium browsers
  | { kind: 'pick' } // No saved handle
  | { kind: 'reconnect'; handleName: string } // Saved handle, permission revoked
  | { kind: 'ready' };

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>({ kind: 'initializing' });

  const activate = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setWorkspaceRoot(handle);
    try {
      await bootstrapWorkspace(handle);
    } catch (error) {
      logger.warn('bootstrapWorkspace failed', error);
    }
    setStatus({ kind: 'ready' });
  }, []);

  // Initial load: check if we have a saved handle, check its permission.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isFileSystemAccessSupported()) {
        if (!cancelled) setStatus({ kind: 'unavailable' });
        return;
      }
      const record = await getWorkspaceHandleRecord();
      if (!record) {
        if (!cancelled) setStatus({ kind: 'pick' });
        return;
      }
      const handle = record.handle as FileSystemDirectoryHandle;
      const permission = await queryHandlePermission(handle);
      if (cancelled) return;
      if (permission === 'granted') {
        await activate(handle);
      } else {
        setStatus({ kind: 'reconnect', handleName: record.name });
      }
    })().catch((error) => {
      logger.error('Gate initialization failed', error);
      if (!cancelled) setStatus({ kind: 'pick' });
    });
    return () => {
      cancelled = true;
    };
  }, [activate]);

  // Permission-lost mid-session → flip to reconnect.
  useEffect(() => {
    const unsubscribe = onPermissionLost(() => {
      void (async () => {
        const record = await getWorkspaceHandleRecord();
        setStatus({ kind: 'reconnect', handleName: record?.name ?? 'workspace' });
      })();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handlePick = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({
        id: 'freecut-workspace',
        mode: 'readwrite',
        startIn: 'documents',
      });
      const queryState = await queryHandlePermission(handle);
      const finalState =
        queryState === 'granted' ? queryState : await requestHandlePermission(handle);
      if (finalState !== 'granted') {
        setStatus({ kind: 'reconnect', handleName: handle.name });
        return;
      }
      await saveWorkspaceHandleRecord(handle);
      await activate(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // User cancelled the picker; stay on splash.
        return;
      }
      logger.error('Folder pick failed', error);
    }
  }, [activate]);

  const handleReconnect = useCallback(async () => {
    const record = await getWorkspaceHandleRecord();
    if (!record) {
      setStatus({ kind: 'pick' });
      return;
    }
    const handle = record.handle as FileSystemDirectoryHandle;
    const permission = await requestHandlePermission(handle);
    if (permission === 'granted') {
      await activate(handle);
    }
  }, [activate]);

  if (status.kind === 'ready') {
    return <>{children}</>;
  }

  return (
    <WorkspaceGateSplash
      status={status}
      onPickFolder={handlePick}
      onReconnect={handleReconnect}
    />
  );
}
