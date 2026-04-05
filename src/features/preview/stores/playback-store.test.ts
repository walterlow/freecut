import { describe, expect, it, beforeEach } from 'vitest';
import { usePlaybackStore } from './playback-store';

describe('playback-store', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 0,
      displayedFrame: null,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewItemId: null,
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
      previewQuality: 1,
    });
  });

  it('has correct initial state', () => {
    const state = usePlaybackStore.getState();
    expect(state.currentFrame).toBe(0);
    expect(state.isPlaying).toBe(false);
    expect(state.playbackRate).toBe(1);
    expect(state.loop).toBe(false);
    expect(state.volume).toBe(1);
    expect(state.muted).toBe(false);
    expect(state.zoom).toBe(-1);
    expect(state.previewFrame).toBe(null);
    expect(state.displayedFrame).toBe(null);
  });

  describe('frame navigation', () => {
    it('sets current frame', () => {
      usePlaybackStore.getState().setCurrentFrame(100);
      expect(usePlaybackStore.getState().currentFrame).toBe(100);
    });

    it('normalizes negative frames to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(-10);
      expect(usePlaybackStore.getState().currentFrame).toBe(0);
    });

    it('rounds fractional frames', () => {
      usePlaybackStore.getState().setCurrentFrame(10.7);
      expect(usePlaybackStore.getState().currentFrame).toBe(11);
    });

    it('normalizes NaN to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(NaN);
      expect(usePlaybackStore.getState().currentFrame).toBe(0);
    });

    it('normalizes Infinity to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(Infinity);
      expect(usePlaybackStore.getState().currentFrame).toBe(0);
    });

    it('avoids state update when frame is unchanged', () => {
      usePlaybackStore.getState().setCurrentFrame(50);
      const stateA = usePlaybackStore.getState();
      usePlaybackStore.getState().setCurrentFrame(50);
      const stateB = usePlaybackStore.getState();
      // Same reference means no unnecessary re-renders
      expect(stateA).toBe(stateB);
    });
  });

  describe('playback controls', () => {
    it('plays and pauses', () => {
      usePlaybackStore.getState().play();
      expect(usePlaybackStore.getState().isPlaying).toBe(true);

      usePlaybackStore.getState().pause();
      expect(usePlaybackStore.getState().isPlaying).toBe(false);
    });

    it('toggles play/pause', () => {
      usePlaybackStore.getState().togglePlayPause();
      expect(usePlaybackStore.getState().isPlaying).toBe(true);

      usePlaybackStore.getState().togglePlayPause();
      expect(usePlaybackStore.getState().isPlaying).toBe(false);
    });

    it('avoids state update when already playing/paused', () => {
      const stateA = usePlaybackStore.getState();
      usePlaybackStore.getState().pause(); // already paused
      const stateB = usePlaybackStore.getState();
      expect(stateA).toBe(stateB);

      usePlaybackStore.getState().play();
      const stateC = usePlaybackStore.getState();
      usePlaybackStore.getState().play(); // already playing
      const stateD = usePlaybackStore.getState();
      expect(stateC).toBe(stateD);
    });
  });

  describe('playback rate', () => {
    it('sets playback rate', () => {
      usePlaybackStore.getState().setPlaybackRate(2);
      expect(usePlaybackStore.getState().playbackRate).toBe(2);

      usePlaybackStore.getState().setPlaybackRate(0.5);
      expect(usePlaybackStore.getState().playbackRate).toBe(0.5);
    });
  });

  describe('loop', () => {
    it('toggles loop', () => {
      usePlaybackStore.getState().toggleLoop();
      expect(usePlaybackStore.getState().loop).toBe(true);

      usePlaybackStore.getState().toggleLoop();
      expect(usePlaybackStore.getState().loop).toBe(false);
    });
  });

  describe('volume and mute', () => {
    it('sets volume', () => {
      usePlaybackStore.getState().setVolume(0.5);
      expect(usePlaybackStore.getState().volume).toBe(0.5);
    });

    it('toggles mute', () => {
      usePlaybackStore.getState().toggleMute();
      expect(usePlaybackStore.getState().muted).toBe(true);

      usePlaybackStore.getState().toggleMute();
      expect(usePlaybackStore.getState().muted).toBe(false);
    });
  });

  describe('zoom', () => {
    it('sets zoom level', () => {
      usePlaybackStore.getState().setZoom(150);
      expect(usePlaybackStore.getState().zoom).toBe(150);
    });

    it('supports auto-fit value (-1)', () => {
      usePlaybackStore.getState().setZoom(-1);
      expect(usePlaybackStore.getState().zoom).toBe(-1);
    });
  });

  describe('preview quality', () => {
    it('defaults to full quality', () => {
      expect(usePlaybackStore.getState().previewQuality).toBe(1);
    });

    it('stores user-selected preview quality', () => {
      usePlaybackStore.getState().setPreviewQuality(0.5);
      expect(usePlaybackStore.getState().previewQuality).toBe(0.5);

      usePlaybackStore.getState().setPreviewQuality(0.33);
      expect(usePlaybackStore.getState().previewQuality).toBe(0.33);

      usePlaybackStore.getState().setPreviewQuality(0.25);
      expect(usePlaybackStore.getState().previewQuality).toBe(0.25);

      usePlaybackStore.getState().setPreviewQuality(1);
      expect(usePlaybackStore.getState().previewQuality).toBe(1);
    });
  });

  describe('preview frame', () => {
    it('sets preview frame for hover', () => {
      usePlaybackStore.getState().setPreviewFrame(42);
      expect(usePlaybackStore.getState().previewFrame).toBe(42);
    });

    it('clears preview frame', () => {
      usePlaybackStore.getState().setPreviewFrame(42);
      usePlaybackStore.getState().setPreviewFrame(null);
      expect(usePlaybackStore.getState().previewFrame).toBe(null);
    });

    it('normalizes preview frame values', () => {
      usePlaybackStore.getState().setPreviewFrame(-5);
      expect(usePlaybackStore.getState().previewFrame).toBe(0);
    });

    it('avoids state update when preview frame is unchanged', () => {
      usePlaybackStore.getState().setPreviewFrame(42);
      const stateA = usePlaybackStore.getState();
      usePlaybackStore.getState().setPreviewFrame(42);
      const stateB = usePlaybackStore.getState();
      expect(stateA).toBe(stateB);
    });

    it('updates currentFrame and previewFrame atomically for scrub frames', () => {
      usePlaybackStore.getState().setScrubFrame(42, 'item-1');
      const state = usePlaybackStore.getState();
      expect(state.currentFrame).toBe(42);
      expect(state.previewFrame).toBe(42);
      expect(state.previewItemId).toBe('item-1');
    });

    it('commits previewFrame into currentFrame and clears preview state atomically', () => {
      usePlaybackStore.getState().setScrubFrame(42, 'item-1');
      usePlaybackStore.getState().commitPreviewFrame();

      const state = usePlaybackStore.getState();
      expect(state.currentFrame).toBe(42);
      expect(state.previewFrame).toBe(null);
      expect(state.previewItemId).toBe(null);
    });

    it('clears preview state without disturbing the current or displayed frame', () => {
      usePlaybackStore.getState().setCurrentFrame(42);
      usePlaybackStore.getState().setDisplayedFrame(41);
      usePlaybackStore.getState().setPreviewFrame(48, 'item-1');
      usePlaybackStore.getState().clearPreviewFrame();

      const state = usePlaybackStore.getState();
      expect(state.currentFrame).toBe(42);
      expect(state.displayedFrame).toBe(41);
      expect(state.previewFrame).toBe(null);
      expect(state.previewItemId).toBe(null);
    });

    it('clears preview state even when currentFrame already matches the preview frame', () => {
      usePlaybackStore.getState().setCurrentFrame(42);
      usePlaybackStore.getState().setPreviewFrame(42, 'item-1');
      usePlaybackStore.getState().commitPreviewFrame();

      const state = usePlaybackStore.getState();
      expect(state.currentFrame).toBe(42);
      expect(state.previewFrame).toBe(null);
      expect(state.previewItemId).toBe(null);
    });

    it('performs transport seeks atomically and clears preview/presented state', () => {
      usePlaybackStore.getState().setScrubFrame(42, 'item-1');
      usePlaybackStore.getState().setDisplayedFrame(41);
      usePlaybackStore.getState().seekTimelineFrame(90);

      const state = usePlaybackStore.getState();
      expect(state.currentFrame).toBe(90);
      expect(state.previewFrame).toBe(null);
      expect(state.displayedFrame).toBe(null);
      expect(state.previewItemId).toBe(null);
    });

    it('normalizes transport seek frames', () => {
      usePlaybackStore.getState().seekTimelineFrame(-5);
      expect(usePlaybackStore.getState().currentFrame).toBe(0);
    });
  });
});
