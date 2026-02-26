import { describe, it, expect, vi } from 'vitest';

describe('pipelined frame loop', () => {
  it('encodes all frames in order and closes every sample', async () => {
    const totalFrames = 5;
    const encodedFrames: number[] = [];
    const closedFrames: number[] = [];

    const frameRenderer = {
      renderFrame: vi.fn(async () => {}),
    };

    const videoSource = {
      add: vi.fn(async (sample: { frame: number }) => {
        encodedFrames.push(sample.frame);
      }),
    };

    // Mirror the production loop: render first, then await previous encode
    let pendingEncode: Promise<void> | null = null;

    for (let frame = 0; frame < totalFrames; frame++) {
      await frameRenderer.renderFrame(frame);
      if (pendingEncode) await pendingEncode;
      const sample = { frame, close: () => { closedFrames.push(frame); } };
      const isKeyFrame = frame === 0;
      pendingEncode = (async () => {
        try {
          if (isKeyFrame) {
            await videoSource.add(sample, { keyFrame: true });
          } else {
            await videoSource.add(sample);
          }
        } finally {
          sample.close();
        }
      })();
    }
    if (pendingEncode) await pendingEncode;

    expect(encodedFrames).toEqual([0, 1, 2, 3, 4]);
    expect(closedFrames).toEqual([0, 1, 2, 3, 4]);
    expect(videoSource.add).toHaveBeenCalledTimes(5);
    expect(videoSource.add.mock.calls[0][1]).toEqual({ keyFrame: true });
  });

  it('renderFrame overlaps with previous encode', async () => {
    const events: string[] = [];

    const frameRenderer = {
      renderFrame: vi.fn(async (frame: number) => {
        events.push(`render-start-${frame}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`render-end-${frame}`);
      }),
    };

    const videoSource = {
      add: vi.fn(async (sample: { frame: number }) => {
        events.push(`encode-start-${sample.frame}`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`encode-end-${sample.frame}`);
      }),
    };

    let pendingEncode: Promise<void> | null = null;

    for (let frame = 0; frame < 3; frame++) {
      await frameRenderer.renderFrame(frame);
      if (pendingEncode) await pendingEncode;
      const sample = { frame, close: () => {} };
      pendingEncode = (async () => {
        try { await videoSource.add(sample); }
        finally { sample.close(); }
      })();
    }
    if (pendingEncode) await pendingEncode;

    // render-start-1 must appear BEFORE encode-end-0 — that's the overlap.
    // render(1) begins while encode(0) is still in flight.
    const render1Start = events.indexOf('render-start-1');
    const encode0End = events.indexOf('encode-end-0');
    expect(render1Start).toBeLessThan(encode0End);

    // Same for frame 2 vs encode 1
    const render2Start = events.indexOf('render-start-2');
    const encode1End = events.indexOf('encode-end-1');
    expect(render2Start).toBeLessThan(encode1End);

    // All frames complete
    expect(events.filter(e => e.startsWith('encode-end-')).length).toBe(3);
  });
});
