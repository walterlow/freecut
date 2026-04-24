import { describe, expect, it } from 'vitest';
import { lintSnapshot, validateSnapshot } from '../src/index.ts';

describe('snapshot validation', () => {
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
});
