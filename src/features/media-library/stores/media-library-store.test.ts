import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '@/types/storage';

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getMediaForProject: vi.fn(),
  getMediaFile: vi.fn(),
}));

const proxyStatusListenerRef = vi.hoisted(() => ({
  current: null as ((mediaId: string, status: 'generating' | 'ready' | 'error' | 'idle', progress?: number) => void) | null,
}));

const proxyServiceMocks = vi.hoisted(() => ({
  canGenerateProxy: vi.fn(),
  clearProxyKey: vi.fn(),
  hasProxy: vi.fn(),
  needsProxy: vi.fn(),
  setProxyKey: vi.fn(),
  loadExistingProxies: vi.fn(),
  generateProxy: vi.fn(),
  onStatusChange: vi.fn((listener) => {
    proxyStatusListenerRef.current = listener;
  }),
}));

const indexedDbMocks = vi.hoisted(() => ({
  getTranscriptMediaIds: vi.fn(),
}));

const loggerEventMocks = vi.hoisted(() => ({
  set: vi.fn(),
  merge: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  event: vi.fn(),
  startEvent: vi.fn(() => loggerEventMocks),
  child: vi.fn(),
  setLevel: vi.fn(),
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

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}));

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}));

vi.mock('../services/background-media-work', () => backgroundMediaWorkMocks);

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}));

vi.mock('@/infrastructure/storage/indexeddb', () => ({
  getTranscriptMediaIds: indexedDbMocks.getTranscriptMediaIds,
}));

vi.mock('./media-import-actions', () => ({
  createImportActions: vi.fn(() => ({})),
}));

vi.mock('./media-delete-actions', () => ({
  createDeleteActions: vi.fn(() => ({})),
}));

vi.mock('./media-relinking-actions', () => ({
  createRelinkingActions: vi.fn(() => ({})),
}));

vi.mock('@/shared/logging/logger', () => ({
  createOperationId: vi.fn(() => 'test-op-id'),
  createLogger: vi.fn(() => loggerMocks),
}));

import { useMediaLibraryStore } from './media-library-store';

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 3840,
    height: 2160,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function resetStore(): void {
  useMediaLibraryStore.setState({
    currentProjectId: null,
    mediaItems: [],
    mediaById: {},
    isLoading: false,
    importingIds: [],
    error: null,
    errorLink: null,
    notification: null,
    selectedMediaIds: [],
    selectedCompositionIds: [],
    searchQuery: '',
    filterByType: null,
    sortBy: 'date',
    viewMode: 'grid',
    mediaItemSize: 1,
    brokenMediaIds: [],
    brokenMediaInfo: new Map(),
    showMissingMediaDialog: false,
    orphanedClips: [],
    showOrphanedClipsDialog: false,
    unsupportedCodecFiles: [],
    showUnsupportedCodecDialog: false,
    unsupportedCodecResolver: null,
    proxyStatus: new Map(),
    proxyProgress: new Map(),
    transcriptStatus: new Map(),
    transcriptProgress: new Map(),
  });
}

