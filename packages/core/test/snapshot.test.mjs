import { describe, expect, it } from 'vitest';
import {
  SnapshotParseError,
  parseSnapshot,
  serializeSnapshot,
  toSnapshot,
} from '../src/index.mjs';

describe('snapshot serialization', () => {
  it('serializes and parses snapshots', () => {
    const project = {
      id: 'project-1',
      name: 'Core Project',
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: { tracks: [], items: [] },
    };

    const snapshot = toSnapshot(
      {
        project,
        mediaReferences: [{ id: 'media-1', fileName: 'clip.mp4' }],
      },
      {
        exportedAt: '2026-01-01T00:00:00.000Z',
        editorVersion: 'test-editor',
      },
    );

    expect(snapshot).toMatchObject({
      version: '1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      editorVersion: 'test-editor',
      project,
      mediaReferences: [{ id: 'media-1', fileName: 'clip.mp4' }],
    });

    const pretty = serializeSnapshot({ project }, { exportedAt: snapshot.exportedAt });
    expect(pretty).toContain('\n  "version": "1.0"');

    const compact = serializeSnapshot({ project }, { pretty: false, exportedAt: snapshot.exportedAt });
    expect(compact).not.toContain('\n');
    expect(parseSnapshot(compact).project.name).toBe('Core Project');
  });

  it('throws SnapshotParseError for malformed snapshots', () => {
    expect(() => parseSnapshot('{')).toThrow(SnapshotParseError);
    expect(() => parseSnapshot('null')).toThrow(SnapshotParseError);
    expect(() => parseSnapshot(JSON.stringify({ project: {} }))).toThrow(/version/);
    expect(() => serializeSnapshot(null)).toThrow(/snapshot source/);
  });
});
