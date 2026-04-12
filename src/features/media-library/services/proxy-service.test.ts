import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerManagerMocks = vi.hoisted(() => ({
  getWorker: vi.fn(),
  peekWorker: vi.fn(() => null),
  terminate: vi.fn(),
}));

const objectUrlRegistryMocks = vi.hoisted(() => ({
  registerObjectUrl: vi.fn(),
  unregisterObjectUrl: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  event: vi.fn(),
  startEvent: vi.fn(),
  child: vi.fn(),
  setLevel: vi.fn(),
}));

const timelineServiceMocks = vi.hoisted(() => ({
  filmstripCache: {
    prewarmPriorityWindow: vi.fn(async () => undefined),
  },
}));

const mediaLibraryStoreMocks = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    mediaById: {},
  })),
}));

const backgroundMediaWorkMocks = vi.hoisted(() => ({
  enqueueBackgroundMediaWork: vi.fn((run: () => unknown) => {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void (result as PromiseLike<unknown>);
    }
    return vi.fn();
  }),
}));

vi.mock('@/shared/utils/managed-worker', () => ({
  createManagedWorker: vi.fn(() => workerManagerMocks),
}));

vi.mock('@/infrastructure/browser/object-url-registry', () => ({
  registerObjectUrl: objectUrlRegistryMocks.registerObjectUrl,
  unregisterObjectUrl: objectUrlRegistryMocks.unregisterObjectUrl,
}));

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => loggerMocks),
}));

vi.mock('@/features/media-library/deps/timeline-services', () => timelineServiceMocks);

vi.mock('./background-media-work', () => backgroundMediaWorkMocks);

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: mediaLibraryStoreMocks.getState,
  },
}));

type MockStoredFile = {
  size: number;
  text?: () => Promise<string>;
};

function createFileHandle(file: MockStoredFile): FileSystemFileHandle {
  return {
    getFile: vi.fn().mockResolvedValue(file),
  } as unknown as FileSystemFileHandle;
}

function createDirectoryHandle(options?: {
  files?: Record<string, MockStoredFile>;
  directories?: Record<string, FileSystemDirectoryHandle>;
  onRemoveEntry?: ReturnType<typeof vi.fn>;
}): FileSystemDirectoryHandle {
  const files = { ...(options?.files ?? {}) };
  const directories = { ...(options?.directories ?? {}) };
  const removeEntry = options?.onRemoveEntry ?? vi.fn(async (name: string) => {
    delete files[name];
    delete directories[name];
  });

  return {
    kind: 'directory',
    async *values() {
      for (const name of Object.keys(directories)) {
        yield {
          kind: 'directory',
          name,
        } as FileSystemDirectoryHandle;
      }
    },
    getDirectoryHandle: vi.fn(async (name: string) => {
      const directory = directories[name];
      if (!directory) {
        throw new Error(`Missing directory: ${name}`);
      }
      return directory;
    }),
    getFileHandle: vi.fn(async (name: string) => {
      const file = files[name];
      if (!file) {
        throw new Error(`Missing file: ${name}`);
      }
      return createFileHandle(file);
    }),
    removeEntry,
  } as unknown as FileSystemDirectoryHandle;
}

function createJsonFile(value: unknown): MockStoredFile {
  const json = JSON.stringify(value);
  return {
    size: json.length,
    text: vi.fn().mockResolvedValue(json),
  };
}

function createBinaryFile(size: number): MockStoredFile {
  return { size };
}

