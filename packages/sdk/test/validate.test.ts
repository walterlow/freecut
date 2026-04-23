import { describe, expect, it } from 'vitest';
import { createProject, deterministicIds, lintSnapshot, toSnapshot, validateSnapshot } from '../src/index.js';

describe('snapshot validation', () => {
  it('accepts a minimal valid project', () => {
    const p = createProject({ name: 'valid', ids: deterministicIds() });
    const track = p.addTrack({ kind: 'video' });
    p.addTextClip({
      trackId: track.id,
      from: 0,
      durationInFrames: 30,
      text: 'hello',
    });

    const result = validateSnapshot(toSnapshot(p));

    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('reports broken item references and invalid timing', () => {
    const p = createProject({ name: 'broken', ids: deterministicIds() });
    p.addTrack({ id: 'track-a', kind: 'video' });
    p.project.timeline!.items.push({
      id: 'item-a',
      type: 'text',
      trackId: 'missing-track',
      from: -1,
      durationInFrames: 0,
      label: 'bad',
      text: '',
      color: '#fff',
    });

    const result = lintSnapshot(toSnapshot(p));

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['item_track_missing', 'item_from_invalid', 'item_duration_invalid', 'text_required']),
    );
  });

  it('warns when transitions are not adjacent', () => {
    const p = createProject({ name: 'transition', ids: deterministicIds() });
    const track = p.addTrack({ id: 'track-a', kind: 'video' });
    const left = p.addVideoClip({ trackId: track.id, from: 0, durationInFrames: 30 });
    const right = p.addVideoClip({ trackId: track.id, from: 40, durationInFrames: 30 });
    p.addTransition({ leftClipId: left.id, rightClipId: right.id, durationInFrames: 10 });

    const result = validateSnapshot(toSnapshot(p));

    expect(result.ok).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0]?.code).toBe('transition_not_adjacent');
  });

  it('detects duplicate ids across timeline entities', () => {
    const p = createProject({ name: 'dupes', ids: deterministicIds() });
    p.addTrack({ id: 'same', kind: 'video' });
    p.addTrack({ id: 'same', kind: 'audio' });

    const result = validateSnapshot(toSnapshot(p));

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'duplicate_id')).toBe(true);
  });
});
