import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index.mjs';
import { parse } from '../src/sdk.mjs';
import { runRender } from '../src/commands/render.mjs';

class BufferStream {
  constructor() {
    this.chunks = [];
  }
  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }
  get text() {
    return this.chunks.join('');
  }
  lastJson() {
    const lines = this.text.trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  }
}

let tmp;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'freecut-cli-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function io() {
  return { stdout: new BufferStream(), stderr: new BufferStream() };
}

async function run(args, streams = io()) {
  await main(args, streams);
  return streams;
}

describe('freecut CLI', () => {
  it('creates a project file', async () => {
    const file = join(tmp, 'basic.fcproject');
    const streams = await run(['new', file, '--name', 'basic', '--fps', '30', '--json']);
    const out = streams.stdout.lastJson();
    expect(out.projectId).toMatch(/project-/);

    const snap = parse(await readFile(file, 'utf8'));
    expect(snap.project.name).toBe('basic');
    expect(snap.project.metadata).toMatchObject({ width: 1920, height: 1080, fps: 30 });
  });

  it('rejects bad integer options on new', async () => {
    const file = join(tmp, 'bad.fcproject');
    await expect(run(['new', file, '--fps', '-1'])).rejects.toThrow(/fps/);
  });

  it('builds a full scene end-to-end', async () => {
    const file = join(tmp, 'scene.fcproject');

    await run(['new', file, '--name', 'scene', '--fps', '30']);

    // Add a video track
    const track = (await run(['track', 'add', file, '--kind', 'video', '--name', 'V1', '--json']))
      .stdout.lastJson().trackId;
    expect(track).toMatch(/track-/);

    // Register media
    const media = (await run([
      'media', 'add', file,
      '--id', 'media-intro',
      '--file-name', 'intro.mp4',
      '--duration', '10',
      '--width', '1920',
      '--height', '1080',
      '--fps', '30',
      '--codec', 'avc1',
      '--bitrate', '8000000',
      '--json',
    ])).stdout.lastJson().mediaId;
    expect(media).toBe('media-intro');

    // Two back-to-back video clips
    const clipA = (await run([
      'clip', 'add', file,
      '--type', 'video',
      '--track', track,
      '--from', '0',
      '--duration', '3',
      '--media-id', media,
      '--src', 'intro.mp4',
      '--json',
    ])).stdout.lastJson().itemId;

    const clipB = (await run([
      'clip', 'add', file,
      '--type', 'video',
      '--track', track,
      '--from', '3',
      '--duration', '3',
      '--media-id', media,
      '--src', 'intro.mp4',
      '--json',
    ])).stdout.lastJson().itemId;

    // Transition between them
    const transition = (await run([
      'transition', 'add', file,
      '--left', clipA,
      '--right', clipB,
      '--duration', '0.5',
      '--preset', 'fade',
      '--json',
    ])).stdout.lastJson().transitionId;
    expect(transition).toMatch(/transition-/);

    // GPU effect on clipA
    const effect = (await run([
      'effect', 'add', file,
      '--item', clipA,
      '--gpu-type', 'gaussian-blur',
      '--params', '{"radius":10}',
      '--json',
    ])).stdout.lastJson().effectId;
    expect(effect).toMatch(/effect-/);

    // Title track + text clip
    const titleTrack = (await run(['track', 'add', file, '--kind', 'video', '--name', 'Titles', '--json']))
      .stdout.lastJson().trackId;
    await run([
      'clip', 'add', file,
      '--type', 'text',
      '--track', titleTrack,
      '--from', '0.5',
      '--duration', '2',
      '--text', 'Hello, FreeCut',
      '--font-size', '120',
      '--color', '#ffffff',
    ]);

    // Marker
    await run(['marker', 'add', file, '--at', '3', '--label', 'cut', '--color', '#ff0000']);

    // Verify final snapshot
    const snap = parse(await readFile(file, 'utf8'));
    const tl = snap.project.timeline;
    expect(tl.tracks).toHaveLength(2);
    expect(tl.items).toHaveLength(3); // 2 video + 1 text
    expect(tl.transitions).toHaveLength(1);
    expect(tl.markers).toHaveLength(1);
    expect(snap.mediaReferences).toHaveLength(1);
    expect(snap.project.duration).toBeCloseTo(6, 5);

    const blurred = tl.items.find((it) => it.id === clipA);
    expect(blurred.effects).toHaveLength(1);
    expect(blurred.effects[0].effect.gpuEffectType).toBe('gaussian-blur');
    expect(blurred.effects[0].effect.params.radius).toBe(10);

    // Text clip defaults
    const textItem = tl.items.find((it) => it.type === 'text');
    expect(textItem.text).toBe('Hello, FreeCut');
    expect(textItem.color).toBe('#ffffff');
  });

  it('inspect --json surfaces the current state', async () => {
    const file = join(tmp, 'inspect.fcproject');
    await run(['new', file, '--fps', '30']);
    const track = (await run(['track', 'add', file, '--json'])).stdout.lastJson().trackId;
    await run(['clip', 'add', file, '--type', 'text', '--track', track, '--from', '0', '--duration', '1', '--text', 'hi']);

    const streams = io();
    await main(['inspect', file, '--json'], streams);
    const parsed = JSON.parse(streams.stdout.text);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].type).toBe('text');
  });

  it('lint passes for valid snapshots', async () => {
    const file = join(tmp, 'lint-valid.fcproject');
    await run(['new', file, '--fps', '30']);
    const streams = await run(['lint', file, '--json']);
    const result = JSON.parse(streams.stdout.text);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('lint rejects invalid snapshots after printing JSON', async () => {
    const file = join(tmp, 'lint-invalid.fcproject');
    await run(['new', file, '--fps', '30']);
    const snap = JSON.parse(await readFile(file, 'utf8'));
    snap.project.timeline.items.push({
      id: 'bad-item',
      type: 'text',
      trackId: 'missing-track',
      from: 0,
      durationInFrames: 30,
      label: 'bad',
      text: '',
      color: '#fff',
    });
    await writeFile(file, JSON.stringify(snap, null, 2), 'utf8');

    const streams = io();
    await expect(main(['lint', file, '--json'], streams)).rejects.toThrow(/lint failed/);
    const result = JSON.parse(streams.stdout.text);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('item_track_missing');
  });

  it('doctor reports environment checks', async () => {
    const file = join(tmp, 'doctor.fcproject');
    await run(['new', file, '--fps', '30']);
    const streams = await run(['doctor', file, '--json']);
    const result = JSON.parse(streams.stdout.text);
    expect(result.fail).toBe(0);
    expect(result.checks.map((check) => check.name)).toContain('snapshot');
  });

  it('render loads a snapshot into a browser bridge and writes decoded output', async () => {
    const file = join(tmp, 'render.fcproject');
    const output = join(tmp, 'rendered.mp4');
    await run(['new', file, '--fps', '30']);

    const calls = [];
    const bridge = {
      waitForApi: async () => calls.push({ method: 'waitForApi' }),
      callApi: async (method, args = []) => {
        calls.push({ method, args });
        if (method === 'renderExport') {
          return {
            mimeType: 'video/mp4',
            duration: 1,
            fileSize: 8,
            extension: 'mp4',
            chunks: [Buffer.from('rendered').toString('base64')],
          };
        }
        return { projectId: 'project-1' };
      },
      close: async () => calls.push({ method: 'close' }),
    };

    const streams = io();
    await runRender(
      ['render.fcproject', '--output', output, '--json', '--url', 'localhost:5173'],
      streams,
      {
        readFile: (path, encoding) => readFile(path === 'render.fcproject' ? file : path, encoding),
        writeFile,
        connectBridge: async (opts) => {
          calls.push({ method: 'connect', opts });
          return bridge;
        },
      },
    );

    expect(await readFile(output, 'utf8')).toBe('rendered');
    const result = JSON.parse(streams.stdout.text);
    expect(result.output).toBe(output);
    expect(calls.map((call) => call.method)).toEqual([
      'connect',
      'waitForApi',
      'loadSnapshot',
      'renderExport',
      'close',
    ]);
    expect(calls[3].args[0]).toMatchObject({ mode: 'video', quality: 'high', videoContainer: 'mp4' });
  });

  it('render can open an existing project by name and pass a range', async () => {
    const output = join(tmp, 'abc-5s.mp4');
    const calls = [];
    const bridge = {
      waitForApi: async () => calls.push({ method: 'waitForApi' }),
      callApi: async (method, args = []) => {
        calls.push({ method, args });
        if (method === 'listProjects') {
          return [{ id: 'project-abc', name: 'ABC', width: 1920, height: 1080, fps: 30, updatedAt: 1 }];
        }
        if (method === 'openProject') return { id: args[0], name: 'ABC' };
        if (method === 'getProjectMeta') return { id: 'project-abc', name: 'ABC', width: 1920, height: 1080, fps: 30 };
        if (method === 'renderExport') {
          return {
            mimeType: 'video/mp4',
            duration: 5,
            fileSize: 8,
            extension: 'mp4',
            chunks: [Buffer.from('rendered').toString('base64')],
          };
        }
        return null;
      },
      close: async () => calls.push({ method: 'close' }),
    };

    await runRender(
      ['--project', 'ABC', '--duration', '5', '--output', output, '--json'],
      io(),
      {
        writeFile,
        connectBridge: async (opts) => {
          calls.push({ method: 'connect', opts });
          return bridge;
        },
      },
    );

    expect(await readFile(output, 'utf8')).toBe('rendered');
    expect(calls.map((call) => call.method)).toEqual([
      'connect',
      'waitForApi',
      'listProjects',
      'openProject',
      'getProjectMeta',
      'renderExport',
      'close',
    ]);
    expect(calls[5].args[0]).toMatchObject({
      videoContainer: 'mp4',
      range: { startSeconds: 0, durationSeconds: 5 },
    });
  });

  it('render can load a workspace project from disk without opening browser workspace storage', async () => {
    const workspace = join(tmp, 'workspace-render');
    const projectId = 'project-disk';
    const mediaId = 'media-disk';
    const output = join(tmp, 'workspace-render.webm');
    await mkdir(join(workspace, 'projects', projectId), { recursive: true });
    await mkdir(join(workspace, 'media', mediaId), { recursive: true });
    const project = {
      id: projectId,
      name: 'Disk Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 5,
      metadata: { width: 1280, height: 720, fps: 30 },
      timeline: {
        tracks: [{
          id: 'track-1',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        }],
        items: [{
          id: 'clip-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 150,
          label: 'clip.mp4',
          mediaId,
        }],
        transitions: [],
      },
    };
    await writeFile(join(workspace, 'projects', projectId, 'project.json'), JSON.stringify(project), 'utf8');
    await writeFile(join(workspace, 'index.json'), JSON.stringify({
      version: '1.0',
      projects: [{ id: projectId, name: project.name, updatedAt: 1 }],
    }), 'utf8');
    await writeFile(join(workspace, 'media', mediaId, 'metadata.json'), JSON.stringify({
      id: mediaId,
      mimeType: 'video/mp4',
      keyframeTimestamps: [0, 1, 2],
    }), 'utf8');
    await writeFile(join(workspace, 'media', mediaId, 'clip.mp4'), 'fake-media', 'utf8');

    const calls = [];
    const bridge = {
      waitForApi: async () => calls.push({ method: 'waitForApi' }),
      callApi: async (method, args = []) => {
        calls.push({ method, args });
        if (method === 'renderProjectExport') {
          return {
            mimeType: 'video/webm',
            duration: 5,
            fileSize: 8,
            extension: 'webm',
            chunks: [Buffer.from('rendered').toString('base64')],
          };
        }
        return null;
      },
      close: async () => calls.push({ method: 'close' }),
    };

    await runRender(
      [
        '--workspace', workspace,
        '--project-id', projectId,
        '--duration', '5',
        '--format', 'webm',
        '--quality', 'low',
        '--output', output,
        '--json',
      ],
      io(),
      {
        writeFile,
        connectBridge: async (opts) => {
          calls.push({ method: 'connect', opts });
          return bridge;
        },
      },
    );

    expect(await readFile(output, 'utf8')).toBe('rendered');
    expect(calls.map((call) => call.method)).toEqual([
      'connect',
      'waitForApi',
      'renderProjectExport',
      'close',
    ]);
    expect(calls[2].args[0]).toMatchObject({
      project,
      videoContainer: 'webm',
      quality: 'low',
      range: { startSeconds: 0, durationSeconds: 5 },
    });
    expect(calls[2].args[0].mediaSources[mediaId].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\/media-disk$/);
    expect(calls[2].args[0].mediaSources[mediaId].keyframeTimestamps).toEqual([0, 1, 2]);
  });

  it('workspace render validates only media overlapping the requested range', async () => {
    const workspace = join(tmp, 'workspace-render-range');
    const projectId = 'project-range';
    const earlyMediaId = 'media-early';
    const lateMediaId = 'media-late';
    const output = join(tmp, 'workspace-render-range.webm');
    await mkdir(join(workspace, 'projects', projectId), { recursive: true });
    await mkdir(join(workspace, 'media', earlyMediaId), { recursive: true });
    await mkdir(join(workspace, 'media', lateMediaId), { recursive: true });
    const project = {
      id: projectId,
      name: 'Range Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 20,
      metadata: { width: 1280, height: 720, fps: 30 },
      timeline: {
        tracks: [{
          id: 'track-1',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        }],
        items: [
          {
            id: 'clip-early',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 150,
            label: 'early.mp4',
            mediaId: earlyMediaId,
          },
          {
            id: 'clip-late',
            type: 'video',
            trackId: 'track-1',
            from: 300,
            durationInFrames: 150,
            label: 'late.mp4',
            mediaId: lateMediaId,
          },
        ],
        transitions: [],
      },
    };
    await writeFile(join(workspace, 'projects', projectId, 'project.json'), JSON.stringify(project), 'utf8');
    await writeFile(join(workspace, 'media', earlyMediaId, 'metadata.json'), JSON.stringify({
      id: earlyMediaId,
      fileName: 'early.mp4',
      mimeType: 'video/mp4',
    }), 'utf8');
    await writeFile(join(workspace, 'media', earlyMediaId, 'early.mp4'), 'fake-media', 'utf8');
    await writeFile(join(workspace, 'media', lateMediaId, 'metadata.json'), JSON.stringify({
      id: lateMediaId,
      fileName: 'late.mp4',
      mimeType: 'video/mp4',
    }), 'utf8');

    const calls = [];
    const bridge = {
      waitForApi: async () => calls.push({ method: 'waitForApi' }),
      callApi: async (method, args = []) => {
        calls.push({ method, args });
        if (method === 'renderProjectExport') {
          return {
            mimeType: 'video/webm',
            duration: 5,
            fileSize: 8,
            extension: 'webm',
            chunks: [Buffer.from('rendered').toString('base64')],
          };
        }
        return null;
      },
      close: async () => calls.push({ method: 'close' }),
    };

    await runRender(
      [
        '--workspace', workspace,
        '--project-id', projectId,
        '--start', '0',
        '--duration', '5',
        '--format', 'webm',
        '--output', output,
      ],
      io(),
      {
        writeFile,
        connectBridge: async () => bridge,
      },
    );

    expect(await readFile(output, 'utf8')).toBe('rendered');
    const renderCall = calls.find((call) => call.method === 'renderProjectExport');
    expect(Object.keys(renderCall.args[0].mediaSources)).toEqual([earlyMediaId]);
  });

  it('workspace render check reports range media readiness without connecting', async () => {
    const workspace = join(tmp, 'workspace-render-check');
    const projectId = 'project-check';
    const mediaId = 'media-missing';
    await mkdir(join(workspace, 'projects', projectId), { recursive: true });
    await mkdir(join(workspace, 'media', mediaId), { recursive: true });
    await writeFile(join(workspace, 'projects', projectId, 'project.json'), JSON.stringify({
      id: projectId,
      name: 'Check Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 5,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [],
        items: [{
          id: 'clip-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 150,
          label: 'missing.mp4',
          mediaId,
        }],
      },
    }), 'utf8');
    await writeFile(join(workspace, 'media', mediaId, 'metadata.json'), JSON.stringify({
      id: mediaId,
      fileName: 'missing.mp4',
      mimeType: 'video/mp4',
    }), 'utf8');
    const connectBridge = vi.fn();

    const streams = io();
    await runRender(
      [
        '--workspace', workspace,
        '--project-id', projectId,
        '--duration', '5',
        '--check',
        '--json',
      ],
      streams,
      { connectBridge },
    );

    const result = JSON.parse(streams.stdout.text);
    expect(result.ok).toBe(false);
    expect(result.render.range).toMatchObject({ inFrame: 0, outFrame: 150, durationSeconds: 5 });
    expect(result.missingMedia).toHaveLength(1);
    expect(result.missingMedia[0]).toMatchObject({ mediaId, fileName: 'missing.mp4', sourceExists: false });
    expect(connectBridge).not.toHaveBeenCalled();
  });

  it('render can launch a temporary browser for workspace rendering', async () => {
    const workspace = join(tmp, 'workspace-render-launch');
    const projectId = 'project-launch';
    const mediaId = 'media-launch';
    const output = join(tmp, 'workspace-render-launch.webm');
    await mkdir(join(workspace, 'projects', projectId), { recursive: true });
    await mkdir(join(workspace, 'media', mediaId), { recursive: true });
    await writeFile(join(workspace, 'projects', projectId, 'project.json'), JSON.stringify({
      id: projectId,
      name: 'Launch Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 5,
      metadata: { width: 1280, height: 720, fps: 30 },
      timeline: {
        tracks: [],
        items: [{
          id: 'clip-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 150,
          label: 'clip.mp4',
          mediaId,
        }],
      },
    }), 'utf8');
    await writeFile(join(workspace, 'media', mediaId, 'metadata.json'), JSON.stringify({
      id: mediaId,
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
    }), 'utf8');
    await writeFile(join(workspace, 'media', mediaId, 'clip.mp4'), 'fake-media', 'utf8');

    const calls = [];
    const bridge = {
      waitForApi: async () => calls.push({ method: 'waitForApi' }),
      callApi: async (method, args = []) => {
        calls.push({ method, args });
        if (method === 'renderProjectExport') {
          return {
            mimeType: 'video/webm',
            duration: 5,
            fileSize: 8,
            extension: 'webm',
            chunks: [Buffer.from('rendered').toString('base64')],
          };
        }
        return null;
      },
      close: async () => calls.push({ method: 'bridge.close' }),
    };

    await runRender(
      [
        '--workspace', workspace,
        '--project-id', projectId,
        '--duration', '5',
        '--format', 'webm',
        '--output', output,
        '--launch-browser',
      ],
      io(),
      {
        writeFile,
        findAvailablePort: async () => 9333,
        launchBrowser: async (opts) => {
          calls.push({ method: 'launchBrowser', opts });
          return {
            port: opts.port,
            url: opts.url,
            close: async () => calls.push({ method: 'browser.close' }),
          };
        },
        connectBridge: async (opts) => {
          calls.push({ method: 'connect', opts });
          return bridge;
        },
      },
    );

    expect(await readFile(output, 'utf8')).toBe('rendered');
    expect(calls[0]).toMatchObject({
      method: 'launchBrowser',
      opts: { port: 9333, url: 'http://localhost:5173/?agent=1' },
    });
    expect(calls[1]).toMatchObject({
      method: 'connect',
      opts: { port: 9333, url: 'http://localhost:5173/?agent=1' },
    });
    expect(calls.map((call) => call.method)).toContain('browser.close');
  });

  it('lists projects from a workspace folder', async () => {
    const workspace = join(tmp, 'workspace-list');
    const projectA = {
      id: 'project-a',
      name: 'Alpha',
      description: 'first',
      createdAt: 1,
      updatedAt: 20,
      duration: 12.5,
      schemaVersion: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [{ id: 'track-1' }],
        items: [{ id: 'item-1' }, { id: 'item-2' }],
      },
    };
    const projectB = {
      id: 'project-b',
      name: 'Beta',
      description: '',
      createdAt: 2,
      updatedAt: 10,
      duration: 4,
      metadata: { width: 1280, height: 720, fps: 24 },
      timeline: { tracks: [], items: [] },
    };

    await mkdir(join(workspace, 'projects', projectA.id), { recursive: true });
    await mkdir(join(workspace, 'projects', projectB.id), { recursive: true });
    await writeFile(join(workspace, 'index.json'), JSON.stringify({
      version: '1.0',
      projects: [
        { id: projectB.id, name: projectB.name, updatedAt: projectB.updatedAt },
        { id: projectA.id, name: projectA.name, updatedAt: projectA.updatedAt },
      ],
    }), 'utf8');
    await writeFile(join(workspace, 'projects', projectA.id, 'project.json'), JSON.stringify(projectA), 'utf8');
    await writeFile(join(workspace, 'projects', projectA.id, 'media-links.json'), JSON.stringify({
      version: '1.0',
      mediaIds: [{ id: 'media-1', addedAt: 1 }],
    }), 'utf8');
    await writeFile(join(workspace, 'projects', projectB.id, 'project.json'), JSON.stringify(projectB), 'utf8');

    const streams = await run(['workspace', 'projects', workspace, '--json']);
    const result = JSON.parse(streams.stdout.text);
    expect(result.workspace).toBe(workspace);
    expect(result.projects.map((project) => project.id)).toEqual(['project-a', 'project-b']);
    expect(result.projects[0]).toMatchObject({
      id: 'project-a',
      name: 'Alpha',
      width: 1920,
      height: 1080,
      fps: 30,
      itemCount: 2,
      mediaCount: 1,
      trashed: false,
    });

    const text = (await run(['workspace', 'list', workspace])).stdout.text;
    expect(text).toContain('project-a');
    expect(text).toContain('Alpha');
  });

  it('workspace projects falls back to scanning project directories and hides trash', async () => {
    const workspace = join(tmp, 'workspace-scan');
    await mkdir(join(workspace, 'projects', 'visible'), { recursive: true });
    await mkdir(join(workspace, 'projects', 'trashed'), { recursive: true });
    await writeFile(join(workspace, 'projects', 'visible', 'project.json'), JSON.stringify({
      id: 'visible',
      name: 'Visible',
      createdAt: 1,
      updatedAt: 1,
      duration: 1,
      metadata: { width: 1, height: 1, fps: 30 },
      timeline: { tracks: [], items: [] },
    }), 'utf8');
    await writeFile(join(workspace, 'projects', 'trashed', 'project.json'), JSON.stringify({
      id: 'trashed',
      name: 'Trashed',
      createdAt: 1,
      updatedAt: 2,
      duration: 1,
      metadata: { width: 1, height: 1, fps: 30 },
      timeline: { tracks: [], items: [] },
    }), 'utf8');
    await writeFile(join(workspace, 'projects', 'trashed', '.freecut-trashed.json'), '{}', 'utf8');

    const hidden = JSON.parse((await run(['workspace', 'projects', workspace, '--json'])).stdout.text);
    expect(hidden.projects.map((project) => project.id)).toEqual(['visible']);

    const included = JSON.parse(
      (await run(['workspace', 'projects', workspace, '--include-trashed', '--json'])).stdout.text,
    );
    expect(included.projects.map((project) => project.id)).toEqual(['trashed', 'visible']);
    expect(included.projects[0].trashed).toBe(true);
  });

  it('render refuses snapshots with lint errors before connecting to Chrome', async () => {
    const file = join(tmp, 'render-invalid.fcproject');
    await run(['new', file]);
    const snap = JSON.parse(await readFile(file, 'utf8'));
    snap.project.timeline.items.push({
      id: 'bad-item',
      type: 'text',
      trackId: 'missing-track',
      from: 0,
      durationInFrames: 30,
      label: 'bad',
      text: 'bad',
      color: '#fff',
    });
    await writeFile(file, JSON.stringify(snap, null, 2), 'utf8');
    const connectBridge = vi.fn();

    await expect(runRender([file], io(), { connectBridge })).rejects.toThrow(/lint error/);
    expect(connectBridge).not.toHaveBeenCalled();
  });

  it('rejects cross-track transitions', async () => {
    const file = join(tmp, 'xtrans.fcproject');
    await run(['new', file]);
    const a = (await run(['track', 'add', file, '--json'])).stdout.lastJson().trackId;
    const b = (await run(['track', 'add', file, '--json'])).stdout.lastJson().trackId;
    const itemA = (await run(['clip', 'add', file, '--type', 'video', '--track', a, '--from', '0', '--duration', '2', '--json'])).stdout.lastJson().itemId;
    const itemB = (await run(['clip', 'add', file, '--type', 'video', '--track', b, '--from', '0', '--duration', '2', '--json'])).stdout.lastJson().itemId;

    await expect(run([
      'transition', 'add', file,
      '--left', itemA, '--right', itemB, '--duration', '0.5',
    ])).rejects.toThrow(/same track/);
  });

  it('help command exits cleanly', async () => {
    const streams = io();
    await main(['--help'], streams);
    expect(streams.stdout.text).toMatch(/freecut — programmatic/);
  });

  it('unknown command throws usage', async () => {
    await expect(run(['flarp'])).rejects.toThrow(/unknown command/);
  });
});