describe('proxyService.loadExistingProxies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:proxy'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    mediaLibraryStoreMocks.getState.mockReturnValue({
      mediaById: {},
    });
  });

  it('allows manual proxy generation for any video clip', async () => {
    const { proxyService } = await import('./proxy-service');

    expect(proxyService.canGenerateProxy('video/mp4')).toBe(true);
    expect(proxyService.canGenerateProxy('video/webm')).toBe(true);
    expect(proxyService.canGenerateProxy('audio/mpeg')).toBe(false);
  });

  it('uses proxy generation settings when deciding automatic proxy work', async () => {
    const { useSettingsStore } = await import('@/features/media-library/deps/settings-contract');
    const { proxyService } = await import('./proxy-service');

    useSettingsStore.getState().resetToDefaults();
    expect(proxyService.needsProxy(1920, 1080, 'video/mp4')).toBe(true);

    useSettingsStore.getState().setSetting('proxyGenerationMode', 'manual');
    expect(proxyService.needsProxy(3840, 2160, 'video/mp4')).toBe(false);

    useSettingsStore.getState().setSetting('proxyGenerationMode', 'smart');
    useSettingsStore.getState().setSetting('proxyGenerationResolution', '2160p');
    expect(proxyService.needsProxy(1920, 1080, 'video/mp4')).toBe(false);
    expect(proxyService.needsProxy(3840, 2160, 'video/mp4')).toBe(true);

    useSettingsStore.getState().setSetting('proxyGenerationMode', 'all');
    expect(proxyService.needsProxy(1280, 720, 'video/mp4')).toBe(true);
  });

  it('treats custom-decoded audio codecs as smart proxy candidates', async () => {
    const { useSettingsStore } = await import('@/features/media-library/deps/settings-contract');
    const { proxyService } = await import('./proxy-service');

    useSettingsStore.getState().resetToDefaults();
    useSettingsStore.getState().setSetting('proxyGenerationMode', 'smart');
    useSettingsStore.getState().setSetting('proxyGenerationResolution', '2160p');

    expect(proxyService.needsProxy(1280, 720, 'video/webm', 'vorbis')).toBe(true);
  });

  it('records runtime playback trouble and auto-queues a smart proxy recommendation', async () => {
    const workerPostMessage = vi.fn();
    workerManagerMocks.getWorker.mockReturnValue({
      postMessage: workerPostMessage,
    });

    const { useSettingsStore } = await import('@/features/media-library/deps/settings-contract');
    const { proxyService } = await import('./proxy-service');

    useSettingsStore.getState().resetToDefaults();
    proxyService.setProxyKey('video-runtime', 'proxy-video-runtime');

    expect(proxyService.reportPlaybackIssue('video-runtime', 'slow-decode', {
      source: new Blob(['video-bytes'], { type: 'video/mp4' }),
      sourceWidth: 1280,
      sourceHeight: 720,
    })).toBe(false);

    expect(proxyService.reportPlaybackIssue('video-runtime', 'waiting', {
      source: new Blob(['video-bytes'], { type: 'video/mp4' }),
      sourceWidth: 1280,
      sourceHeight: 720,
    })).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(useSettingsStore.getState().proxyRecommendedMediaIds).toContain('video-runtime');
    expect(proxyService.needsProxy(1280, 720, 'video/mp4', undefined, 'video-runtime')).toBe(true);
    expect(workerPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'generate',
      mediaId: 'proxy-video-runtime',
      sourceWidth: 1280,
      sourceHeight: 720,
    }));
  });

  it('requeues interrupted generating proxies on startup and removes partial output', async () => {
    const removeEntry = vi.fn(async () => undefined);
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 3,
          width: 1280,
          height: 720,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'generating',
          createdAt: 1,
        }),
      },
    });
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-1': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    });
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    });

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    });

    const { proxyService } = await import('./proxy-service');
    proxyService.setProxyKey('video-1', 'proxy-video-1');

    await expect(proxyService.loadExistingProxies(['video-1'])).resolves.toEqual(['video-1']);
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-1', { recursive: true });
  });

  it('cleans failed proxies without auto-retrying them on startup', async () => {
    const removeEntry = vi.fn(async () => undefined);
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 3,
          width: 1280,
          height: 720,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'error',
          createdAt: 1,
        }),
      },
    });
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-2': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    });
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    });

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    });

    const { proxyService } = await import('./proxy-service');
    proxyService.setProxyKey('video-2', 'proxy-video-2');

    await expect(proxyService.loadExistingProxies(['video-2'])).resolves.toEqual([]);
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-2', { recursive: true });
  });

  it('requeues ready proxies whose file payload is empty', async () => {
    const removeEntry = vi.fn(async () => undefined);
    const proxyDirectory = createDirectoryHandle({
      files: {
        'meta.json': createJsonFile({
          version: 3,
          width: 1280,
          height: 720,
          sourceWidth: 3840,
          sourceHeight: 2160,
          status: 'ready',
          createdAt: 1,
        }),
        'proxy.mp4': createBinaryFile(0),
      },
    });
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-3': proxyDirectory,
      },
      onRemoveEntry: removeEntry,
    });
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    });

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    });

    const { proxyService } = await import('./proxy-service');
    proxyService.setProxyKey('video-3', 'proxy-video-3');

    await expect(proxyService.loadExistingProxies(['video-3'])).resolves.toEqual(['video-3']);
    expect(removeEntry).toHaveBeenCalledWith('proxy-video-3', { recursive: true });
  });

  it('prewarms the first filmstrip window when a proxy finishes loading', async () => {
    const proxyDirectory = createDirectoryHandle({
      files: {
        'proxy.mp4': createBinaryFile(1024),
      },
    });
    const proxyRoot = createDirectoryHandle({
      directories: {
        'proxy-video-4': proxyDirectory,
      },
    });
    const root = createDirectoryHandle({
      directories: {
        proxies: proxyRoot,
      },
    });

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
      },
    });

    mediaLibraryStoreMocks.getState.mockReturnValue({
      mediaById: {
        'video-4': {
          id: 'video-4',
          mimeType: 'video/mp4',
          duration: 20,
        },
      },
    });

    const { proxyService } = await import('./proxy-service');
    proxyService.setProxyKey('video-4', 'proxy-video-4');

    await (proxyService as unknown as {
      loadCompletedProxy: (proxyKey: string) => Promise<void>;
    }).loadCompletedProxy('proxy-video-4');

    expect(timelineServiceMocks.filmstripCache.prewarmPriorityWindow).toHaveBeenCalledWith(
      'video-4',
      expect.objectContaining({ size: 1024 }),
      20,
      { startTime: 0, endTime: 12 },
    );
  });
});