describe('useMediaLibraryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('clears loading without fetching when no project is selected', async () => {
    useMediaLibraryStore.setState({ isLoading: true, currentProjectId: null });

    await useMediaLibraryStore.getState().loadMediaItems();

    expect(useMediaLibraryStore.getState().isLoading).toBe(false);
    expect(mediaLibraryServiceMocks.getMediaForProject).not.toHaveBeenCalled();
  });

  it('loads media, transcript availability, and stale proxies for the current project', async () => {
    const video = makeMedia({ id: 'video-1', fileName: 'video.mp4' });
    const audio = makeMedia({
      id: 'audio-1',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
      width: 0,
      height: 0,
    });

    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video, audio]);
    indexedDbMocks.getTranscriptMediaIds.mockResolvedValue(new Set(['video-1']));
    proxyServiceMocks.canGenerateProxy.mockImplementation((mimeType: string) => mimeType.startsWith('video/'));
    proxyServiceMocks.hasProxy.mockReturnValue(false);
    proxyServiceMocks.needsProxy.mockImplementation((_w, _h, mimeType: string) => mimeType.startsWith('video/'));
    proxyServiceMocks.loadExistingProxies.mockResolvedValue(['video-1']);

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' });

    await useMediaLibraryStore.getState().loadMediaItems();

    const state = useMediaLibraryStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.mediaItems).toEqual([video, audio]);
    expect(state.mediaById['video-1']).toEqual(video);
    expect(state.mediaById['audio-1']).toEqual(audio);
    expect(state.transcriptStatus.get('video-1')).toBe('ready');
    expect(state.transcriptStatus.get('audio-1')).toBe('idle');
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('video-1', 'proxy-video-1');
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-1']);
    const generateProxyCall = proxyServiceMocks.generateProxy.mock.calls[0];
    expect(generateProxyCall?.[0]).toBe('video-1');
    expect(generateProxyCall?.[2]).toBe(3840);
    expect(generateProxyCall?.[3]).toBe(2160);
    expect(generateProxyCall?.[4]).toBe('proxy-video-1');
    expect(generateProxyCall?.[5]).toEqual({ priority: 'background' });
    expect(typeof generateProxyCall?.[1]).toBe('function');
  });

  it('falls back to idle transcript status when transcript lookup fails', async () => {
    const video = makeMedia({ id: 'video-1' });
    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video]);
    indexedDbMocks.getTranscriptMediaIds.mockRejectedValue(new Error('boom'));
    proxyServiceMocks.canGenerateProxy.mockReturnValue(true);
    proxyServiceMocks.needsProxy.mockReturnValue(false);
    proxyServiceMocks.loadExistingProxies.mockResolvedValue([]);

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' });

    await useMediaLibraryStore.getState().loadMediaItems();

    const state = useMediaLibraryStore.getState();
    expect(state.transcriptStatus.get('video-1')).toBe('idle');
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-1']);
    expect(proxyServiceMocks.generateProxy).not.toHaveBeenCalled();
  });

  it('loads existing proxies for all videos and only auto-generates smart candidates', async () => {
    const manualVideo = makeMedia({
      id: 'video-manual',
      fileName: 'manual.mp4',
      width: 1280,
      height: 720,
    });
    const autoVideo = makeMedia({
      id: 'video-auto',
      fileName: 'auto.mp4',
      width: 3840,
      height: 2160,
    });
    const audio = makeMedia({
      id: 'audio-1',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
      width: 0,
      height: 0,
    });

    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([manualVideo, autoVideo, audio]);
    indexedDbMocks.getTranscriptMediaIds.mockResolvedValue(new Set());
    proxyServiceMocks.canGenerateProxy.mockImplementation((mimeType: string) => mimeType.startsWith('video/'));
    proxyServiceMocks.needsProxy.mockImplementation((width: number) => width >= 3840);
    proxyServiceMocks.loadExistingProxies.mockResolvedValue([]);
    proxyServiceMocks.hasProxy.mockReturnValue(false);

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' });

    await useMediaLibraryStore.getState().loadMediaItems();

    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('video-manual', 'proxy-video-manual');
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('video-auto', 'proxy-video-auto');
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-manual', 'video-auto']);
    expect(proxyServiceMocks.generateProxy).toHaveBeenCalledTimes(1);
    expect(proxyServiceMocks.generateProxy).toHaveBeenCalledWith(
      'video-auto',
      expect.any(Function),
      3840,
      2160,
      'proxy-video-auto',
      { priority: 'background' }
    );
  });

  it('clears proxy status and progress when proxy generation is cancelled', () => {
    useMediaLibraryStore.getState().setProxyStatus('media-1', 'generating');
    useMediaLibraryStore.getState().setProxyProgress('media-1', 0.5);

    proxyStatusListenerRef.current?.('media-1', 'idle');

    const state = useMediaLibraryStore.getState();
    expect(state.proxyStatus.has('media-1')).toBe(false);
    expect(state.proxyProgress.has('media-1')).toBe(false);
  });
});
