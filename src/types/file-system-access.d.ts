/**
 * TypeScript declarations for File System Access API
 * https://wicg.github.io/file-system-access/
 */

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemFileHandle {
  /**
   * Query the current permission state of this handle
   */
  queryPermission(
    descriptor?: FileSystemPermissionDescriptor
  ): Promise<PermissionState>;

  /**
   * Request permission to access this handle
   */
  requestPermission(
    descriptor?: FileSystemPermissionDescriptor
  ): Promise<PermissionState>;

  /**
   * Creates a sync access handle for high-performance file operations
   * Only available in Web Workers
   */
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}

interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  write(
    buffer: ArrayBuffer | ArrayBufferView,
    options?: { at?: number }
  ): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface SaveFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  suggestedName?: string;
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface Window {
  showOpenFilePicker(
    options?: OpenFilePickerOptions
  ): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(
    options?: SaveFilePickerOptions
  ): Promise<FileSystemFileHandle>;
  showDirectoryPicker(
    options?: DirectoryPickerOptions
  ): Promise<FileSystemDirectoryHandle>;
}

/**
 * Extends FileSystemDirectoryHandle with async iterable methods
 */
interface FileSystemDirectoryHandle {
  /**
   * Returns an async iterator of [name, handle] pairs
   */
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;

  /**
   * Returns an async iterator of file/directory names
   */
  keys(): AsyncIterableIterator<string>;

  /**
   * Returns an async iterator of file/directory handles
   */
  values(): AsyncIterableIterator<FileSystemHandle>;

  /**
   * Makes FileSystemDirectoryHandle async iterable
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}

/**
 * Extends DataTransferItem to support getAsFileSystemHandle()
 * Only supported in Chrome/Edge 86+
 */
interface DataTransferItem {
  /**
   * Returns a FileSystemHandle for the dragged item
   * Only available for 'file' kind items
   * Returns null if the item is not a file or handle cannot be obtained
   */
  getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
}
