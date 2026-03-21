import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoSourcePool } from './VideoSourcePool';

type MutableVideoElement = HTMLVideoElement & {
  __setReadyState: (value: number) => void;
  __setCurrentTime: (value: number) => void;
  __setPaused: (value: boolean) => void;
};

function installVideoElementMocks() {
  const createdVideos: MutableVideoElement[] = [];
  const originalCreateElement = document.createElement.bind(document);

  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName) as HTMLElement;
    if (tagName !== 'video') {
      return element;
    }

    const video = element as MutableVideoElement;
    let readyStateValue = 0;
    let currentTimeValue = 0;
    let pausedValue = true;

    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => readyStateValue,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTimeValue,
      set: (value: number) => {
        currentTimeValue = value;
      },
    });
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get: () => 120,
    });
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      get: () => 1920,
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      get: () => 1080,
    });
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => pausedValue,
    });

    video.__setReadyState = (value: number) => {
      readyStateValue = value;
    };
    video.__setCurrentTime = (value: number) => {
      currentTimeValue = value;
    };
    video.__setPaused = (value: boolean) => {
      pausedValue = value;
    };

    video.load = vi.fn(() => {
      queueMicrotask(() => {
        readyStateValue = 2;
        video.dispatchEvent(new Event('loadedmetadata'));
        video.dispatchEvent(new Event('canplay'));
      });
    });
    video.play = vi.fn(async () => {
      pausedValue = false;
    });
    video.pause = vi.fn(() => {
      pausedValue = true;
    });

    createdVideos.push(video);
    return video;
  }) as typeof document.createElement);

  return {
    createdVideos,
    restore: () => createElementSpy.mockRestore(),
  };
}

describe('VideoSourcePool', () => {
  let videoMocks: ReturnType<typeof installVideoElementMocks>;

  beforeEach(() => {
    videoMocks = installVideoElementMocks();
  });

  afterEach(() => {
    videoMocks.restore();
    vi.useRealTimers();
  });

  it('ensures ready lanes and warms idle elements near transition boundaries', async () => {
    const pool = new VideoSourcePool();

    await pool.ensureReadyLanes('blob:test-video', 2, {
      targetTimeSeconds: [5, 12],
      warmDecode: true,
    });

    expect(pool.getStats()).toEqual({
      sourceCount: 1,
      totalElements: 2,
      activeClips: 0,
    });
    expect(videoMocks.createdVideos).toHaveLength(2);
    expect(videoMocks.createdVideos[0]!.currentTime).toBe(5);
    expect(videoMocks.createdVideos[1]!.currentTime).toBe(12);
    expect(videoMocks.createdVideos[0]!.play).toHaveBeenCalledTimes(1);
    expect(videoMocks.createdVideos[1]!.play).toHaveBeenCalledTimes(1);
  });

  it('reuses a clip assignment during sticky release windows', async () => {
    vi.useFakeTimers();
    const pool = new VideoSourcePool();

    const firstElement = pool.acquireForClip('clip-1', 'blob:test-video');
    expect(firstElement).not.toBeNull();

    pool.releaseClip('clip-1', { delayMs: 400 });
    await vi.advanceTimersByTimeAsync(200);

    const reacquiredElement = pool.acquireForClip('clip-1', 'blob:test-video');
    expect(reacquiredElement).toBe(firstElement);

    await vi.advanceTimersByTimeAsync(500);
    expect(pool.getClipElement('clip-1')).toBe(firstElement);

    pool.releaseClip('clip-1');
    expect(pool.getClipElement('clip-1')).toBeNull();
  });
});
