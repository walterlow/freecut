import { describe, expect, it } from 'vitest';
import {
  createProject,
  deterministicIds,
  parse,
  serialize,
  SnapshotParseError,
  toSnapshot,
} from '../src/index';

function fixedClock() {
  let t = 1_700_000_000_000;
  return () => t++;
}

describe('ProjectBuilder', () => {
  it('creates an empty project with sensible defaults', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds(), now: fixedClock() });
    expect(p.project.name).toBe('demo');
    expect(p.project.metadata).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(p.project.timeline?.tracks).toHaveLength(0);
    expect(p.project.timeline?.items).toHaveLength(0);
  });

  it('adds a video clip and recomputes duration on touch', () => {
    const p = createProject({ name: 'demo', fps: 30, ids: deterministicIds(), now: fixedClock() });
    const track = p.addTrack({ kind: 'video' });
    p.addVideoClip({
      trackId: track.id,
      from: 0,
      durationInFrames: 90, // 3 seconds
      mediaId: 'media-1',
    });
    p.touch();
    expect(p.project.duration).toBe(3);
    expect(p.project.timeline?.items).toHaveLength(1);
  });

  it('stacks new tracks above existing ones', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const t1 = p.addTrack();
    const t2 = p.addTrack();
    const t3 = p.addTrack();
    expect(t1.order).toBe(-1);
    expect(t2.order).toBe(-2);
    expect(t3.order).toBe(-3);
  });

  it('ensureTrack reuses an existing track of the same kind', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const first = p.ensureTrack('video');
    const again = p.ensureTrack('video');
    expect(first.id).toBe(again.id);
    const audio = p.ensureTrack('audio');
    expect(audio.id).not.toBe(first.id);
  });

  it('endOfTrack returns the last-used frame on that track', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const t = p.addTrack();
    p.addVideoClip({ trackId: t.id, from: 0, durationInFrames: 60 });
    p.addVideoClip({ trackId: t.id, from: 60, durationInFrames: 30 });
    expect(p.endOfTrack(t.id)).toBe(90);
  });

  it('split divides a clip and preserves source-frame math', () => {
    const p = createProject({ name: 'demo', fps: 30, ids: deterministicIds() });
    const t = p.addTrack();
    const clip = p.addVideoClip({
      trackId: t.id,
      from: 0,
      durationInFrames: 90,
      sourceStart: 0,
      sourceEnd: 90,
      sourceFps: 30,
    });
    const right = p.split(clip.id, 30);
    expect(clip.durationInFrames).toBe(30);
    expect(right.from).toBe(30);
    expect(right.durationInFrames).toBe(60);
    expect(right.sourceStart).toBe(30);
  });

  it('split rejects boundaries outside the clip', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const t = p.addTrack();
    const clip = p.addVideoClip({ trackId: t.id, from: 10, durationInFrames: 20 });
    expect(() => p.split(clip.id, 10)).toThrow(RangeError);
    expect(() => p.split(clip.id, 30)).toThrow(RangeError);
    expect(() => p.split(clip.id, 5)).toThrow(RangeError);
  });

  it('applyGpuEffect appends an effect entry on the clip', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const t = p.addTrack();
    const clip = p.addVideoClip({ trackId: t.id, from: 0, durationInFrames: 30 });
    const id = p.applyGpuEffect(clip.id, {
      type: 'gpu-effect',
      gpuEffectType: 'gaussian-blur',
      params: { radius: 10 },
    });
    expect(clip.effects).toHaveLength(1);
    expect(clip.effects?.[0]?.id).toBe(id);
    expect(clip.effects?.[0]?.enabled).toBe(true);
  });

  it('addTransition requires matching tracks', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const a = p.addTrack();
    const b = p.addTrack();
    const clipA = p.addVideoClip({ trackId: a.id, from: 0, durationInFrames: 60 });
    const clipB = p.addVideoClip({ trackId: b.id, from: 30, durationInFrames: 60 });
    expect(() =>
      p.addTransition({
        leftClipId: clipA.id,
        rightClipId: clipB.id,
        durationInFrames: 30,
      }),
    ).toThrow(/same track/);
  });

  it('addTransition stores preset and properties', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    const t = p.addTrack();
    const a = p.addVideoClip({ trackId: t.id, from: 0, durationInFrames: 60 });
    const b = p.addVideoClip({ trackId: t.id, from: 45, durationInFrames: 60 });
    const tr = p.addTransition({
      leftClipId: a.id,
      rightClipId: b.id,
      durationInFrames: 15,
      presetId: 'fade',
      alignment: 0.5,
    });
    expect(tr.trackId).toBe(t.id);
    expect(tr.presetId).toBe('fade');
    expect(p.project.timeline?.transitions).toHaveLength(1);
  });

  it('sets and clears render ranges', () => {
    const p = createProject({ name: 'demo', fps: 30, ids: deterministicIds() });
    p.setRenderRange({ startFrame: 30, durationInFrames: 150 });
    expect(p.project.timeline?.inPoint).toBe(30);
    expect(p.project.timeline?.outPoint).toBe(180);

    p.setInOutPoints(0, 150);
    expect(p.project.timeline?.inPoint).toBe(0);
    expect(p.project.timeline?.outPoint).toBe(150);

    p.clearInOutPoints();
    expect(p.project.timeline?.inPoint).toBeUndefined();
    expect(p.project.timeline?.outPoint).toBeUndefined();
  });

  it('rejects invalid render ranges', () => {
    const p = createProject({ name: 'demo', ids: deterministicIds() });
    expect(() => p.setInOutPoints(10, 10)).toThrow(RangeError);
    expect(() => p.setInOutPoints(-1, 10)).toThrow(RangeError);
    expect(() => p.setRenderRange({ startFrame: 0 })).toThrow(/durationInFrames/);
  });

  it('deterministic ids produce stable snapshots', () => {
    const a = buildGolden();
    const b = buildGolden();
    const opts = { exportedAt: '2026-01-01T00:00:00.000Z' };
    expect(serialize(a, opts)).toBe(serialize(b, opts));
  });
});

describe('serialize/parse', () => {
  it('round-trips a snapshot', () => {
    const p = buildGolden();
    const json = serialize(p);
    const back = parse(json);
    expect(back.version).toBe('1.0');
    expect(back.project.name).toBe('demo');
    expect(back.project.timeline?.items).toHaveLength(1);
    expect(back.mediaReferences).toHaveLength(1);
  });

  it('embeds the sdk version in editorVersion by default', () => {
    const snap = toSnapshot(buildGolden());
    expect(snap.editorVersion).toMatch(/@freecut\/sdk@/);
  });

  it('throws SnapshotParseError on malformed JSON', () => {
    expect(() => parse('{')).toThrow(SnapshotParseError);
    expect(() => parse('null')).toThrow(SnapshotParseError);
    expect(() => parse(JSON.stringify({ project: {} }))).toThrow(/version/);
  });
});

function buildGolden() {
  const p = createProject({
    name: 'demo',
    fps: 30,
    width: 1920,
    height: 1080,
    ids: deterministicIds(),
    now: fixedClock(),
  });
  p.addMediaReference({
    id: 'media-1',
    fileName: 'clip.mp4',
    fileSize: 1000,
    mimeType: 'video/mp4',
    duration: 3,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'avc1',
    bitrate: 5_000_000,
  });
  const track = p.addTrack({ kind: 'video' });
  p.addVideoClip({
    trackId: track.id,
    from: 0,
    durationInFrames: 90,
    mediaId: 'media-1',
    src: 'clip.mp4',
  });
  p.touch();
  return p;
}
