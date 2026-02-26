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

    let pendingEncode: Promise<void> | null = null;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (pendingEncode) await pendingEncode;
      await frameRenderer.renderFrame(frame);
      const sample = { frame, close: () => { closedFrames.push(frame); } };
      pendingEncode = (async () => {
        try {
          if (frame === 0) {
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

  it('all frames are rendered and encoded even with async timing', async () => {
    const totalFrames = 10;
    const encodedFrames: number[] = [];

    const frameRenderer = {
      renderFrame: vi.fn(async () => {}),
    };

    const videoSource = {
      add: vi.fn(async (sample: { frame: number }) => {
        await new Promise((r) => setTimeout(r, 1));
        encodedFrames.push(sample.frame);
      }),
    };

    let pendingEncode: Promise<void> | null = null;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (pendingEncode) await pendingEncode;
      await frameRenderer.renderFrame(frame);
      const sample = { frame, close: () => {} };
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

    expect(encodedFrames).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
