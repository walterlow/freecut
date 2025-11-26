import type {
  OPFSWorkerMessage,
  OPFSWorkerResponse,
} from '../workers/opfs-worker';

/**
 * OPFS Service - Wrapper for OPFS worker communication
 *
 * Provides a Promise-based API for file operations, hiding the complexity
 * of worker communication using MessageChannel pattern.
 */
export class OPFSService {
  private worker: Worker | null = null;

  /**
   * Pending read requests - prevents concurrent sync access handles on the same file
   * Maps file path to pending Promise
   */
  private pendingReads = new Map<string, Promise<ArrayBuffer>>();

  /**
   * Initialize the OPFS worker
   */
  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/opfs-worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return this.worker;
  }

  /**
   * Send a message to the worker and wait for response
   */
  private async sendMessage<T = unknown>(
    message: OPFSWorkerMessage
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent<OPFSWorkerResponse>) => {
        if (event.data.success) {
          resolve(event.data.data as T);
        } else {
          reject(new Error(event.data.error || 'OPFS operation failed'));
        }
      };

      this.getWorker().postMessage(message, [channel.port2]);
    });
  }

  /**
   * Save a file to OPFS
   */
  async saveFile(path: string, data: ArrayBuffer): Promise<void> {
    await this.sendMessage({
      type: 'save',
      payload: { path, data },
    });
  }

  /**
   * Get a file from OPFS
   *
   * Deduplicates concurrent requests to the same path to prevent
   * "Access Handles cannot be created" errors from the sync access API.
   */
  async getFile(path: string): Promise<ArrayBuffer> {
    // Check if there's already a pending read for this path
    const pending = this.pendingReads.get(path);
    if (pending) {
      return pending;
    }

    // Create the read request
    const readPromise = this.sendMessage<ArrayBuffer>({
      type: 'get',
      payload: { path },
    }).finally(() => {
      // Clean up pending request when done (success or failure)
      this.pendingReads.delete(path);
    });

    // Store the pending request
    this.pendingReads.set(path, readPromise);

    return readPromise;
  }

  /**
   * Delete a file from OPFS
   */
  async deleteFile(path: string): Promise<void> {
    await this.sendMessage({
      type: 'delete',
      payload: { path },
    });
  }

  /**
   * List files in a directory
   */
  async listFiles(directory: string): Promise<string[]> {
    const files = await this.sendMessage<string[]>({
      type: 'list',
      payload: { directory },
    });

    return files;
  }

  /**
   * Get storage usage estimate
   */
  async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0 };
    }

    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
    };
  }

  /**
   * Terminate the worker (cleanup)
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance
export const opfsService = new OPFSService();
