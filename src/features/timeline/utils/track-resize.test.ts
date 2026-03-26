import { describe, expect, it } from 'vitest';
import { TRACK_SECTION_DIVIDER_HEIGHT, MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../constants';
import {
  clampSectionDividerPosition,
  clampTrackHeight,
  getMinimumTrackSectionSpacerHeight,
  getTrackSectionLayout,
  resizeTrackInList,
} from './track-resize';

function createTrack(id: string, kind: 'video' | 'audio', height: number) {
  return {
    id,
    name: id.toUpperCase(),
    kind,
    order: 0,
    height,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  };
}

describe('track-resize', () => {
  it('clamps resized track heights into the supported range', () => {
    expect(clampTrackHeight(MIN_TRACK_HEIGHT - 20)).toBe(MIN_TRACK_HEIGHT);
    expect(clampTrackHeight(MAX_TRACK_HEIGHT + 20)).toBe(MAX_TRACK_HEIGHT);
    expect(clampTrackHeight(96.6)).toBe(97);
  });

  it('updates only the requested track and preserves unchanged arrays', () => {
    const tracks = [
      createTrack('v1', 'video', 72),
      createTrack('a1', 'audio', 72),
    ];

    const resizedTracks = resizeTrackInList(tracks, 'a1', 118);

    expect(resizedTracks).not.toBe(tracks);
    expect(resizedTracks[0]).toBe(tracks[0]);
    expect(resizedTracks[1]).toMatchObject({ id: 'a1', height: 118 });
    expect(resizeTrackInList(tracks, 'missing', 118)).toBe(tracks);
    expect(resizeTrackInList(tracks, 'v1', 72)).toBe(tracks);
  });

  it('keeps the A/V spacer slightly taller than the title bar', () => {
    expect(getMinimumTrackSectionSpacerHeight(24)).toBe(36);
    expect(getMinimumTrackSectionSpacerHeight(26)).toBe(39);
  });

  it('lets manual divider drags fully collapse either spacer', () => {
    const viewportHeight = 420;
    const trackTitleBarHeight = 24;
    const tracks = [
      createTrack('v1', 'video', 100),
      createTrack('a1', 'audio', 100),
    ];

    const topCollapsedLayout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: 0,
      trackTitleBarHeight,
    });
    const bottomCollapsedLayout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: viewportHeight,
      trackTitleBarHeight,
    });

    expect(topCollapsedLayout.videoPaneHeight).toBe(0);
    expect(topCollapsedLayout.audioPaneHeight).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT);
    expect(bottomCollapsedLayout.videoPaneHeight).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT);
    expect(bottomCollapsedLayout.audioPaneHeight).toBe(0);
  });

  it('defaults the split around the section content heights', () => {
    const viewportHeight = 420;
    const trackTitleBarHeight = 24;
    const tracks = [
      createTrack('v1', 'video', 120),
      createTrack('a1', 'audio', 80),
    ];

    const layout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: null,
      trackTitleBarHeight,
    });

    expect(layout.videoPaneHeight).toBe(229);
    expect(layout.audioPaneHeight).toBe(189);
  });

  it('keeps a manual divider position stable when track heights change', () => {
    const viewportHeight = 420;
    const trackTitleBarHeight = 24;
    const tracks = [
      createTrack('v1', 'video', 100),
      createTrack('a1', 'audio', 100),
    ];
    const resizedTracks = resizeTrackInList(tracks, 'v1', 160);

    const nextLayout = getTrackSectionLayout({
      viewportHeight,
      tracks: resizedTracks,
      sectionDividerPosition: 150,
      trackTitleBarHeight,
    });

    expect(nextLayout.videoPaneHeight).toBe(150);
    expect(nextLayout.audioPaneHeight).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT - 150);
  });

  it('clamps divider positions to the available pane height', () => {
    const viewportHeight = 420;
    const tracks = [
      createTrack('v1', 'video', 100),
      createTrack('a1', 'audio', 100),
    ];

    expect(clampSectionDividerPosition({
      viewportHeight,
      tracks,
      requestedDividerPosition: -20,
    })).toBe(0);
    expect(clampSectionDividerPosition({
      viewportHeight,
      tracks,
      requestedDividerPosition: viewportHeight,
    })).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT);
  });
});
