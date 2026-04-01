import type { ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/state/editor';
import { usePlaybackStore } from '@/shared/state/playback';
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

vi.mock('@/hooks/use-marquee-selection', () => ({
  useMarqueeSelection: () => ({
    marqueeState: {
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    },
  }),
}));

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
  TimelineTrack: () => null,
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
    displayedFrame: null,
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
    captureFrame: null,
    captureFrameImageData: null,
    captureCanvasSource: null,
    useProxy: true,
    previewQuality: 1,
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
});
