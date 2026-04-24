import { describe, expect, it } from 'vitest';
import { planProjectRender, resolveProjectRenderRange } from '../src/index.ts';

describe('project render planning', () => {
  it('resolves explicit ranges before timeline in/out markers', () => {
    const project = {
      metadata: { fps: 30 },
      timeline: { inPoint: 30, outPoint: 90 },
    };

    expect(resolveProjectRenderRange(project)).toEqual({ inFrame: 30, outFrame: 90 });
    expect(resolveProjectRenderRange(project, { startSeconds: 0, durationSeconds: 1 })).toEqual({
      inFrame: 0,
      outFrame: 30,
    });
    expect(resolveProjectRenderRange(project, { inFrame: 12, outFrame: 24 })).toEqual({
      inFrame: 12,
      outFrame: 24,
    });
    expect(resolveProjectRenderRange(project, { startSeconds: 0, durationSeconds: 1 }, true)).toBeNull();
  });

  it('plans media usage and source readiness for the effective range', () => {
    const project = {
      metadata: { fps: 30 },
      timeline: {
        items: [
          { id: 'visible', type: 'video', mediaId: 'media-visible', from: 0, durationInFrames: 60 },
          { id: 'late', type: 'audio', mediaId: 'media-late', from: 120, durationInFrames: 60 },
        ],
      },
    };

    const plan = planProjectRender(project, {
      range: { startSeconds: 0, durationSeconds: 2 },
      mediaSources: { 'media-visible': 'blob:visible', 'media-unused': 'blob:unused' },
    });

    expect(plan.effectiveRange).toEqual({ inFrame: 0, outFrame: 60 });
    expect([...plan.mediaUsage.keys()]).toEqual(['media-visible']);
    expect(plan.mediaSourcePlan).toMatchObject({
      ok: true,
      requiredMediaIds: ['media-visible'],
      missingMediaIds: [],
      unusedMediaIds: ['media-unused'],
    });
  });

  it('reports missing sources in range-limited plans', () => {
    const project = {
      metadata: { fps: 30 },
      timeline: {
        items: [
          { id: 'clip', type: 'image', mediaId: 'media-needed', from: 0, durationInFrames: 30 },
        ],
      },
    };

    const plan = planProjectRender(project, { mediaSources: {} });
    expect(plan.mediaSourcePlan).toMatchObject({
      ok: false,
      missingMediaIds: ['media-needed'],
    });
  });
});
