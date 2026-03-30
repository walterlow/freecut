import { describe, expect, it } from 'vitest';
import { validateSnapshotData } from './json-import-service';

describe('validateSnapshotData', () => {
  it('accepts legacy snapshots that need migration instead of rejecting them up front', async () => {
    const result = await validateSnapshotData({
      version: '1.0',
      exportedAt: '2026-03-30T11:29:25.781Z',
      editorVersion: '1.0.0',
      project: {
        id: 'legacy-project',
        name: 'Legacy Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 0,
        schemaVersion: 8,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: '#000000',
        },
        timeline: {
          tracks: [
            {
              id: 'track-video',
              name: 'V1',
              kind: 'video',
              height: 100,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              volume: 0,
              order: -1,
            },
          ],
          items: [
            {
              id: 'item-shape',
              type: 'shape',
              trackId: 'track-video',
              from: 0,
              durationInFrames: 30,
              label: 'Path Shape',
              shapeType: 'path',
              fillColor: '#ffffff',
              pathVertices: [
                {
                  position: [0, 0],
                  inHandle: [0, 0],
                  outHandle: [0, 0],
                },
                {
                  position: [1, 0],
                  inHandle: [0, 0],
                  outHandle: [0, 0],
                },
              ],
              effects: [
                {
                  id: 'effect-1',
                  effect: {
                    type: 'gpu-effect',
                    gpuEffectType: 'gpu-halftone',
                    params: {
                      intensity: 0.4,
                      patternType: 'dots',
                    },
                  },
                  enabled: true,
                },
              ],
            },
          ],
          zoomLevel: 0.025,
          scrollPosition: 0,
          compositions: [
            {
              id: 'comp-1',
              name: 'Comp 1',
              fps: 30,
              width: 1920,
              height: 1080,
              durationInFrames: 30,
              tracks: [
                {
                  id: 'comp-track',
                  name: 'V1',
                  kind: 'video',
                  height: 100,
                  locked: false,
                  visible: true,
                  muted: false,
                  solo: false,
                  volume: 0,
                  order: 5,
                },
              ],
              items: [
                {
                  id: 'comp-item',
                  type: 'video',
                  trackId: 'comp-track',
                  from: 0,
                  durationInFrames: 30,
                  label: 'Comp Clip',
                  src: 'blob:http://localhost:5173/example',
                },
              ],
            },
          ],
        },
      },
      mediaReferences: [],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: 'project.schemaVersion',
        message: expect.stringContaining('upgraded'),
      }),
    );
  });
});
