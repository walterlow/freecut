import { createRef, type ReactNode } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/app/state/editor';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { useSelectionStore } from '@/shared/state/selection';
import type { TimelineTrack, VideoItem } from '@/types/timeline';

import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useTimelineStore } from '../stores/timeline-store';
import { TimelineContent } from './timeline-content';

vi.mock('../hooks/use-timeline-zoom', () => ({
  useTimelineZoom: () => ({
    timeToPixels: (time: number) => time * 100,
    frameToPixels: (frame: number) => frame * 2,
    pixelsToFrame: (pixels: number) => pixels / 2,
    setZoom: vi.fn(),
    setZoomImmediate: vi.fn(),
    zoomLevel: 1,
  }),
}));

vi.mock('@/hooks/use-marquee-selection', () => {
  const INACTIVE = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
  return {
    useMarqueeSelection: () => ({
      isActive: false,
      marquee: {
        subscribe: () => () => {},
        getSnapshot: () => INACTIVE,
      },
      selectedIds: [],
    }),
  };
});

vi.mock('../hooks/use-waveform-prefetch', () => ({
  useWaveformPrefetch: () => {},
}));

vi.mock('./timeline-markers', () => ({
  TimelineMarkers: () => null,
}));

vi.mock('./timeline-playhead', () => ({
  TimelinePlayhead: () => null,
}));

vi.mock('./timeline-preview-scrubber', () => ({
  TimelinePreviewScrubber: () => null,
}));

vi.mock('./timeline-track', () => ({
  TimelineTrack: ({ track }: { track: { id: string; height: number } }) => (
    <div
      data-track-id={track.id}
      style={{ height: `${track.height}px` }}
    />
  ),
}));

vi.mock('./timeline-guidelines', () => ({
  TimelineGuidelines: () => null,
}));

vi.mock('./timeline-media-drop-zone', () => ({
  TimelineMediaDropZone: () => null,
}));

vi.mock('./track-row-frame', () => ({
  TrackRowFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TrackSectionDivider: () => null,
}));

vi.mock('@/components/marquee-overlay', () => ({
  MarqueeOverlay: () => null,
}));

const VIDEO_TRACK: TimelineTrack = {
  id: 'track-video-1',
  name: 'V1',
  kind: 'video',
  height: 72,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
};

const VIDEO_ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: VIDEO_TRACK.id,
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:clip-video-1',
  mediaId: 'media-video-1',
};

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }

  if (!globalThis.requestIdleCallback) {
    globalThis.requestIdleCallback = ((callback: IdleRequestCallback) => {
      return window.setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 0,
        });
      }, 0);
    }) as typeof requestIdleCallback;
  }

  if (!globalThis.cancelIdleCallback) {
    globalThis.cancelIdleCallback = ((id: number) => {
      window.clearTimeout(id);
    }) as typeof cancelIdleCallback;
  }
});

function resetStores() {
  useEditorStore.setState({
    linkedSelectionEnabled: true,
    transcriptionDialogDepth: 0,
  });

  useSelectionStore.setState({
    selectedItemIds: [],
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: null,
    activeTool: 'select',
    dragState: null,
    expandedKeyframeLanes: new Set<string>(),
  });

  usePlaybackStore.setState({
    currentFrame: 0,
    currentFrameEpoch: 0,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    useProxy: true,
    previewQuality: 1,
  });
  usePreviewBridgeStore.setState({
    displayedFrame: null,
    captureFrame: null,
    captureFrameImageData: null,
    captureCanvasSource: null,
  });

  useTimelineStore.setState({
    fps: 30,
    items: [VIDEO_ITEM],
    tracks: [VIDEO_TRACK],
    transitions: [],
    keyframes: [],
    markers: [],
    inPoint: null,
    outPoint: null,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
  });

  _resetViewportThrottle();
  useTimelineViewportStore.setState({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  });
}

