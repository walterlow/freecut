import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SnapshotParseError,
  buildRange,
  collectProjectMediaUsage,
  deterministicIds,
  lintSnapshot,
  loadWorkspaceRenderSource,
  parseSnapshot,
  framesToSeconds,
  randomIds,
  resolveProjectRenderRange,
  serializeSnapshot,
  secondsToFrames,
  toSnapshot,
  validateSnapshot,
} from '../src/index.mjs';

let tmp;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'freecut-core-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('core workspace planning', () => {
  it('generates deterministic and random ids', () => {
    const ids = deterministicIds();
    expect(ids('project')).toBe('project-1');
    expect(ids('track')).toBe('track-1');
    expect(ids('project')).toBe('project-2');

    const seeded = deterministicIds(10);
    expect(seeded('item')).toBe('item-11');
    expect(randomIds('media')).toMatch(/^media-[a-f0-9]{16}$/);
  });

  it('converts between seconds and project frames', () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(1 / 30, 30)).toBe(1);
    expect(secondsToFrames(0.5, 60)).toBe(30);
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(() => secondsToFrames(-1, 30)).toThrow(RangeError);
    expect(() => secondsToFrames(1, 0)).toThrow(RangeError);
    expect(() => secondsToFrames(Infinity, 30)).toThrow(RangeError);
  });

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

  it('validates snapshots and reports timeline findings', () => {
    const valid = {
      version: '1.0',
      project: {
        metadata: { width: 1920, height: 1080, fps: 30 },
        timeline: {
          tracks: [{ id: 'track-1', name: 'V1', order: 0 }],
          items: [{
            id: 'title-1',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            text: 'hello',
          }],
        },
      },
      mediaReferences: [],
    };

    expect(validateSnapshot(valid)).toMatchObject({ ok: true, errorCount: 0 });

    const broken = structuredClone(valid);
    broken.project.timeline.items[0].trackId = 'missing-track';
    broken.project.timeline.items[0].durationInFrames = 0;
    broken.project.timeline.items[0].text = '';

    const result = lintSnapshot(broken);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['item_track_missing', 'item_duration_invalid', 'text_required']),
    );
  });

  it('builds seconds and frame render ranges from CLI values', () => {
    expect(buildRange({ start: '1.5', duration: '2' })).toEqual({
      startSeconds: 1.5,
      durationSeconds: 2,
    });
    expect(buildRange({ 'in-frame': '12', 'out-frame': '42' })).toEqual({
      inFrame: 12,
      outFrame: 42,
    });
    expect(() => buildRange({ start: '0', 'out-frame': '30' })).toThrow(/either seconds range flags/);
    expect(() => buildRange({ start: '2', end: '1' })).toThrow(/--start must be before --end/);
  });

  it('resolves requested ranges before timeline IO markers', () => {
    const project = {
      metadata: { fps: 30 },
      timeline: { inPoint: 30, outPoint: 90 },
    };

    expect(resolveProjectRenderRange(project, null, false)).toEqual({ inFrame: 30, outFrame: 90 });
    expect(resolveProjectRenderRange(project, { startSeconds: 0, durationSeconds: 1 }, false)).toEqual({
      inFrame: 0,
      outFrame: 30,
    });
    expect(resolveProjectRenderRange(project, { inFrame: 12, outFrame: 24 }, false)).toEqual({
      inFrame: 12,
      outFrame: 24,
    });
    expect(resolveProjectRenderRange(project, { startSeconds: 0, durationSeconds: 1 }, true)).toBeNull();
  });

  it('collects media usage for the effective render range', () => {
    const project = {
      timeline: {
        items: [
          {
            id: 'early',
            type: 'video',
            mediaId: 'media-early',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
          },
          {
            id: 'late',
            type: 'audio',
            mediaId: 'media-late',
            trackId: 'track-1',
            from: 90,
            durationInFrames: 30,
          },
          {
            id: 'title',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 120,
          },
        ],
      },
    };

    const usage = collectProjectMediaUsage(project, { inFrame: 0, outFrame: 60 });
    expect([...usage.keys()]).toEqual(['media-early']);
    expect(usage.get('media-early')).toMatchObject({
      mediaId: 'media-early',
      itemCount: 1,
      items: [{ id: 'early', type: 'video', trackId: 'track-1' }],
    });
  });

  it('loads a workspace render source with deterministic media readiness', async () => {
    const workspace = join(tmp, 'render-source');
    const projectId = 'project-plan';
    const readyMediaId = 'media-ready';
    const lateMediaId = 'media-late';
    await mkdir(join(workspace, 'projects', projectId), { recursive: true });
    await mkdir(join(workspace, 'media', readyMediaId), { recursive: true });
    await mkdir(join(workspace, 'media', lateMediaId), { recursive: true });

    const project = {
      id: projectId,
      name: 'Plan Project',
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        items: [
          {
            id: 'clip-ready',
            type: 'video',
            mediaId: readyMediaId,
            trackId: 'track-1',
            from: 0,
            durationInFrames: 150,
          },
          {
            id: 'clip-late',
            type: 'video',
            mediaId: lateMediaId,
            trackId: 'track-1',
            from: 300,
            durationInFrames: 150,
          },
        ],
      },
    };
    await writeFile(join(workspace, 'projects', projectId, 'project.json'), JSON.stringify(project), 'utf8');
    await writeFile(join(workspace, 'index.json'), JSON.stringify({
      projects: [{ id: projectId, name: project.name }],
    }), 'utf8');
    await writeFile(join(workspace, 'media', readyMediaId, 'metadata.json'), JSON.stringify({
      id: readyMediaId,
      fileName: 'ready.mp4',
      mimeType: 'video/mp4',
      keyframeTimestamps: [0, 1],
    }), 'utf8');
    await writeFile(join(workspace, 'media', readyMediaId, 'ready.mp4'), 'media', 'utf8');
    await writeFile(join(workspace, 'media', lateMediaId, 'metadata.json'), JSON.stringify({
      id: lateMediaId,
      fileName: 'late.mp4',
      mimeType: 'video/mp4',
    }), 'utf8');

    const source = await loadWorkspaceRenderSource(
      workspace,
      { project: 'Plan Project' },
      { range: { startSeconds: 0, durationSeconds: 5 } },
    );

    expect(source.project.id).toBe(projectId);
    expect(source.effectiveRange).toEqual({ inFrame: 0, outFrame: 150 });
    expect(source.requiredMedia).toEqual([{
      mediaId: readyMediaId,
      fileName: 'ready.mp4',
      mimeType: 'video/mp4',
      fileSize: null,
      sourceFile: resolve(join(workspace, 'media', readyMediaId, 'ready.mp4')),
      sourceExists: true,
      itemCount: 1,
    }]);
    expect(Object.keys(source.mediaSources)).toEqual([readyMediaId]);
    expect(source.mediaSources[readyMediaId].keyframeTimestamps).toEqual([0, 1]);
    expect(source.missingSources).toEqual([]);
  });
});
