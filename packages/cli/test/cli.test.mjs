import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index.mjs';
import { parse } from '../src/sdk.mjs';

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