describe('TimelineContent playback selection behavior', () => {
  beforeEach(() => {
    resetStores();
  });

  it('keeps the selected clip selected after the playhead moves past it', async () => {
    render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />);

    act(() => {
      useSelectionStore.getState().selectItems([VIDEO_ITEM.id]);
      usePlaybackStore.getState().setCurrentFrame(30);
    });

    expect(useSelectionStore.getState().selectedItemIds).toEqual([VIDEO_ITEM.id]);

    act(() => {
      usePlaybackStore.getState().setCurrentFrame(VIDEO_ITEM.from + VIDEO_ITEM.durationInFrames + 15);
    });

    await waitFor(() => {
      expect(useSelectionStore.getState().selectedItemIds).toEqual([VIDEO_ITEM.id]);
    });
  });

  it('does not update the hover scrub preview while the transcription dialog is open', async () => {
    const { container } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />);
    const scrollContainer = container.querySelector('[data-timeline-scroll-container]');

    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll container');
    }

    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      useEditorStore.setState({ transcriptionDialogDepth: 1 });
      usePlaybackStore.getState().setPreviewFrame(12);
    });

    fireEvent.mouseMove(scrollContainer, { clientX: 180, clientY: 48 });

    expect(usePlaybackStore.getState().previewFrame).toBeNull();
  });

  it('reveals the active track when selection moves to an offscreen lane', async () => {
    const videoTracks: TimelineTrack[] = [
      { ...VIDEO_TRACK, id: 'track-video-1', name: 'V1', order: 0 },
      { ...VIDEO_TRACK, id: 'track-video-2', name: 'V2', order: 1 },
      { ...VIDEO_TRACK, id: 'track-video-3', name: 'V3', order: 2 },
    ];

    useTimelineStore.setState({
      tracks: videoTracks,
      items: [],
    });

    const allTracksScrollRef = createRef<HTMLDivElement>();
    const { container } = render(
      <TimelineContent
        duration={10}
        tracks={videoTracks}
        allTracksScrollRef={allTracksScrollRef}
      />
    );
    const scrollContainer = allTracksScrollRef.current
      ?? container.querySelector('[data-track-section-scroll="video"]') as HTMLDivElement | null;
    expect(scrollContainer).toBeTruthy();

    const trackElements = Array.from(container.querySelectorAll<HTMLElement>('[data-track-id]'));
    expect(trackElements).toHaveLength(3);

    Object.defineProperty(scrollContainer!, 'clientHeight', {
      configurable: true,
      value: 100,
    });
    scrollContainer!.scrollTop = 120;
    vi.spyOn(scrollContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const trackRects = new Map<string, DOMRect>([
      ['track-video-1', {
        x: 0, y: -120, left: 0, top: -120, right: 200, bottom: -48, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
      ['track-video-2', {
        x: 0, y: -48, left: 0, top: -48, right: 200, bottom: 24, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
      ['track-video-3', {
        x: 0, y: 24, left: 0, top: 24, right: 200, bottom: 96, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
    ]);

    for (const element of trackElements) {
      const trackId = element.getAttribute('data-track-id');
      const rect = trackId ? trackRects.get(trackId) : null;
      expect(rect).toBeTruthy();
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect!);
    }

    act(() => {
      useSelectionStore.getState().setActiveTrack('track-video-1');
    });

    await waitFor(() => {
      expect(scrollContainer!.scrollTop).toBe(0);
    });
  });

  it('reveals the active track through the split-pane video scroll ref', async () => {
    const tracks: TimelineTrack[] = [
      { ...VIDEO_TRACK, id: 'track-video-1', name: 'V1', order: 0 },
      { ...VIDEO_TRACK, id: 'track-video-2', name: 'V2', order: 1 },
      { ...VIDEO_TRACK, id: 'track-video-3', name: 'V3', order: 2 },
      {
        ...VIDEO_TRACK,
        id: 'track-audio-1',
        name: 'A1',
        kind: 'audio',
        order: 3,
      },
    ];

    useTimelineStore.setState({
      tracks,
      items: [],
    });

    const videoTracksScrollRef = createRef<HTMLDivElement>();
    const audioTracksScrollRef = createRef<HTMLDivElement>();
    const { container } = render(
      <TimelineContent
        duration={10}
        tracks={tracks}
        videoTracksScrollRef={videoTracksScrollRef}
        audioTracksScrollRef={audioTracksScrollRef}
      />
    );
    const videoScrollContainer = videoTracksScrollRef.current
      ?? container.querySelector('[data-track-section-scroll="video"]') as HTMLDivElement | null;
    const audioScrollContainer = audioTracksScrollRef.current
      ?? container.querySelector('[data-track-section-scroll="audio"]') as HTMLDivElement | null;
    expect(videoScrollContainer).toBeTruthy();
    expect(audioScrollContainer).toBeTruthy();

    const videoTrackElements = Array.from(
      videoScrollContainer!.querySelectorAll<HTMLElement>('[data-track-id]')
    );
    expect(videoTrackElements).toHaveLength(3);

    Object.defineProperty(videoScrollContainer!, 'clientHeight', {
      configurable: true,
      value: 100,
    });
    videoScrollContainer!.scrollTop = 120;
    audioScrollContainer!.scrollTop = 55;
    vi.spyOn(videoScrollContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const trackRects = new Map<string, DOMRect>([
      ['track-video-1', {
        x: 0, y: -120, left: 0, top: -120, right: 200, bottom: -48, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
      ['track-video-2', {
        x: 0, y: -48, left: 0, top: -48, right: 200, bottom: 24, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
      ['track-video-3', {
        x: 0, y: 24, left: 0, top: 24, right: 200, bottom: 96, width: 200, height: 72, toJSON: () => ({})
      } as DOMRect],
    ]);

    for (const element of videoTrackElements) {
      const trackId = element.getAttribute('data-track-id');
      const rect = trackId ? trackRects.get(trackId) : null;
      expect(rect).toBeTruthy();
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect!);
    }

    act(() => {
      useSelectionStore.getState().setActiveTrack('track-video-1');
    });

    await waitFor(() => {
      expect(videoScrollContainer!.scrollTop).toBe(0);
    });
    expect(audioScrollContainer!.scrollTop).toBe(55);
  });

  it('does not clear previewFrame on ruler mousedown before the ruler handler runs', () => {
    const { container } = render(<TimelineContent duration={10} tracks={[VIDEO_TRACK]} />);

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(24);
    });

    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement | null;
    expect(ruler).toBeTruthy();

    fireEvent.mouseDown(ruler!, { button: 0 });

    expect(usePlaybackStore.getState().previewFrame).toBe(24);
  });
});
