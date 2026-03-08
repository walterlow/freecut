import { describe, expect, it } from 'vitest';
import type { MaskVertex } from '@/types/masks';
import { fitShapePathToBounds, getPathBounds } from './path-fit';

describe('path-fit utilities', () => {
  it('computes bezier bounds beyond anchor points', () => {
    const vertices: MaskVertex[] = [
      {
        position: [0, 0],
        inHandle: [0, 0],
        outHandle: [0, 1],
      },
      {
        position: [1, 0],
        inHandle: [0, 1],
        outHandle: [0, 0],
      },
    ];

    const bounds = getPathBounds(vertices);

    expect(bounds).not.toBeNull();
    expect(bounds?.minX).toBeCloseTo(0);
    expect(bounds?.maxX).toBeCloseTo(1);
    expect(bounds?.minY).toBeCloseTo(0);
    expect(bounds?.maxY).toBeCloseTo(0.75);
  });

  it('fits a path to tight bounds and updates transform center and size', () => {
    const vertices: MaskVertex[] = [
      {
        position: [0, 0],
        inHandle: [0, 0],
        outHandle: [0, 1],
      },
      {
        position: [1, 0],
        inHandle: [0, 1],
        outHandle: [0, 0],
      },
    ];

    const result = fitShapePathToBounds(vertices, {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    });

    expect(result.transform.width).toBeCloseTo(200);
    expect(result.transform.height).toBeCloseTo(75);
    expect(result.transform.x).toBeCloseTo(0);
    expect(result.transform.y).toBeCloseTo(-12.5);
    expect(result.pathVertices[0]?.position).toEqual([0, 0]);
    expect(result.pathVertices[1]?.position).toEqual([1, 0]);
    expect(result.pathVertices[0]?.outHandle[1]).toBeCloseTo(4 / 3);
    expect(result.pathVertices[1]?.inHandle[1]).toBeCloseTo(4 / 3);
  });

  it('treats near-zero derivative discriminants as a single root', () => {
    const vertices: MaskVertex[] = [
      {
        position: [0, 0],
        inHandle: [0, 0],
        outHandle: [1 / 3, 0],
      },
      {
        position: [1, 0],
        inHandle: [-1 / 3, 1e-12],
        outHandle: [0, 0],
      },
    ];

    const bounds = getPathBounds(vertices);

    expect(bounds).not.toBeNull();
    expect(bounds?.minX).toBeCloseTo(0);
    expect(bounds?.maxX).toBeCloseTo(1);
    expect(bounds?.maxY).toBeGreaterThanOrEqual(0);
  });
});
