import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClipMask } from '@/types/masks';
import { renderMasks } from './mask-renderer';

class MockCanvasRenderingContext2D {
  public fillStyle = '#000000';
  public globalAlpha = 1;
  public globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  public filter = 'none';
  private pixels: Uint8ClampedArray;

  constructor(private readonly canvas: MockOffscreenCanvas) {
    this.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  setTransform() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}

  clearRect() {
    this.ensureSize();
    this.pixels.fill(0);
  }

  fillRect() {
    this.paint(this.fillStyle);
  }

  fill() {
    this.paint(this.fillStyle);
  }

  drawImage(source: MockOffscreenCanvas) {
    const sourcePixels = source.__getPixels();
    this.pixels = new Uint8ClampedArray(sourcePixels);
  }

  getImageData(_x: number, _y: number, width: number, height: number): ImageData {
    this.ensureSize();
    return new ImageData(new Uint8ClampedArray(this.pixels), width, height);
  }

  putImageData(imageData: ImageData) {
    this.pixels = new Uint8ClampedArray(imageData.data);
  }

  __getPixels(): Uint8ClampedArray {
    this.ensureSize();
    return this.pixels;
  }

  private ensureSize(): void {
    const expectedSize = this.canvas.width * this.canvas.height * 4;
    if (this.pixels.length !== expectedSize) {
      this.pixels = new Uint8ClampedArray(expectedSize);
    }
  }

  private paint(fillStyle: string): void {
    this.ensureSize();
    const value = fillStyle === '#ffffff' ? 255 : 0;
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = value;
      this.pixels[i + 1] = value;
      this.pixels[i + 2] = value;
      this.pixels[i + 3] = 0;
    }
  }
}

class MockOffscreenCanvas {
  public readonly context: MockCanvasRenderingContext2D;

  constructor(public width: number, public height: number) {
    this.context = new MockCanvasRenderingContext2D(this);
  }

  getContext(type: '2d'): OffscreenCanvasRenderingContext2D | null {
    if (type !== '2d') return null;
    return this.context as unknown as OffscreenCanvasRenderingContext2D;
  }

  __getPixels(): Uint8ClampedArray {
    return this.context.__getPixels();
  }
}

function createMask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'mask-1',
    vertices: [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
    ...overrides,
  };
}

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
});

describe('mask-renderer', () => {
  it('stores mask strength in alpha so destination-in compositing stays stable', () => {
    const imageData = renderMasks([createMask()], 2, 2);

    expect(Array.from(imageData.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(imageData.data.slice(4, 8))).toEqual([255, 255, 255, 255]);
  });
});
