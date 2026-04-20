import { describe, expect, it } from 'vitest';
import type { Project, ProjectTimeline } from '@/types/project';
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index';

function createTrack(id: string, order: number, kind: 'video' | 'audio'): ProjectTimeline['tracks'][number] {
  return {
    id,
    name: id,
    kind,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
  };
}

function createBaseProject(timeline: ProjectTimeline): Project {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 7,
    metadata: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline,
  };
}

describe('migrateProject transition normalization', () => {
  it('converts legacy overlap transitions back to adjacent cuts and restores linked audio alignment', () => {
    const project = createBaseProject({
      tracks: [
        createTrack('video-track', 0, 'video'),
        createTrack('audio-track', 1, 'audio'),
      ],
      items: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'video-track',
          from: 0,
          durationInFrames: 50,
          label: 'Video 1',
          src: 'video-1.mp4',
          mediaId: 'media-1',
          linkedGroupId: 'group-1',
          sourceStart: 0,
          sourceEnd: 80,
          sourceDuration: 100,
        },
        {
          id: 'video-2',
          type: 'video',
          trackId: 'video-track',
          from: 30,
          durationInFrames: 50,
          label: 'Video 2',
          src: 'video-2.mp4',
          mediaId: 'media-2',
          linkedGroupId: 'group-2',
          sourceStart: 20,
          sourceEnd: 70,
          sourceDuration: 100,
        },
        {
          id: 'video-3',
          type: 'video',
          trackId: 'video-track',
          from: 80,
          durationInFrames: 30,
          label: 'Video 3',
          src: 'video-3.mp4',
          mediaId: 'media-3',
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
        },
        {
          id: 'audio-1',
          type: 'audio',
          trackId: 'audio-track',
          from: 0,
          durationInFrames: 50,
          label: 'Audio 1',
          src: 'audio-1.wav',
          mediaId: 'media-1',
          linkedGroupId: 'group-1',
          sourceStart: 0,
          sourceEnd: 80,
          sourceDuration: 100,
        },
        {
          id: 'audio-2',
          type: 'audio',
          trackId: 'audio-track',
          from: 30,
          durationInFrames: 50,
          label: 'Audio 2',
          src: 'audio-2.wav',
          mediaId: 'media-2',
          linkedGroupId: 'group-2',
          sourceStart: 20,
          sourceEnd: 70,
          sourceDuration: 100,
        },
        {
          id: 'audio-3',
          type: 'audio',
          trackId: 'audio-track',
          from: 80,
          durationInFrames: 30,
          label: 'Audio 3',
          src: 'audio-3.wav',
          mediaId: 'media-3',
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
        },
      ],
      transitions: [{
        id: 'transition-1',
        type: 'crossfade',
        leftClipId: 'video-1',
        rightClipId: 'video-2',
        trackId: 'video-track',
        durationInFrames: 20,
        presentation: 'fade',
        timing: 'linear',
        alignment: 0.5,
      }],
    });

    const result = migrateProject(project);
    const itemById = Object.fromEntries(result.project.timeline!.items.map((item) => [item.id, item]));

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(itemById['video-2']?.from).toBe(50);
    expect(itemById['video-3']?.from).toBe(100);
    expect(itemById['audio-2']?.from).toBe(50);
    expect(itemById['audio-3']?.from).toBe(100);
    expect(result.project.timeline?.transitions).toEqual([
      expect.objectContaining({ id: 'transition-1', durationInFrames: 20 }),
    ]);
  });

  it('drops legacy overlap transitions that do not have enough source handle after normalization', () => {
    const project = createBaseProject({
      tracks: [createTrack('video-track', 0, 'video')],
      items: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'video-track',
          from: 0,
          durationInFrames: 50,
          label: 'Video 1',
          src: 'video-1.mp4',
          mediaId: 'media-1',
          sourceStart: 0,
          sourceEnd: 50,
          sourceDuration: 50,
        },
        {
          id: 'video-2',
          type: 'video',
          trackId: 'video-track',
          from: 30,
          durationInFrames: 50,
          label: 'Video 2',
          src: 'video-2.mp4',
          mediaId: 'media-2',
          sourceStart: 0,
          sourceEnd: 50,
          sourceDuration: 50,
        },
      ],
      transitions: [{
        id: 'transition-1',
        type: 'crossfade',
        leftClipId: 'video-1',
        rightClipId: 'video-2',
        trackId: 'video-track',
        durationInFrames: 20,
        presentation: 'fade',
        timing: 'linear',
        alignment: 0.5,
      }],
    });

    const result = migrateProject(project);
    const itemById = Object.fromEntries(result.project.timeline!.items.map((item) => [item.id, item]));

    expect(itemById['video-2']?.from).toBe(50);
    expect(result.project.timeline?.transitions).toEqual([]);
  });

  it('normalizes legacy overlap transitions inside sub-compositions', () => {
    const project = createBaseProject({
      tracks: [createTrack('root-video-track', 0, 'video')],
      items: [],
      transitions: [],
      compositions: [{
        id: 'comp-1',
        name: 'Comp 1',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 120,
        tracks: [createTrack('comp-video-track', 0, 'video')],
        items: [
          {
            id: 'comp-video-1',
            type: 'video',
            trackId: 'comp-video-track',
            from: 0,
            durationInFrames: 40,
            label: 'Comp Video 1',
            src: 'comp-video-1.mp4',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 80,
          },
          {
            id: 'comp-video-2',
            type: 'video',
            trackId: 'comp-video-track',
            from: 20,
            durationInFrames: 40,
            label: 'Comp Video 2',
            src: 'comp-video-2.mp4',
            sourceStart: 20,
            sourceEnd: 60,
            sourceDuration: 80,
          },
        ],
        transitions: [{
          id: 'comp-transition-1',
          type: 'crossfade',
          leftClipId: 'comp-video-1',
          rightClipId: 'comp-video-2',
          trackId: 'comp-video-track',
          durationInFrames: 20,
          presentation: 'fade',
          timing: 'linear',
          alignment: 0.5,
        }],
      }],
    });

    const result = migrateProject(project);
    const composition = result.project.timeline?.compositions?.[0];
    const itemById = Object.fromEntries((composition?.items ?? []).map((item) => [item.id, item]));

    expect(itemById['comp-video-2']?.from).toBe(40);
    expect(composition?.transitions).toEqual([
      expect.objectContaining({ id: 'comp-transition-1', durationInFrames: 20 }),
    ]);
  });

  it('renumbers legacy track orders and backfills missing origin ids', () => {
    const project = createBaseProject({
      tracks: [
        createTrack('video-top', -2, 'video'),
        createTrack('video-main', 4, 'video'),
        createTrack('audio-main', 9, 'audio'),
      ],
      items: [
        {
          id: 'composition-1',
          type: 'composition',
          trackId: 'video-main',
          from: 0,
          durationInFrames: 60,
          label: 'Legacy comp',
          compositionId: 'comp-1',
          compositionWidth: 1920,
          compositionHeight: 1080,
        },
      ],
      transitions: [],
      compositions: [{
        id: 'comp-1',
        name: 'Comp 1',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
        tracks: [
          createTrack('comp-video', 7, 'video'),
          createTrack('comp-audio', 12, 'audio'),
        ],
        items: [
          {
            id: 'comp-video-1',
            type: 'video',
            trackId: 'comp-video',
            from: 0,
            durationInFrames: 60,
            label: 'Comp Video',
            src: 'comp-video.mp4',
            mediaId: 'media-1',
          },
        ],
      }],
    });

    const result = migrateProject(project);

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.project.timeline?.tracks.map((track) => ({ id: track.id, order: track.order }))).toEqual([
      { id: 'video-top', order: 0 },
      { id: 'video-main', order: 1 },
      { id: 'audio-main', order: 2 },
    ]);
    expect(result.project.timeline?.items[0]?.originId).toBe('composition-1');
    expect(result.project.timeline?.compositions?.[0]?.tracks.map((track) => ({ id: track.id, order: track.order }))).toEqual([
      { id: 'comp-video', order: 0 },
      { id: 'comp-audio', order: 1 },
    ]);
    expect(result.project.timeline?.compositions?.[0]?.items[0]?.originId).toBe('comp-video-1');
  });

  it('preserves legacy array order when tracks are missing explicit order values', () => {
    const project = createBaseProject({
      tracks: [
        { ...createTrack('video-top', 0, 'video'), order: undefined } as unknown as ProjectTimeline['tracks'][number],
        { ...createTrack('audio-main', 1, 'audio'), order: undefined } as unknown as ProjectTimeline['tracks'][number],
        { ...createTrack('video-overlay', 2, 'video'), order: undefined } as unknown as ProjectTimeline['tracks'][number],
      ],
      items: [],
      transitions: [],
    });

    const result = migrateProject(project);

    expect(result.project.timeline?.tracks.map((track) => track.id)).toEqual([
      'video-top',
      'audio-main',
      'video-overlay',
    ]);
    expect(result.project.timeline?.tracks.map((track) => track.order)).toEqual([0, 1, 2]);
  });
});
